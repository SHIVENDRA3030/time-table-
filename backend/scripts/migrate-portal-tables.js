// Supplemental migration: creates the parallel-work tables (portal_access,
// students, section publish columns) that schema.sql declares but the live DB
// was missing — without them rbac.attachUser throws and every data route 403s.
// Also brings them into the tenancy scaffold (institution_id + RLS).
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });
const db = require('../db');

const DEFAULT_INSTITUTION_ID = 'a0000000-0000-4000-8000-000000000001';

const statements = [
  `CREATE TABLE IF NOT EXISTS portal_access (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     institution_id uuid NOT NULL DEFAULT '${DEFAULT_INSTITUTION_ID}' REFERENCES institutions(id),
     email TEXT UNIQUE NOT NULL,
     access_role TEXT NOT NULL CHECK (access_role IN ('admin', 'editor', 'faculty', 'student')),
     full_name TEXT,
     department TEXT,
     section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     added_by_email TEXT,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_portal_access_email ON portal_access (lower(email));`,
  `CREATE TABLE IF NOT EXISTS students (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     institution_id uuid NOT NULL DEFAULT '${DEFAULT_INSTITUTION_ID}' REFERENCES institutions(id),
     name TEXT NOT NULL,
     email TEXT UNIQUE NOT NULL,
     section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_students_email ON students (lower(email));`,
  `ALTER TABLE sections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';`,
  `ALTER TABLE sections ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;`,
  `ALTER TABLE portal_access ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE portal_access FORCE ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS tenant_isolation ON portal_access;`,
  `CREATE POLICY tenant_isolation ON portal_access
     USING (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid))
     WITH CHECK (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid));`,
  `ALTER TABLE students ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE students FORCE ROW LEVEL SECURITY;`,
  `DROP POLICY IF EXISTS tenant_isolation ON students;`,
  `CREATE POLICY tenant_isolation ON students
     USING (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid))
     WITH CHECK (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid));`,
];

(async () => {
  let ok = 0, failed = 0;
  for (const stmt of statements) {
    try {
      await db.query(stmt);
      ok++;
    } catch (err) {
      failed++;
      console.error(`FAIL ${stmt.replace(/\s+/g, ' ').slice(0, 60)}: ${err.message}`);
    }
  }
  // Prove rbac's allowlist query works now.
  try {
    const { rows } = await db.query(
      `SELECT access_role, full_name, department, section_id
       FROM portal_access WHERE lower(email) = lower($1) AND is_active LIMIT 1`,
      ['nobody@example.com']
    );
    console.log(`allowlist query ok (${rows.length} rows)`);
  } catch (err) {
    console.error(`allowlist query still failing: ${err.message}`);
  }
  console.log(`${ok} applied, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
