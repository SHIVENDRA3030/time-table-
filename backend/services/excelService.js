const xlsx = require('xlsx');

const DAY_MAP = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday'
};

const METADATA_SHEETS = new Set([
    'advisor', 'student count hostel', 'section detail hostel', 'personal tt'
]);

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isDayValue = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(DAY_MAP, normalized);
};

const normalizeDay = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    return DAY_MAP[normalized] || null;
};

const isMetadataSheet = (sheetName) => {
    const lower = sheetName.toLowerCase().trim();
    if (METADATA_SHEETS.has(lower)) return true;
    if (lower.startsWith('f master')) return true;
    return false;
};

const extractSubjectCode = (value) => {
    const text = normalizeText(value).toUpperCase();
    if (!text) return null;

    // Split by /, \r\n, \n to handle all cell formats
    const parts = text.split(/[\r\n\/]+/).map(p => p.trim()).filter(Boolean);

    // Subject code pattern: 2-5 letters + optional space + 3-5 digits, optional LAB suffix
    const codeRegex = /\b([A-Z]{2,5}\s?\d{3,5}(?:LAB)?)\b/;

    for (const part of parts) {
        const match = part.match(codeRegex);
        if (!match) continue;

        const code = match[1].replace(/\s/g, '');

        // Filter out non-subject codes
        if (/^GLA\d+$/i.test(code)) continue;
        if (/^BP\d{3}$/i.test(code)) continue;
        if (/^VII\d+$/i.test(code)) continue; // Room numbers like VII-202

        // Strip trailing LAB suffix for matching
        return code.replace(/LAB$/i, '');
    }

    return null;
};

const extractRoomNumber = (value) => {
    const text = normalizeText(value).toUpperCase();
    if (!text) return null;

    // Skip online classes
    if (/\(ONLINE\)/.test(text) || text === 'ONLINE') return null;

    // Remove batch markers and group info before searching for rooms
    // Remove: (INNOVATOR_1), (INNOVATOR_2), (AA,FA,IA), etc.
    let cleaned = text
        .replace(/\(INNOVATOR[^)]*\)/g, ' ')
        .replace(/\([A-Z]{1,3}(?:,[A-Z]{1,3})*\)/g, ' ');

    // Try to find room after subject code
    // Pattern 1: After \r\n - "BCSC1010\r\nABI-311"
    const lines = cleaned.split(/\r?\n/);
    if (lines.length >= 2) {
        const roomLine = normalizeText(lines[lines.length - 1]);
        if (roomLine && !extractSubjectCode(roomLine)) {
            // Last line is room if it doesn't contain a subject code
            const roomMatch = roomLine.match(/^([A-Z]{2,12}[A-Z0-9]{0,4}(?:-[A-Z0-9]{1,8})*(?:-\d{1,4}[A-Z]?)?)/);
            if (roomMatch && roomMatch[1].length > 2) {
                return roomMatch[1];
            }
        }
    }

    // Pattern 2: Slash-separated "2AA1/BCSC0803/ABI-203A"
    const slashParts = cleaned.split('/');
    if (slashParts.length >= 3) {
        const lastPart = normalizeText(slashParts[slashParts.length - 1]);
        const roomMatch = lastPart.match(/^([A-Z]{2,12}[A-Z0-9]{0,4}(?:-[A-Z0-9]{1,8})*(?:-\d{1,4}[A-Z]?)?)/);
        if (roomMatch && roomMatch[1].length > 2 && !extractSubjectCode(roomMatch[1])) {
            return roomMatch[1];
        }
    }

    // Pattern 3: General room patterns in text
    // ABI-329, ABVIII-205, AB1-413, ABIII-102, ABI-203A, ABI-406
    const numericRoomMatches = cleaned.match(/[A-Z]{2,12}[A-Z0-9]{0,4}(?:-[A-Z0-9]{1,8})*-\d{1,4}[A-Z]?\b/g);
    if (numericRoomMatches && numericRoomMatches.length > 0) {
        // Filter out subject codes from room matches
        const rooms = numericRoomMatches.filter(m => !extractSubjectCode(m));
        if (rooms.length > 0) return rooms[rooms.length - 1];
    }

    // Named labs: ABXI-SMART MANUFACTURING LAB
    const namedLabMatches = cleaned.match(/[A-Z]{2,12}[A-Z0-9]{0,4}-[A-Z0-9]+(?:\s+[A-Z0-9]+){0,8}\s+LAB\b/g);
    if (namedLabMatches && namedLabMatches.length > 0) {
        return namedLabMatches[namedLabMatches.length - 1];
    }

    return null;
};

