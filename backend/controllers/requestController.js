const db = require('../db');
const { withTransaction } = require('../db');
const { audit } = require('../services/auditService');
const conflictService = require('../services/conflictService');
const outboxService = require('../services/outboxService');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ENTRY_SELECT = `
    SELECT te.id, te.section_id, te.subject_id, te.faculty_id, te.room_id, te.day, te.time_slot_id,
           sec.name AS section_name, sub.name AS subject_name, sub.code AS subject_code,
           fac.name AS faculty_name, rm.room_number AS room_number,
           ts.start_time AS slot_start_time, ts.end_time AS slot_end_time, ts.slot_number AS slot_slot_number
    FROM timetable_entries te
    LEFT JOIN sections sec ON sec.id = te.section_id
    LEFT JOIN subjects sub ON sub.id = te.subject_id
    LEFT JOIN faculty fac ON fac.id = te.faculty_id
    LEFT JOIN rooms rm ON rm.id = te.room_id
    LEFT JOIN time_slots ts ON ts.id = te.time_slot_id
`;

const mapEntryRow = (row) => {
    const { section_name, subject_name, subject_code, faculty_name, room_number,
        slot_start_time, slot_end_time, slot_slot_number, ...entry } = row;
    return {
        ...entry,
        section: { name: section_name },
        subject: { name: subject_name, code: subject_code },
        faculty: { name: faculty_name },
        room: { room_number: room_number },
        time_slot: { start_time: slot_start_time, end_time: slot_end_time, slot_number: slot_slot_number }
    };
};

const snapshotOf = (entry) => ({
    id: entry.id,
    section_id: entry.section_id,
    subject_id: entry.subject_id,
    faculty_id: entry.faculty_id,
    room_id: entry.room_id,
    day: entry.day,
    time_slot_id: entry.time_slot_id,
    section_name: entry.section?.name || null,
    subject_name: entry.subject?.name || null,
    subject_code: entry.subject?.code || null,
    faculty_name: entry.faculty?.name || null,
    room_number: entry.room?.room_number || null,
    slot: entry.time_slot ? `${entry.time_slot.start_time} - ${entry.time_slot.end_time}` : null
});

