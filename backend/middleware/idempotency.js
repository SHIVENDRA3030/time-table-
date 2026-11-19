// Idempotency middleware (enterprise plan F6). Clients send `Idempotency-Key`
// on mutations; the first response is stored (24h TTL) and replayed verbatim on
// retries, so mobile networks can retry safely without double-creating rows.
const db = require('../db');

const TTL_MS = 24 * 60 * 60 * 1000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let lastCleanup = 0;

const cleanup = async () => {
    if (Date.now() - lastCleanup < 10 * 60 * 1000) return;
    lastCleanup = Date.now();
    try {
        await db.query('DELETE FROM idempotency_keys WHERE created_at < now() - INTERVAL \'24 hours\'');
    } catch (err) {
        console.error('Idempotency cleanup failed:', err.message);
    }
};

module.exports = function idempotency() {
    return async (req, res, next) => {
        const key = req.get('Idempotency-Key');
        if (!key || !MUTATING.has(req.method)) return next();
        if (key.length > 200) return res.status(400).json({ error: 'Idempotency-Key too long.' });

        const userId = req.auth?.userId || null;
        const path = req.originalUrl.split('?')[0];

        try {
            cleanup();

            const { rows: existing } = await db.query(
                `SELECT response_status, response_body FROM idempotency_keys
                 WHERE key = $1 AND user_id IS NOT DISTINCT FROM $2 AND method = $3 AND path = $4`,
                [key, userId, req.method, path]
            );

            if (existing[0]?.response_status) {
                // Completed request: replay the stored response.
                res.set('Idempotency-Replayed', 'true');
                return res.status(existing[0].response_status).json(existing[0].response_body);
            }
            if (existing[0]) {
                // Same key currently in flight (no stored response yet).
                return res.status(409).json({ error: 'An identical request is still in progress.' });
            }

            await db.query(
                `INSERT INTO idempotency_keys (key, user_id, method, path) VALUES ($1, $2, $3, $4)`,
                [key, userId, req.method, path]
            );
        } catch (err) {
            // Idempotency is a safety net, never a hard failure.
            console.error('Idempotency check failed:', err.message);
            return next();
        }

        // Capture the response body once, then persist after the response ships.
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            res.locals.__idempotentBody = body;
            return originalJson(body);
        };

        res.on('finish', () => {
            const body = res.locals.__idempotentBody;
            if (body === undefined || res.statusCode >= 500) return; // 5xx may be retried
            db.query(
                `UPDATE idempotency_keys SET response_status = $1, response_body = $2
                 WHERE key = $3 AND user_id IS NOT DISTINCT FROM $4 AND method = $5 AND path = $6`,
                [res.statusCode, JSON.stringify(body ?? null), key, userId, req.method, path]
            ).catch((err) => console.error('Idempotency store failed:', err.message));
        });

        next();
    };
};
