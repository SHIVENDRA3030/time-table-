// E2E proof for the admin + faculty portal:
// RBAC matrix, draft->publish visibility, faculty request lifecycle (incl.
// conflict rejection), audit rows, time-slot CRUD, Excel export.
// Usage: node scripts/test-admin-portal.js  (admin JWT read from env or re-authed)
require('dotenv').config({ quiet: true, path: '../.env.local' });
require('dotenv').config({ quiet: true });

const API = 'http://localhost:5000/api';
const AUTH = process.env.NEON_AUTH_BASE_URL;
const ORIGIN = 'http://localhost:5173';

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

const authCall = async (path, { method = 'GET', body, token, raw = false } = {}) => {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    if (raw) return res;
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, data };
};

const authApi = async (path, { method = 'GET', body, token } = {}) => {
    const res = await fetch(`${AUTH}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

// Sign up (or in) and exchange the session cookie for a JWT via /token.
const signUpOrIn = async (email, password, name) => {
    let res = await fetch(`${AUTH}/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ email, password, name })
    });
    let body = await res.json().catch(() => ({}));
    if (res.status !== 200) {
        res = await fetch(`${AUTH}/sign-in/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
            body: JSON.stringify({ email, password })
        });
        body = await res.json().catch(() => ({}));
    }
    if (res.status !== 200) throw new Error(`auth for ${email} failed: ${JSON.stringify(body).slice(0, 200)}`);

    // replay the session cookie to the JWT plugin's /token endpoint
    const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const tokenRes = await fetch(`${AUTH}/token`, { headers: { Cookie: cookies } });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenBody.token) throw new Error(`no JWT for ${email}: ${JSON.stringify(tokenBody).slice(0, 200)}`);
    return { token: tokenBody.token, userId: body.user?.id };
};

(async () => {
    // --- admin session (existing E2E user is admin via bootstrap) ---
    const admin = await signUpOrIn('timetable-e2e@college.edu', 'TestPass@12345', 'E2E Tester');
    const adminToken = admin.token;
    check('admin sign-in', Boolean(adminToken));

    // --- faculty session (email matches Dr. Anita Sharma) ---
    const facAuth = await signUpOrIn('anita.sharma@college.edu', 'TestPass@12345', 'Dr. Anita Sharma');
    const facToken = facAuth.token;
    const meFac = await authCall('/me', { token: facToken });
    check('faculty email -> faculty link', meFac.data?.faculty?.name === 'Dr. Anita Sharma', JSON.stringify(meFac.data?.faculty));
    const facUserId = meFac.data?.user?.id;

    // --- role assignment ---
    const roleSet = await authCall(`/admin/users/${facUserId}/role`, { method: 'PUT', token: adminToken, body: { role: 'viewer' } });
    check('admin assigns viewer role', roleSet.status === 200, JSON.stringify(roleSet.data).slice(0, 120));

    const meFac2 = await authCall('/me', { token: facToken });
    check('role visible in /me', meFac2.data?.role === 'viewer');

    // --- RBAC matrix ---
    const facCreate = await authCall('/programs/programs', { method: 'POST', token: facToken, body: { name: 'X', department: 'Y' } });
    check('viewer mutation blocked (403)', facCreate.status === 403);
    const facUsers = await authCall('/admin/users', { token: facToken });
    check('viewer blocked from /admin/users (403)', facUsers.status === 403);
    const facSlot = await authCall('/timetable/time-slots', { method: 'POST', token: facToken, body: { start_time: '09:00', end_time: '09:50', slot_number: 9 } });
    check('viewer blocked from slot create (403)', facSlot.status === 403);
    const anon = await authCall('/programs/programs');
    check('anonymous read blocked (401)', anon.status === 401);

    // --- draft/publish visibility ---
    const sections = await authCall('/programs/sections', { token: adminToken });
    const cseA = sections.data.find((s) => s.name === 'CSE-A');
    // start from a known draft state (a previous run may have left it published)
    await authCall(`/admin/sections/${cseA.id}/publish`, { method: 'PUT', token: adminToken, body: { status: 'draft' } });
    const facViewDraft = await authCall(`/timetable/section/${cseA.id}`, { token: facToken });
    check('viewer blocked on draft section (403)', facViewDraft.status === 403, JSON.stringify(facViewDraft.data).slice(0, 120));
    const adminViewDraft = await authCall(`/timetable/section/${cseA.id}`, { token: adminToken });
    check('admin sees draft section (200)', adminViewDraft.status === 200 && Array.isArray(adminViewDraft.data));
    const publish = await authCall(`/admin/sections/${cseA.id}/publish`, { method: 'PUT', token: adminToken, body: { status: 'published' } });
    check('admin publishes section', publish.status === 200 && publish.data.status === 'published');
    const facViewPublished = await authCall(`/timetable/section/${cseA.id}`, { token: facToken });
    check('viewer sees published section (200)', facViewPublished.status === 200);

    // --- faculty request lifecycle ---
    const facEntries = await authCall(`/timetable/faculty/${meFac.data.faculty.id}`, { token: facToken });
    const entry = facEntries.data[0];
    check('faculty sees own entries', Array.isArray(facEntries.data) && facEntries.data.length > 0, `${facEntries.data.length} entries`);

    const slots = await authCall('/timetable/time-slots', { token: facToken });
    // find a (day, slot) pair with NO entry for this section, faculty, or room
    const allEntries = await authCall('/timetable', { token: adminToken });
    let free = null;
    outer: for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
        for (const slot of slots.data) {
            const clash = allEntries.data.filter((e) => e.day === day && e.time_slot_id === slot.id);
            if (clash.some((e) => e.section_id === entry.section_id || e.faculty_id === entry.faculty_id || e.room_id === entry.room_id)) continue;
            free = { day, slot };
            break outer;
        }
    }
    check('found a free target slot', Boolean(free));

    const reqCreate = await authCall('/requests', {
        method: 'POST', token: facToken,
        body: { entry_id: entry.id, request_type: 'reschedule', proposed_day: free.day, proposed_time_slot_id: free.slot.id, reason: 'E2E: hospital appointment' }
    });
    check('faculty creates reschedule request', reqCreate.status === 201, JSON.stringify(reqCreate.data).slice(0, 120));

    const pendingList = await authCall('/requests?status=pending', { token: adminToken });
    check('admin sees pending request', pendingList.data.some((r) => r.id === reqCreate.data.id));

    const facDecide = await authCall(`/requests/${reqCreate.data.id}/decide`, { method: 'PUT', token: facToken, body: { decision: 'approved' } });
    check('viewer cannot decide requests (403)', facDecide.status === 403);

    const approve = await authCall(`/requests/${reqCreate.data.id}/decide`, {
        method: 'PUT', token: adminToken, body: { decision: 'approved', note: 'Approved for E2E' }
    });
    check('admin approves request (applied)', approve.status === 200 && approve.data.status === 'applied', JSON.stringify(approve.data.status));

    const moved = await authCall(`/timetable/${entry.id}`, { token: adminToken });
    const movedOk = moved.status === 200 || moved.status === 404; // GET by id not defined -> expect 404 for GET; verify via section query instead
    const afterEntries = await authCall(`/timetable/section/${entry.section_id}`, { token: adminToken });
    const movedEntry = afterEntries.data.find((e) => e.id === entry.id);
    check('entry actually moved', movedEntry && movedEntry.day === free.day && movedEntry.time_slot_id === free.slot.id,
        movedEntry ? `${movedEntry.day} ${movedEntry.time_slot?.start_time}` : 'entry missing');

    // conflicting reschedule: request a target that IS occupied -> approve must 409
    const occupied = allEntries.data.find((e) => e.id !== entry.id && e.faculty_id !== entry.faculty_id);
    const req2 = await authCall('/requests', {
        method: 'POST', token: facToken,
        body: { entry_id: entry.id, request_type: 'reschedule', proposed_day: occupied.day, proposed_time_slot_id: occupied.time_slot_id, reason: 'E2E conflict test' }
    });
    check('second request created', req2.status === 201);
    const approve2 = await authCall(`/requests/${req2.data.id}/decide`, { method: 'PUT', token: adminToken, body: { decision: 'approved' } });
    check('conflicting approval rejected (409)', approve2.status === 409, JSON.stringify(approve2.data).slice(0, 140));
    const reject2 = await authCall(`/requests/${req2.data.id}/decide`, { method: 'PUT', token: adminToken, body: { decision: 'rejected', note: 'Slot busy' } });
    check('admin rejects the conflicting request', reject2.status === 200 && reject2.data.status === 'rejected');

    // faculty cannot request someone else's class
    const otherEntry = allEntries.data.find((e) => e.faculty_id !== entry.faculty_id);
    const foreignReq = await authCall('/requests', {
        method: 'POST', token: facToken,
        body: { entry_id: otherEntry.id, request_type: 'cancel', reason: 'not mine' }
    });
    check('faculty blocked from other faculty entries (403)', foreignReq.status === 403);

    // --- time-slot CRUD ---
    const slotCreate = await authCall('/timetable/time-slots', { method: 'POST', token: adminToken, body: { start_time: '16:00', end_time: '17:00', slot_number: 9 } });
    check('admin creates time slot', slotCreate.status === 201);
    const slotUpdate = await authCall(`/timetable/time-slots/${slotCreate.data[0].id}`, { method: 'PUT', token: adminToken, body: { slot_number: 10 } });
    check('admin updates time slot', slotUpdate.status === 200 && slotUpdate.data.slot_number === 10);
    const slotDelete = await authCall(`/timetable/time-slots/${slotCreate.data[0].id}?force=1`, { method: 'DELETE', token: adminToken });
    check('admin deletes time slot', slotDelete.status === 200);

    // --- audit ---
    const auditList = await authCall('/admin/audit?limit=50', { token: adminToken });
    const actions = new Set(auditList.data.map((r) => r.action));
    check('audit log captures actions', auditList.data.length > 0 && actions.has('section.published') && actions.has('request.reschedule.apply'),
        `${auditList.data.length} rows: ${[...actions].slice(0, 8).join(', ')}`);

    // --- export ---
    const xlsx = await authCall(`/export/timetable/${cseA.id}.xlsx`, { token: adminToken, raw: true });
    const buf = Buffer.from(await xlsx.arrayBuffer());
    check('excel export returns xlsx bytes', xlsx.status === 200 && buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b, `${buf.length} bytes`);

    console.log(failures === 0 ? '\nADMIN PORTAL API E2E: ALL PASS' : `\nADMIN PORTAL API E2E: ${failures} FAILURES`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
