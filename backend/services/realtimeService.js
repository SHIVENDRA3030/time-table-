// Neon Realtime: seals live SQL queries so the browser can subscribe without
// being able to read or change the SQL or its parameters.
const { createRealtime, rawSql } = require('@neon/realtime/server');

const secret = process.env.NEON_REALTIME_SECRET;
const databaseUrl = process.env.DATABASE_URL;

if (!secret || !databaseUrl) {
    throw new Error(
        'Missing NEON_REALTIME_SECRET / DATABASE_URL. Run `neon deploy` in the project root to provision Neon Realtime.'
    );
}

// `db` is the database name from the connection string.
const dbName = new URL(databaseUrl).pathname.replace(/^\//, '') || 'neondb';

const realtime = createRealtime({
    secret,
    db: dbName,
    debugMode: process.env.NODE_ENV !== 'production'
});

// Mirrors the timetable API's row shape (nested section/subject/faculty/room/time_slot
// objects) so the same grid components can render live rows. The scope subselects
// are part of the sealed query, so live rows keep following section renames/children.
const ENTRY_LIVE_SQL = `
    SELECT te.id, te.section_id, te.subject_id, te.faculty_id, te.room_id, te.day, te.time_slot_id, te.created_at,
           json_build_object('name', sec.name) AS section,
           json_build_object('name', sub.name, 'code', sub.code) AS subject,
           json_build_object('name', fac.name) AS faculty,
           json_build_object('room_number', rm.room_number) AS room,
           json_build_object('start_time', ts.start_time, 'end_time', ts.end_time, 'slot_number', ts.slot_number) AS time_slot
    FROM timetable_entries te
    LEFT JOIN sections sec ON sec.id = te.section_id
    LEFT JOIN subjects sub ON sub.id = te.subject_id
    LEFT JOIN faculty fac ON fac.id = te.faculty_id
    LEFT JOIN rooms rm ON rm.id = te.room_id
    LEFT JOIN time_slots ts ON ts.id = te.time_slot_id
`;

const SECTION_SCOPE_SQL = ` WHERE te.section_id IN (
        SELECT s.id FROM sections s
        WHERE s.program_id = (SELECT program_id FROM sections WHERE id = $1)
          AND (s.id = $1 OR s.name ILIKE (SELECT name || '%' FROM sections WHERE id = $1))
    )`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sealTimetableQuery = async (viewType, resourceId) => {
    if (!UUID_RE.test(resourceId)) {
        const error = new Error('resourceId must be a UUID');
        error.status = 400;
        throw error;
    }

    if (viewType === 'section') {
        return realtime.seal({ query: rawSql(ENTRY_LIVE_SQL + SECTION_SCOPE_SQL, [resourceId]) });
    }
    if (viewType === 'faculty') {
        return realtime.seal({ query: rawSql(ENTRY_LIVE_SQL + ' WHERE te.faculty_id = $1', [resourceId]) });
    }
    if (viewType === 'room') {
        return realtime.seal({ query: rawSql(ENTRY_LIVE_SQL + ' WHERE te.room_id = $1', [resourceId]) });
    }

    const error = new Error('viewType must be section, faculty, or room');
    error.status = 400;
    throw error;
};

module.exports = { realtime, sealTimetableQuery };
