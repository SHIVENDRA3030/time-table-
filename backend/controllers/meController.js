const db = require('../db');
const { audit } = require('../services/auditService');

// GET /api/me — the signed-in caller's role, faculty/student links, allowlist
// state, and bootstrap state. `provisioned: false` drives the frontend's
// "not added to any college or faculty" screen.
const getMe = async (req, res) => {
    try {
        const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin'");
        res.json({
            user: { id: req.auth.userId, email: req.auth.email, name: req.auth.name },
            role: req.user.role,
            faculty: req.user.faculty,
            student: req.user.student,
            accessRole: req.user.access ? req.user.access.access_role : null,
            provisioned: Boolean(req.user.provisioned),
            needsBootstrap: rows[0].n === 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// POST /api/admin/bootstrap — grants the caller admin only while no admin exists.
const bootstrapAdmin = async (req, res) => {
    try {
        const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin'");
        if (rows[0].n > 0) {
            return res.status(403).json({ error: 'An admin already exists. Ask an admin to assign roles.' });
        }
        await db.query(
            `INSERT INTO app_users (user_id, role, display_name)
             VALUES ($1, 'admin', $2)
             ON CONFLICT (user_id) DO UPDATE SET role = 'admin', display_name = EXCLUDED.display_name`,
            [req.auth.userId, req.auth.name || req.auth.email]
        );
        // Also allowlist the bootstrap admin so the new access gate governs them
        // like everyone else instead of relying on the carve-out forever.
        if (req.auth.email) {
            await db.query(
                `INSERT INTO portal_access (email, access_role, full_name, is_active, added_by_email)
                 VALUES ($1, 'admin', $2, TRUE, $1)
                 ON CONFLICT (email) DO UPDATE SET access_role = 'admin', is_active = TRUE`,
                [req.auth.email, req.auth.name || req.auth.email]
            );
        }
        await audit(req, 'bootstrap.admin', 'app_user', req.auth.userId, { email: req.auth.email });
        res.json({ message: 'Admin access granted.', role: 'admin' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getMe, bootstrapAdmin };
