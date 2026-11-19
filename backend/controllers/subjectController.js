const db = require('../db');
const { audit } = require('../services/auditService');

// Guard helper: refuse destructive deletes while dependent rows exist unless
// the caller explicitly confirms with ?force=1.
const guardDelete = async (req, res, counts) => {
    const force = req.query.force === '1';
    const blocking = counts.filter((c) => c.count > 0);
    if (blocking.length > 0 && !force) {
        res.status(409).json({
            error: `Cannot delete yet: ${blocking.map((c) => `${c.count} ${c.label}`).join(', ')} reference this and would be removed or cleared too. Confirm with force=1 to continue.`
        });
        return false;
    }
    return true;
};

// Faculty
const getAllFaculty = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT f.*,
                   COALESCE(json_agg(json_build_object('subject_id', fs.subject_id)) FILTER (WHERE fs.subject_id IS NOT NULL), '[]') AS faculty_subjects,
                   COALESCE(json_agg(fs.subject_id) FILTER (WHERE fs.subject_id IS NOT NULL), '[]') AS subject_ids
            FROM faculty f
            LEFT JOIN faculty_subjects fs ON fs.faculty_id = f.id
            WHERE f.deleted_at IS NULL
            GROUP BY f.id
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteFaculty = async (req, res) => {
    try {
        const { rows: counts } = await db.query(`
            SELECT
                (SELECT COUNT(*)::int FROM timetable_entries WHERE faculty_id = $1) AS entries,
                (SELECT COUNT(*)::int FROM workloads WHERE faculty_id = $1) AS workloads
        `, [req.params.id]);
        const ok = await guardDelete(req, res, [
            { count: counts[0].entries, label: 'timetable classes' },
            { count: counts[0].workloads, label: 'workloads' }
        ]);
        if (!ok) return;
        await db.query('DELETE FROM faculty WHERE id = $1', [req.params.id]);
        await audit(req, 'faculty.delete', 'faculty', req.params.id, { forced: req.query.force === '1' });
        res.json({ message: 'Faculty deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createFaculty = async (req, res) => {
    const { name, department, email, subject_ids } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO faculty (name, department, email) VALUES ($1, $2, $3) RETURNING *',
            [name, department, email]
        );
        const newFaculty = rows[0];

        // Insert mapping records if subjects were provided
        if (subject_ids && Array.isArray(subject_ids) && subject_ids.length > 0) {
            await db.query(
                `INSERT INTO faculty_subjects (faculty_id, subject_id)
                 SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
                [newFaculty.id, subject_ids]
            );
        }

        await audit(req, 'faculty.create', 'faculty', newFaculty.id, { name, email });
        res.status(201).json(newFaculty);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateFaculty = async (req, res) => {
    const { id } = req.params;
    const { name, department, email } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE faculty
             SET name = COALESCE($1, name),
                 department = COALESCE($2, department),
                 email = COALESCE($3, email)
             WHERE id = $4
             RETURNING *`,
            [name || null, department || null, email || null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Faculty not found.' });
        await audit(req, 'faculty.update', 'faculty', id, { name, email });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateFacultySubjects = async (req, res) => {
    const { id } = req.params;
    const { subject_ids } = req.body; // Array of subject UUIDs

    try {
        // First delete all existing mappings for this faculty
        await db.query('DELETE FROM faculty_subjects WHERE faculty_id = $1', [id]);

        // Then insert the new mappings
        if (subject_ids && Array.isArray(subject_ids) && subject_ids.length > 0) {
            await db.query(
                `INSERT INTO faculty_subjects (faculty_id, subject_id)
                 SELECT $1, unnest($2::uuid[])`,
                [id, subject_ids]
            );
        }

        await audit(req, 'faculty.subjects.update', 'faculty', id, { count: Array.isArray(subject_ids) ? subject_ids.length : 0 });
        res.json({ message: 'Faculty subjects updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Subjects
const getAllSubjects = async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM subjects WHERE deleted_at IS NULL ORDER BY code');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteSubject = async (req, res) => {
    try {
        const { rows: counts } = await db.query(`
            SELECT
                (SELECT COUNT(*)::int FROM timetable_entries WHERE subject_id = $1) AS entries,
                (SELECT COUNT(*)::int FROM workloads WHERE subject_id = $1) AS workloads
        `, [req.params.id]);
        const ok = await guardDelete(req, res, [
            { count: counts[0].entries, label: 'timetable classes' },
            { count: counts[0].workloads, label: 'workloads' }
        ]);
        if (!ok) return;
        await db.query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
        await audit(req, 'subject.delete', 'subject', req.params.id, { forced: req.query.force === '1' });
        res.json({ message: 'Subject deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createSubject = async (req, res) => {
    const { code, name, credits, type } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO subjects (code, name, credits, type) VALUES ($1, $2, $3, $4) RETURNING *',
            [code, name, credits, type]
        );
        await audit(req, 'subject.create', 'subject', rows[0].id, { code, name });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateSubject = async (req, res) => {
    const { id } = req.params;
    const { code, name, credits, type } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE subjects
             SET code = COALESCE($1, code),
                 name = COALESCE($2, name),
                 credits = COALESCE($3, credits),
                 type = COALESCE($4, type)
             WHERE id = $5
             RETURNING *`,
            [code || null, name || null, credits ?? null, type || null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Subject not found.' });
        await audit(req, 'subject.update', 'subject', id, { code, name });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Rooms
const getAllRooms = async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM rooms WHERE deleted_at IS NULL ORDER BY room_number');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteRoom = async (req, res) => {
    try {
        const { rows: counts } = await db.query(
            'SELECT COUNT(*)::int AS n FROM timetable_entries WHERE room_id = $1',
            [req.params.id]
        );
        const ok = await guardDelete(req, res, [{ count: counts[0].n, label: 'timetable classes using it' }]);
        if (!ok) return;
        await db.query('DELETE FROM rooms WHERE id = $1', [req.params.id]);
        await audit(req, 'room.delete', 'room', req.params.id, { forced: req.query.force === '1' });
        res.json({ message: 'Room deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const createRoom = async (req, res) => {
    const { room_number, capacity, type } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO rooms (room_number, capacity, type) VALUES ($1, $2, $3) RETURNING *',
            [room_number, capacity, type]
        );
        await audit(req, 'room.create', 'room', rows[0].id, { room_number });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateRoom = async (req, res) => {
    const { id } = req.params;
    const { room_number, capacity, type } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE rooms
             SET room_number = COALESCE($1, room_number),
                 capacity = COALESCE($2, capacity),
                 type = COALESCE($3, type)
             WHERE id = $4
             RETURNING *`,
            [room_number || null, capacity ?? null, type || null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Room not found.' });
        await audit(req, 'room.update', 'room', id, { room_number });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getAllFaculty,
    createFaculty,
    updateFaculty,
    deleteFaculty,
    updateFacultySubjects,
    getAllSubjects,
    createSubject,
    updateSubject,
    deleteSubject,
    getAllRooms,
    createRoom,
    updateRoom,
    deleteRoom
};
