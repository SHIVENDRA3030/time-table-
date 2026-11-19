const { Pool } = require('@neondatabase/serverless');
const path = require('path');

// Load Neon-managed env vars from the repo root (.env.local, written by `neon deploy`)
// first, then backend-local .env for app settings. Existing vars are never overridden.
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error(
        'Missing DATABASE_URL. Run `neon deploy` in the project root to provision Neon and write .env.local.'
    );
}

// Driver note: this machine's network blocks outbound port 5432, so plain TCP
// (`node-postgres`) cannot reach Neon. `@neondatabase/serverless` exports a
// drop-in pg-compatible Pool that tunnels the Postgres wire protocol over
// WebSocket/HTTPS on port 443. If you deploy on a network where 5432 is open,
// swapping this import to `pg` is the only change needed.
const pool = new Pool({
    connectionString,
    max: 10,
});

// Idle WebSocket-pooled connections can die silently (VPN/network blips) and
// emit an unhandled 'error' that would otherwise crash the whole server.
// Swallowing is safe: the next query simply opens a fresh connection.
pool.on('error', (err) => {
    console.error('Neon pool idle connection error (connection will be recreated):', err.message);
});

// Transaction helper: checked-out client with BEGIN/COMMIT and rollback on error.
// Multi-statement mutations MUST go through this (see enterprise plan §F5).
const withTransaction = async (fn) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
        throw error;
    } finally {
        client.release();
    }
};

module.exports = pool;
module.exports.withTransaction = withTransaction;
module.exports.pool = pool;
