// Parses a roster workbook (Excel/CSV) for the portal-access allowlist upload.
// Expects one row per person with flexible, case-insensitive headers:
//   email (required), name, role (Faculty/Student/Admin/Editor; default Student),
//   department (faculty), section (student; resolved against sections by name).
const xlsx = require('xlsx');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_MAP = {
    faculty: 'faculty',
    teacher: 'faculty',
    staff: 'faculty',
    student: 'student',
    admin: 'admin',
    administrator: 'admin',
    editor: 'editor',
};

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// Case-insensitive lookup of a row field, tolerating header noise like
// "Email ", "EMAIL ID", "Student Email".
const pickField = (row, ...keywords) => {
    for (const key of Object.keys(row)) {
        const normalized = normalizeText(key).toLowerCase();
        if (keywords.some((kw) => normalized === kw || normalized.startsWith(kw))) {
            return row[key];
        }
    }
    return undefined;
};

const parseRoster = (buffer) => {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return { rows: [], skipped: [{ email: null, reason: 'The uploaded file has no sheets.' }] };

    const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    const rows = [];
    const skipped = [];

    for (const raw of rawRows) {
        const email = normalizeText(pickField(raw, 'email', 'mail')).toLowerCase();
        if (!email || !EMAIL_RE.test(email)) {
            skipped.push({ email: email || null, reason: 'Missing or invalid email address.' });
            continue;
        }

        const rawRole = normalizeText(pickField(raw, 'role', 'type', 'access')).toLowerCase();
        const role = ROLE_MAP[rawRole] || 'student';

        const name = normalizeText(pickField(raw, 'name', 'faculty name', 'student name')) || email.split('@')[0];
        const department = normalizeText(pickField(raw, 'department', 'dept')) || null;
        const sectionName = normalizeText(pickField(raw, 'section', 'class')) || null;

        rows.push({ email, role, name, department, sectionName });
    }

    if (rows.length === 0 && skipped.length === 0) {
        skipped.push({ email: null, reason: 'No data rows found. Expected headers: email, name, role, department, section.' });
    }

    return { rows, skipped };
};

module.exports = { parseRoster, EMAIL_RE };
