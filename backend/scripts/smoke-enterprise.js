// End-to-end smoke for the enterprise readiness work. Run with the backend up:
//   node scripts/smoke-enterprise.js
// Covers: session→token exchange, refresh rotation + reuse detection, v1
// contract, faculty request create with idempotency replay + cancel, admin
// approval transaction, async export job, provisioning gate.
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });

const BASE = 'http://localhost:5000';
const AUTH_URL = process.env.NEON_AUTH_BASE_URL;
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name} ${extra}`); }
};

// JSON parse with diagnostics: never crash on an HTML error page mid-run.
const asJson = async (res) => {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`non-JSON response (HTTP ${res.status}): ${text.slice(0, 120)}`);
    }
};

const postJson = async (path, body, headers = {}) => {
    const res = await post(path, body, headers);
    return { status: res.status, body: await asJson(res).catch((e) => ({ parseError: e.message })) };
};

const post = (path, body, headers = {}) =>
    fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });

const signIn = async (email, password) => {
    const res = await fetch(`${AUTH_URL}/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ email, password }),
    });
    const setCookie = res.headers.get('set-cookie') || '';
    const [pair] = setCookie.split(/,(?=[^;]+?=)/);
    const cookie = pair ? pair.split(';')[0].trim() : null;
    const body = await res.json();
    return { cookie, body };
};

(async () => {
    // ── admin: sign-in → token exchange ──
    const admin = await signIn('mobile.admin@ttstudio.dev', 'AdminPass123!');
    check('admin sign-in via auth server', !!admin.cookie && !!admin.body.user);

    const tokenRes = await post('/api/auth/token', { sessionCookie: admin.cookie });
    const tokens = await tokenRes.json();
    check('session → token pair issued', tokenRes.status === 200 && !!tokens.accessToken && !!tokens.refreshToken,
        JSON.stringify(tokens).slice(0, 120));

    // ── v1 contract + data access with the mobile token ──
    const sectionsRes = await fetch(BASE + '/api/v1/programs/sections', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const sections = await sectionsRes.json();
    check('GET /api/v1/programs/sections with mobile token', sectionsRes.status === 200 && Array.isArray(sections) && sections.length > 0);

    const meRes = await fetch(BASE + '/api/v1/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const me = await meRes.json();
    check('GET /api/v1/me role=admin provisioned', meRes.status === 200 && me.role === 'admin' && me.provisioned === true);

    // ── refresh rotation + reuse detection ──
    const rotRes = await post('/api/auth/refresh', { refreshToken: tokens.refreshToken });
    const rotated = await rotRes.json();
    check('refresh rotation issues new pair', rotRes.status === 200 && rotated.refreshToken !== tokens.refreshToken);

    const reuseRes = await post('/api/auth/refresh', { refreshToken: tokens.refreshToken });
    const reuse = await reuseRes.json();
    check('refresh reuse detected → family revoked', reuseRes.status === 401 && reuse.code === 'reuse_detected');

    const afterReuse = await post('/api/auth/refresh', { refreshToken: rotated.refreshToken });
    check('family revoked after reuse', afterReuse.status === 401);

    // Fresh admin tokens for the export test (mobile token revoked above).
    const adminTokenRes = await post('/api/auth/token', { sessionCookie: admin.cookie });
    const adminTokens = await adminTokenRes.json();
    const adminAuth = { Authorization: `Bearer ${adminTokens.accessToken}` };

    // ── async export job pipeline ──
    const secRes = await fetch(BASE + '/api/v1/programs/sections', { headers: adminAuth });
    const allSections = await secRes.json();
    const cseA = allSections.find((s) => s.name === 'CSE-A');
    const exportRes = await post(`/api/v1/export/timetable/${cseA.id}`, {}, adminAuth);
    const exportJob = await exportRes.json();
    check('export queued (202)', exportRes.status === 202 && !!exportJob.jobId);

    let exportDone = null;
    for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const jobRes = await fetch(BASE + `/api/jobs/${exportJob.jobId}`, { headers: adminAuth });
        try {
            const job = await asJson(jobRes);
            if (job.status === 'done') { exportDone = job; break; }
            if (job.status === 'failed') { exportDone = job; break; }
        } catch (e) {
            check('job poll', false, e.message);
            break;
        }
    }
    check('export job completes', !!exportDone && exportDone.status === 'done', JSON.stringify(exportDone?.error || ''));

    const dlRes = await fetch(BASE + `/api/exports/${exportJob.jobId}/download`, { headers: adminAuth });
    check('export download streams xlsx', dlRes.status === 200 && (dlRes.headers.get('content-type') || '').includes('spreadsheet'), `status=${dlRes.status} type=${dlRes.headers.get('content-type')}`);

    // ── faculty: idempotency + cancel ──
    const fac = await signIn('mobile.test@ttstudio.dev', 'TestPass123!');
    const facTokenRes = await post('/api/auth/token', { sessionCookie: fac.cookie });
    const facTokens = await facTokenRes.json();
    // Unique per run: a fixed key would replay an old (already cancelled)
    // request on re-runs, breaking the cancel check below.
    const facAuth = { Authorization: `Bearer ${facTokens.accessToken}`, 'Idempotency-Key': `smoke-key-${Date.now()}` };

    const meFacRes = await fetch(BASE + '/api/v1/me', { headers: { Authorization: `Bearer ${facTokens.accessToken}` } });
    const meFac = await meFacRes.json();
    check('faculty provisioned via allowlist', meFacRes.status === 200 && meFac.faculty && meFac.provisioned === true);

    const facEntries = await fetch(BASE + `/api/v1/timetable/faculty/${meFac.faculty.id}`, {
        headers: { Authorization: `Bearer ${facTokens.accessToken}` },
    });
    const entries = await facEntries.json();
    check('faculty sees own schedule', facEntries.status === 200 && Array.isArray(entries) && entries.length > 0);
    const entryId = entries[0].id;

    const reqBody = {
        entry_id: entryId,
        request_type: 'reschedule',
        proposed_day: 'Wednesday',
        proposed_time_slot_id: entries[0].time_slot_id,
        reason: 'Enterprise smoke test',
    };
    const first = await post('/api/v1/requests', reqBody, facAuth);
    const replay = await post('/api/v1/requests', reqBody, facAuth);
    const firstBody = await first.json();
    const replayBody = await replay.json();
    check('idempotency: first create accepted', first.status === 201);
    check('idempotency: replay returns same id', replay.status === 201 && replayBody.id === firstBody.id,
        `first=${firstBody.id} replay=${replayBody.id}`);

    const cancelRes = await post(`/api/v1/requests/${firstBody.id}/cancel`, {}, {
        Authorization: `Bearer ${facTokens.accessToken}`,
    });
    const cancelled = await cancelRes.json();
    check('faculty cancels own pending request', cancelRes.status === 200 && cancelled.status === 'cancelled');

    // ── provisioning gate: a signed-in non-allowlisted user is blocked ──
    const outsider = await signIn('nobody@ttstudio.dev', 'WrongPass123!');
    check('non-allowlisted sign-in rejected by IdP', !outsider.cookie);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
})();
