const db = require('../db');
const { audit } = require('../services/auditService');

const ROLES = ['admin', 'editor', 'viewer'];

// GET /api/admin/users — every Neon Auth identity with its app role and
// portal-access allowlist status.
const listUsers = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT u.id::text AS user_id, u.name, u.email, u."createdAt" AS auth_created_at,
                   au.role, au.created_at AS role_created_at,
                   pa.access_role, pa.is_active AS access_active
            FROM neon_auth.user u
            LEFT JOIN app_users au ON au.user_id = u.id::text
            LEFT JOIN portal_access pa ON lower(pa.email) = lower(u.email)
            ORDER BY u."createdAt" DESC
        `);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PUT /api/admin/users/:userId/role — assign or change an app role.
const setUserRole = async (req, res) => {
    const { userId } = req.params;
    const { role } = req.body;
    if (!ROLES.includes(role)) {
        return res.status(400).json({ error: 'role must be one of: ' + ROLES.join(', ') });
    }
    try {
        const { rows } = await db.query(
            `INSERT INTO app_users (user_id, role, display_name)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
             RETURNING *`,
            [userId, role, req.body.display_name || null]
        );
        // A user cannot demote themselves out of the last admin seat.
        if (req.auth.userId === userId && role !== 'admin') {
            const { rows: admins } = await db.query("SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin'");
            if (admins[0].n === 0) {
                await db.query("UPDATE app_users SET role = 'admin' WHERE user_id = $1", [userId]);
                return res.status(400).json({ error: 'Cannot demote the only admin.' });
            }
        }
        await audit(req, 'user.role.set', 'app_user', userId, { role });
        res.json({ message: 'Role updated.', user_id: userId, role: rows[0].role });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// GET /api/admin/audit?actor=&action=&entity=&limit=
const listAudit = async (req, res) => {
    const { actor, action, entity } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const clauses = [];
    const params = [];
    if (actor) { params.push(`%${actor}%`); clauses.push(`(actor_email ILIKE $${params.length} OR actor_user_id ILIKE $${params.length})`); }
    if (action) { params.push(`%${action}%`); clauses.push(`action ILIKE $${params.length}`); }
    if (entity) { params.push(entity); clauses.push(`entity = $${params.length}`); }
    params.push(limit);
    const limitIdx = params.length;
    try {
        const { rows } = await db.query(
            `SELECT * FROM audit_log
             ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
             ORDER BY created_at DESC
             LIMIT $${limitIdx}`,
            params
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PUT /api/admin/sections/:id/publish — draft <-> published per section.
const publishSection = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!['draft', 'published'].includes(status)) {
        return res.status(400).json({ error: "status must be 'draft' or 'published'." });
    }
    try {
        const { rows } = await db.query(
            `UPDATE sections
             SET status = $1,
                 published_at = CASE WHEN $1 = 'published' THEN NOW() ELSE NULL END
             WHERE id = $2
             RETURNING id, name, status, published_at`,
            [status, id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Section not found.' });
        await audit(req, `section.${status}`, 'section', id, { name: rows[0].name });
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { listUsers, setUserRole, listAudit, publishSection };