// POST /api/requests — a faculty member asks to reschedule or cancel one of
// their own classes. Admins and editors manage the timetable directly instead.
const createRequest = async (req, res) => {
    const { entry_id, request_type, proposed_day, proposed_time_slot_id, proposed_room_id, reason } = req.body;

    if (!['reschedule', 'cancel'].includes(request_type)) {
        return res.status(400).json({ error: "request_type must be 'reschedule' or 'cancel'." });
    }
    if (!req.user.faculty) {
        return res.status(403).json({ error: 'Your account is not linked to a faculty record (email mismatch).' });
    }

    try {
        const { rows } = await db.query(`${ENTRY_SELECT} WHERE te.id = $1`, [entry_id]);
        const entry = rows[0] && mapEntryRow(rows[0]);
        if (!entry) return res.status(404).json({ error: 'Timetable entry not found.' });
        if (entry.faculty_id !== req.user.faculty.id) {
            return res.status(403).json({ error: 'You can only request changes to your own classes.' });
        }

        let proposed = {};
        if (request_type === 'reschedule') {
            if (!proposed_day || !DAYS.includes(proposed_day)) {
                return res.status(400).json({ error: 'proposed_day must be a valid weekday.' });
            }
            if (!proposed_time_slot_id) {
                return res.status(400).json({ error: 'proposed_time_slot_id is required.' });
            }
            const { rows: slotRows } = await db.query('SELECT id FROM time_slots WHERE id = $1', [proposed_time_slot_id]);
            if (slotRows.length === 0) return res.status(400).json({ error: 'Proposed time slot does not exist.' });
            proposed = { day: proposed_day, time_slot_id: proposed_time_slot_id, room_id: proposed_room_id || null };
        }

        const { rows: created } = await db.query(
            `INSERT INTO change_requests
                (entry_id, request_type, requested_by_user_id, requested_by_email, faculty_id,
                 entry_snapshot, proposed_day, proposed_time_slot_id, proposed_room_id, reason, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + INTERVAL '72 hours')
             RETURNING *`,
            [
                entry.id, request_type, req.auth.userId, req.auth.email, req.user.faculty.id,
                JSON.stringify(snapshotOf(entry)),
                proposed.day || null, proposed.time_slot_id || null, proposed.room_id || null,
                reason ? String(reason).slice(0, 1000) : null
            ]
        );
        await audit(req, `request.${request_type}.create`, 'change_request', created[0].id, {
            entry_id: entry.id, subject: entry.subject?.code, section: entry.section?.name
        });
        res.status(201).json(created[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// GET /api/requests — admins see everything (optionally ?status=), faculty see their own.
const listRequests = async (req, res) => {
    try {
        const clauses = [];
        const params = [];
        if (req.user.role === 'admin') {
            if (req.query.status) { params.push(req.query.status); clauses.push(`cr.status = $${params.length}`); }
        } else {
            params.push(req.auth.userId);
            clauses.push(`cr.requested_by_user_id = $${params.length}`);
        }
        const { rows } = await db.query(
            `SELECT cr.*,
                    ts.start_time AS proposed_start, ts.end_time AS proposed_end,
                    rm.room_number AS proposed_room_number,
                    du.name AS decider_name
             FROM change_requests cr
             LEFT JOIN time_slots ts ON ts.id = cr.proposed_time_slot_id
             LEFT JOIN rooms rm ON rm.id = cr.proposed_room_id
             LEFT JOIN neon_auth.user du ON du.id::text = cr.decided_by
             ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
             ORDER BY cr.created_at DESC
             LIMIT 200`,
            params
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PUT /api/requests/:id/decide — admin approves (applying the change with
// conflict checking) or rejects with a note. Multi-statement mutation: runs in
// one transaction with a row lock so two admins cannot double-apply (F5).
const decideRequest = async (req, res) => {
    const { id } = req.params;
    const { decision, note } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
        return res.status(400).json({ error: "decision must be 'approved' or 'rejected'." });
    }

    try {
        const result = await withTransaction(async (client) => {
            const { rows: reqRows } = await client.query(
                'SELECT * FROM change_requests WHERE id = $1 FOR UPDATE',
                [id]
            );
            const request = reqRows[0];
            if (!request) {
                const err = new Error('Request not found.');
                err.status = 404;
                throw err;
            }
            if (request.status !== 'pending') {
                const err = new Error(`Request is already ${request.status}.`);
                err.status = 409;
                throw err;
            }

            if (decision === 'rejected') {
                const { rows: updated } = await client.query(
                    `UPDATE change_requests
                     SET status = 'rejected', decision_note = $1, decided_by = $2, decided_at = NOW()
                     WHERE id = $3 RETURNING *`,
                    [note ? String(note).slice(0, 1000) : null, req.auth.userId, id]
                );
                await client.query(
                    `INSERT INTO audit_log (actor_user_id, actor_email, action, entity, entity_id, details, ip, user_agent)
                     VALUES ($1, $2, 'request.reject', 'change_request', $3, $4, $5, $6)`,
                    [req.auth.userId, req.auth.email || null, id,
                     JSON.stringify({ entry_id: request.entry_id, note: note || null }),
                     req.ip || null, req.get('user-agent') || null]
                );
                return { updated: updated[0], applied: false, snapshot: request.entry_snapshot, type: request.request_type };
            }

            // Approved: apply the change. The entry may be gone (deleted since the request).
            const { rows: entryRows } = await client.query('SELECT * FROM timetable_entries WHERE id = $1', [request.entry_id]);
            const entry = entryRows[0];
            if (!entry) {
                const { rows: updated } = await client.query(
                    `UPDATE change_requests
                     SET status = 'rejected', decision_note = 'Entry no longer exists.', decided_by = $1, decided_at = NOW()
                     WHERE id = $2 RETURNING *`,
                    [req.auth.userId, id]
                );
                return { updated: updated[0], applied: false, autoRejected: true };
            }

            if (request.request_type === 'cancel') {
                await client.query('DELETE FROM timetable_entries WHERE id = $1', [entry.id]);
            } else {
                // reschedule: run the same conflict checks the designer enforces
                const conflict = await conflictService.checkConflicts(
                    {
                        section_id: entry.section_id,
                        faculty_id: entry.faculty_id,
                        room_id: request.proposed_room_id || entry.room_id,
                        day: request.proposed_day,
                        time_slot_id: request.proposed_time_slot_id
                    },
                    entry.id
                );
                if (conflict) {
                    const err = new Error(`Cannot approve: ${conflict}`);
                    err.status = 409;
                    throw err;
                }
                await client.query(
                    'UPDATE timetable_entries SET day = $1, time_slot_id = $2, room_id = $3 WHERE id = $4',
                    [request.proposed_day, request.proposed_time_slot_id, request.proposed_room_id || entry.room_id, entry.id]
                );
            }

            const { rows: updated } = await client.query(
                `UPDATE change_requests
                 SET status = 'applied', decision_note = $1, decided_by = $2, decided_at = NOW()
                 WHERE id = $3 RETURNING *`,
                [note ? String(note).slice(0, 1000) : null, req.auth.userId, id]
            );
            await client.query(
                `INSERT INTO audit_log (actor_user_id, actor_email, action, entity, entity_id, details, ip, user_agent)
                 VALUES ($1, $2, 'request.apply', 'change_request', $3, $4, $5, $6)`,
                [req.auth.userId, req.auth.email || null, id,
                 JSON.stringify({
                     entry_id: request.entry_id,
                     to: request.request_type === 'cancel' ? 'cancelled'
                        : { day: request.proposed_day, time_slot_id: request.proposed_time_slot_id }
                 }),
                 req.ip || null, req.get('user-agent') || null]
            );
            return { updated: updated[0], applied: true, snapshot: request.entry_snapshot, type: request.request_type };
        });

        // Notify through the outbox (never blocks the response, F17).
        if (result.applied) {
            await outboxService.enqueue('request.decided', {
                requestId: id,
                decision: 'approved',
                email: req.auth.email,
                facultyName: result.snapshot?.faculty_name || null,
                subject: result.snapshot?.subject_code || null,
                type: result.type,
            });
        }

        res.json(result.updated);
    } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
    }
};

// POST /api/requests/:id/cancel — the requester withdraws a pending request.
const cancelRequest = async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await db.query(
            `UPDATE change_requests
             SET status = 'cancelled'
             WHERE id = $1 AND status = 'pending' AND requested_by_user_id = $2
             RETURNING *`,
            [id, req.auth.userId]
        );
        if (!rows[0]) {
            return res.status(409).json({ error: 'Request not found, already decided, or not yours to cancel.' });
        }
        await audit(req, 'request.cancel', 'change_request', id, null);
        res.json(rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { createRequest, listRequests, decideRequest, cancelRequest };
