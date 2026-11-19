// Seed portal_access allowlist rows for the mobile smoke accounts so they pass
// requireProvisioned. Idempotent (email UNIQUE). Cleanup: DELETE FROM portal_access
// WHERE email IN ('mobile.admin@ttstudio.dev','mobile.test@ttstudio.dev');
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });
const db = require('../db');

(async () => {
  const sec = await db.query(`SELECT id FROM sections WHERE name = 'CSE-A' LIMIT 1`);
  const sectionId = sec.rows[0]?.id || null;
  await db.query(
    `INSERT INTO portal_access (email, access_role, full_name, department, is_active)
     VALUES ('mobile.admin@ttstudio.dev', 'admin', 'Mobile Admin', 'Administration', TRUE)
     ON CONFLICT (email) DO UPDATE SET access_role = 'admin', is_active = TRUE`
  );
  await db.query(
    `INSERT INTO portal_access (email, access_role, full_name, department, section_id, is_active)
     VALUES ('mobile.test@ttstudio.dev', 'faculty', 'Mobile Tester Faculty', 'Computer Science', $1, TRUE)
     ON CONFLICT (email) DO UPDATE SET access_role = 'faculty', is_active = TRUE`,
    [sectionId]
  );
  const { rows } = await db.query('SELECT email, access_role, is_active FROM portal_access ORDER BY email');
  console.log(rows);
})();
