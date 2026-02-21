const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_ANON_KEY)) {
    require('dotenv').config({ quiet: true });
}

const supabaseUrl = process.env.SUPABASE_URL;
// Use Service Role Key for backend operations to bypass RLS, or Anon Key if acting as public
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
