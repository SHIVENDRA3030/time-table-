const supabase = require('./mcp/supabaseClient');

async function testConnection() {
    try {
        const { data, error } = await supabase.from('programs').select('*').limit(1);
        if (error) {
            console.error('Supabase connection error:', error.message);
        } else {
            console.log('Supabase connection successful!');
            console.log('Data:', data);
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

testConnection();
