// Portal-access allowlist management. The gate rule in three places (check,
// rbac.attachUser, and the login page) is identical:
//   allowed = active portal_access row OR existing admin email OR first-run
//   (allowlist empty AND zero admins, so the very first admin can still bootstrap).
const db = require('../db');
const multer = require('multer');
const { audit } = require('../services/auditService');
const rosterService = require('../services/rosterService');

const ACCESS_ROLES = ['admin', 'editor', 'faculty', 'student'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const storage = multer.memoryStorage();
const upload = multer({ storage });

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// POST /api/access/check — public pre-auth lookup for the login page. Only
// returns the gate decision, never any allowlist details.
const check = async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL_RE.test(email)) {
        return res.json({ allowed: false, bootstrapOpen: false });
    }
    try {
        const { rows } = await db.query(
            'SELECT is_active FROM portal_access WHERE lower(email) = lower($1) LIMIT 1',
            [email]
        );
        if (rows[0]) {
            return res.json({ allowed: rows[0].is_active, bootstrapOpen: false });
        }
        const { rows: stateRows } = await db.query(
            `SELECT (SELECT COUNT(*)::int FROM portal_access) AS access_n,
                    (SELECT COUNT(*)::int FROM app_users WHERE role = 'admin') AS admin_n`
        );
        const { access_n, admin_n } = stateRows[0];
        const bootstrapOpen = access_n === 0 && admin_n === 0;
        if (bootstrapOpen) {
            return res.json({ allowed: true, bootstrapOpen: true });
        }
        // Carve-out: accounts that already hold the admin role stay allowed even
        // without an allowlist row, so the install can never lock itself out.
        const { rows: adminRows } = await db.query(
            `SELECT 1 FROM neon_auth.user u
             JOIN app_users au ON au.user_id = u.id::text
             WHERE lower(u.email) = lower($1) AND au.role = 'admin' LIMIT 1`,
            [email]
        );
        res.json({ allowed: adminRows.length > 0, bootstrapOpen: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// GET /api/access — every allowlist entry with its section label.
const list = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT pa.id, pa.email, pa.access_role, pa.full_name, pa.department,
                   pa.section_id, sec.name AS section_name, pa.is_active,
                   pa.added_by_email, pa.created_at
            FROM portal_access pa
            LEFT JOIN sections sec ON sec.id = pa.section_id
            ORDER BY pa.created_at DESC`);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Resolve section names (case-insensitive) to ids in one query. Returns a Map
// keyed by lowercase name.
const resolveSectionIds = async (sectionNames) => {
    const wanted = [...new Set(sectionNames.filter(Boolean).map((n) => String(n).trim().toLowerCase()))];
    if (wanted.length === 0) return new Map();
    const { rows } = await db.query(
        'SELECT lower(name) AS key, id FROM sections WHERE lower(name) = ANY($1::text[])',
        [wanted]
    );
    return new Map(rows.map((r) => [r.key, r.id]));
};

// Keep faculty/students profile rows in step with allowlist entries so the
// email-based portal links work the moment someone is added.
const syncProfiles = async (entries) => {
    const facultyEntries = entries
        .filter((e) => e.access_role === 'faculty')
        .map((e) => ({ name: e.full_name || e.email.split('@')[0], department: e.department || 'Not Assigned', email: e.email }));
    if (facultyEntries.length > 0) {
        await db.query(
            `INSERT INTO faculty (name, department, email)
             SELECT r.name, r.department, r.email
             FROM jsonb_to_recordset($1::jsonb) AS r(name text, department text, email text)
             ON CONFLICT (email) DO UPDATE SET
                 name = COALESCE(NULLIF(EXCLUDED.name, ''), faculty.name),
                 department = COALESCE(NULLIF(EXCLUDED.department, ''), faculty.department)`,
            [JSON.stringify(facultyEntries)]
        );
    }

    const studentEntries = entries
        .filter((e) => e.access_role === 'student')
        .map((e) => ({ name: e.full_name || e.email.split('@')[0], email: e.email, section_id: e.section_id || null }));
    if (studentEntries.length > 0) {
        await db.query(
            `INSERT INTO students (name, email, section_id)
             SELECT r.name, r.email, r.section_id
             FROM jsonb_to_recordset($1::jsonb) AS r(name text, email text, section_id uuid)
             ON CONFLICT (email) DO UPDATE SET
                 name = COALESCE(NULLIF(EXCLUDED.name, ''), students.name),
                 section_id = COALESCE(EXCLUDED.section_id, students.section_id)`,
            [JSON.stringify(studentEntries)]
        );
    }
};

// POST /api/access — add (or reactivate) a single allowlist entry.
const add = async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const accessRole = req.body?.access_role;
    if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required.' });
    }
    if (!ACCESS_ROLES.includes(accessRole)) {
        return res.status(400).json({ error: 'access_role must be one of: ' + ACCESS_ROLES.join(', ') });
    }

    try {
        const fullName = normalizeText(req.body?.full_name) || email.split('@')[0];
        const department = normalizeText(req.body?.department) || null;

        let sectionId = req.body?.section_id || null;
        if (accessRole === 'student' && !sectionId && req.body?.section) {
            const sectionName = String(req.body.section).trim();
            sectionId = (await resolveSectionIds([sectionName])).get(sectionName.toLowerCase()) || null;
            if (!sectionId) {
                return res.status(400).json({ error: `Section "${sectionName}" was not found.` });
            }
        }

        const { rows } = await db.query(
            `INSERT INTO portal_access (email, access_role, full_name, department, section_id, added_by_email)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (email) DO UPDATE SET
                 access_role = EXCLUDED.access_role,
                 full_name = EXCLUDED.full_name,
                 department = EXCLUDED.department,
                 section_id = EXCLUDED.section_id,
                 is_active = TRUE,
                 added_by_email = EXCLUDED.added_by_email
             RETURNING *`,
            [email, accessRole, fullName, department, sectionId, req.auth?.email || null]
        );
        const entry = rows[0];
        await syncProfiles([entry]);
        await audit(req, 'access.grant', 'portal_access', entry.id, { email, access_role: accessRole });
        res.status(201).json(entry);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// POST /api/access/bulk — roster upload (Excel/CSV). Rows with bad emails or
// unknown section names are reported back as skipped instead of failing the lot.
const bulk = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Attach a roster file (.xlsx, .xls or .csv) in the "file" field.' });
    }
    let parsed;
    try {
        parsed = rosterService.parseRoster(req.file.buffer);
    } catch (error) {
        return res.status(400).json({ error: 'Could not read the roster file: ' + error.message });
    }

    const skipped = [...parsed.skipped];
    const sectionMap = await resolveSectionIds(parsed.rows.map((r) => r.sectionName));

    const valid = [];
    for (const row of parsed.rows) {
        const sectionId = row.sectionName ? sectionMap.get(row.sectionName.toLowerCase()) || null : null;
        if (row.sectionName && row.role === 'student' && !sectionId) {
            skipped.push({ email: row.email, reason: `Section "${row.sectionName}" was not found.` });
            continue;
        }
        valid.push({
            email: row.email,
            access_role: row.role,
            full_name: row.name,
            department: row.role === 'faculty' ? row.department : null,
            section_id: row.role === 'student' ? sectionId : null,
        });
    }

    try {
        let added = 0, updated = 0;
        if (valid.length > 0) {
            // xmax = 0 marks rows created by this statement (not conflict-updated).
            const { rows } = await db.query(
                `INSERT INTO portal_access (email, access_role, full_name, department, section_id, added_by_email)
                 SELECT r.email, r.access_role, r.full_name, r.department, r.section_id, $2
                 FROM jsonb_to_recordset($1::jsonb) AS r(email text, access_role text, full_name text, department text, section_id uuid)
                 ON CONFLICT (email) DO UPDATE SET
                     access_role = EXCLUDED.access_role,
                     full_name = EXCLUDED.full_name,
                     department = EXCLUDED.department,
                     section_id = EXCLUDED.section_id,
                     is_active = TRUE,
                     added_by_email = EXCLUDED.added_by_email
                 RETURNING (xmax = 0) AS inserted`,
                [JSON.stringify(valid), req.auth?.email || null]
            );
            added = rows.filter((r) => r.inserted).length;
            updated = rows.length - added;
            await syncProfiles(valid);
        }
        await audit(req, 'access.bulk', 'portal_access', null, { added, updated, skipped: skipped.length });
        res.json({ added, updated, skipped });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PUT /api/access/:id — edit role, profile fields, section, or active state.
const update = async (req, res) => {
    const { id } = req.params;
    const { access_role, full_name, department, section_id, section, is_active } = req.body;

    if (access_role !== undefined && !ACCESS_ROLES.includes(access_role)) {
        return res.status(400).json({ error: 'access_role must be one of: ' + ACCESS_ROLES.join(', ') });
    }
    if (is_active !== undefined && typeof is_active !== 'boolean') {
        return res.status(400).json({ error: 'is_active must be true or false.' });
    }

    try {
        const { rows: existingRows } = await db.query('SELECT * FROM portal_access WHERE id = $1', [id]);
        const existing = existingRows[0];
        if (!existing) {
            return res.status(404).json({ error: 'Allowlist entry not found.' });
        }

        const nextRole = access_role !== undefined ? access_role : existing.access_role;
        let nextSectionId = section_id !== undefined ? section_id : existing.section_id;
        if (nextRole === 'student' && section) {
            const sectionName = String(section).trim();
            nextSectionId = (await resolveSectionIds([sectionName])).get(sectionName.toLowerCase()) || null;
        }

        const { rows } = await db.query(
            `UPDATE portal_access
             SET access_role = $2,
                 full_name = $3,
                 department = $4,
                 section_id = $5,
                 is_active = $6
             WHERE id = $1
             RETURNING *`,
            [
                id,
                nextRole,
                full_name !== undefined ? normalizeText(full_name) || null : existing.full_name,
                department !== undefined ? normalizeText(department) || null : existing.department,
                nextSectionId,
                is_active !== undefined ? is_active : existing.is_active
            ]
        );
        const entry = rows[0];

        if (entry.is_active && (entry.access_role === 'faculty' || entry.access_role === 'student')) {
            await syncProfiles([entry]);
        }
        await audit(req, 'access.update', 'portal_access', id, { email: entry.email, changes: req.body });
        res.json(entry);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// DELETE /api/access/:id — revoke portal access entirely.
const remove = async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query('DELETE FROM portal_access WHERE id = $1 RETURNING *', [id]);
        if (!rows[0]) {
            return res.status(404).json({ error: 'Allowlist entry not found.' });
        }
        await audit(req, 'access.revoke', 'portal_access', id, { email: rows[0].email });
        res.json({ message: `${rows[0].email} has been removed from the allowlist.` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    uploadMiddleware: upload.single('file'),
    check, list, add, bulk, update, remove
};
