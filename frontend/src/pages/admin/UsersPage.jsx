import React, { useCallback, useEffect, useState } from 'react';
import api from '../../services/api';
import { useToasts, ToastContainer } from '../../components/Toast';
import { useMe } from '../../context/MeContext';

const ROLES = ['admin', 'editor', 'viewer'];

const UsersPage = () => {
    const { refresh } = useMe();
    const { toasts, addToast } = useToasts();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingId, setSavingId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/admin/users');
            setUsers(Array.isArray(res.data) ? res.data : []);
            setError('');
        } catch (err) {
            setError(err?.response?.data?.error || 'Failed to load users.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const changeRole = async (user, role) => {
        setSavingId(user.user_id);
        try {
            await api.put(`/admin/users/${user.user_id}/role`, { role, display_name: user.name });
            addToast(`${user.email || user.name} is now ${role}.`);
            await load();
            await refresh();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Role change failed.', 'error');
        } finally {
            setSavingId(null);
        }
    };

    return (
        <section className="card p-6">
            <p className="caption">Access control</p>
            <h2 className="mt-2 text-xl">Users & roles</h2>
            <p className="mt-1 text-sm text-[var(--text-2)]">
                <strong>admin</strong> manages everything including roles and publishing. <strong>editor</strong> designs
                timetables and master data. <strong>viewer</strong> only sees published timetables. Faculty members get
                their portal automatically when their account email matches a faculty record.
            </p>

            {error && <div className="alert-danger mt-4 p-3 text-sm">{error}</div>}

            {loading ? (
                <div className="mt-5 space-y-3">
                    <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                </div>
            ) : (
                <div className="mt-5 overflow-auto">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Email</th>
                                <th>Signed up</th>
                                <th>Role</th>
                                <th>Allowlist</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <tr key={u.user_id}>
                                    <td className="font-semibold">{u.name || '—'}</td>
                                    <td>{u.email || '—'}</td>
                                    <td className="mono whitespace-nowrap">{u.auth_created_at ? new Date(u.auth_created_at).toLocaleDateString() : '—'}</td>
                                    <td>
                                        <select
                                            value={u.role || 'viewer'}
                                            disabled={savingId === u.user_id}
                                            onChange={(e) => changeRole(u, e.target.value)}
                                            className="input-shell w-auto rounded px-2 py-1 text-sm"
                                        >
                                            {ROLES.map((r) => <option key={r} value={r}>{u.role ? r : `${r} (currently unassigned)`}</option>)}
                                        </select>
                                    </td>
                                    <td>
                                        {u.access_role
                                            ? <span className={u.access_active ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}>
                                                {u.access_role}{u.access_active ? '' : ' (deactivated)'}
                                              </span>
                                            : <span className="text-[var(--text-3)]">not added</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <ToastContainer toasts={toasts} />
        </section>
    );
};

export default UsersPage;
