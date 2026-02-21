const supabase = require('../mcp/supabaseClient');
const DEFAULT_FACULTY_PASSWORD = process.env.DEFAULT_FACULTY_PASSWORD || 'ChangeMe@123';

// Faculty
const getAllFaculty = async (req, res) => {
    const { data, error } = await supabase.from('faculty').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

const createFaculty = async (req, res) => {
    try {
        const { name, department, email } = req.body;

        // Primary insert path for schemas where faculty.password is required.
        let response = await supabase
            .from('faculty')
            .insert([{ name, department, email, password: DEFAULT_FACULTY_PASSWORD }])
            .select();

        // Fallback path for schemas that do not include password column.
        if (response.error && (response.error.code === 'PGRST204' || /password/i.test(response.error.message || ''))) {
            response = await supabase.from('faculty').insert([{ name, department, email }]).select();
        }

        if (response.error) return res.status(500).json({ error: response.error.message });
        res.status(201).json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Subjects
const getAllSubjects = async (req, res) => {
    const { data, error } = await supabase.from('subjects').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

const createSubject = async (req, res) => {
    const { code, name, credits, type } = req.body;
    const { data, error } = await supabase.from('subjects').insert([{ code, name, credits, type }]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
};

// Rooms
const getAllRooms = async (req, res) => {
    const { data, error } = await supabase.from('rooms').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

const createRoom = async (req, res) => {
    const { room_number, capacity, type } = req.body;
    const { data, error } = await supabase.from('rooms').insert([{ room_number, capacity, type }]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
};

module.exports = {
    getAllFaculty,
    createFaculty,
    getAllSubjects,
    createSubject,
    getAllRooms,
    createRoom
};
