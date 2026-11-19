// Excel import pipeline (enterprise plan F4). Parsing (excelService) and
// insertion (this service) are separate stages; the worker runs each in its
// own job so a 5k-row workbook never blocks the request path. All writes run
// in one transaction; per-row failures are captured, not fatal.
const excelService = require('./excelService');

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const slugify = (value) =>
    normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '');

const makeFacultyEmail = (facultyName) => {
    const slug = slugify(facultyName) || 'faculty';
    return `${slug}@college.edu`;
};

const DEFAULT_PROGRAM_NAME = process.env.DEFAULT_PROGRAM_NAME || 'B.Tech';
const DEFAULT_PROGRAM_DEPARTMENT = process.env.DEFAULT_PROGRAM_DEPARTMENT || 'Engineering';

const buildQualitySummary = (parsedData) => {
    const summary = {
        totalEntries: Array.isArray(parsedData) ? parsedData.length : 0,
        missingRooms: 0,
        nonOnlineMissing: 0,
        onlineClasses: 0,
    };
    if (!Array.isArray(parsedData) || parsedData.length === 0) return summary;
    for (const entry of parsedData) {
        const hasRoom = Boolean(normalizeText(entry?.roomNumber));
        if (hasRoom) continue;
        summary.missingRooms += 1;
        const rawContent = normalizeText(entry?.rawContent).toLowerCase();
        if (rawContent.includes('online')) summary.onlineClasses += 1;
        else summary.nonOnlineMissing += 1;
    }
    return summary;
};

// Stage 1: parse + validate only — no database writes.
const stageImport = (buffer) => {
    const parsedData = excelService.parseExcelBuffer(buffer);
    const quality = buildQualitySummary(parsedData);
    if (parsedData.length === 0) {
        const error = new Error('No valid timetable entries found in this Excel format.');
        error.status = 400;
        throw error;
    }
    return { totalParsed: parsedData.length, quality, sample: parsedData.slice(0, 30) };
};

