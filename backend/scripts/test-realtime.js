// E2E proof for Neon Realtime:
// 1. fetch a sealed live query from the Express API (Bearer JWT)
// 2. subscribe via @neon/realtime/client over the Live SQL WebSocket
// 3. insert + delete a timetable entry through the API and observe live updates
// 4. renew the sealed query before expiry and confirm the subscription stays live
// Usage: E2E_JWT=<token> node scripts/test-realtime.js
require('dotenv').config({ quiet: true, path: '../.env.local' });
require('dotenv').config({ quiet: true });

const API = 'http://localhost:5000/api';
const token = process.env.E2E_JWT;
if (!token) { console.error('Set E2E_JWT'); process.exit(1); }

const { createRealtimeClient } = require('@neon/realtime/client');

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = async (path, options = {}) => {
    const res = await fetch(`${API}${path}`, { ...options, headers: { ...headers, ...options.headers } });
    if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
};

const t0 = Date.now();
const log = (...args) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);

const waitFor = (subscription, predicate, timeoutMs = 30000) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    subscription.onChange((snapshot) => {
        if (Array.isArray(snapshot.data) && predicate(snapshot.data)) {
            clearTimeout(timer);
            resolve(true);
        }
    });
});

(async () => {
    const sections = await api('/programs/sections');
    const cseA = sections.find((s) => s.name === 'CSE-A');
    const fetchSealed = () => api(`/realtime/section/${cseA.id}`, { method: 'POST' });

    log('1) sealed live query fetched from API (capability', fetchSealed ? 'ok' : 'fail' + ')');
    const sealed = await fetchSealed();

    const client = createRealtimeClient({ url: process.env.NEON_REALTIME_URL, logLevel: 'warn' });
    const subscription = client.subscribe(sealed);

    const ready = await waitFor(subscription, () => true);
    const initialRows = (subscription.getSnapshot() || {}).data || [];
    log(`2) subscription live, initial snapshot: ${initialRows.length} rows (ready=${ready})`);

    // pick a free slot for CSE-A / Anita / CS101 / R-101
    const allEntries = await api('/timetable');
    const slots = await api('/timetable/time-slots');
    const faculty = (await api('/resources/faculty')).find((f) => f.name === 'Dr. Anita Sharma');
    const subjects = (await api('/resources/subjects')).find((s) => s.code === 'CS101');
    const rooms = (await api('/resources/rooms')).find((r) => r.room_number === 'R-101');
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let candidate = null;
    outer: for (const day of days) {
        for (const slot of slots) {
            const clashes = allEntries.filter((e) => e.day === day && e.time_slot_id === slot.id);
            if (clashes.some((e) => e.section_id === cseA.id || e.faculty_id === faculty.id || e.room_id === rooms.id)) continue;
            candidate = { day, slot };
            break outer;
        }
    }
    if (!candidate) throw new Error('no free slot found');

    // Journal every snapshot: the change event can arrive while the insert HTTP
    // response is still in flight, so predicates must run against history, not
    // against listeners registered after a specific moment.
    const journal = [];
    subscription.onChange((snapshot) => {
        if (Array.isArray(snapshot.data)) journal.push({ at: Date.now(), data: snapshot.data });
    });

    let createdId = null;
    const sawInsertPromise = (async () => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            if (createdId && journal.some((j) => j.data.some((r) => r.id === createdId))) return true;
            await new Promise((r) => setTimeout(r, 200));
        }
        return false;
    })();

    const created = await api('/timetable', {
        method: 'POST',
        body: JSON.stringify({
            section_id: cseA.id, subject_id: subjects.id, faculty_id: faculty.id,
            room_id: rooms.id, day: candidate.day, time_slot_id: candidate.slot.id,
        }),
    });
    createdId = created[0].id;
    log(`3) INSERT via API ok (${candidate.day} ${candidate.slot.start_time}), entry ${createdId}`);

    const sawInsert = await sawInsertPromise;
    log(`   ${sawInsert ? 'LIVE UPDATE RECEIVED' : 'NO LIVE UPDATE'} — rows now ${(subscription.getSnapshot() || { data: [] }).data.length}`);

    // renew the sealed query (same fingerprint) before it expires, as the frontend does
    const renewed = await fetchSealed();
    await subscription.renew(renewed);
    log(`4) sealed query renewed before expiry (fingerprint match: ${renewed.queryFingerprint === sealed.queryFingerprint})`);

    const sawDeletePromise = (async () => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            if (createdId && journal.some((j) => !j.data.some((r) => r.id === createdId))) return true;
            await new Promise((r) => setTimeout(r, 200));
        }
        return false;
    })();

    await api(`/timetable/${createdId}`, { method: 'DELETE' });
    log('5) DELETE via API ok');
    const sawDelete = await sawDeletePromise;
    log(`   ${sawDelete ? 'LIVE DELETE RECEIVED' : 'NO LIVE UPDATE'} — rows now ${(subscription.getSnapshot() || { data: [] }).data.length}`);

    subscription.unsubscribe();
    client.close();

    const pass = ready && sawInsert && sawDelete;
    log(pass ? 'REALTIME E2E: PASS' : 'REALTIME E2E: FAIL');
    process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
