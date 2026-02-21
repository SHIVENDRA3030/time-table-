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

-- Faculty Table
CREATE TABLE IF NOT EXISTS faculty (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
