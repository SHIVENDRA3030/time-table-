import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';

const ACTION_PRESETS = [
    '', 'timetable.entry.create', 'timetable.entry.update', 'timetable.entry.delete',
    'timetable.section.clear', 'timetable.generate', 'section.create', 'section.update',
    'section.published', 'section.draft', 'section.bulk_create', 'subject.create', 'subject.update',
    'faculty.create', 'faculty.update', 'room.create', 'room.update', 'workload.create',
    'time_slot.create', 'time_slot.update', 'time_slot.delete', 'upload.excel', 'database.reset',
    'user.role.set', 'request.reschedule.create', 'request.reschedule.apply', 'request.cancel.apply',
    'request.reject', 'export.xlsx', 'bootstrap.admin'
];

const AuditPage = () => {
    const [entries, setEntries] = useState([]);
    const [action, setAction] = useState('');
    const [entity, setEntity] = useState('');
    const [actor, setActor] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/audit', {
                params: { action: action || undefined, entity: entity || undefined, actor: actor || undefined, limit: 300 }
            });
            setEntries(Array.isArray(res.data) ? res.data : []);
            setError('');
        } catch (err) {
            setError(err?.response?.data?.error || 'Failed to load audit log.');
        } finally {
            setLoading(false);
        }
    }, [action, entity, actor]);

    useEffect(() => { load(); }, [load]);

    return (
        <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <p className="caption">Governance</p>
                    <h2 className="mt-2 text-xl">Audit log</h2>
                </div>
                <button type="button" onClick={load} className="btn-secondary">Refresh</button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">Action
                    <select value={action} onChange={(e) => setAction(e.target.value)} className="input-shell mt-1 w-full">
                        {ACTION_PRESETS.map((a) => <option key={a || 'all'} value={a}>{a || 'All actions'}</option>)}
                    </select>
                </label>
                <label className="block text-sm">Entity
                    <select value={entity} onChange={(e) => setEntity(e.target.value)} className="input-shell mt-1 w-full">
                        <option value="">All entities</option>
                        {['timetable_entry', 'section', 'program', 'subject', 'faculty', 'room', 'workload', 'time_slot', 'app_user', 'change_request'].map((en) => (
                            <option key={en} value={en}>{en}</option>
                        ))}
                    </select>
                </label>
                <label className="block text-sm">Actor (email or id)
                    <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="filter…" className="input-shell mt-1 w-full" />
                </label>
            </div>

            {error && <div className="alert-danger mt-4 p-3 text-sm">{error}</div>}

            {loading ? (
                <div className="mt-5 space-y-3">
                    <div className="h-8 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    <div className="h-8 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                </div>
            ) : entries.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--text-2)]">No audit entries match.</p>
            ) : (
                <div className="mt-5 overflow-auto max-h-[560px] soft-scroll">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>When</th>
                                <th>Actor</th>
                                <th>Action</th>
                                <th>Entity</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map((row) => (
                                <tr key={row.id}>
                                    <td className="mono whitespace-nowrap text-[var(--text-2)]">{new Date(row.created_at).toLocaleString()}</td>
                                    <td>{row.actor_email || row.actor_user_id || '—'}</td>
                                    <td className="font-medium">{row.action}</td>
                                    <td>{row.entity}{row.entity_id ? ` · ${String(row.entity_id).slice(0, 8)}…` : ''}</td>
                                    <td className="mono max-w-[320px] truncate text-xs text-[var(--text-2)]" title={row.details ? JSON.stringify(row.details) : ''}>
                                        {row.details ? JSON.stringify(row.details) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
};

export default AuditPage;
