const db = require('../db');

const checkConflicts = async (entry, excludeEntryId = null) => {
    const { section_id, faculty_id, room_id, day, time_slot_id } = entry;
    const excludeClause = excludeEntryId ? 'AND id <> $4' : '';
    const params = excludeEntryId ? [faculty_id, day, time_slot_id, excludeEntryId] : [faculty_id, day, time_slot_id];

    // Check Faculty Conflict
    const facultyConflict = await db.query(
        `SELECT id FROM timetable_entries WHERE faculty_id = $1 AND day = $2 AND time_slot_id = $3 ${excludeClause}`,
        params
    );
    if (facultyConflict.rows.length > 0) return "Faculty is already booked at this time.";

    // Check Room Conflict (if room is assigned)
    if (room_id) {
        const roomParams = excludeEntryId ? [room_id, day, time_slot_id, excludeEntryId] : [room_id, day, time_slot_id];
        const roomConflict = await db.query(
            `SELECT id FROM timetable_entries WHERE room_id = $1 AND day = $2 AND time_slot_id = $3 ${excludeClause}`,
            roomParams
        );
        if (roomConflict.rows.length > 0) return "Room is already occupied at this time.";
    }

    // Check Section Conflict
    const sectionParams = excludeEntryId ? [section_id, day, time_slot_id, excludeEntryId] : [section_id, day, time_slot_id];
    const sectionConflict = await db.query(
        `SELECT id FROM timetable_entries WHERE section_id = $1 AND day = $2 AND time_slot_id = $3 ${excludeClause}`,
        sectionParams
    );
    if (sectionConflict.rows.length > 0) return "Section already has a class at this time.";

    return null; // No conflict
};

module.exports = {
    checkConflicts
};
