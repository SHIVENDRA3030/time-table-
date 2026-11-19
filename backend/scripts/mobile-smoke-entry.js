// One-off: give the mobile smoke faculty one scheduled class so the request
// sheet can be exercised. Prints the cleanup SQL.
const { neon } = require('@neondatabase/serverless');
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });

const sql = neon(process.env.DATABASE_URL);

(async () => {
  const fac = await sql`SELECT id FROM faculty WHERE email = 'mobile.test@ttstudio.dev' LIMIT 1`;
  const wl = await sql`SELECT section_id, subject_id FROM workloads WHERE faculty_id = ${fac[0].id} LIMIT 1`;
  const slot = await sql`SELECT id, start_time FROM time_slots ORDER BY slot_number ASC LIMIT 1`;
  const clash = await sql`
    SELECT id FROM timetable_entries
    WHERE section_id = ${wl[0].section_id} AND day = 'Monday' AND time_slot_id = ${slot[0].id} LIMIT 1`;
  if (clash[0]) {
    console.log('slot taken, using second slot');
    const slot2 = await sql`SELECT id FROM time_slots ORDER BY slot_number ASC OFFSET 1 LIMIT 1`;
    const ins = await sql`
      INSERT INTO timetable_entries (section_id, subject_id, faculty_id, room_id, day, time_slot_id)
      VALUES (${wl[0].section_id}, ${wl[0].subject_id}, ${fac[0].id}, NULL, 'Monday', ${slot2[0].id})
      RETURNING id`;
    console.log('entry:', ins[0]);
  } else {
    const ins = await sql`
      INSERT INTO timetable_entries (section_id, subject_id, faculty_id, room_id, day, time_slot_id)
      VALUES (${wl[0].section_id}, ${wl[0].subject_id}, ${fac[0].id}, NULL, 'Monday', ${slot[0].id})
      RETURNING id`;
    console.log('entry:', ins[0]);
  }
  console.log(`cleanup: DELETE FROM timetable_entries WHERE faculty_id = '${fac[0].id}';`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
