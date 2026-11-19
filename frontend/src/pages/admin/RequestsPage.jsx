import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { useToasts, ToastContainer } from '../../components/Toast';

const statusChipClass = (status) => {
    if (status === 'applied' || status === 'approved') return 'chip chip-ok';
    if (status === 'rejected') return 'chip chip-danger';
    if (status === 'pending') return 'chip chip-warn';
    return 'chip';
};

const RequestsPage = () => {
    const { toasts, addToast } = useToasts();
    const [requests, setRequests] = useState([]);
    const [statusFilter, setStatusFilter] = useState('pending');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [decidingId, setDecidingId] = useState(null);
    const [notes, setNotes] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/requests', { params: statusFilter ? { status: statusFilter } : {} });
            setRequests(Array.isArray(res.data) ? res.data : []);
            setError('');
        } catch (err) {
            setError(err?.response?.data?.error || 'Failed to load requests.');
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { load(); }, [load]);

    const decide = async (request, decision) => {
        setDecidingId(request.id);
        try {
            const res = await api.put(`/requests/${request.id}/decide`, { decision, note: notes[request.id] || null });
            addToast(decision === 'approved'
                ? (res.data.status === 'applied' ? 'Approved and applied to the timetable.' : 'Decision recorded.')
                : 'Request rejected.');
            await load();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Decision failed.', 'error');
        } finally {
            setDecidingId(null);
        }
    };

    return (
        <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="caption">Faculty requests</p>
                    <h2 className="mt-1 text-[20px] leading-7">Change requests</h2>
                </div>
                <div className="flex gap-2">
                    {['pending', 'applied', 'rejected', ''].map((s) => (
                        <button
                            key={s || 'all'}
                            type="button"
                            onClick={() => setStatusFilter(s)}
                            className={`chip${statusFilter === s ? ' is-active' : ''}`}
                        >
                            {s || 'all'}
                        </button>
                    ))}
                </div>
            </div>

            {error && <div className="alert-danger mt-4">{error}</div>}

            {loading ? (
                <div className="mt-5 space-y-3">
                    <div className="h-16 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    <div className="h-16 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                </div>
            ) : requests.length === 0 ? (
                <div className="empty-state">
                    <span className="empty-state-glyph">⌖</span>
                    <p className="text-sm">No {statusFilter || ''} requests.</p>
                </div>
            ) : (
                <div className="mt-5 space-y-4">
                    {requests.map((req) => {
                        const snap = req.entry_snapshot || {};
                        return (
                            <article key={req.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                        <p className="font-medium text-[var(--text-1)]">
                                            {snap.faculty_name || 'Faculty'} — {req.request_type === 'cancel' ? 'cancel class' : 'reschedule class'}
                                        </p>
                                        <p className="mt-0.5 text-sm text-[var(--text-2)]">
                                            {snap.subject_code} {snap.subject_name} · {snap.section_name} · currently {snap.day} {snap.slot}
                                        </p>
                                        {req.request_type === 'reschedule' && (
                                            <p className="mt-0.5 text-sm text-[var(--text-1)]">
                                                Proposed <strong>{req.proposed_day}</strong>, period{' '}
                                                <span className="mono">
                                                    {req.proposed_start ? `${String(req.proposed_start).slice(0, 5)}–${String(req.proposed_end).slice(0, 5)}` : ''}
                                                </span>
                                                {req.proposed_room_number ? ` in ${req.proposed_room_number}` : ' (room unchanged)'}
                                            </p>
                                        )}
                                        <p className="mt-1 text-sm text-[var(--text-2)]">Reason: {req.reason || '—'}</p>
                                        <p className="mono mt-1 text-[11px] leading-[14px] text-[var(--text-3)]">
                                            {req.requested_by_email || snap.faculty_name} · {new Date(req.created_at).toLocaleString()}
                                        </p>
                                    </div>
                                    <span className={statusChipClass(req.status)}>{req.status}</span>
                                </div>

                                {req.status === 'pending' && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <input
                                            value={notes[req.id] || ''}
                                            onChange={(e) => setNotes({ ...notes, [req.id]: e.target.value })}
                                            placeholder="Optional note to the faculty…"
                                            className="input-shell min-w-[200px] flex-1"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => decide(req, 'approved')}
                                            disabled={decidingId === req.id}
                                            className="btn-volt"
                                        >
                                            {decidingId === req.id ? 'Applying…' : 'Approve & apply'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => decide(req, 'rejected')}
                                            disabled={decidingId === req.id}
                                            className="btn-danger"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                )}

                                {req.status !== 'pending' && req.decision_note && (
                                    <p className={`mt-2 text-sm ${req.status === 'rejected' ? 'text-[var(--danger)]' : 'text-[var(--text-2)]'}`}>
                                        Note: {req.decision_note}
                                    </p>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}

            <ToastContainer toasts={toasts} />
        </section>
    );
};

export default RequestsPage;
