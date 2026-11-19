// Enterprise-readiness schema migration. Idempotent: safe to re-run.
//   node scripts/migrate-enterprise.js
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });
const db = require('../db');

// Fixed tenant scaffold UUIDs (single default institution for now; multi-tenant
// onboarding later just inserts more rows here).
const DEFAULT_INSTITUTION_ID = 'a0000000-0000-4000-8000-000000000001';
const DEFAULT_TERM_ID = 'b0000000-0000-4000-8000-000000000001';

const RLS_TABLES = [
  'programs', 'sections', 'subjects', 'faculty', 'rooms', 'time_slots',
  'timetable_entries', 'workloads', 'faculty_subjects', 'app_users',
  'change_requests', 'academic_terms'
];

const softDeleteColumns = ['programs', 'sections', 'subjects', 'faculty', 'rooms']
  .map((t) => `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS deleted_at timestamptz;`);

const institutionColumns = [
  'programs', 'sections', 'subjects', 'faculty', 'rooms', 'time_slots',
  'timetable_entries', 'workloads', 'faculty_subjects', 'app_users', 'change_requests'
].map((t) => `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS institution_id uuid NOT NULL DEFAULT '${DEFAULT_INSTITUTION_ID}' REFERENCES institutions(id);`);

const rlsStatements = [];
for (const t of RLS_TABLES) {
  rlsStatements.push(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`);
  rlsStatements.push(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`);
  rlsStatements.push(`DROP POLICY IF EXISTS tenant_isolation ON ${t};`);
  rlsStatements.push(`CREATE POLICY tenant_isolation ON ${t}
    USING (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid))
    WITH CHECK (institution_id = COALESCE(current_setting('app.institution_id', true)::uuid, '${DEFAULT_INSTITUTION_ID}'::uuid));`);
}

const statements = [
  `CREATE EXTENSION IF NOT EXISTS btree_gist;`,

  // ── soft deletes on reference data (F8) ──
  ...softDeleteColumns,

  // ── tenant root (F3 scaffold) ──
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
  ...institutionColumns,

  // ── academic terms (F13) ──
  `CREATE TABLE IF NOT EXISTS academic_terms (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     institution_id uuid NOT NULL DEFAULT '${DEFAULT_INSTITUTION_ID}' REFERENCES institutions(id),
     name TEXT NOT NULL,
     starts_on DATE NOT NULL,
     ends_on DATE NOT NULL,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
     created_at timestamptz NOT NULL DEFAULT now()
   );`,
  `INSERT INTO academic_terms (id, name, starts_on, ends_on, status)
   SELECT '${DEFAULT_TERM_ID}', 'AY 2026-27 · Semester 1', '2026-07-01', '2026-12-31', 'open'
   WHERE NOT EXISTS (SELECT 1 FROM academic_terms WHERE id = '${DEFAULT_TERM_ID}');`,
  `ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS term_id uuid NOT NULL DEFAULT '${DEFAULT_TERM_ID}' REFERENCES academic_terms(id);`,
  `ALTER TABLE workloads ADD COLUMN IF NOT EXISTS term_id uuid NOT NULL DEFAULT '${DEFAULT_TERM_ID}' REFERENCES academic_terms(id);`,
  `ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS term_id uuid NOT NULL DEFAULT '${DEFAULT_TERM_ID}' REFERENCES academic_terms(id);`,

  // ── idempotency (F6) ──
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     key TEXT NOT NULL,
     user_id TEXT,
     method TEXT NOT NULL,
     path TEXT NOT NULL,
     response_status INT,
     response_body JSONB,
     created_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (key, method, path)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys (created_at);`,

  // ── audit hardening (F7): enrich + append-only ──
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip TEXT;`,
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_agent TEXT;`,
  `CREATE OR REPLACE FUNCTION forbid_audit_mutation() RETURNS trigger AS $$
     BEGIN
       RAISE EXCEPTION 'audit_log is append-only (attempted %)', TG_OP;
     END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;`,
  `CREATE TRIGGER audit_log_append_only
     BEFORE UPDATE OR DELETE ON audit_log
     FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();`,

  // ── mobile token lifecycle (F2) ──
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id TEXT NOT NULL,
     family_id UUID NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     expires_at timestamptz NOT NULL,
     rotated_to UUID REFERENCES refresh_tokens(id),
     revoked_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens (family_id);`,

  // ── notification outbox (F17) ──
  `CREATE TABLE IF NOT EXISTS outbox_events (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     type TEXT NOT NULL,
     payload JSONB NOT NULL DEFAULT '{}',
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
     created_at timestamptz NOT NULL DEFAULT now(),
     processed_at timestamptz
   );`,

  // ── async job pipeline (F4) ──
  `CREATE TABLE IF NOT EXISTS jobs (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     kind TEXT NOT NULL CHECK (kind IN ('import', 'export')),
     status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'staged', 'done', 'failed', 'cancelled')),
     payload JSONB NOT NULL DEFAULT '{}',
     result JSONB,
     error TEXT,
     file_path TEXT,
     created_by TEXT,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, created_at);`,

  // ── change-request lifecycle (F12) ──
  `ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS expires_at timestamptz;`,
  `UPDATE change_requests SET expires_at = created_at + INTERVAL '72 hours'
     WHERE expires_at IS NULL AND status = 'pending';`,

  // ── row-level security (F3) ──
  ...rlsStatements,
];

// change_requests.status CHECK: existing name is auto-generated; find + replace.
async function migrateStatusCheck() {
  const { rows } = await db.query(
    `SELECT conname FROM pg_constraint
     WHERE conrelid = 'change_requests'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%pending%'`
  );
  for (const { conname } of rows) {
    await db.query(`ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS ${conname};`);
  }
  await db.query(`ALTER TABLE change_requests
     ADD CONSTRAINT change_requests_status_check
     CHECK (status IN ('pending', 'applied', 'rejected', 'cancelled', 'expired'));`);
}

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
  try {
    await migrateStatusCheck();
    ok++;
    console.log('ok   change_requests status CHECK widened (cancelled/expired)');
  } catch (err) {
    failed++;
    console.error(`FAIL change_requests status CHECK: ${err.message}`);
  }

  // Post-migration verification.
  const checks = [];
  try {
    const inst = await db.query('SELECT COUNT(*)::int AS n FROM institutions');
    checks.push(`institutions: ${inst.rows[0].n}`);
    const terms = await db.query('SELECT COUNT(*)::int AS n FROM academic_terms');
    checks.push(`academic_terms: ${terms.rows[0].n}`);
    const rls = await db.query(
      `SELECT COUNT(*)::int AS n FROM pg_class c
       WHERE c.relrowsecurity = true AND c.relname = ANY($1)`,
      [RLS_TABLES]
    );
    checks.push(`RLS-enabled tables: ${rls.rows[0].n}/${RLS_TABLES.length}`);
    const trig = await db.query(
      `SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname = 'audit_log_append_only'`
    );
    checks.push(`audit append-only trigger: ${trig.rows[0].n}`);
    const rlsRead = await db.query('SELECT COUNT(*)::int AS n FROM sections');
    checks.push(`RLS read test (sections visible): ${rlsRead.rows[0].n}`);
  } catch (err) {
    checks.push(`verification error: ${err.message}`);
  }

  console.log(`\n${ok} statements applied, ${failed} failed`);
  console.log(checks.join('\n'));
  process.exit(failed > 0 ? 1 : 0);
}

main();
