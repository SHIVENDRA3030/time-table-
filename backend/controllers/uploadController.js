// Excel import (enterprise plan F4): uploads are staged asynchronously.
// POST /api/upload → parse + validate only, returns 202 + job id + preview
// (per-row errors land in the job result). POST /api/imports/:id/commit →
// worker applies everything in one transaction. The database reset stays
// gated by ALLOW_DATABASE_RESET / non-production.
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const excelService = require('../services/excelService');
const importService = require('../services/importService');
const jobService = require('../services/jobService');
const db = require('../db');
const { withTransaction } = require('../db');
const { audit } = require('../services/auditService');

const TMP_DIR = path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Payload caps (F10): 10 MB, single file.
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const RESET_TABLES = [
    'timetable_entries',
    'time_slots',
    'rooms',
    'faculty',
    'subjects',
    'sections',
    'programs'
];

const canResetDatabase = () => {
    const override = String(process.env.ALLOW_DATABASE_RESET || '').toLowerCase();
    if (override) return ['1', 'true', 'yes', 'on'].includes(override);
    return process.env.NODE_ENV !== 'production';
};

const stageUpload = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    try {
        // Parse + validate right away so obvious format errors fail fast (the
        // buffer is small enough for an inline parse; the writes are what run
        // in the background).
        const preview = importService.stageImport(req.file.buffer);

        // Persist the workbook BEFORE creating the job row (with file_path and
        // status 'staged' in one insert) — otherwise the worker can claim the
        // job before the file exists.
        const jobId = crypto.randomUUID();
        const filePath = path.join(TMP_DIR, `import-${jobId}.xlsx`);
        fs.writeFileSync(filePath, req.file.buffer);

        const job = await jobService.createJob(
            'import',
            { fileName: req.file.originalname, stage: 'commit', totalParsed: preview.totalParsed },
            req.auth?.userId || null,
            filePath,
            'staged'
        );
        await jobService.setJobStatus(job.id, { result: preview });

        await audit(req, 'upload.staged', 'import_job', job.id, {
            fileName: req.file.originalname,
            totalParsed: preview.totalParsed,
        });

        return res.status(202).json({
            message: 'File staged. Review the preview, then commit to apply.',
            jobId: job.id,
            preview,
        });
    } catch (error) {
        const status = error.status || 500;
        return res.status(status).json({ error: error.message });
    }
};

const commitImport = async (req, res) => {
    const { id } = req.params;
    try {
        const job = await jobService.getJob(id);
        if (!job) return res.status(404).json({ error: 'Import job not found.' });
        if (job.status === 'done') {
            return res.status(409).json({ error: 'This import was already committed.', result: job.result });
        }
        if (job.status !== 'staged') {
            return res.status(409).json({ error: `Import is not ready to commit (status: ${job.status}).` });
        }
        if (job.created_by && req.auth?.userId && job.created_by !== req.auth.userId && req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Only the uploader or an admin can commit this import.' });
        }

        // Re-parse the stored workbook and apply it asynchronously.
        await jobService.setJobStatus(job.id, { status: 'queued', result: null });
        await db.query(
            `UPDATE jobs SET payload = payload || '{"stage": "commit"}'::jsonb, updated_at = now() WHERE id = $1`,
            [job.id]
        );
        return res.status(202).json({ message: 'Commit queued.', jobId: job.id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Worker handlers — registered by services/workers.js.
const importHandlers = {
    // kind 'import': payload.stage 'parse' (unused — staging happens inline) or
    // 'commit' → re-parse the stored file and apply everything transactionally.
    import: async (job) => {
        const stage = job.payload?.stage || 'parse';
        if (stage === 'parse') {
            // Pure parse: store the staged preview (defensive — staging normally
            // happens inline in stageUpload).
            const buffer = fs.readFileSync(job.file_path);
            const preview = importService.stageImport(buffer);
            return { status: 'staged', result: preview };
        }
        const buffer = fs.readFileSync(job.file_path);
        const parsedData = excelService.parseExcelBuffer(buffer);
        const results = await withTransaction((client) => importService.commitImport(client, parsedData));
        try {
            fs.unlinkSync(job.file_path);
        } catch { /* already gone */ }
        return { status: 'done', result: results };
    },
};

const getTableCount = async (table) => {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    return rows[0].count || 0;
};

const clearDatabaseData = async (req, res) => {
    if (!canResetDatabase()) {
        return res.status(403).json({
            error: 'Database reset is disabled. Set ALLOW_DATABASE_RESET=true on the server to enable this action.'
        });
    }

    try {
        const deleted = {};
        let totalDeleted = 0;
        await withTransaction(async (client) => {
            for (const table of RESET_TABLES) {
                const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
                const countBefore = rows[0].count;
                deleted[table] = countBefore;
                totalDeleted += countBefore;
                if (countBefore > 0) {
                    await client.query(`DELETE FROM ${table} WHERE id IS NOT NULL`);
                }
            }
        });

        await audit(req, 'database.reset', 'timetable_entry', null, { totalDeleted, deleted });
        return res.json({
            message: 'Database data deleted successfully.',
            summary: { totalDeleted, deleted }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};

module.exports = {
    uploadMiddleware: upload.single('file'),
    stageUpload,
    commitImport,
    importHandlers,
    clearDatabaseData
};
