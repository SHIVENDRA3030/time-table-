// One-off mobile smoke-test data: link the mobile test account to a faculty
// record and create an admin test account. Rows are tagged so they are easy to
// remove (see DELETE statements at the bottom).
const { neon } = require('@neondatabase/serverless');
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const email = 'mobile.test@ttstudio.dev';
  const adminEmail = 'mobile.admin@ttstudio.dev';

  // 1. faculty record linked by email
  const fac = await sql`
    INSERT INTO faculty (name, email, department)
    VALUES ('Mobile Tester Faculty', ${email}, 'Computer Science')
    RETURNING id, name`;
  console.log('faculty:', fac[0]);

  // 2. app_users role for the faculty-linked user (editor sees designer-grade
  //    access on web; use 'editor' so we exercise a privileged role)
  await sql`
    INSERT INTO app_users (user_id, role, display_name)
    VALUES ('18da21f6-224b-4293-b029-af3303a7a031', 'viewer', 'Mobile Tester Faculty')
    ON CONFLICT (user_id) DO UPDATE SET role = 'viewer'`;
  console.log('app_users role set: viewer');

  // 3. workload so My Classes shows progress chips (first section + first subject)
  const sec = await sql`SELECT id, name FROM sections WHERE name = 'CSE-A' LIMIT 1`;
  const sub = await sql`SELECT id, code, name FROM subjects LIMIT 1`;
  if (sec[0] && sub[0]) {
    const wl = await sql`
      INSERT INTO workloads (section_id, subject_id, faculty_id, lectures_per_week, room_id)
      SELECT ${sec[0].id}, ${sub[0].id}, ${fac[0].id}, 3, NULL
      RETURNING id`;
    console.log('workload:', wl[0]);
  }

  console.log('NOTE: create the admin account by signing up mobile.admin@ttstudio.dev in the app,');
  console.log('then assign admin via app_users (user id printed after first sign-in).');
  console.log('Cleanup SQL:');
  console.log(`  DELETE FROM workloads WHERE faculty_id = '${fac[0].id}';`);
  console.log(`  DELETE FROM faculty WHERE id = '${fac[0].id}';`);
  console.log(`  DELETE FROM app_users WHERE user_id = '18da21f6-224b-4293-b029-af3303a7a031';`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
