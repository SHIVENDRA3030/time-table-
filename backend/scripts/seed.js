// Seeds demo scheduling data into the Neon branch so the app and E2E tests have data.
// Idempotent: inserts only missing rows. Run with `node scripts/seed.js` from backend/.
require('dotenv').config({ quiet: true, path: '../.env.local' });
require('dotenv').config({ quiet: true });
const { Pool } = require('@neondatabase/serverless');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
    const q = (sql, params) => pool.query(sql, params);
    const one = async (sql, params) => (await q(sql, params)).rows[0];

    const program = await one("SELECT * FROM programs WHERE name = 'B.Tech'")
        || await one("INSERT INTO programs (name, department) VALUES ('B.Tech', 'Engineering') RETURNING *");

    const sections = {};
    for (const name of ['CSE-A', 'CSE-B']) {
        sections[name] = await one('SELECT * FROM sections WHERE name = $1 AND program_id = $2', [name, program.id])
            || await one('INSERT INTO sections (name, program_id, year, advisor) VALUES ($1, $2, 2026, $3) RETURNING *', [name, program.id, 'Dr. Mehta']);
    }

    const faculty = {};
    for (const [name, email] of [['Dr. Anita Sharma', 'anita.sharma@college.edu'], ['Prof. Rajesh Iyer', 'rajesh.iyer@college.edu']]) {
        faculty[email] = await one('SELECT * FROM faculty WHERE email = $1', [email])
            || await one('INSERT INTO faculty (name, department, email) VALUES ($1, $2, $3) RETURNING *', [name, 'CSE', email]);
    }

    const subjects = {};
    for (const [code, name, credits, type] of [['CS101', 'Data Structures', 4, 'Theory'], ['CS201', 'Algorithms', 3, 'Theory'], ['CS101L', 'Data Structures Lab', 2, 'Lab']]) {
        subjects[code] = await one('SELECT * FROM subjects WHERE code = $1', [code])
            || await one('INSERT INTO subjects (code, name, credits, type) VALUES ($1, $2, $3, $4) RETURNING *', [code, name, credits, type]);
    }

    const rooms = {};
    for (const [roomNumber, capacity, type] of [['R-101', 60, 'Classroom'], ['LAB-1', 30, 'Lab']]) {
        rooms[roomNumber] = await one('SELECT * FROM rooms WHERE room_number = $1', [roomNumber])
            || await one('INSERT INTO rooms (room_number, capacity, type) VALUES ($1, $2, $3) RETURNING *', [roomNumber, capacity, type]);
    }

    const { rows: slotCount } = await q('SELECT COUNT(*)::int AS n FROM time_slots');
    if (slotCount[0].n === 0) {
        await q(`INSERT INTO time_slots (start_time, end_time, slot_number)
                 VALUES ('09:00', '10:00', 1), ('10:00', '11:00', 2), ('11:00', '12:00', 3),
                        ('12:00', '13:00', 4), ('14:00', '15:00', 5), ('15:00', '16:00', 6)`);
    }

    const anita = faculty['anita.sharma@college.edu'].id;
    const rajesh = faculty['rajesh.iyer@college.edu'].id;
    const cs101 = subjects['CS101'].id;
    const cs201 = subjects['CS201'].id;
    const cs101l = subjects['CS101L'].id;
    const cseA = sections['CSE-A'].id;
    const cseB = sections['CSE-B'].id;
    const r101 = rooms['R-101'].id;
    const lab1 = rooms['LAB-1'].id;

    const { rows: fsCount } = await q('SELECT COUNT(*)::int AS n FROM faculty_subjects');
    if (fsCount[0].n === 0) {
        await q(
            `INSERT INTO faculty_subjects (faculty_id, subject_id)
             VALUES ($1, $3), ($1, $4), ($2, $4), ($2, $5)`,
            [anita, rajesh, cs101, cs201, cs101l]
        );
        console.log('faculty_subjects: inserted 4 mappings');
    }

    const { rows: wlCount } = await q('SELECT COUNT(*)::int AS n FROM workloads');
    if (wlCount[0].n === 0) {
        await q(
            `INSERT INTO workloads (section_id, subject_id, faculty_id, room_id, lectures_per_week)
             VALUES ($1, $3, $6, $8, 3),   -- CSE-A, CS101,  Anita, R-101
                     ($2, $3, $6, $8, 2),   -- CSE-B, CS101,  Anita, R-101
                     ($1, $4, $7, $8, 2),   -- CSE-A, CS201,  Rajesh, R-101
                     ($2, $4, $6, $8, 2),   -- CSE-B, CS201,  Anita, R-101
                     ($1, $5, $7, $9, 2)  -- CSE-A, CS101L, Rajesh, LAB-1`,
            [cseA, cseB, cs101, cs201, cs101l, anita, rajesh, r101, lab1]
        );
        console.log('workloads: inserted 5 rows');
    }

    const summary = await one(`SELECT
        (SELECT COUNT(*)::int FROM programs) AS programs,
        (SELECT COUNT(*)::int FROM sections) AS sections,
        (SELECT COUNT(*)::int FROM faculty) AS faculty,
        (SELECT COUNT(*)::int FROM subjects) AS subjects,
        (SELECT COUNT(*)::int FROM rooms) AS rooms,
        (SELECT COUNT(*)::int FROM time_slots) AS time_slots,
        (SELECT COUNT(*)::int FROM faculty_subjects) AS faculty_subjects,
        (SELECT COUNT(*)::int FROM workloads) AS workloads,
        (SELECT COUNT(*)::int FROM timetable_entries) AS timetable_entries`);
    console.log('seed complete:', summary);
    await pool.end();
})().catch((e) => { console.error('ERR:', e.stack || e.message); process.exit(1); });
