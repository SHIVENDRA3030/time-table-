const db = require('../db');
const { audit } = require('../services/auditService');

// Guard helper: refuse destructive deletes while dependent rows exist unless
// the caller explicitly confirms with ?force=1.
const guardDelete = async (req, res, counts) => {
    const force = req.query.force === '1';
    const blocking = counts.filter((c) => c.count > 0);
    if (blocking.length > 0 && !force) {
        res.status(409).json({
            error: `Cannot delete yet: ${blocking.map((c) => `${c.count} ${c.label}`).join(', ')} reference this and would be removed too. Confirm with force=1 to delete everything.`
        });
        return false;
    }
    return true;
};

// Programs
const getAllPrograms = async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM programs WHERE deleted_at IS NULL ORDER BY name');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteProgram = async (req, res) => {
    try {
        const { rows: counts } = await db.query(`
            SELECT
                (SELECT COUNT(*)::int FROM sections WHERE program_id = $1) AS sections,
                (SELECT COUNT(*)::int FROM timetable_entries te
                    JOIN sections s ON s.id = te.section_id WHERE s.program_id = $1) AS entries
        `, [req.params.id]);
        const ok = await guardDelete(req, res, [
            { count: counts[0].sections, label: 'sections' },
            { count: counts[0].entries, label: 'timetable classes' }
        ]);
        if (!ok) return;
        await db.query('DELETE FROM programs WHERE id = $1', [req.params.id]);
        await audit(req, 'program.delete', 'program', req.params.id, { forced: req.query.force === '1' });
        res.json({ message: 'Program deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createProgram = async (req, res) => {
    const { name, department } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO programs (name, department) VALUES ($1, $2) RETURNING *',
            [name, department]
        );
        await audit(req, 'program.create', 'program', rows[0].id, { name });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateProgram = async (req, res) => {
    const { id } = req.params;
    const { name, department } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE programs
             SET name = COALESCE($1, name),
                 department = COALESCE($2, department)
             WHERE id = $3
             RETURNING *`,
            [name || null, department || null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Program not found.' });
        await audit(req, 'program.update', 'program', id, { name, department });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Sections
const getAllSections = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT s.*, p.name AS program_name
            FROM sections s
            LEFT JOIN programs p ON p.id = s.program_id
        `);
        const data = rows.map(({ program_name, ...section }) => ({
            ...section,
            program: program_name ? { name: program_name } : null
        }));
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteSection = async (req, res) => {
    try {
        const { rows: counts } = await db.query(`
            SELECT
                (SELECT COUNT(*)::int FROM timetable_entries WHERE section_id = $1) AS entries,
                (SELECT COUNT(*)::int FROM workloads WHERE section_id = $1) AS workloads
        `, [req.params.id]);
        const ok = await guardDelete(req, res, [
            { count: counts[0].entries, label: 'timetable classes' },
            { count: counts[0].workloads, label: 'workloads' }
        ]);
        if (!ok) return;
        await db.query('DELETE FROM sections WHERE id = $1', [req.params.id]);
        await audit(req, 'section.delete', 'section', req.params.id, { forced: req.query.force === '1' });
        res.json({ message: 'Section deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createSection = async (req, res) => {
    const { name, program_id, year, advisor } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO sections (name, program_id, year, advisor) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, program_id, year, advisor]
        );
        await audit(req, 'section.create', 'section', rows[0].id, { name });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Bulk-create a batch of sections, e.g. prefix "CSE", count 4 -> CSE-A..CSE-D.
const bulkCreateSections = async (req, res) => {
    const { program_id, prefix, count, year, advisor } = req.body;
    const total = parseInt(count, 10);
    const batchPrefix = String(prefix || '').trim();

    if (!batchPrefix || !Number.isInteger(total) || total < 1 || total > 26) {
        return res.status(400).json({ error: 'Provide a prefix and a count between 1 and 26.' });
    }

    try {
        const labels = Array.from({ length: total }, (_, i) =>
            `${batchPrefix}-${String.fromCharCode(65 + i)}`
        );
        const values = [];
        const placeholders = labels.map((name, i) => {
            values.push(name, program_id, year || new Date().getFullYear(), advisor || null);
            const base = i * 4;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        });
        const { rows } = await db.query(
            `INSERT INTO sections (name, program_id, year, advisor) VALUES ${placeholders.join(', ')} RETURNING *`,
            values
        );
        await audit(req, 'section.bulk_create', 'section', null, { prefix: batchPrefix, created: rows.length });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateSection = async (req, res) => {
    const { id } = req.params;
    const { name, program_id, year, advisor } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE sections
             SET name = COALESCE($1, name),
                 program_id = COALESCE($2, program_id),
                 year = COALESCE($3, year),
                 advisor = $4
             WHERE id = $5
             RETURNING *`,
            [name || null, program_id || null, year ?? null, advisor === undefined ? null : advisor, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Section not found.' });
        await audit(req, 'section.update', 'section', id, { name, year });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getAllPrograms,
    createProgram,
    updateProgram,
    deleteProgram,
    getAllSections,
    createSection,
    bulkCreateSections,
    updateSection,
    deleteSection
};
