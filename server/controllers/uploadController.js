const multer = require('multer');
const excelService = require('../services/excelService');
const supabase = require('../mcp/supabaseClient');

const storage = multer.memoryStorage();
const upload = multer({ storage });

const DEFAULT_PROGRAM_NAME = process.env.DEFAULT_PROGRAM_NAME || 'B.Tech';
const DEFAULT_PROGRAM_DEPARTMENT = process.env.DEFAULT_PROGRAM_DEPARTMENT || 'Engineering';
const DEFAULT_FACULTY_PASSWORD = process.env.DEFAULT_FACULTY_PASSWORD || 'ChangeMe@123';
const RESET_TABLES = [
    'timetable_entries',
    'time_slots',
    'rooms',
    'faculty',
    'subjects',
    'sections',
    'programs'
];

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

const canResetDatabase = () => {
    const override = String(process.env.ALLOW_DATABASE_RESET || '').toLowerCase();
    if (override) return ['1', 'true', 'yes', 'on'].includes(override);
    return process.env.NODE_ENV !== 'production';
};

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
        const isOnline = rawContent.includes('online');

        if (isOnline) {
            summary.onlineClasses += 1;
        } else {
            summary.nonOnlineMissing += 1;
        }
    }

    return summary;
};

const findSingle = async (table, filters, select = 'id') => {
    let query = supabase.from(table).select(select).limit(1);
    for (const [column, value] of filters) {
        query = query.eq(column, value);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data || null;
};

const insertFaculty = async ({ name, department, email }) => {
    const baseRow = { name, department, email };

    // Primary path: schema has NOT NULL password
    const withPassword = await supabase
        .from('faculty')
        .insert([{ ...baseRow, password: DEFAULT_FACULTY_PASSWORD }])
        .select('id')
        .single();

    if (!withPassword.error) return withPassword.data;

    // Fallback for schemas that do not include password column
    if (withPassword.error.code === 'PGRST204' || /password/i.test(withPassword.error.message || '')) {
        const fallback = await supabase.from('faculty').insert([baseRow]).select('id').single();
        if (fallback.error) throw fallback.error;
        return fallback.data;
    }

    throw withPassword.error;
};

const getTableCount = async (table) => {
    const { count, error } = await supabase
        .from(table)
        .select('*', { head: true, count: 'exact' });

    if (error) throw error;
    return count || 0;
};

const clearTable = async (table) => {
    const { error } = await supabase
        .from(table)
        .delete()
        .not('id', 'is', null);

    if (error) throw error;
};

const uploadExcel = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
        const parsedData = excelService.parseExcelBuffer(req.file.buffer);
        const quality = buildQualitySummary(parsedData);

        if (parsedData.length === 0) {
            return res.status(400).json({
                error: 'No valid timetable entries found in this Excel format.'
            });
        }

        const isDryRun = String(req.query.dryRun || '').toLowerCase() === 'true';
        if (isDryRun) {
            return res.json({
                message: 'Dry run successful',
                totalParsed: parsedData.length,
                quality,
                sample: parsedData.slice(0, 30)
            });
        }

        const results = {
            totalParsed: parsedData.length,
            inserted: 0,
            duplicates: 0,
            updated: 0,
            failed: 0,
            errors: []
        };

        let program = await findSingle('programs', [['name', DEFAULT_PROGRAM_NAME]], 'id');
        if (!program) {
            const { data, error } = await supabase
                .from('programs')
                .insert([{ name: DEFAULT_PROGRAM_NAME, department: DEFAULT_PROGRAM_DEPARTMENT }])
                .select('id')
                .single();
            if (error) throw error;
            program = data;
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
                    const existingSection = await findSingle('sections', [['name', sectionName], ['program_id', program.id]], 'id');
                    if (existingSection) {
                        sectionId = existingSection.id;
                    } else {
                        const { data, error } = await supabase
                            .from('sections')
                            .insert([{
                                name: sectionName,
                                program_id: program.id,
                                year: new Date().getFullYear(),
                                advisor: null
                            }])
                            .select('id')
                            .single();
                        if (error) throw error;
                        sectionId = data.id;
                    }
                    sectionCache.set(sectionKey, sectionId);
                }

                let subjectId = subjectCache.get(subjectCode);
                if (!subjectId) {
                    const existingSubject = await findSingle('subjects', [['code', subjectCode]], 'id');
                    if (existingSubject) {
                        subjectId = existingSubject.id;
                    } else {
                        const { data, error } = await supabase
                            .from('subjects')
                            .insert([{
                                code: subjectCode,
                                name: subjectName,
                                credits: 3
                            }])
                            .select('id')
                            .single();
                        if (error) throw error;
                        subjectId = data.id;
                    }
                    subjectCache.set(subjectCode, subjectId);
                }

                const facultyKey = facultyName.toLowerCase();
                let facultyId = facultyCache.get(facultyKey);
                if (!facultyId) {
                    const existingFacultyByName = await findSingle('faculty', [['name', facultyName]], 'id');
                    if (existingFacultyByName) {
                        facultyId = existingFacultyByName.id;
                    } else {
                        const email = makeFacultyEmail(facultyName);
                        const existingFacultyByEmail = await findSingle('faculty', [['email', email]], 'id');
                        if (existingFacultyByEmail) {
                            facultyId = existingFacultyByEmail.id;
                        } else {
                            try {
                                const insertedFaculty = await insertFaculty({
                                    name: facultyName,
                                    department: 'TBD',
                                    email
                                });
                                facultyId = insertedFaculty.id;
                            } catch (facultyError) {
                                if (facultyError.code === '23505') {
                                    const afterConflict = await findSingle('faculty', [['email', email]], 'id');
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
                        const existingRoom = await findSingle('rooms', [['room_number', roomNumber]], 'id');
                        if (existingRoom) {
                            roomId = existingRoom.id;
                        } else {
                            const { data, error } = await supabase
                                .from('rooms')
                                .insert([{ room_number: roomNumber, capacity: 60 }])
                                .select('id')
                                .single();
                            if (error) throw error;
                            roomId = data.id;
                        }
                        roomCache.set(roomKey, roomId);
                    }
                }

                let slotId = slotCache.get(slotKey);
                if (!slotId) {
                    const existingSlot = await findSingle('time_slots', [['start_time', entry.startTime], ['end_time', entry.endTime]], 'id');
                    if (existingSlot) {
                        slotId = existingSlot.id;
                    } else {
                        const { data, error } = await supabase
                            .from('time_slots')
                            .insert([{ start_time: entry.startTime, end_time: entry.endTime, slot_number: entry.slotNumber || 1 }])
                            .select('id')
                            .single();
                        if (error) throw error;
                        slotId = data.id;
                    }
                    slotCache.set(slotKey, slotId);
                }

                const { error: insertError } = await supabase.from('timetable_entries').insert([{
                    section_id: sectionId,
                    subject_id: subjectId,
                    faculty_id: facultyId,
                    room_id: roomId,
                    day: entry.day,
                    time_slot_id: slotId
                }]);

                if (insertError) {
                    if (insertError.code === '23505') {
                        results.duplicates++;

                        // If the row already exists for the section/day/slot and has no room,
                        // backfill room_id from the current parsed row.
                        if (roomId) {
                            try {
                                const existingEntry = await findSingle(
                                    'timetable_entries',
                                    [
                                        ['section_id', sectionId],
                                        ['day', entry.day],
                                        ['time_slot_id', slotId]
                                    ],
                                    'id, room_id'
                                );

                                if (existingEntry?.id && !existingEntry.room_id) {
                                    const { error: updateError } = await supabase
                                        .from('timetable_entries')
                                        .update({ room_id: roomId })
                                        .eq('id', existingEntry.id);

                                    if (updateError) throw updateError;
                                    results.updated++;
                                }
                            } catch (updateExistingError) {
                                if (results.errors.length < 50) {
                                    const context = `${entry.section} | ${entry.day} | ${entry.timeSlot || `${entry.startTime}-${entry.endTime}`}`;
                                    results.errors.push(`${context} -> room backfill failed: ${updateExistingError.message}`);
                                }
                            }
                        }
                        continue;
                    }
                    throw insertError;
                }

                results.inserted++;
            } catch (err) {
                results.failed++;
                if (results.errors.length < 50) {
                    const context = `${entry.section} | ${entry.day} | ${entry.timeSlot || `${entry.startTime}-${entry.endTime}`}`;
                    results.errors.push(`${context} -> ${err.message}`);
                }
            }
        }

        return res.json({
            message: 'File processed successfully',
            results,
            quality
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};

const clearDatabaseData = async (req, res) => {
    if (!canResetDatabase()) {
        return res.status(403).json({
            error: 'Database reset is disabled. Set ALLOW_DATABASE_RESET=true on the server to enable this action.'
        });
    }

    try {
        const deleted = {};
        let totalDeleted = 0;

        for (const table of RESET_TABLES) {
            const countBefore = await getTableCount(table);
            deleted[table] = countBefore;

            if (countBefore > 0) {
                await clearTable(table);
            }

            totalDeleted += countBefore;
        }

        return res.json({
            message: 'Database data deleted successfully.',
            summary: {
                totalDeleted,
                deleted
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
};

module.exports = {
    uploadMiddleware: upload.single('file'),
    uploadExcel,
    clearDatabaseData
};
