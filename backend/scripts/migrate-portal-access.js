// Portal-access allowlist + students migration. Idempotent: safe to re-run.
//   node scripts/migrate-portal-access.js
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });
const db = require('../db');

// Same fixed tenant scaffold UUID as migrate-enterprise.js so both scripts stay
// consistent whether or not the enterprise migration has run yet.
const DEFAULT_INSTITUTION_ID = 'a0000000-0000-4000-8000-000000000001';

const RLS_TABLES = ['portal_access', 'students'];

const statements = [
  // Institutions scaffold (no-op when migrate-enterprise.js already created it).
  `CREATE TABLE IF NOT EXISTS institutions (
     id UUID PRIMARY KEY,
     name TEXT NOT NULL,
     slug TEXT NOT NULL UNIQUE,
     config JSONB NOT NULL DEFAULT '{}',
     created_at timestamptz NOT NULL DEFAULT now()
   );`,
  `INSERT INTO institutions (id, name, slug)
   SELECT '${DEFAULT_INSTITUTION_ID}', 'Default Institution', 'default'
   WHERE NOT EXISTS (SELECT 1 FROM institutions);`,

  // ── allowlist: who may sign in at all ──
  `CREATE TABLE IF NOT EXISTS portal_access (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     email TEXT UNIQUE NOT NULL,
     access_role TEXT NOT NULL CHECK (access_role IN ('admin', 'editor', 'faculty', 'student')),
     full_name TEXT,
     department TEXT,
     section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
     is_active BOOLEAN NOT NULL DEFAULT TRUE,
     added_by_email TEXT,
     institution_id uuid NOT NULL DEFAULT '${DEFAULT_INSTITUTION_ID}' REFERENCES institutions(id),
     created_at timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_portal_access_email ON portal_access (lower(email));`,

  // ── students: portal viewers scoped to one section ──
  `CREATE TABLE IF NOT EXISTS students (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     name TEXT NOT NULL,
     email TEXT UNIQUE NOT NULL,
     section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
     institution_id uuid NOT NULL DEFAULT '${DEFAULT_INSTITUTION_ID}' REFERENCES institutions(id),
     created_at timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_students_email ON students (lower(email));`,

  // ── row-level security, same tenant_isolation pattern as the core tables ──
  ...RLS_TABLES.flatMap((t) => [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS tenant_isolation ON ${t};`,
    `CREATE POLICY tenant_isolation ON ${t}
      USING (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid))
      WITH CHECK (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid));`
  ]),
];

async function main() {
  let ok = 0, failed = 0;
  for (const stmt of statements) {
    const label = stmt.replace(/\s+/g, ' ').slice(0, 64);
    try {
      await db.query(stmt);
      ok++;
      console.log(`ok   ${label}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${label}\n     ${err.message}`);
    }
  }

  // Post-migration verification.
  const checks = [];
  try {
    const access = await db.query('SELECT COUNT(*)::int AS n FROM portal_access');
    checks.push(`portal_access rows: ${access.rows[0].n}`);
    const students = await db.query('SELECT COUNT(*)::int AS n FROM students');
    checks.push(`students rows: ${students.rows[0].n}`);
    const rls = await db.query(
      `SELECT COUNT(*)::int AS n FROM pg_class c
       WHERE c.relrowsecurity = true AND c.relname = ANY($1)`,
      [RLS_TABLES]
    );
    checks.push(`RLS-enabled tables: ${rls.rows[0].n}/${RLS_TABLES.length}`);
  } catch (err) {
    checks.push(`verification error: ${err.message}`);
  }

  console.log(`\n${ok} statements applied, ${failed} failed`);
  console.log(checks.join('\n'));
  process.exit(failed > 0 ? 1 : 0);
}

main();
