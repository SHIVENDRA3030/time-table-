// One-off: verify the approved reschedule actually moved the smoke-test entry.
const { neon } = require('@neondatabase/serverless');
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });

const sql = neon(process.env.DATABASE_URL);

(async () => {
  const r = await sql`
    SELECT te.day, ts.start_time, ts.end_time, f.email
    FROM timetable_entries te
    JOIN faculty f ON f.id = te.faculty_id
    LEFT JOIN time_slots ts ON ts.id = te.time_slot_id
    WHERE f.email = 'mobile.test@ttstudio.dev'`;
  console.log(r);
})();
