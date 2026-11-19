// Postgres-backed job queue + in-process worker pool (enterprise plan F4).
// Single-instance today; the claim uses FOR UPDATE SKIP LOCKED so additional
// API instances can safely share the same queue later. Handlers register by
// kind; the tick also dispatches the notification outbox (F17) and expires
// stale change requests (F12).
const db = require('../db');
const { withTransaction } = db;
const outboxService = require('./outboxService');

const TICK_MS = 2000;
const EXPIRY_CHECK_TICKS = 15; // ~30s

const handlers = {}; // kind → async (job) => result

const register = (kind, handler) => {
    handlers[kind] = handler;
};

const createJob = async (kind, payload, createdBy, filePath = null, status = 'queued') => {
    const { rows } = await db.query(
        `INSERT INTO jobs (kind, payload, created_by, file_path, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [kind, JSON.stringify(payload || {}), createdBy || null, filePath, status]
    );
    return rows[0];
};

const getJob = async (id) => {
    const { rows } = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
    return rows[0] || null;
};

const setJobStatus = async (id, fields) => {
    const sets = [];
    const params = [];
    if (fields.status) { params.push(fields.status); sets.push(`status = $${params.length}`); }
    if (fields.result !== undefined) { params.push(JSON.stringify(fields.result)); sets.push(`result = $${params.length}`); }
    if (fields.error !== undefined) { params.push(fields.error); sets.push(`error = $${params.length}`); }
    if (fields.filePath !== undefined) { params.push(fields.filePath); sets.push(`file_path = $${params.length}`); }
    params.push(id);
    await db.query(
        `UPDATE jobs SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length}`,
        params
    );
};

// One unit of work: claim with SKIP LOCKED (safe across instances), run the
// handler, persist the outcome. Handler failures mark the job failed with the
// error text so clients can display per-job errors.
const processNext = async () => {
    const job = await withTransaction(async (client) => {
        const { rows } = await client.query(
            `SELECT * FROM jobs
             WHERE status = 'queued' AND kind IN (${Object.keys(handlers).map((k) => `'${k}'`).join(',') || "''"})
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1`
        );
        if (!rows[0]) return null;
        await client.query(`UPDATE jobs SET status = 'running', updated_at = now() WHERE id = $1`, [rows[0].id]);
        return rows[0];
    });
    if (!job) return false;

    const handler = handlers[job.kind];
    if (!handler) {
        await setJobStatus(job.id, { status: 'failed', error: `No handler for kind '${job.kind}'` });
        return true;
    }

    try {
        const result = await handler(job);
        // A handler may hand back a status (e.g. import parse → 'staged') and a
        // produced file (e.g. export workbook → file_path for the download route).
        if (result && result.status) {
            await setJobStatus(job.id, { status: result.status, result: result.result ?? null, filePath: result.filePath });
        } else {
            await setJobStatus(job.id, { status: 'done', result: result ?? null, filePath: result?.filePath });
        }
    } catch (err) {
        console.error(`Job ${job.id} (${job.kind}) failed:`, err.message);
        await setJobStatus(job.id, { status: 'failed', error: err.message });
    }
    return true;
};

// F12: pending change requests older than expires_at become 'expired', and
// both the faculty member and the office learn about it via the outbox.
const expireStaleRequests = async () => {
    const { rows } = await db.query(
        `UPDATE change_requests
         SET status = 'expired'
         WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()
         RETURNING id, requested_by_email, entry_snapshot`
    );
    for (const req of rows) {
        await outboxService.enqueue('request.expired', {
            requestId: req.id,
            email: req.requested_by_email,
            subject: req.entry_snapshot?.subject_name || null,
        });
    }
    return rows.length;
};

let tickTimer = null;
let tickCount = 0;
let running = false;

const tick = async () => {
    if (running) return;
    running = true;
    try {
        tickCount += 1;
        let worked = true;
        while (worked) worked = await processNext(); // drain the queue
        await outboxService.dispatchPending();
        if (tickCount % EXPIRY_CHECK_TICKS === 0) await expireStaleRequests();
    } catch (err) {
        console.error('Job tick error:', err.message);
    } finally {
        running = false;
    }
};

const startWorker = () => {
    if (tickTimer) return;
    // Crash recovery: jobs stuck 'running' from a killed process go back to
    // the queue (handlers are idempotent per job id / stage).
    db.query("UPDATE jobs SET status = 'queued', updated_at = now() WHERE status = 'running'")
        .then((r) => { if (r.rowCount > 0) console.log('Requeued ' + r.rowCount + " stale 'running' job(s)."); })
        .catch((err) => console.error('Requeue failed:', err.message));
    tickTimer = setInterval(tick, TICK_MS);
    console.log('Background worker started (jobs, outbox, request expiry).');
};

const stopWorker = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
};

module.exports = { register, createJob, getJob, setJobStatus, startWorker, stopWorker, expireStaleRequests };
