-- Schema for the Timetable Management System on Neon (Lakebase Postgres)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Programs Table
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sections Table
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  advisor TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Faculty Table (identity comes from Neon Auth, linked by email)
CREATE TABLE IF NOT EXISTS faculty (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Legacy local-password column is obsolete (Neon Auth replaced it)
ALTER TABLE faculty DROP COLUMN IF EXISTS password;

-- Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  type TEXT CHECK (type IN ('Theory', 'Lab', 'Seminar')) DEFAULT 'Theory',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rooms Table
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_number TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL,
  type TEXT CHECK (type IN ('Classroom', 'Lab', 'Seminar Hall')) DEFAULT 'Classroom',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Time Slots Table
CREATE TABLE IF NOT EXISTS time_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_number INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Timetable Entries Table
CREATE TABLE IF NOT EXISTS timetable_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id UUID REFERENCES faculty(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL, -- Nullable for online classes
  day TEXT NOT NULL CHECK (day IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')),
  time_slot_id UUID REFERENCES time_slots(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraint: A section cannot have two classes at the same time
  CONSTRAINT unique_section_slot UNIQUE (section_id, day, time_slot_id),
  
  -- Constraint: A faculty cannot be in two places at the same time
  CONSTRAINT unique_faculty_slot UNIQUE (faculty_id, day, time_slot_id),
  
  -- Constraint: A room cannot be occupied by two sections at the same time
  CONSTRAINT unique_room_slot UNIQUE (room_id, day, time_slot_id)
);

-- Faculty-Subject mapping (which subjects a faculty member can teach)
CREATE TABLE IF NOT EXISTS faculty_subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  faculty_id UUID NOT NULL REFERENCES faculty(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_faculty_subject UNIQUE (faculty_id, subject_id)
);

-- Workloads Table (teaching load per section/subject/faculty combination)
CREATE TABLE IF NOT EXISTS workloads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  section_id UUID REFERENCES sections(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  faculty_id UUID REFERENCES faculty(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  lectures_per_week INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- App roles for Neon Auth users (identity lives in the neon_auth schema)
CREATE TABLE IF NOT EXISTS app_users (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'editor', 'viewer')),
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Portal access allowlist: only emails added here (by an admin, singly or via
-- roster upload) may sign in. faculty/student entries also create the matching
-- profile row so the email-based portal links work immediately.
CREATE TABLE IF NOT EXISTS portal_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  access_role TEXT NOT NULL CHECK (access_role IN ('admin', 'editor', 'faculty', 'student')),
  full_name TEXT,
  department TEXT,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  added_by_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_access_email ON portal_access (lower(email));

-- Students (portal viewers scoped to one section; identity via Neon Auth email)
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_students_email ON students (lower(email));

-- Draft -> publish workflow per section
ALTER TABLE sections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE sections ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;

-- Immutable audit trail for every mutation
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);

-- Faculty change requests (reschedule / cancel), decided by admins
CREATE TABLE IF NOT EXISTS change_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id UUID REFERENCES timetable_entries(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('reschedule', 'cancel')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  requested_by_user_id TEXT NOT NULL,
  requested_by_email TEXT,
  faculty_id UUID REFERENCES faculty(id) ON DELETE SET NULL,
  entry_snapshot JSONB NOT NULL,
  proposed_day TEXT,
  proposed_time_slot_id UUID REFERENCES time_slots(id) ON DELETE SET NULL,
  proposed_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  reason TEXT,
  decision_note TEXT,
  decided_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  decided_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON change_requests (status, created_at DESC);
