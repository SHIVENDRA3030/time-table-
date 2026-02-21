const supabase = require('../mcp/supabaseClient');

// Get all timetables
const getAllTimetables = async (req, res) => {
    const { data, error } = await supabase
        .from('timetable_entries')
        .select(`
      *,
      section:sections(name),
      subject:subjects(name, code),
      faculty:faculty(name),
      room:rooms(room_number),
      time_slot:time_slots(start_time, end_time, slot_number)
    `);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

// Get timetable by Section
const getTimetableBySection = async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('timetable_entries')
        .select(`
      *,
      subject:subjects(name, code),
      faculty:faculty(name),
      room:rooms(room_number),
      time_slot:time_slots(start_time, end_time, slot_number)
    `)
        .eq('section_id', id);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

// Get timetable by Faculty
const getTimetableByFaculty = async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('timetable_entries')
        .select(`
      *,
      section:sections(name),
      subject:subjects(name, code),
      room:rooms(room_number),
      time_slot:time_slots(start_time, end_time, slot_number)
    `)
        .eq('faculty_id', id);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

// Get timetable by Room
const getTimetableByRoom = async (req, res) => {
    const { id } = req.params;
    const { data, error } = await supabase
        .from('timetable_entries')
        .select(`
      *,
      section:sections(name),
      subject:subjects(name, code),
      faculty:faculty(name),
      time_slot:time_slots(start_time, end_time, slot_number)
    `)
        .eq('room_id', id);

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

// Create a Manual Entry
const createEntry = async (req, res) => {
    const { section_id, subject_id, faculty_id, room_id, day, time_slot_id } = req.body;

    // Basic validation could go here

    try {
        // Check conflicts
        const conflictService = require('../services/conflictService');
        const conflict = await conflictService.checkConflicts({ section_id, faculty_id, room_id, day, time_slot_id });

        if (conflict) {
            return res.status(409).json({ error: conflict });
        }

        const { data, error } = await supabase
            .from('timetable_entries')
            .insert([{ section_id, subject_id, faculty_id, room_id, day, time_slot_id }])
            .select();

        if (error) throw error;
        res.status(201).json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getAllTimetables,
    getTimetableBySection,
    getTimetableByFaculty,
    getTimetableByRoom,
    createEntry
};
