const xlsx = require('xlsx');

const DAY_MAP = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday'
};

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const isDayValue = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(DAY_MAP, normalized);
};

const normalizeDay = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return DAY_MAP[normalized] || null;
};

const extractSubjectCode = (value) => {
    const text = normalizeText(value).toUpperCase();
    const match = text.match(/\b([A-Z]{4}\d{4})[A-Z]*\b/);
    return match ? match[1] : null;
};

const extractRoomNumber = (value) => {
    const text = normalizeText(value).toUpperCase();
    if (!text || text.includes('ONLINE')) return null;

    // Supports room formats like:
    // ABI-329, ABVIII-205, ABIX-11, ABII-4004, AB-VIII-205
    const numericRoomMatches = text.match(/\b[A-Z]{2,12}[A-Z0-9]{0,4}(?:-[A-Z0-9]{1,8})*-\d{1,4}[A-Z]?\b/g);
    if (numericRoomMatches && numericRoomMatches.length > 0) {
        return numericRoomMatches[numericRoomMatches.length - 1];
    }

    // Supports named labs without trailing numbers like:
    // ABXI-SMART MANUFACTURING LAB, ABXI-IIOT LAB
    const namedLabMatches = text.match(/\b[A-Z]{2,12}[A-Z0-9]{0,4}-[A-Z0-9]+(?:\s+[A-Z0-9]+){0,8}\s+LAB\b/g);
    if (namedLabMatches && namedLabMatches.length > 0) {
        return namedLabMatches[namedLabMatches.length - 1];
    }

    return null;
};

const parseTimeTokenToMinutes = (token) => {
    const text = normalizeText(token).toUpperCase();
    if (!text) return null;

    // Handles formats like "08:00", "8:00", "08:00:00"
    const direct = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (direct) {
        const hour = Number.parseInt(direct[1], 10);
        const minute = Number.parseInt(direct[2], 10);
        const second = Number.parseInt(direct[3] || '0', 10);
        if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
            return (hour * 60) + minute;
        }
    }

    // Handles formats like "08:00 AM"
    const ampm = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (ampm) {
        let hour = Number.parseInt(ampm[1], 10);
        const minute = Number.parseInt(ampm[2], 10);
        const period = ampm[3];
        if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
            if (period === 'AM') hour = hour === 12 ? 0 : hour;
            if (period === 'PM') hour = hour === 12 ? 12 : hour + 12;
            return (hour * 60) + minute;
        }
    }

    return null;
};

const minutesToSqlTime = (minutes) => {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    const hour = Math.floor(wrapped / 60);
    const minute = wrapped % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
};

const parseTimeRange = (value) => {
    const raw = normalizeText(value).replace(/[–—]/g, '-');
    if (!raw.includes('-')) return null;

    const parts = raw.split('-').map((part) => normalizeText(part));
    if (parts.length !== 2) return null;

    const startMinutes = parseTimeTokenToMinutes(parts[0]);
    const endMinutes = parseTimeTokenToMinutes(parts[1]);
    if (startMinutes === null || endMinutes === null) return null;

    return {
        label: raw,
        startMinutes,
        endMinutes
    };
};

const findScheduleHeaderRowIndex = (rows) => {
    const scanLimit = Math.min(rows.length, 80);
    for (let i = 0; i < scanLimit; i++) {
        const firstCell = normalizeText(rows[i]?.[0]).toLowerCase();
        if (!firstCell.includes('day/time')) continue;

        const timeColumns = rows[i]
            .slice(1)
            .map((cell) => parseTimeRange(cell))
            .filter(Boolean);
        if (timeColumns.length >= 3) return i;
    }
    return -1;
};

const findCodeHeaderRowIndex = (rows, startIndex) => {
    for (let i = startIndex; i < rows.length; i++) {
        const col0 = normalizeText(rows[i]?.[0]).toLowerCase();
        const col1 = normalizeText(rows[i]?.[1]).toLowerCase();
        if (col0 === 'code' && col1.includes('subject')) return i;
    }
    return -1;
};

const extractPrimaryFaculty = (value) => {
    const text = normalizeText(value);
    if (!text) return 'TBD Faculty';

    // Example formats:
    // "Prof. X, 2AA1:Ms. Y"
    // "2AA1: Dr. A, 2AA2: Dr. B"
    const firstChunk = normalizeText(text.split(',')[0]);
    let faculty = firstChunk
        .replace(/^[A-Za-z0-9.+-]+\s*:\s*/, '')
        .replace(/^[A-Za-z0-9.+-]+\s*\/\s*/, '')
        .replace(/\(.*?\)/g, '')
        .trim();

    if (!faculty) faculty = text.replace(/\(.*?\)/g, '').trim();
    return faculty || 'TBD Faculty';
};

