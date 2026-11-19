const db = require('../db');
const generatorService = require('../services/generatorService');
const { audit } = require('../services/auditService');
const { isEditor } = require('../middleware/rbac');

// Shared SELECT with every lookup the frontend reads, mirroring the previous
// embedded-resource responses (section, subject, faculty, room, time_slot).
const ENTRY_SELECT = `
    SELECT te.*,
           sec.name AS section_name,
           sub.name AS subject_name, sub.code AS subject_code,
           fac.name AS faculty_name,
           rm.room_number AS room_number,
           ts.start_time AS slot_start_time, ts.end_time AS slot_end_time, ts.slot_number AS slot_slot_number
    FROM timetable_entries te
    LEFT JOIN sections sec ON sec.id = te.section_id
    LEFT JOIN subjects sub ON sub.id = te.subject_id
    LEFT JOIN faculty fac ON fac.id = te.faculty_id
    LEFT JOIN rooms rm ON rm.id = te.room_id
    LEFT JOIN time_slots ts ON ts.id = te.time_slot_id
`;

const mapEntryRow = (row) => {
    const { section_name, subject_name, subject_code, faculty_name, room_number,
        slot_start_time, slot_end_time, slot_slot_number, ...entry } = row;
    return {
        ...entry,
        section: section_name ? { name: section_name } : null,
        subject: subject_name || subject_code ? { name: subject_name, code: subject_code } : null,
        faculty: faculty_name ? { name: faculty_name } : null,
        room: room_number ? { room_number } : null,
        time_slot: slot_start_time
            ? { start_time: slot_start_time, end_time: slot_end_time, slot_number: slot_slot_number }
            : null
    };
};

// Callers without an editor/admin role (viewers and unassigned users) may only
// read timetables of published sections.
const viewerFilter = (req) =>
    isEditor(req) ? '' : ' AND te.section_id IN (SELECT id FROM sections WHERE status = \'published\')';

