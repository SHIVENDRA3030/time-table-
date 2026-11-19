// Role-based access control. Neon Auth identities are mapped to app roles via
// the app_users table; faculty and student records are linked by matching email
// addresses; portal access is governed by the portal_access allowlist.
const db = require('../db');

const PRIVILEGED = new Set(['admin', 'editor']);
const NOT_PROVISIONED = {
    error: 'NOT_PROVISIONED',
    message: 'You are not added to any college or faculty. Please contact your administrator.'
};

// Allowlist roles map onto app roles on first login (insert-only, so later
// manual role changes in Users & Roles stick).
const ACCESS_ROLE_TO_APP_ROLE = { admin: 'admin', editor: 'editor' };

// Resolves the caller's role, faculty/student links, and allowlist state. Runs
// after verifyAuth on every /api request; safe to call when unauthenticated
// (leaves req.user empty).
const attachUser = async (req, res, next) => {
    req.user = {
        id: null, email: null, name: null, role: null,
        faculty: null, student: null, access: null, provisioned: false
    };

    if (req.auth && req.auth.userId) {
        req.user.id = req.auth.userId;
        req.user.email = req.auth.email;
        req.user.name = req.auth.name;
        try {
            const { rows: roleRows } = await db.query(
                'SELECT role, display_name FROM app_users WHERE user_id = $1',
                [req.auth.userId]
            );
            if (roleRows[0]) {
                req.user.role = roleRows[0].role;
                req.user.displayName = roleRows[0].display_name;
            }
        } catch (error) {
            console.error('Role lookup failed:', error.message);
        }
        if (req.auth.email) {
            try {
                // Allowlist lookup — who may use the portal at all. An explicit
                // (even deactivated) row is authoritative; the carve-outs below
                // only apply when there is no row for this email.
                const { rows: accessRows } = await db.query(
                    `SELECT access_role, full_name, department, section_id
                     FROM portal_access WHERE lower(email) = lower($1) AND is_active LIMIT 1`,
                    [req.auth.email]
                );
                req.user.access = accessRows[0] || null;

                if (req.user.access) {
                    req.user.provisioned = true;
                } else {
                    const { rows: stateRows } = await db.query(
                        `SELECT (SELECT COUNT(*)::int FROM portal_access) AS access_n,
                                (SELECT COUNT(*)::int FROM app_users WHERE role = 'admin') AS admin_n`
                    );
                    const { access_n, admin_n } = stateRows[0];
                    if (access_n === 0 && admin_n === 0) {
                        // First run: nothing configured yet, everyone may enter
                        // (the login page + bootstrap flow set the first admin up).
                        req.user.provisioned = true;
                    } else {
                        // Existing admins stay allowed so the install can never
                        // lock itself out of its own management portal.
                        const { rows: adminRows } = await db.query(
                            `SELECT 1 FROM neon_auth.user u
                             JOIN app_users au ON au.user_id = u.id::text
                             WHERE lower(u.email) = lower($1) AND au.role = 'admin' LIMIT 1`,
                            [req.auth.email]
                        );
                        req.user.provisioned = adminRows.length > 0;
                    }
                }

                // First login of an allowlisted user: seed their app role from
                // the allowlist entry.
                if (req.user.access && req.user.role === null) {
                    const mapped = ACCESS_ROLE_TO_APP_ROLE[req.user.access.access_role] || 'viewer';
                    await db.query(
                        `INSERT INTO app_users (user_id, role, display_name)
                         VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
                        [req.auth.userId, mapped, req.user.access.full_name || req.auth.name || req.auth.email]
                    );
                    req.user.role = mapped;
                }
            } catch (error) {
                console.error('Access lookup failed:', error.message);
            }
            try {
                const { rows: facRows } = await db.query(
                    'SELECT id, name, department FROM faculty WHERE lower(email) = lower($1)',
                    [req.auth.email]
                );
                req.user.faculty = facRows[0] || null;
            } catch (error) {
                console.error('Faculty lookup failed:', error.message);
            }
            try {
                const { rows: stuRows } = await db.query(
                    'SELECT id, name, section_id FROM students WHERE lower(email) = lower($1)',
                    [req.auth.email]
                );
                req.user.student = stuRows[0] || null;
            } catch (error) {
                console.error('Student lookup failed:', error.message);
            }
        }
    }

    next();
};

// Gate for every route: a verified Neon Auth identity is required at all.
const requireAuth = (req, res, next) => {
    if (!req.auth || !req.auth.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

// Gate for every data route: authenticated callers must be on the allowlist.
const requireProvisioned = (req, res, next) => {
    if (!req.auth || !req.auth.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!req.user || !req.user.provisioned) {
        return res.status(403).json(NOT_PROVISIONED);
    }
    next();
};

// Gate for privileged operations. 401 for anonymous calls, 403 for authenticated
// callers who are not allowlisted or whose role is not in the list.
const requireRole = (...roles) => (req, res, next) => {
    if (!req.auth || !req.auth.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!req.user || !req.user.provisioned) {
        return res.status(403).json(NOT_PROVISIONED);
    }
    if (!req.user.role || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Forbidden: requires ' + roles.join(' or ') + ' role.' });
    }
    next();
};

// True when the caller may edit data (admin or editor); everyone else, including
// users without an assigned role, is treated as a viewer.
const isEditor = (req) =>
    Boolean(req.user && req.user.role && PRIVILEGED.has(req.user.role));

const isAdmin = (req) => req.user && req.user.role === 'admin';

module.exports = { attachUser, requireAuth, requireProvisioned, requireRole, isEditor, isAdmin };
