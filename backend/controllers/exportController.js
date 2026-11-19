// Section timetable export (enterprise plan F4): queued as a background job
// and downloaded when ready instead of building the workbook in-request.
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { audit } = require('../services/auditService');
const jobService = require('../services/jobService');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EXPORT_DIR = path.join(__dirname, '..', 'tmp', 'exports');
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

const buildWorkbook = async (sectionId) => {
    const { rows: sectionRows } = await db.query(
        'SELECT s.name, p.name AS program_name FROM sections s LEFT JOIN programs p ON p.id = s.program_id WHERE s.id = $1',
        [sectionId]
    );
    const section = sectionRows[0];
    if (!section) {
        const error = new Error('Section not found.');
        error.status = 404;
        throw error;
    }

    const { rows } = await db.query(`
        SELECT te.id, te.day,
               sub.code AS subject_code, sub.name AS subject_name,
               fac.name AS faculty_name, rm.room_number AS room_number,
               ts.start_time, ts.end_time, ts.slot_number, ts.id AS time_slot_id
        FROM timetable_entries te
        LEFT JOIN subjects sub ON sub.id = te.subject_id
        LEFT JOIN faculty fac ON fac.id = te.faculty_id
        LEFT JOIN rooms rm ON rm.id = te.room_id
        LEFT JOIN time_slots ts ON ts.id = te.time_slot_id
        WHERE te.section_id = $1
    `, [sectionId]);

    const slots = [...new Map(rows.filter((r) => r.time_slot_id).map((r) => [r.time_slot_id, r]))
        .values()]
        .sort((a, b) => (a.slot_number || 0) - (b.slot_number || 0) || String(a.start_time).localeCompare(String(b.start_time)));

    const cellText = (row) => {
        if (!row) return '';
        const parts = [row.subject_code ? `${row.subject_code} ${row.subject_name || ''}`.trim() : row.subject_name || ''];
        if (row.faculty_name) parts.push(row.faculty_name);
        if (row.room_number) parts.push(row.room_number);
        return parts.filter(Boolean).join('\n');
    };

    const header = ['Day', ...slots.map((s) => `Slot ${s.slot_number}\n${String(s.start_time).slice(0, 5)}-${String(s.end_time).slice(0, 5)}`)];
    const aoa = [header];
    for (const day of DAYS) {
        const line = [day];
        for (const slot of slots) {
            const cellRows = rows.filter((r) => r.day === day && r.time_slot_id === slot.time_slot_id);
            line.push(cellRows.map(cellText).join('\n---\n'));
        }
        aoa.push(line);
    }

    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    sheet['!cols'] = [{ wch: 12 }, ...slots.map(() => ({ wch: 26 }))];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Timetable');

    const safeName = `${section.program_name || ''}-${section.name}`.replace(/[^a-z0-9-]+/gi, '_').toLowerCase();
    const filePath = path.join(EXPORT_DIR, `timetable-${safeName}-${Date.now()}.xlsx`);
    fs.writeFileSync(filePath, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
    return { filePath, section, rowCount: rows.length };
};

// POST /api/export/timetable/:sectionId — queue the export (202 + job id).
const queueSectionExport = async (req, res) => {
    const { sectionId } = req.params;
    try {
        const { rows: sectionRows } = await db.query('SELECT name FROM sections WHERE id = $1', [sectionId]);
        if (!sectionRows[0]) return res.status(404).json({ error: 'Section not found.' });

        const job = await jobService.createJob(
            'export',
            { sectionId, sectionName: sectionRows[0].name },
            req.auth?.userId || null
        );
        await audit(req, 'export.queued', 'section', sectionId, { jobId: job.id });
        return res.status(202).json({ message: 'Export queued. Download when the job completes.', jobId: job.id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// GET /api/exports/:id/download — stream the finished workbook.
const downloadExport = async (req, res) => {
    const { id } = req.params;
    try {
        const job = await jobService.getJob(id);
        if (!job || job.kind !== 'export') return res.status(404).json({ error: 'Export job not found.' });
        if (job.status !== 'done') {
            return res.status(409).json({ error: `Export is not ready (status: ${job.status}).` });
        }
        if (!job.file_path || !fs.existsSync(job.file_path)) {
            return res.status(410).json({ error: 'Export file has expired. Queue a new export.' });
        }
        const safeName = `${job.payload?.sectionName || 'section'}`.replace(/[^a-z0-9-]+/gi, '_').toLowerCase();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="timetable-${safeName}.xlsx"`);
        res.send(fs.readFileSync(job.file_path));
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Worker handler for kind 'export'.
const exportHandler = async (job) => {
    const { filePath, section, rowCount } = await buildWorkbook(job.payload.sectionId);
    await audit({ auth: { userId: job.created_by } }, 'export.xlsx', 'section', job.payload.sectionId, {
        section: section.name,
        entries: rowCount,
        jobId: job.id,
    });
    // filePath lands on the job's file_path column (jobService persists it) so
    // GET /api/exports/:id/download can stream the workbook.
    return { rowCount, section: section.name, filePath };
};

// GET /api/export/timetable/:sectionId.xlsx — legacy synchronous export kept
// for the existing web UI; new clients should use the queued flow above.
const exportSectionTimetable = async (req, res) => {
    try {
        const { filePath, section, rowCount } = await buildWorkbook(req.params.sectionId);
        await audit(req, 'export.xlsx', 'section', req.params.sectionId, { section: section.name, entries: rowCount });
        const safeName = `${section.program_name || ''}-${section.name}`.replace(/[^a-z0-9-]+/gi, '_').toLowerCase();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="timetable-${safeName}.xlsx"`);
        res.send(fs.readFileSync(filePath));
        fs.unlinkSync(filePath);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
};

module.exports = { queueSectionExport, downloadExport, exportHandler, exportSectionTimetable };