const isChildSectionName = (parentName, candidateName) => {
    const base = String(parentName || '').trim();
    const candidate = String(candidateName || '').trim();

    if (!base || !candidate || candidate === base) return false;
    if (!candidate.startsWith(base)) return false;

    return /^[0-9(]/.test(candidate.slice(base.length));
};

const resolveSectionScopeIds = async (sectionId) => {
    const { rows: selectedRows } = await db.query(
        'SELECT id, name, program_id FROM sections WHERE id = $1',
        [sectionId]
    );
    const selectedSection = selectedRows[0] || null;
    if (!selectedSection) return [sectionId];

    const { rows: siblingSections } = await db.query(
        'SELECT id, name FROM sections WHERE program_id = $1 AND name ILIKE $2',
        [selectedSection.program_id, `${selectedSection.name}%`]
    );

    const parentSectionExists = siblingSections.some((section) =>
        isChildSectionName(section.name, selectedSection.name)
    );

    if (parentSectionExists) return [selectedSection.id];

    const scopedIds = siblingSections
        .filter((section) =>
            section.id === selectedSection.id || isChildSectionName(selectedSection.name, section.name)
        )
        .map((section) => section.id);

    return scopedIds.length > 0 ? scopedIds : [selectedSection.id];
};

// Get all timetables
const getAllTimetables = async (req, res) => {
    try {
        const { rows } = await db.query(ENTRY_SELECT + ' WHERE true' + viewerFilter(req));
        res.json(rows.map(mapEntryRow));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get timetable by Section
const getTimetableBySection = async (req, res) => {
    const { id } = req.params;

    try {
        if (!isEditor(req)) {
            const { rows: statusRows } = await db.query('SELECT status FROM sections WHERE id = $1', [id]);
            if (statusRows[0] && statusRows[0].status !== 'published') {
                return res.status(403).json({ error: 'This timetable is not published yet.' });
            }
        }

        const sectionIds = await resolveSectionScopeIds(id);
        const { rows } = await db.query(`${ENTRY_SELECT} WHERE te.section_id = ANY($1::uuid[])`, [sectionIds]);
        res.json(rows.map(mapEntryRow));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get timetable by Faculty. Users without an editor role may only read their
// own timetable (their faculty link comes from the email match in rbac).
const getTimetableByFaculty = async (req, res) => {
    const { id } = req.params;
    if (!isEditor(req) && req.user?.faculty?.id !== id) {
        return res.status(403).json({ error: 'You can only view your own timetable.' });
    }
    try {
        const { rows } = await db.query(
            `${ENTRY_SELECT} WHERE te.faculty_id = $1` + viewerFilter(req),
            [id]
        );
        res.json(rows.map(mapEntryRow));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get timetable by Room
const getTimetableByRoom = async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `${ENTRY_SELECT} WHERE te.room_id = $1` + viewerFilter(req),
            [id]
        );
        res.json(rows.map(mapEntryRow));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Create a Manual Entry
const createEntry = async (req, res) => {
    const { section_id, subject_id, faculty_id, room_id, day, time_slot_id } = req.body;

    try {
        const conflictService = require('../services/conflictService');
        const conflict = await conflictService.checkConflicts({ section_id, faculty_id, room_id, day, time_slot_id });

        if (conflict) {
            return res.status(409).json({ error: conflict });
        }

        const { rows } = await db.query(
            `INSERT INTO timetable_entries (section_id, subject_id, faculty_id, room_id, day, time_slot_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [section_id, subject_id, faculty_id, room_id, day, time_slot_id]
        );
        await audit(req, 'timetable.entry.create', 'timetable_entry', rows[0].id, { section_id, day, time_slot_id });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update an existing entry
const updateEntry = async (req, res) => {
    const { id } = req.params;
    const { section_id, subject_id, faculty_id, room_id, day, time_slot_id } = req.body;

    try {
        const conflictService = require('../services/conflictService');
        const conflict = await conflictService.checkConflicts(
            { section_id, faculty_id, room_id, day, time_slot_id },
            id
        );

        if (conflict) {
            return res.status(409).json({ error: conflict });
        }

        const { rows } = await db.query(
            `UPDATE timetable_entries
             SET section_id = $1, subject_id = $2, faculty_id = $3, room_id = $4, day = $5, time_slot_id = $6
             WHERE id = $7
             RETURNING *`,
            [section_id, subject_id, faculty_id, room_id, day, time_slot_id, id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found.' });
        }
        await audit(req, 'timetable.entry.update', 'timetable_entry', id, { section_id, day, time_slot_id });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete an entry
const deleteEntry = async (req, res) => {
    const { id } = req.params;

    try {
        const { rows } = await db.query('DELETE FROM timetable_entries WHERE id = $1 RETURNING *', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Entry not found.' });
        }
        await audit(req, 'timetable.entry.delete', 'timetable_entry', id);
        res.json({ message: 'Entry deleted successfully.', id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Clear every entry of one section (designer bulk action)
const clearSectionTimetable = async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            'DELETE FROM timetable_entries WHERE section_id = $1 RETURNING id',
            [id]
        );
        await audit(req, 'timetable.section.clear', 'section', id, { deleted: rows.length });
        res.json({ message: 'Section timetable cleared.', deleted: rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get all time slots
const getTimeSlots = async (req, res) => {
    try {
        const { rows } = await db.query('SELECT * FROM time_slots ORDER BY slot_number ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Time-slot management
const createTimeSlot = async (req, res) => {
    const { start_time, end_time, slot_number } = req.body;
    try {
        const { rows } = await db.query(
            'INSERT INTO time_slots (start_time, end_time, slot_number) VALUES ($1, $2, $3) RETURNING *',
            [start_time, end_time, slot_number]
        );
        await audit(req, 'time_slot.create', 'time_slot', rows[0].id, { start_time, end_time, slot_number });
        res.status(201).json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateTimeSlot = async (req, res) => {
    const { id } = req.params;
    const { start_time, end_time, slot_number } = req.body;
    try {
        const { rows } = await db.query(
            `UPDATE time_slots
             SET start_time = COALESCE($1, start_time),
                 end_time = COALESCE($2, end_time),
                 slot_number = COALESCE($3, slot_number)
             WHERE id = $4
             RETURNING *`,
            [start_time || null, end_time || null, slot_number ?? null, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Time slot not found.' });
        await audit(req, 'time_slot.update', 'time_slot', id, { start_time, end_time, slot_number });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteTimeSlot = async (req, res) => {
    const { id } = req.params;
    const force = req.query.force === '1';
    try {
        const { rows: usage } = await db.query(
            'SELECT COUNT(*)::int AS n FROM timetable_entries WHERE time_slot_id = $1',
            [id]
        );
        if (usage[0].n > 0 && !force) {
            return res.status(409).json({
                error: `This period is used by ${usage[0].n} timetable entries. Deleting it removes them; retry with force=1 to confirm.`
            });
        }
        const { rows } = await db.query('DELETE FROM time_slots WHERE id = $1 RETURNING id', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Time slot not found.' });
        await audit(req, 'time_slot.delete', 'time_slot', id, { hadEntries: usage[0].n, force });
        res.json({ message: 'Time slot deleted.', id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Auto Generate Schedule
const generateSchedule = async (req, res) => {
    try {
        const { wipe } = req.body;
        const result = await generatorService.generateTimetable({ wipe });
        await audit(req, 'timetable.generate', 'timetable_entry', null, result);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getAllTimetables,
    getTimetableBySection,
    getTimetableByFaculty,
    getTimetableByRoom,
    createEntry,
    updateEntry,
    deleteEntry,
    clearSectionTimetable,
    getTimeSlots,
    createTimeSlot,
    updateTimeSlot,
    deleteTimeSlot,
    generateSchedule,
    ENTRY_SELECT,
    mapEntryRow
};
