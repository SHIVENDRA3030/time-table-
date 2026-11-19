// Writes one audit_log row per mutation. Failures are logged but never fail the
// request that triggered them.
const db = require('../db');

const audit = async (req, action, entity, entityId = null, details = null) => {
    try {
        await db.query(
            `INSERT INTO audit_log (actor_user_id, actor_email, action, entity, entity_id, details, ip, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                req.auth?.userId || null,
                req.auth?.email || null,
                action,
                entity,
                entityId !== null && entityId !== undefined ? String(entityId) : null,
                details ? JSON.stringify(details) : null,
                req.ip || null,
                req.headers?.['user-agent'] || null
            ]
        );
    } catch (error) {
        console.error('Audit write failed:', error.message);
    }
};

module.exports = { audit };