const buildSubjectCatalog = (rows, codeHeaderRowIndex) => {
    const catalog = new Map();
    if (codeHeaderRowIndex === -1) return catalog;

    for (let i = codeHeaderRowIndex + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const code = extractSubjectCode(row[0]);
        if (!code) continue;

        const subjectName = normalizeText(row[1]) || code;
        const facultyRaw = normalizeText(row[6]);
        const existing = catalog.get(code);

        if (!existing) {
            catalog.set(code, { subjectName, facultyRaw });
            continue;
        }

        catalog.set(code, {
            subjectName: existing.subjectName || subjectName,
            facultyRaw: existing.facultyRaw || facultyRaw
        });
    }

    return catalog;
};

const parseSectionSheet = (sheetName, worksheet) => {
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (rows.length === 0) return [];

    const scheduleHeaderRowIndex = findScheduleHeaderRowIndex(rows);
    if (scheduleHeaderRowIndex === -1) return [];

    const scheduleHeader = rows[scheduleHeaderRowIndex] || [];
    const timeSlots = [];
    let previousStartMinutes = null;
    for (let colIndex = 1; colIndex < scheduleHeader.length; colIndex++) {
        const parsedRange = parseTimeRange(scheduleHeader[colIndex]);
        if (!parsedRange) continue;

        let startMinutes = parsedRange.startMinutes;
        let endMinutes = parsedRange.endMinutes;

        // Heuristic: headers are sequential through the day (e.g., 12:00-01:00 means 12:00-13:00).
        while (previousStartMinutes !== null && startMinutes <= previousStartMinutes && (startMinutes + 720) < 1440) {
            startMinutes += 720;
        }
        while (endMinutes <= startMinutes && (endMinutes + 720) < 1440) {
            endMinutes += 720;
        }

        previousStartMinutes = startMinutes;

        timeSlots.push({
            colIndex,
            slotNumber: timeSlots.length + 1,
            label: parsedRange.label,
            startTime: minutesToSqlTime(startMinutes),
            endTime: minutesToSqlTime(endMinutes)
        });
    }
    if (timeSlots.length === 0) return [];

    const codeHeaderRowIndex = findCodeHeaderRowIndex(rows, scheduleHeaderRowIndex + 1);
    const subjectCatalog = buildSubjectCatalog(rows, codeHeaderRowIndex);

    const scheduleEndRow = codeHeaderRowIndex === -1 ? rows.length : codeHeaderRowIndex;
    const entries = [];
    let currentDay = null;

    for (let rowIndex = scheduleHeaderRowIndex + 1; rowIndex < scheduleEndRow; rowIndex++) {
        const row = rows[rowIndex] || [];
        const col0 = normalizeText(row[0]);

        if (col0) {
            if (isDayValue(col0)) {
                currentDay = normalizeDay(col0);
            } else if (col0.toLowerCase() === 'code') {
                break;
            }
        }

        if (!currentDay) continue;

        for (const slot of timeSlots) {
            const cellText = normalizeText(row[slot.colIndex]);
            if (!cellText) continue;
            if (/^(break|lunch)$/i.test(cellText)) continue;

            const subjectCode = extractSubjectCode(cellText);
            if (!subjectCode) continue;

            const subjectMeta = subjectCatalog.get(subjectCode) || {};
            const facultyRaw = subjectMeta.facultyRaw || '';

            entries.push({
                sheetName,
                section: normalizeText(sheetName),
                day: currentDay,
                timeSlot: slot.label,
                startTime: slot.startTime,
                endTime: slot.endTime,
                slotNumber: slot.slotNumber,
                subjectCode,
                subjectName: subjectMeta.subjectName || subjectCode,
                facultyRaw,
                facultyName: extractPrimaryFaculty(facultyRaw),
                roomNumber: extractRoomNumber(cellText),
                rawContent: cellText
            });
        }
    }

    return entries;
};

const dedupeBySectionDayAndSlot = (entries) => {
    const seen = new Set();
    const deduped = [];

    for (const entry of entries) {
        const key = `${entry.section.toLowerCase()}|${entry.day}|${entry.startTime}|${entry.endTime}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(entry);
    }

    return deduped;
};

const parseExcelBuffer = (buffer) => {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const allEntries = [];

    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const sectionEntries = parseSectionSheet(sheetName, worksheet);
        if (sectionEntries.length === 0) continue;
        allEntries.push(...sectionEntries);
    }

    return dedupeBySectionDayAndSlot(allEntries);
};

module.exports = {
    parseExcelBuffer
};

