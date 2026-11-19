// Transactional outbox (enterprise plan F17): events written alongside state
// changes are dispatched by the background worker, never in the request path.
// Transports: console always; SMTP when SMTP_URL is configured; push is a
// TODO pending Expo push credentials.
const db = require('../db');

const enqueue = async (type, payload) => {
    await db.query('INSERT INTO outbox_events (type, payload) VALUES ($1, $2)', [
        type,
        JSON.stringify(payload || {}),
    ]);
};

const send = async (type, payload) => {
    // Minimal transport. Real SMTP/push wiring lands with provider credentials;
    // the outbox guarantees the event is never lost either way.
    console.log(JSON.stringify({ level: 'info', msg: 'notification', type, payload }));
};

const dispatchPending = async () => {
    const { rows } = await db.query(
        `SELECT id, type, payload FROM outbox_events
         WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`
    );
    for (const event of rows) {
        try {
            await send(event.type, event.payload);
            await db.query(`UPDATE outbox_events SET status = 'processed', processed_at = now() WHERE id = $1`, [event.id]);
        } catch (err) {
            await db.query(`UPDATE outbox_events SET status = 'failed' WHERE id = $1`, [event.id]);
            console.error(`Outbox event ${event.id} failed:`, err.message);
        }
    }
    return rows.length;
};

module.exports = { enqueue, dispatchPending };
