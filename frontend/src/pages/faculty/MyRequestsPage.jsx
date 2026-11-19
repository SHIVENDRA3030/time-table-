import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';

const statusChipClass = (status) => {
    if (status === 'pending') return 'chip-warn';
    if (status === 'applied' || status === 'approved') return 'chip-ok';
    if (status === 'rejected') return 'chip-danger';
    return '';
};

const MyRequestsPage = () => {
    const [requests, setRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        api.get('/requests')
            .then((res) => { if (active) setRequests(Array.isArray(res.data) ? res.data : []); })
            .catch((err) => { if (active) setError(err?.response?.data?.error || 'Failed to load requests.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    return (
        <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="caption">Faculty</p>
                    <h2 className="mt-2 text-xl">My requests</h2>
                </div>
                <Link to="/portal" className="btn-secondary">← Back to my timetable</Link>
            </div>

            {error && <div className="alert-danger mt-4 p-3 text-sm">{error}</div>}

            {loading ? (
                <div className="mt-5 space-y-3">
                    <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                </div>
            ) : requests.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--text-2)]">
                    No requests yet. Open your timetable and use the reschedule button on a class to ask for a change.
                </p>
            ) : (
                <div className="mt-5 overflow-auto">
                    <table className="data-table w-full text-sm text-left">
                        <thead className="bg-[var(--surface-2)] text-[var(--text-2)] uppercase text-xs">
                            <tr>
                                <th className="px-4 py-3">Raised</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Class</th>
                                <th className="px-4 py-3">Proposed</th>
                                <th className="px-4 py-3">Reason</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Admin note</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.map((req) => {
                                const snap = req.entry_snapshot || {};
                                return (
                                    <tr key={req.id} className="border-b border-[var(--line)] hover:bg-[var(--surface-2)]">
                                        <td className="px-4 py-3 whitespace-nowrap mono text-xs">{new Date(req.created_at).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 capitalize">{req.request_type}</td>
                                        <td className="px-4 py-3">
                                            {snap.subject_code || snap.subject_name} · {snap.section_name} · {snap.day} <span className="mono">{snap.slot}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {req.request_type === 'cancel'
                                                ? '—'
                                                : (
                                                    <>
                                                        {req.proposed_day}{' '}
                                                        <span className="mono">
                                                            {req.proposed_start ? String(req.proposed_start).slice(0, 5) : ''}–{req.proposed_end ? String(req.proposed_end).slice(0, 5) : ''}
                                                        </span>
                                                        {req.proposed_room_number ? ` (${req.proposed_room_number})` : ''}
                                                    </>
                                                )}
                                        </td>
                                        <td className="px-4 py-3 max-w-[220px] truncate" title={req.reason}>{req.reason || '—'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`chip ${statusChipClass(req.status)}`}>{req.status}</span>
                                        </td>
                                        <td className={`px-4 py-3 max-w-[200px] truncate ${req.status === 'rejected' ? 'text-[var(--danger)]' : ''}`} title={req.decision_note}>
                                            {req.decision_note || '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

export default MyRequestsPage;
