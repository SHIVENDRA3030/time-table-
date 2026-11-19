const db = require('../db');
const { audit } = require('../services/auditService');

const getAllWorkloads = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT w.id, w.lectures_per_week,
                   sec.id AS section_id, sec.name AS section_name, p.name AS program_name,
                   sub.id AS subject_id, sub.code AS subject_code, sub.name AS subject_name,
                   fac.id AS faculty_id, fac.name AS faculty_name, fac.department AS faculty_department,
                   rm.id AS room_id, rm.room_number AS room_number
            FROM workloads w
            LEFT JOIN sections sec ON sec.id = w.section_id
            LEFT JOIN programs p ON p.id = sec.program_id
            LEFT JOIN subjects sub ON sub.id = w.subject_id
            LEFT JOIN faculty fac ON fac.id = w.faculty_id
            LEFT JOIN rooms rm ON rm.id = w.room_id
            WHERE sec.deleted_at IS NULL AND sub.deleted_at IS NULL AND fac.deleted_at IS NULL
        `);

        const data = rows.map((row) => {
            const {
                section_id, section_name, program_name,
                subject_id, subject_code, subject_name,
                faculty_id, faculty_name, faculty_department,
                room_id, room_number,
                ...workload
            } = row;

            return {
                ...workload,
                section: section_id ? { id: section_id, name: section_name, program: program_name ? { name: program_name } : null } : null,
                subject: subject_id ? { id: subject_id, code: subject_code, name: subject_name } : null,
                faculty: faculty_id ? { id: faculty_id, name: faculty_name, department: faculty_department } : null,
                room: room_id ? { id: room_id, room_number: room_number } : null
            };
        });

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createWorkload = async (req, res) => {
    const { section_id, subject_id, faculty_id, room_id, lectures_per_week } = req.body;

    try {
        const { rows } = await db.query(
            `INSERT INTO workloads (section_id, subject_id, faculty_id, room_id, lectures_per_week)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [section_id, subject_id, faculty_id, room_id || null, lectures_per_week]
        );
        await audit(req, 'workload.create', 'workload', rows[0].id, { section_id, subject_id, faculty_id, lectures_per_week });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateWorkload = async (req, res) => {
    const { id } = req.params;
    const { section_id, subject_id, faculty_id, room_id, lectures_per_week } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE workloads
             SET section_id = COALESCE($1, section_id),
                 subject_id = COALESCE($2, subject_id),
                 faculty_id = COALESCE($3, faculty_id),
                 room_id = COALESCE($4, room_id),
                 lectures_per_week = COALESCE($5, lectures_per_week)
             WHERE id = $6
             RETURNING *`,
            [section_id || null, subject_id || null, faculty_id || null, room_id || null, lectures_per_week ?? null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Workload not found.' });
        await audit(req, 'workload.update', 'workload', id, { lectures_per_week });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteWorkload = async (req, res) => {
    try {
        await db.query('DELETE FROM workloads WHERE id = $1', [req.params.id]);
        await audit(req, 'workload.delete', 'workload', req.params.id);
        res.json({ message: 'Workload deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getAllWorkloads,
    createWorkload,
    updateWorkload,
    deleteWorkload
};
