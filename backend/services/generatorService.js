const db = require('../db');

const shuffleArray = (array) => {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
};

const insertEntries = async (entries) => {
    const columns = ['section_id', 'subject_id', 'faculty_id', 'room_id', 'day', 'time_slot_id'];
    const chunkSize = 500; // stay within Postgres' 65535 parameter limit

    for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        const values = [];
        const rows = chunk.map((entry) =>
            columns.map((col) => {
                values.push(entry[col] ?? null);
                return `$${values.length}`;
            }).join(', ')
        );
        await db.query(
            `INSERT INTO timetable_entries (${columns.join(', ')}) VALUES ${rows.map((r) => `(${r})`).join(', ')}`,
            values
        );
    }
};

const generateTimetable = async (options = {}) => {
    // wipe=true clears every existing entry first, then schedules all workloads
    // from scratch. The controller audits the wipe.
    if (options.wipe) {
        await db.query('DELETE FROM timetable_entries');
    }

    // 1. Fetch all necessary data
    const [{ rows: workloads }, { rows: timeSlots }, { rows: rooms }, { rows: existingEntries }] = await Promise.all([
        db.query('SELECT * FROM workloads'),
        db.query('SELECT * FROM time_slots'),
        db.query('SELECT * FROM rooms'),
        db.query('SELECT * FROM timetable_entries'),
    ]);

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Build conflict trackers and count existing workload satisfaction
    const facultyBooked = new Set();
    const roomBooked = new Set();
    const sectionBooked = new Set();
    const existingWorkloadCounts = {};

    const getSlotKey = (entityId, day, timeSlotId) => `${entityId}_${day}_${timeSlotId}`;
    const getWorkloadKey = (sectionId, subjectId, facultyId) => `${sectionId}_${subjectId}_${facultyId}`;

    existingEntries.forEach(entry => {
        facultyBooked.add(getSlotKey(entry.faculty_id, entry.day, entry.time_slot_id));
        if (entry.room_id) roomBooked.add(getSlotKey(entry.room_id, entry.day, entry.time_slot_id));
        sectionBooked.add(getSlotKey(entry.section_id, entry.day, entry.time_slot_id));

        // Count how many times this specific class combination already exists
        const wlKey = getWorkloadKey(entry.section_id, entry.subject_id, entry.faculty_id);
        existingWorkloadCounts[wlKey] = (existingWorkloadCounts[wlKey] || 0) + 1;
    });

    // Expand workloads into individual lectures to schedule
    const lecturesToSchedule = [];
    workloads.forEach(wl => {
        const wlKey = getWorkloadKey(wl.section_id, wl.subject_id, wl.faculty_id);
        const alreadyScheduled = existingWorkloadCounts[wlKey] || 0;
        const remainingToSchedule = Math.max(0, wl.lectures_per_week - alreadyScheduled);

        for (let i = 0; i < remainingToSchedule; i++) {
            lecturesToSchedule.push({
                section_id: wl.section_id,
                subject_id: wl.subject_id,
                faculty_id: wl.faculty_id,
                room_id: wl.room_id || null // might be null
            });
        }
    });

    if (lecturesToSchedule.length === 0) {
        return { message: "All workloads are already fully scheduled. Nothing new to add.", entriesCreated: 0 };
    }

    // We will use a backtracking approach
    const newEntries = [];

    const solve = (lectureIndex) => {
        if (lectureIndex >= lecturesToSchedule.length) {
            return true; // All scheduled successfully
        }

        const lecture = lecturesToSchedule[lectureIndex];

        // Randomize days and timeslots to get different schedules each time
        const shuffledDays = shuffleArray([...days]);
        const shuffledTimeSlots = shuffleArray([...timeSlots]);

        for (const day of shuffledDays) {
            for (const timeSlot of shuffledTimeSlots) {

                // If a specific room isn't requested, we should try all rooms, but for simplicity
                // we'll just try to find ANY room if room_id is null, or just don't use a room.
                // Let's assume if room_id is null, it's a general classroom class, we pick a random one.
                const targetRooms = lecture.room_id
                    ? [{ id: lecture.room_id }]
                    : [{id: null}, ...shuffleArray([...rooms])]; // try no room first, then any room

                for (const potentialRoom of targetRooms) {
                    const rId = potentialRoom.id;

                    const facKey = getSlotKey(lecture.faculty_id, day, timeSlot.id);
                    const secKey = getSlotKey(lecture.section_id, day, timeSlot.id);
                    const rmKey = rId ? getSlotKey(rId, day, timeSlot.id) : null;

                    if (!facultyBooked.has(facKey) && !sectionBooked.has(secKey) && (!rmKey || !roomBooked.has(rmKey))) {
                        // Place it
                        facultyBooked.add(facKey);
                        sectionBooked.add(secKey);
                        if (rmKey) roomBooked.add(rmKey);

                        newEntries.push({
                            section_id: lecture.section_id,
                            subject_id: lecture.subject_id,
                            faculty_id: lecture.faculty_id,
                            room_id: rId,
                            day: day,
                            time_slot_id: timeSlot.id
                        });

                        // Recurse
                        if (solve(lectureIndex + 1)) {
                            return true;
                        }

                        // Backtrack
                        newEntries.pop();
                        facultyBooked.delete(facKey);
                        sectionBooked.delete(secKey);
                        if (rmKey) roomBooked.delete(rmKey);
                    }
                }
            }
        }

        return false; // Could not schedule this lecture
    };

    const success = solve(0);

    if (!success) {
        throw new Error("Could not find a conflict-free schedule with the given constraints and workloads.");
    }

    if (newEntries.length > 0) {
        // Bulk insert
        await insertEntries(newEntries);
    }

    return { message: "Schedule generated successfully", entriesCreated: newEntries.length };
};

module.exports = {
    generateTimetable
};
