const supabase = require('../mcp/supabaseClient');

const checkConflicts = async (entry) => {
    const { section_id, faculty_id, room_id, day, time_slot_id } = entry;

    // Check Faculty Conflict
    const { data: facultyConflict, error: fError } = await supabase
        .from('timetable_entries')
        .select('id')
        .eq('faculty_id', faculty_id)
        .eq('day', day)
        .eq('time_slot_id', time_slot_id);

    if (fError) throw fError;
    if (facultyConflict.length > 0) return "Faculty is already booked at this time.";

    // Check Room Conflict (if room is assigned)
    if (room_id) {
        const { data: roomConflict, error: rError } = await supabase
            .from('timetable_entries')
            .select('id')
            .eq('room_id', room_id)
            .eq('day', day)
            .eq('time_slot_id', time_slot_id);

        if (rError) throw rError;
        if (roomConflict.length > 0) return "Room is already occupied at this time.";
    }

    // Check Section Conflict
    const { data: sectionConflict, error: sError } = await supabase
        .from('timetable_entries')
        .select('id')
        .eq('section_id', section_id)
        .eq('day', day)
        .eq('time_slot_id', time_slot_id);

    if (sError) throw sError;
    if (sectionConflict.length > 0) return "Section already has a class at this time.";

    return null; // No conflict
};

module.exports = {
    checkConflicts
};
