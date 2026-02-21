const supabase = require('../mcp/supabaseClient');

// Programs
const getAllPrograms = async (req, res) => {
    const { data, error } = await supabase.from('programs').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

const createProgram = async (req, res) => {
    const { name, department } = req.body;
    const { data, error } = await supabase.from('programs').insert([{ name, department }]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
};

// Sections
const getAllSections = async (req, res) => {
    const { data, error } = await supabase.from('sections').select('*, program:programs(name)');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
};

const createSection = async (req, res) => {
    const { name, program_id, year, advisor } = req.body;
    const { data, error } = await supabase.from('sections').insert([{ name, program_id, year, advisor }]).select();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
};

module.exports = {
    getAllPrograms,
    createProgram,
    getAllSections,
    createSection
};