const parseCellText = (cellText, sectionName) => {
    const text = normalizeText(cellText);
    if (!text) return null;

    const result = {
        subjectCode: null,
        roomNumber: null,
        isOnline: false,
        subSections: [],
        batch: null
    };

    // Check for online
    if (/\(ONLINE\)/i.test(text)) {
        result.isOnline = true;
    }

    // Extract subject code
    result.subjectCode = extractSubjectCode(text);
    if (!result.subjectCode) return null;

    // Extract room
    result.roomNumber = extractRoomNumber(text);

    // Detect sub-section pattern: "2AA1/", "2AA1+2AA2/"
    const subSectionMatch = text.match(/^([A-Z0-9]+(?:\([^)]*\))?(?:\+[A-Z0-9]+(?:\([^)]*\))?)*)\//);
    if (subSectionMatch) {
        result.subSections = subSectionMatch[1].split('+').map(s => s.trim());
    }

    // Detect batch/group markers
    const batchMatch = text.match(/\((INNOVATOR[^)]*)\)/i);
    if (batchMatch) {
        result.batch = batchMatch[1].trim();
    }

    return result;
};

const extractSectionName = (rows) => {
    // Look for "Section:" in first 10 rows
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        // Check col 0 specifically for "Section:" prefix
        const col0 = normalizeText(rows[i]?.[0]);
        const sectionMatch = col0.match(/^Section:\s*(.+)/i);
        if (sectionMatch) {
            // Clean up: "2AA(73)" -> "2AA", "M. Tech. 1A(13)" -> "M.Tech.1A"
            let name = sectionMatch[1].replace(/\(\d+\)\s*$/, '').trim();
            // Remove student count info like "Student 75(26)"
            name = name.replace(/\s*Student\s+\d+.*/i, '').trim();
            return name;
        }
    }
    return null;
};

const parseLtpMetadata = (value) => {
    const ltp = normalizeText(value);
    if (!ltp) {
        return {
            type: 'Theory',
            practicalHours: 1
        };
    }

    const parts = ltp.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts[2] > 0) {
        return {
            type: 'Lab',
            practicalHours: Math.min(parts[2], 4)
        };
    }

    return {
        type: 'Theory',
        practicalHours: 1
    };
};