// Stage 2: transactional insert. Soft-deleted reference rows are ignored
// (deleted_at IS NULL); new rows inherit institution_id and term_id defaults.
const commitImport = async (client, parsedData) => {
    const results = { totalParsed: parsedData.length, inserted: 0, duplicates: 0, updated: 0, failed: 0, errors: [] };

    const findSingleTx = async (table, filters, select = 'id', soft = false) => {
        const whereClause = filters.map(([column], index) => `${column} = $${index + 1}`).join(' AND ');
        const values = filters.map(([, value]) => value);
        const softClause = soft ? ' AND deleted_at IS NULL' : '';
        const { rows } = await client.query(
            `SELECT ${select} FROM ${table} WHERE ${whereClause}${softClause} LIMIT 1`,
            values
        );
        return rows[0] || null;
    };

    let program = await findSingleTx('programs', [['name', DEFAULT_PROGRAM_NAME]], 'id', true);
    if (!program) {
        const { rows } = await client.query(
            'INSERT INTO programs (name, department) VALUES ($1, $2) RETURNING id',
            [DEFAULT_PROGRAM_NAME, DEFAULT_PROGRAM_DEPARTMENT]
        );
        program = rows[0];
    }

    const sectionCache = new Map();
    const subjectCache = new Map();
    const facultyCache = new Map();
    const roomCache = new Map();
    const slotCache = new Map();

    for (const entry of parsedData) {
        try {
            const sectionName = normalizeText(entry.section);
            const subjectCode = normalizeText(entry.subjectCode).toUpperCase();
            const subjectName = normalizeText(entry.subjectName) || subjectCode;
            const facultyName = normalizeText(entry.facultyName) || 'TBD Faculty';
            const roomNumber = normalizeText(entry.roomNumber || '');
            const slotKey = `${entry.startTime}|${entry.endTime}`;

            if (!sectionName || !subjectCode || !entry.day || !entry.startTime || !entry.endTime) {
                results.failed++;
                continue;
            }

            const sectionKey = `${program.id}|${sectionName.toLowerCase()}`;
            let sectionId = sectionCache.get(sectionKey);
            if (!sectionId) {
                const existingSection = await findSingleTx('sections', [['name', sectionName], ['program_id', program.id]], 'id', true);
                if (existingSection) {
                    sectionId = existingSection.id;
                } else {
                    const { rows } = await client.query(
                        'INSERT INTO sections (name, program_id, year, advisor) VALUES ($1, $2, $3, $4) RETURNING id',
                        [sectionName, program.id, new Date().getFullYear(), null]
                    );
                    sectionId = rows[0].id;
                }
                sectionCache.set(sectionKey, sectionId);
            }

            let subjectId = subjectCache.get(subjectCode);
            if (!subjectId) {
                const existingSubject = await findSingleTx('subjects', [['code', subjectCode]], 'id', true);
                if (existingSubject) {
                    subjectId = existingSubject.id;
                } else {
                    const { rows } = await client.query(
                        'INSERT INTO subjects (code, name, credits) VALUES ($1, $2, $3) RETURNING id',
                        [subjectCode, subjectName, 3]
                    );
                    subjectId = rows[0].id;
                }
                subjectCache.set(subjectCode, subjectId);
            }

            const facultyKey = facultyName.toLowerCase();
            let facultyId = facultyCache.get(facultyKey);
            if (!facultyId) {
                const existingFacultyByName = await findSingleTx('faculty', [['name', facultyName]], 'id', true);
                if (existingFacultyByName) {
                    facultyId = existingFacultyByName.id;
                } else {
                    const email = makeFacultyEmail(facultyName);
                    const existingFacultyByEmail = await findSingleTx('faculty', [['email', email]], 'id', true);
                    if (existingFacultyByEmail) {
                        facultyId = existingFacultyByEmail.id;
                    } else {
                        try {
                            const { rows } = await client.query(
                                'INSERT INTO faculty (name, department, email) VALUES ($1, $2, $3) RETURNING id',
                                [facultyName, 'TBD', email]
                            );
                            facultyId = rows[0].id;
                        } catch (facultyError) {
                            if (facultyError.code === '23505') {
                                const afterConflict = await findSingleTx('faculty', [['email', email]], 'id');
                                if (!afterConflict) throw facultyError;
                                facultyId = afterConflict.id;
                            } else {
                                throw facultyError;
                            }
                        }
                    }
                }
                facultyCache.set(facultyKey, facultyId);
            }

            let roomId = null;
            if (roomNumber && roomNumber.toLowerCase() !== 'online') {
                const roomKey = roomNumber.toLowerCase();
                roomId = roomCache.get(roomKey) || null;
                if (!roomId) {
                    const existingRoom = await findSingleTx('rooms', [['room_number', roomNumber]], 'id', true);
                    if (existingRoom) {
                        roomId = existingRoom.id;
                    } else {
                        const { rows } = await client.query(
                            'INSERT INTO rooms (room_number, capacity) VALUES ($1, $2) RETURNING id',
                            [roomNumber, 60]
                        );
                        roomId = rows[0].id;
                    }
                    roomCache.set(roomKey, roomId);
                }
            }

            let slotId = slotCache.get(slotKey);
            if (!slotId) {
                const existingSlot = await findSingleTx('time_slots', [['start_time', entry.startTime], ['end_time', entry.endTime]], 'id');
                if (existingSlot) {
                    slotId = existingSlot.id;
                } else {
                    const { rows } = await client.query(
                        'INSERT INTO time_slots (start_time, end_time, slot_number) VALUES ($1, $2, $3) RETURNING id',
                        [entry.startTime, entry.endTime, entry.slotNumber || 1]
                    );
                    slotId = rows[0].id;
                }
                slotCache.set(slotKey, slotId);
            }

            try {
                await client.query(
                    `INSERT INTO timetable_entries (section_id, subject_id, faculty_id, room_id, day, time_slot_id)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [sectionId, subjectId, facultyId, roomId, entry.day, slotId]
                );
                results.inserted++;
                continue;
            } catch (insertError) {
                if (insertError.code !== '23505') throw insertError;
                results.duplicates++;
                if (roomId) {
                    const existingEntry = await findSingleTx(
                        'timetable_entries',
                        [['section_id', sectionId], ['day', entry.day], ['time_slot_id', slotId]],
                        'id, room_id'
                    );
                    if (existingEntry?.id && !existingEntry.room_id) {
                        await client.query('UPDATE timetable_entries SET room_id = $1 WHERE id = $2', [roomId, existingEntry.id]);
                        results.updated++;
                    }
                }
            }
        } catch (err) {
            results.failed++;
            if (results.errors.length < 50) {
                const context = `${entry.section} | ${entry.day} | ${entry.timeSlot || `${entry.startTime}-${entry.endTime}`}`;
                results.errors.push(`${context} -> ${err.message}`);
            }
        }
    }
    return results;
};

module.exports = { stageImport, commitImport, buildQualitySummary, normalizeText };
