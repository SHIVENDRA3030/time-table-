import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { useToasts, ToastContainer } from '../../components/Toast';

const ROLES = ['faculty', 'student', 'admin', 'editor'];

const ROLE_LABELS = {
    faculty: 'Faculty',
    student: 'Student',
    admin: 'Admin',
    editor: 'Editor',
};

const blankForm = { email: '', access_role: 'faculty', full_name: '', department: '', section_id: '' };

// Access — manage the portal-access allowlist. Only allowlisted emails can sign
// in; faculty/student entries also create their profile row so their portal
// data (own timetable / own section) works immediately.
const AccessPage = () => {
    const { toasts, addToast } = useToasts();
    const [entries, setEntries] = useState([]);
    const [sections, setSections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [form, setForm] = useState(blankForm);
    const [adding, setAdding] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [bulkResult, setBulkResult] = useState(null);
    const [busyId, setBusyId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [accessRes, sectionsRes] = await Promise.all([
                api.get('/access'),
                api.get('/programs/sections'),
            ]);
            setEntries(Array.isArray(accessRes.data) ? accessRes.data : []);
            setSections(Array.isArray(sectionsRes.data) ? sectionsRes.data : []);
            setError('');
        } catch (err) {
            setError(err?.response?.data?.error || 'Failed to load the allowlist.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const sectionsById = useMemo(
        () => new Map(sections.map((s) => [s.id, s])),
        [sections]
    );

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const submitAdd = async (e) => {
        e.preventDefault();
        setAdding(true);
        try {
            await api.post('/access', {
                email: form.email,
                access_role: form.access_role,
                full_name: form.full_name || undefined,
                department: form.access_role === 'faculty' ? (form.department || undefined) : undefined,
                section_id: form.access_role === 'student' ? (form.section_id || null) : null,
            });
            addToast(`${form.email} added to the allowlist.`);
            setForm(blankForm);
            await load();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Could not add the entry.', 'error');
        } finally {
            setAdding(false);
        }
    };

    const uploadRoster = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setBulkResult(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await api.post('/access/bulk', fd);
            const { added, updated, skipped } = res.data;
            const skippedNote = skipped?.length ? `, ${skipped.length} skipped` : '';
            addToast(`Roster uploaded: ${added} added, ${updated} updated${skippedNote}.`);
            setBulkResult(res.data);
            await load();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Roster upload failed.', 'error');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const toggleActive = async (entry) => {
        setBusyId(entry.id);
        try {
            await api.put(`/access/${entry.id}`, { is_active: !entry.is_active });
            addToast(entry.is_active ? `${entry.email} can no longer sign in.` : `${entry.email} can sign in again.`);
            await load();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Update failed.', 'error');
        } finally {
            setBusyId(null);
        }
    };

    const removeEntry = async (entry) => {
        if (!window.confirm(`Remove ${entry.email} from the allowlist? They will lose portal access.`)) return;
        setBusyId(entry.id);
        try {
            await api.delete(`/access/${entry.id}`);
            addToast(`${entry.email} removed from the allowlist.`);
            await load();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Removal failed.', 'error');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <section className="space-y-5">
            <section className="card p-6">
                <p className="caption">Portal allowlist</p>
                <h2 className="mt-1 text-[20px] leading-7">Access</h2>
                <p className="mt-1 text-sm text-[var(--text-2)]">
                    Only emails on this list can sign in. Anyone else who tries sees
                    &ldquo;You are not added to any college or faculty&rdquo;. Adding someone as
                    <strong> Faculty</strong> or <strong>Student</strong> also creates their profile, so their own
                    timetable (or their class&apos;s timetable) appears on their portal the first time they sign in.
                    Upload an Excel/CSV with columns <code>email, name, role, department, section</code> — role
                    defaults to Student if omitted.
                </p>

                {error && <div className="alert-danger mt-4">{error}</div>}
            </section>

            <section className="card p-6">
                <h3 className="text-base">Add an email</h3>
                <form onSubmit={submitAdd} className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end">
                    <label className="block">
                        <span className="caption block">
                            Email <span className="text-[var(--danger)]">*</span>
                        </span>
                        <input
                            type="email"
                            name="email"
                            required
                            value={form.email}
                            onChange={handleChange}
                            placeholder="person@college.edu"
                            className="input-shell mt-1 w-full"
                        />
                    </label>
                    <label className="block">
                        <span className="caption block">Access role</span>
                        <select
                            name="access_role"
                            value={form.access_role}
                            onChange={handleChange}
                            className="input-shell mt-1 w-full"
                        >
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                    </label>
                    <label className="block">
                        <span className="caption block">Name</span>
                        <input
                            type="text"
                            name="full_name"
                            value={form.full_name}
                            onChange={handleChange}
                            className="input-shell mt-1 w-full"
                        />
                    </label>
                    {form.access_role === 'faculty' && (
                        <label className="block">
                            <span className="caption block">Department</span>
                            <input
                                type="text"
                                name="department"
                                value={form.department}
                                onChange={handleChange}
                                placeholder="e.g. Computer Science"
                                className="input-shell mt-1 w-full"
                            />
                        </label>
                    )}
                    {form.access_role === 'student' && (
                        <label className="block">
                            <span className="caption block">Section</span>
                            <select
                                name="section_id"
                                value={form.section_id}
                                onChange={handleChange}
                                className="input-shell mt-1 w-full"
                            >
                                <option value="">— none yet —</option>
                                {sections.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}{s.program?.name ? ` · ${s.program.name}` : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}
                    <button type="submit" disabled={adding} className="btn-primary">
                        {adding ? 'Adding…' : 'Add to allowlist'}
                    </button>
                </form>
                {form.access_role === 'student' && sections.length === 0 && (
                    <p className="mt-2 text-xs text-[var(--text-3)]">
                        No sections exist yet — create them in Master Data or via Import, then edit the entry to
                        attach one.
                    </p>
                )}
            </section>

            <section className="card p-6">
                <h3 className="text-base">Bulk upload roster</h3>
                <p className="mt-1 text-sm text-[var(--text-2)]">
                    One row per person. Headers (case-insensitive): <code>email</code> (required),
                    <code> name</code>, <code>role</code> (Faculty/Student/Admin/Editor),
                    <code> department</code> (faculty), <code>section</code> (student, matched by name).
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={uploadRoster}
                        disabled={uploading}
                        className="input-shell w-auto text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--text-1)] file:px-3 file:py-1.5 file:text-[var(--bg)]"
                    />
                    {uploading && <span className="text-sm text-[var(--text-2)]">Uploading…</span>}
                </div>

                {bulkResult && (
                    <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
                        <p>
                            <strong className="mono">{bulkResult.added}</strong> added · <strong className="mono">{bulkResult.updated}</strong> updated ·
                            <strong className="mono"> {bulkResult.skipped?.length || 0}</strong> skipped
                        </p>
                        {bulkResult.skipped?.length > 0 && (
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[var(--text-2)]">
                                {bulkResult.skipped.map((s, i) => (
                                    <li key={i}>
                                        {s.email ? <strong>{s.email}</strong> : <em>(row)</em>} — {s.reason}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </section>

            <section className="card p-6">
                <h3 className="text-base">
                    Allowlist <span className="mono text-[var(--text-2)]">({entries.length})</span>
                </h3>
                {loading ? (
                    <div className="mt-5 space-y-3">
                        <div className="h-10 animate-pulse rounded bg-[var(--surface-2)]" />
                        <div className="h-10 animate-pulse rounded bg-[var(--surface-2)]" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-state-glyph">⌖</span>
                        <p className="text-sm">
                            Nobody is on the allowlist yet — add emails above. Until then, only existing admin
                            accounts can sign in.
                        </p>
                    </div>
                ) : (
                    <div className="mt-4 overflow-auto">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Email</th>
                                    <th>Name</th>
                                    <th>Role</th>
                                    <th>Department / Section</th>
                                    <th>Status</th>
                                    <th>Added</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((entry) => (
                                    <tr key={entry.id}>
                                        <td className="font-medium">{entry.email}</td>
                                        <td>{entry.full_name || '—'}</td>
                                        <td>{ROLE_LABELS[entry.access_role] || entry.access_role}</td>
                                        <td>
                                            {entry.access_role === 'student'
                                                ? (entry.section_name || '—')
                                                : (entry.department || '—')}
                                        </td>
                                        <td>
                                            <span className={entry.is_active ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}>
                                                {entry.is_active ? 'Active' : 'Deactivated'}
                                            </span>
                                        </td>
                                        <td className="mono whitespace-nowrap">
                                            {entry.created_at ? new Date(entry.created_at).toLocaleDateString() : '—'}
                                        </td>
                                        <td>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    disabled={busyId === entry.id}
                                                    onClick={() => toggleActive(entry)}
                                                    className="btn-secondary px-2"
                                                >
                                                    {entry.is_active ? 'Deactivate' : 'Activate'}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busyId === entry.id}
                                                    onClick={() => removeEntry(entry)}
                                                    className="btn-danger px-2"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <ToastContainer toasts={toasts} />
        </section>
    );
};

export default AccessPage;