const extractSemesterFromHeader = (rows) => {
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
        const rowText = rows[i].map(c => normalizeText(c)).join(' ');
        const match = rowText.match(/Semester:\s*(VIII|VII|VI|V|IV|III|II|I|\d+)/i);
        if (match) return match[1];
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

const extractPrimaryFaculty = (value, sectionName = '') => {
    const text = normalizeText(value);
    if (!text) return 'TBD Faculty';

    if (sectionName) {
        const sectionPattern = escapeRegExp(sectionName);
        const specificMapping = text.match(
            new RegExp(`(${sectionPattern})\\s*:\\s*(.+?)(?=\\s+[A-Z0-9]+(?:\\([^)]*\\))?\\s*:|,|$)`, 'i')
        );
        if (specificMapping?.[2]) {
            const facultyFromMapping = normalizeText(specificMapping[2]).replace(/\(.*?\)/g, '').trim();
            if (facultyFromMapping) return facultyFromMapping;
        }
    }

    // Example formats:
    // "Prof. X, 2AA1:Ms. Y"
    // "2AA1: Dr. A, 2AA2: Dr. B"
    // "Prof. Himanshu Sharma, 2AA1:Ms. Ayshwarya Jaiswal"
    const firstChunk = normalizeText(text.split(',')[0]);
    let faculty = firstChunk
        .replace(/^[A-Za-z0-9.+-]+\s*:\s*/, '')
        .replace(/^[A-Za-z0-9.+-]+\s*\/\s*/, '')
        .replace(/\(.*?\)/g, '')
        .trim();

    if (!faculty) faculty = text.replace(/\(.*?\)/g, '').trim();
    return faculty || 'TBD Faculty';
};

const buildGlobalSubjectCatalog = (workbook) => {
    const catalog = new Map();

    // Find the F MASTER sheet (or similar)
    const masterSheetName = workbook.SheetNames.find(
        name => name.toLowerCase().startsWith('f master')
    );
    if (!masterSheetName) return catalog;

    const worksheet = workbook.Sheets[masterSheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // Find all "Code" header rows
    const codeHeaderIndices = [];
    for (let i = 0; i < rows.length; i++) {
        const col0 = normalizeText(rows[i]?.[0]).toLowerCase().trim();
        if (col0 === 'code') codeHeaderIndices.push(i);
    }

    for (const headerIndex of codeHeaderIndices) {
        // Determine column indices from header
        const headerRow = rows[headerIndex];
        let nameCol = -1;
        let creditCol = -1;
        let typeCol = -1;
        let facultyCol = -1;

        for (let j = 0; j < headerRow.length; j++) {
            const cell = normalizeText(headerRow[j]).toLowerCase();
            if (cell.includes('subject') && cell.includes('name')) nameCol = j;
            if (cell === 'credit') creditCol = j;
            if (cell === 'l t p' || cell === 'l   t   p') typeCol = j;
            if (cell === 'faculty') facultyCol = j;
        }

        // If faculty column not found by header, default to col 6
        if (facultyCol === -1) facultyCol = 6;

        // Read data rows until next empty block or next code header
        let emptyCount = 0;
        for (let i = headerIndex + 1; i < rows.length; i++) {
            const row = rows[i] || [];
            const rawCode = normalizeText(row[0]);
            if (!rawCode) {
                emptyCount++;
                if (emptyCount >= 3) break;
                continue;
            }
            emptyCount = 0;

            const code = extractSubjectCode(rawCode);
            if (!code) continue;

            const subjectName = nameCol >= 0 ? normalizeText(row[nameCol]) : code;
            const credits = creditCol >= 0 ? Number.parseInt(row[creditCol], 10) || 3 : 3;
            const ltp = typeCol >= 0 ? normalizeText(row[typeCol]) : '';
            const facultyRaw = normalizeText(row[facultyCol]) || '';

            const { type, practicalHours } = parseLtpMetadata(ltp);

            const existing = catalog.get(code);
            if (!existing) {
                catalog.set(code, { subjectName, facultyRaw, credits, type, practicalHours });
            } else {
                // Merge: prefer non-empty values
                catalog.set(code, {
                    subjectName: existing.subjectName || subjectName,
                    facultyRaw: existing.facultyRaw || facultyRaw,
                    credits: existing.credits || credits,
                    type: existing.type || type,
                    practicalHours: existing.practicalHours || practicalHours
                });
            }
        }
    }

    return catalog;
};

const parseSectionSheet = (sheetName, worksheet, globalCatalog) => {
    const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    if (rows.length === 0) return [];

    const scheduleHeaderRowIndex = findScheduleHeaderRowIndex(rows);
    if (scheduleHeaderRowIndex === -1) return [];

    // Extract section name from header or use sheet name
    const sectionName = extractSectionName(rows) || normalizeText(sheetName);

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

    // Check for in-sheet subject catalog (legacy format)
    const codeHeaderRowIndex = findCodeHeaderRowIndex(rows, scheduleHeaderRowIndex + 1);
    const localCatalog = buildLocalSubjectCatalog(rows, codeHeaderRowIndex);

    // Merge catalogs: local overrides global but preserves practicalHours from global
    const subjectCatalog = new Map();
    for (const [code, meta] of globalCatalog) {
        subjectCatalog.set(code, { ...meta });
    }
    for (const [code, meta] of localCatalog) {
        const existing = subjectCatalog.get(code) || {};
        subjectCatalog.set(code, {
            ...existing,
            ...meta,
            practicalHours: meta.practicalHours || existing.practicalHours || 1
        });
    }

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

        const skipSlots = new Set(); // Keep track of spanned slots

        for (const slot of timeSlots) {
            if (skipSlots.has(slot.colIndex)) continue;

            const rawCell = row[slot.colIndex];
            const cellText = normalizeText(rawCell);
            if (!cellText) continue;
            if (/^(break|lunch)$/i.test(cellText)) continue;

            const parsed = parseCellText(cellText, sectionName);
            if (!parsed || !parsed.subjectCode) continue;

            const subjectCode = parsed.subjectCode;
            const subjectMeta = subjectCatalog.get(subjectCode) || {};
            const facultyRaw = subjectMeta.facultyRaw || '';
            const practicalHours = subjectMeta.practicalHours || 1;

            const targetSections = parsed.subSections.length > 0 ? parsed.subSections : [sectionName];

            for (const entrySection of targetSections) {
                const baseOptions = {
                    sheetName,
                    section: entrySection,
                    parentSection: sectionName,
                    day: currentDay,
                    subjectCode,
                    subjectName: subjectMeta.subjectName || subjectCode,
                    facultyRaw,
                    facultyName: extractPrimaryFaculty(facultyRaw, entrySection),
                    roomNumber: parsed.roomNumber,
                    rawContent: cellText
                };

                entries.push({
                    ...baseOptions,
                    timeSlot: slot.label,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    slotNumber: slot.slotNumber
                });

                if (practicalHours > 1) {
                    const slotIndex = timeSlots.findIndex(s => s.colIndex === slot.colIndex);
                    for (let h = 1; h < practicalHours && (slotIndex + h) < timeSlots.length; h++) {
                        const nextSlot = timeSlots[slotIndex + h];
                        const nextCell = normalizeText(row[nextSlot.colIndex]);

                        if (!nextCell || /^(break|lunch)$/i.test(nextCell) || nextCell === cellText) {
                            entries.push({
                                ...baseOptions,
                                timeSlot: nextSlot.label,
                                startTime: nextSlot.startTime,
                                endTime: nextSlot.endTime,
                                slotNumber: nextSlot.slotNumber
                            });
                            skipSlots.add(nextSlot.colIndex);
                        } else {
                            break;
                        }
                    }
                }
            }
        }
    }

    return entries;
};

const buildLocalSubjectCatalog = (rows, codeHeaderRowIndex) => {
    const catalog = new Map();
    if (codeHeaderRowIndex === -1) return catalog;

    const headerRow = rows[codeHeaderRowIndex] || [];
    let nameCol = 1;
    let typeCol = 5;
    let facultyCol = 6;

    for (let j = 0; j < headerRow.length; j++) {
        const cell = normalizeText(headerRow[j]).toLowerCase();
        if (cell.includes('subject') && cell.includes('name')) nameCol = j;
        if (cell.replace(/\s+/g, '') === 'ltp') typeCol = j;
        if (cell === 'faculty') facultyCol = j;
    }

    for (let i = codeHeaderRowIndex + 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const code = extractSubjectCode(row[0]);
        if (!code) continue;

        const subjectName = normalizeText(row[nameCol]) || code;
        const facultyRaw = normalizeText(row[facultyCol]);
        const { type, practicalHours } = parseLtpMetadata(row[typeCol]);
        const existing = catalog.get(code);

        if (!existing) {
            catalog.set(code, { subjectName, facultyRaw, type, practicalHours });
            continue;
        }

        catalog.set(code, {
            subjectName: existing.subjectName || subjectName,
            facultyRaw: existing.facultyRaw || facultyRaw,
            type: existing.type || type,
            practicalHours: existing.practicalHours || practicalHours
        });
    }

    return catalog;
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

    // Build global subject catalog from F MASTER sheet
    const globalCatalog = buildGlobalSubjectCatalog(workbook);

    const allEntries = [];

    for (const sheetName of workbook.SheetNames) {
        // Skip metadata sheets
        if (isMetadataSheet(sheetName)) continue;

        const worksheet = workbook.Sheets[sheetName];
        const sectionEntries = parseSectionSheet(sheetName, worksheet, globalCatalog);
        if (sectionEntries.length === 0) continue;
        allEntries.push(...sectionEntries);
    }

    return dedupeBySectionDayAndSlot(allEntries);
};

module.exports = {
    parseExcelBuffer
};
