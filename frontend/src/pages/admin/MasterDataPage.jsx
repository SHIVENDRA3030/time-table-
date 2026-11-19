import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import SearchableSelect from '../../components/SearchableSelect';
import { useMe } from '../../context/MeContext';
import { CaretUp, CaretDown } from '@phosphor-icons/react';

const TABS = [
    { id: 'sections', label: 'Classes (sections)' },
    { id: 'time-slots', label: 'Time slots' },
    { id: 'workloads', label: 'Workloads (auto gen)' },
    { id: 'subjects', label: 'Subjects' },
    { id: 'faculty', label: 'Faculty' },
    { id: 'rooms', label: 'Rooms' },
    { id: 'programs', label: 'Programs' },
];

const EditableText = ({ value, onChange, type = 'text' }) => (
    <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="input-shell rounded px-2 py-1 text-sm"
        style={{ width: 'auto' }}
    />
);

const MasterDataPage = () => {
    const { me } = useMe();
    const isAdmin = me?.role === 'admin';

    const [activeTab, setActiveTab] = useState('sections');
    const [data, setData] = useState({
        programs: [], sections: [], subjects: [], faculty: [], rooms: [], workloads: [], timeSlots: []
    });
    const [form, setForm] = useState({});
    const [bulkForm, setBulkForm] = useState({ prefix: '', count: 4, year: new Date().getFullYear(), advisor: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [editingFaculty, setEditingFaculty] = useState(null);
    const [addSubjectSearch, setAddSubjectSearch] = useState('');
    const [editSubjectSearch, setEditSubjectSearch] = useState('');

    const fetchAll = async () => {
        setLoading(true);
        setError('');
        try {
            const [programsRes, sectionsRes, subjectsRes, facultyRes, roomsRes, workloadsRes, slotsRes] = await Promise.all([
                api.get('/programs/programs'),
                api.get('/programs/sections'),
                api.get('/resources/subjects'),
                api.get('/resources/faculty'),
                api.get('/resources/rooms'),
                api.get('/workloads'),
                api.get('/timetable/time-slots'),
            ]);
            setData({
                programs: Array.isArray(programsRes.data) ? programsRes.data : [],
                sections: Array.isArray(sectionsRes.data) ? sectionsRes.data : [],
                subjects: Array.isArray(subjectsRes.data) ? subjectsRes.data : [],
                faculty: Array.isArray(facultyRes.data) ? facultyRes.data : [],
                rooms: Array.isArray(roomsRes.data) ? roomsRes.data : [],
                workloads: Array.isArray(workloadsRes.data) ? workloadsRes.data : [],
                timeSlots: Array.isArray(slotsRes.data) ? slotsRes.data : [],
            });
        } catch (err) {
            setError(err?.response?.data?.error || 'Failed to load master data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchAll(); }, []);

    const handleChange = (e) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    const handleEditChange = (field, value) => setEditForm((prev) => ({ ...prev, [field]: value }));

    const handleSubmit = async (e, endpoint) => {
        e.preventDefault();
        setError('');
        try {
            await api.post(endpoint, form);
            setForm({});
            await fetchAll();
        } catch (err) {
            setError(err?.response?.data?.error || 'Request failed.');
        }
    };

    const handleDelete = async (endpoint) => {
        setError('');
        try {
            await api.delete(endpoint);
            await fetchAll();
        } catch (err) {
            // Deletion guard: dependent rows exist. Ask the admin to confirm force delete.
            if (err?.response?.status === 409) {
                const message = err?.response?.data?.error || 'This row is still referenced.';
                if (window.confirm(`${message}\n\nDelete everything anyway?`)) {
                    try {
                        await api.delete(`${endpoint}${endpoint.includes('?') ? '&' : '?'}force=1`);
                        await fetchAll();
                    } catch (retryErr) {
                        setError(retryErr?.response?.data?.error || 'Delete failed.');
                    }
                }
            } else {
                setError(err?.response?.data?.error || 'Delete failed.');
            }
        }
    };

    const startEdit = (row, fields) => {
        setEditingId(row.id);
        setEditForm(Object.fromEntries(fields.map((f) => [f, row[f] ?? ''])));
    };

    const saveEdit = async (endpoint, fields) => {
        setError('');
        try {
            const payload = {};
            fields.forEach((f) => { payload[f] = editForm[f]; });
            await api.put(endpoint, payload);
            setEditingId(null);
            setEditForm({});
            await fetchAll();
        } catch (err) {
            setError(err?.response?.data?.error || 'Update failed.');
        }
    };

    const togglePublish = async (section) => {
        setError('');
        try {
            await api.put(`/admin/sections/${section.id}/publish`, {
                status: section.status === 'published' ? 'draft' : 'published'
            });
            await fetchAll();
        } catch (err) {
            setError(err?.response?.data?.error || 'Publish action failed.');
        }
    };

    const bulkCreate = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/programs/sections/bulk', {
                program_id: bulkForm.program_id || data.programs[0]?.id,
                prefix: bulkForm.prefix,
                count: Number(bulkForm.count),
                year: Number(bulkForm.year),
                advisor: bulkForm.advisor || null
            });
            setBulkForm((prev) => ({ ...prev, prefix: '' }));
            await fetchAll();
        } catch (err) {
            setError(err?.response?.data?.error || 'Bulk create failed.');
        }
    };

    const moveSlot = async (slot, direction) => {
        const sorted = [...data.timeSlots].sort((a, b) => a.slot_number - b.slot_number);
        const idx = sorted.findIndex((s) => s.id === slot.id);
        const swapWith = sorted[idx + direction];
        if (!swapWith) return;
        setError('');
        try {
            await api.put(`/timetable/time-slots/${slot.id}`, { slot_number: swapWith.slot_number });
            await api.put(`/timetable/time-slots/${swapWith.id}`, { slot_number: slot.slot_number });
            await fetchAll();
        } catch (err) {
            setError(err?.response?.data?.error || 'Reorder failed.');
        }
    };

    const saveFacultySubjects = async (facultyId, subject_ids) => {
        setError('');
        try {
            await api.put(`/resources/faculty/${facultyId}/subjects`, { subject_ids });
            setEditingFaculty(null);
            await fetchAll();
        } catch (err) {
            setError(err?.response?.data?.error || 'Update failed.');
        }
    };

    const programOptions = useMemo(() => data.programs.map((p) => ({ value: p.id, label: p.name })), [data.programs]);
    const sectionOptions = useMemo(() => data.sections.map((s) => ({ value: s.id, label: s.name })), [data.sections]);
    const subjectOptions = useMemo(() => data.subjects.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })), [data.subjects]);
    const facultyOptions = useMemo(() => data.faculty.map((f) => ({ value: f.id, label: f.name })), [data.faculty]);
    const roomOptions = useMemo(() => data.rooms.map((r) => ({ value: r.id, label: r.room_number })), [data.rooms]);

    const renderTabs = () => (
        <div className="tabs">
            {TABS.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    onClick={() => { setActiveTab(tab.id); setForm({}); setEditingId(null); }}
                    className={`tab${activeTab === tab.id ? ' is-active' : ''}`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );

    const sectionRow = (s) => {
        const editing = editingId === s.id;
        return (
            <tr key={s.id}>
                <td className="font-semibold">
                    {editing ? <EditableText value={editForm.name} onChange={(v) => handleEditChange('name', v)} /> : s.name}
                </td>
                <td>{s.program?.name || '—'}</td>
                <td className="mono">
                    {editing
                        ? <EditableText value={editForm.year} onChange={(v) => handleEditChange('year', v)} type="number" />
                        : s.year}
                </td>
                <td>
                    {editing
                        ? <EditableText value={editForm.advisor} onChange={(v) => handleEditChange('advisor', v)} />
                        : (s.advisor || '—')}
                </td>
                <td>
                    <span className={`chip ${s.status === 'published' ? 'is-active' : ''}`}>
                        {s.status || 'draft'}
                    </span>
                </td>
                <td className="text-right whitespace-nowrap">
                    {editing ? (
                        <>
                            <button onClick={() => saveEdit(`/programs/sections/${s.id}`, ['name', 'year', 'advisor'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Cancel</button>
                        </>
                    ) : (
                        <>
                            {isAdmin && (
                                <button onClick={() => togglePublish(s)} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">
                                    {s.status === 'published' ? 'Unpublish' : 'Publish'}
                                </button>
                            )}
                            <button onClick={() => startEdit(s, ['name', 'year', 'advisor'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Edit</button>
                            <button onClick={() => handleDelete(`/programs/sections/${s.id}`)} className="text-sm font-medium text-[var(--danger)] transition hover:underline">Delete</button>
                        </>
                    )}
                </td>
            </tr>
        );
    };

    const subjectRow = (s) => {
        const editing = editingId === s.id;
        return (
            <tr key={s.id}>
                <td className="font-semibold">
                    {editing ? <EditableText value={editForm.code} onChange={(v) => handleEditChange('code', v)} /> : s.code}
                </td>
                <td>
                    {editing ? <EditableText value={editForm.name} onChange={(v) => handleEditChange('name', v)} /> : s.name}
                </td>
                <td className="mono">
                    {editing ? <EditableText value={editForm.credits} onChange={(v) => handleEditChange('credits', v)} type="number" /> : s.credits}
                </td>
                <td>{s.type}</td>
                <td className="text-right whitespace-nowrap">
                    {editing ? (
                        <>
                            <button onClick={() => saveEdit(`/resources/subjects/${s.id}`, ['code', 'name', 'credits', 'type'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Cancel</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => startEdit(s, ['code', 'name', 'credits', 'type'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Edit</button>
                            <button onClick={() => handleDelete(`/resources/subjects/${s.id}`)} className="text-sm font-medium text-[var(--danger)] transition hover:underline">Delete</button>
                        </>
                    )}
                </td>
            </tr>
        );
    };

    const roomRow = (r) => {
        const editing = editingId === r.id;
        return (
            <tr key={r.id}>
                <td className="font-semibold">
                    {editing ? <EditableText value={editForm.room_number} onChange={(v) => handleEditChange('room_number', v)} /> : r.room_number}
                </td>
                <td className="mono">
                    {editing ? <EditableText value={editForm.capacity} onChange={(v) => handleEditChange('capacity', v)} type="number" /> : r.capacity}
                </td>
                <td>{r.type}</td>
                <td className="text-right whitespace-nowrap">
                    {editing ? (
                        <>
                            <button onClick={() => saveEdit(`/resources/rooms/${r.id}`, ['room_number', 'capacity', 'type'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Cancel</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => startEdit(r, ['room_number', 'capacity', 'type'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Edit</button>
                            <button onClick={() => handleDelete(`/resources/rooms/${r.id}`)} className="text-sm font-medium text-[var(--danger)] transition hover:underline">Delete</button>
                        </>
                    )}
                </td>
            </tr>
        );
    };

    const facultyRow = (f) => {
        const editing = editingId === f.id;
        return (
            <tr key={f.id}>
                <td className="font-semibold">
                    {editing ? <EditableText value={editForm.name} onChange={(v) => handleEditChange('name', v)} /> : f.name}
                </td>
                <td>
                    {editing ? <EditableText value={editForm.department} onChange={(v) => handleEditChange('department', v)} /> : f.department}
                </td>
                <td>
                    {editing ? <EditableText value={editForm.email} onChange={(v) => handleEditChange('email', v)} /> : f.email}
                </td>
                <td>
                    {f.subject_ids.map((id) => data.subjects.find((s) => s.id === id)?.code).filter(Boolean).join(', ') || '—'}
                </td>
                <td className="text-right whitespace-nowrap">
                    <button onClick={() => setEditingFaculty(f)} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Subjects</button>
                    {editing ? (
                        <>
                            <button onClick={() => saveEdit(`/resources/faculty/${f.id}`, ['name', 'department', 'email'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Cancel</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => startEdit(f, ['name', 'department', 'email'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Edit</button>
                            <button onClick={() => handleDelete(`/resources/faculty/${f.id}`)} className="text-sm font-medium text-[var(--danger)] transition hover:underline">Delete</button>
                        </>
                    )}
                </td>
            </tr>
        );
    };

    const programRow = (p) => {
        const editing = editingId === p.id;
        return (
            <tr key={p.id}>
                <td className="font-semibold">
                    {editing ? <EditableText value={editForm.name} onChange={(v) => handleEditChange('name', v)} /> : p.name}
                </td>
                <td>
                    {editing ? <EditableText value={editForm.department} onChange={(v) => handleEditChange('department', v)} /> : p.department}
                </td>
                <td className="text-right whitespace-nowrap">
                    {editing ? (
                        <>
                            <button onClick={() => saveEdit(`/programs/programs/${p.id}`, ['name', 'department'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Cancel</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => startEdit(p, ['name', 'department'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Edit</button>
                            <button onClick={() => handleDelete(`/programs/programs/${p.id}`)} className="text-sm font-medium text-[var(--danger)] transition hover:underline">Delete</button>
                        </>
                    )}
                </td>
            </tr>
        );
    };

    const workloadRow = (wl) => {
        const editing = editingId === wl.id;
        return (
            <tr key={wl.id}>
                <td className="font-semibold">{wl.section?.name}</td>
                <td>{wl.subject?.name}</td>
                <td>{wl.faculty?.name}</td>
                <td>{wl.room?.room_number || '—'}</td>
                <td className="mono">
                    {editing
                        ? <EditableText value={editForm.lectures_per_week} onChange={(v) => handleEditChange('lectures_per_week', v)} type="number" />
                        : `${wl.lectures_per_week} / week`}
                </td>
                <td className="text-right whitespace-nowrap">
                    {editing ? (
                        <>
                            <button onClick={() => saveEdit(`/workloads/${wl.id}`, ['lectures_per_week'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Cancel</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => startEdit(wl, ['lectures_per_week'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Edit</button>
                            <button onClick={() => handleDelete(`/workloads/${wl.id}`)} className="text-sm font-medium text-[var(--danger)] transition hover:underline">Delete</button>
                        </>
                    )}
                </td>
            </tr>
        );
    };

    const slotRow = (slot, index, sorted) => {
        const editing = editingId === slot.id;
        return (
            <tr key={slot.id}>
                <td className="mono font-semibold">
                    {editing
                        ? <EditableText value={editForm.slot_number} onChange={(v) => handleEditChange('slot_number', v)} type="number" />
                        : `#${slot.slot_number}`}
                </td>
                <td className="mono">
                    {editing
                        ? <EditableText value={editForm.start_time} onChange={(v) => handleEditChange('start_time', v)} />
                        : String(slot.start_time).slice(0, 5)}
                </td>
                <td className="mono">
                    {editing
                        ? <EditableText value={editForm.end_time} onChange={(v) => handleEditChange('end_time', v)} />
                        : String(slot.end_time).slice(0, 5)}
                </td>
                <td className="text-right whitespace-nowrap">
                    {editing ? (
                        <>
                            <button onClick={() => saveEdit(`/timetable/time-slots/${slot.id}`, ['slot_number', 'start_time', 'end_time'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Cancel</button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => moveSlot(slot, -1)} disabled={index === 0} aria-label="Move up" className="icon-btn mr-1 disabled:opacity-40">
                                <CaretUp size={12} weight="regular" />
                            </button>
                            <button onClick={() => moveSlot(slot, 1)} disabled={index === sorted.length - 1} aria-label="Move down" className="icon-btn mr-2 disabled:opacity-40">
                                <CaretDown size={12} weight="regular" />
                            </button>
                            <button onClick={() => startEdit(slot, ['slot_number', 'start_time', 'end_time'])} className="mr-2 text-sm font-medium text-[var(--text-2)] transition hover:text-[var(--text-1)]">Edit</button>
                            <button onClick={() => handleDelete(`/timetable/time-slots/${slot.id}`)} className="text-sm font-medium text-[var(--danger)] transition hover:underline">Delete</button>
                        </>
                    )}
                </td>
            </tr>
        );
    };

    const renderPanel = () => {
        if (activeTab === 'sections') {
            return (
                <div className="grid gap-6 md:grid-cols-3">
                    <div className="md:col-span-1 space-y-5">
                        <form onSubmit={(e) => handleSubmit(e, '/programs/sections')} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                            <h3 className="mb-3 text-lg">Add section</h3>
                            <label className="block text-sm">Name
                                <input required name="name" value={form.name || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                            </label>
                            <label className="mt-3 block text-sm">Program
                                <SearchableSelect name="program_id" value={form.program_id || ''} onChange={handleChange} options={programOptions} required />
                            </label>
                            <label className="mt-3 block text-sm">Year
                                <input required type="number" name="year" value={form.year || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                            </label>
                            <label className="mt-3 block text-sm">Advisor
                                <input name="advisor" value={form.advisor || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                            </label>
                            <button type="submit" className="btn-primary mt-4 w-full">Add section</button>
                        </form>

                        <form onSubmit={bulkCreate} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                            <h3 className="mb-3 text-lg">Bulk create</h3>
                            <p className="mb-3 text-xs text-[var(--text-2)]">Creates PREFIX-A, PREFIX-B, … for the chosen program.</p>
                            <label className="block text-sm">Prefix
                                <input required name="prefix" value={bulkForm.prefix} onChange={(e) => setBulkForm({ ...bulkForm, prefix: e.target.value })} placeholder="CSE" className="input-shell mt-1 w-full" />
                            </label>
                            <label className="mt-3 block text-sm">Count (1-26)
                                <input required type="number" min="1" max="26" value={bulkForm.count} onChange={(e) => setBulkForm({ ...bulkForm, count: e.target.value })} className="input-shell mt-1 w-full" />
                            </label>
                            <label className="mt-3 block text-sm">Program
                                <SearchableSelect name="program_id" value={bulkForm.program_id || ''} onChange={(e) => setBulkForm({ ...bulkForm, program_id: e.target.value })} options={programOptions} />
                            </label>
                            <label className="mt-3 block text-sm">Year
                                <input required type="number" value={bulkForm.year} onChange={(e) => setBulkForm({ ...bulkForm, year: e.target.value })} className="input-shell mt-1 w-full" />
                            </label>
                            <button type="submit" className="btn-secondary mt-4 w-full">Create batch</button>
                        </form>
                    </div>
                    <div className="md:col-span-2 overflow-auto max-h-[500px]">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th><th>Program</th>
                                    <th>Year</th><th>Advisor</th>
                                    <th>Status</th><th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>{data.sections.map(sectionRow)}</tbody>
                        </table>
                    </div>
                </div>
            );
        }

        if (activeTab === 'time-slots') {
            const sorted = [...data.timeSlots].sort((a, b) => a.slot_number - b.slot_number);
            return (
                <div className="grid gap-6 md:grid-cols-3">
                    <form onSubmit={(e) => handleSubmit(e, '/timetable/time-slots')} className="md:col-span-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                        <h3 className="mb-3 text-lg">Add period</h3>
                        <label className="block text-sm">Slot number
                            <input required type="number" min="1" name="slot_number" value={form.slot_number || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Starts
                            <input required name="start_time" value={form.start_time || ''} onChange={handleChange} placeholder="09:00" className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Ends
                            <input required name="end_time" value={form.end_time || ''} onChange={handleChange} placeholder="10:00" className="input-shell mt-1 w-full" />
                        </label>
                        <button type="submit" className="btn-primary mt-4 w-full">Add period</button>
                    </form>
                    <div className="md:col-span-2 overflow-auto max-h-[500px]">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>No.</th><th>Starts</th>
                                    <th>Ends</th><th className="text-right">Order / delete</th>
                                </tr>
                            </thead>
                            <tbody>{sorted.map((slot, i) => slotRow(slot, i, sorted))}</tbody>
                        </table>
                    </div>
                </div>
            );
        }

        if (activeTab === 'workloads') {
            return (
                <div className="grid gap-6 md:grid-cols-3">
                    <form onSubmit={(e) => handleSubmit(e, '/workloads')} className="md:col-span-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                        <h3 className="mb-3 text-lg">Add workload</h3>
                        <label className="block text-sm">Section
                            <SearchableSelect name="section_id" value={form.section_id || ''} onChange={handleChange} options={sectionOptions} required />
                        </label>
                        <label className="mt-3 block text-sm">Subject
                            <SearchableSelect name="subject_id" value={form.subject_id || ''} onChange={handleChange} options={subjectOptions} required />
                        </label>
                        <label className="mt-3 block text-sm">Faculty
                            <SearchableSelect name="faculty_id" value={form.faculty_id || ''} onChange={handleChange} options={facultyOptions} required />
                        </label>
                        <label className="mt-3 block text-sm">Preferred room
                            <SearchableSelect name="room_id" value={form.room_id || ''} onChange={handleChange} options={roomOptions} />
                        </label>
                        <label className="mt-3 block text-sm">Lectures per week
                            <input required type="number" min="1" max="10" name="lectures_per_week" value={form.lectures_per_week || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <button type="submit" className="btn-primary mt-4 w-full">Add workload</button>
                    </form>
                    <div className="md:col-span-2 overflow-auto max-h-[500px]">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Section</th><th>Subject</th>
                                    <th>Faculty</th><th>Room</th>
                                    <th>Load</th><th className="text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody>{data.workloads.map(workloadRow)}</tbody>
                        </table>
                    </div>
                </div>
            );
        }

        if (activeTab === 'subjects') {
            return (
                <div className="grid gap-6 md:grid-cols-3">
                    <form onSubmit={(e) => handleSubmit(e, '/resources/subjects')} className="md:col-span-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                        <h3 className="mb-3 text-lg">Add subject</h3>
                        <label className="block text-sm">Code
                            <input required name="code" value={form.code || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Name
                            <input required name="name" value={form.name || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Credits
                            <input required type="number" name="credits" value={form.credits || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Type
                            <select name="type" value={form.type || 'Theory'} onChange={handleChange} className="input-shell mt-1 w-full">
                                <option>Theory</option><option>Lab</option><option>Seminar</option>
                            </select>
                        </label>
                        <button type="submit" className="btn-primary mt-4 w-full">Add subject</button>
                    </form>
                    <div className="md:col-span-2 overflow-auto max-h-[500px]">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Code</th><th>Name</th>
                                    <th>Credits</th><th>Type</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>{data.subjects.map(subjectRow)}</tbody>
                        </table>
                    </div>
                </div>
            );
        }

        if (activeTab === 'faculty') {
            const matches = (name, query) => (name || '').toLowerCase().includes(query.toLowerCase());
            return (
                <div className="grid gap-6 md:grid-cols-3">
                    <form onSubmit={(e) => handleSubmit(e, '/resources/faculty')} className="md:col-span-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                        <h3 className="mb-3 text-lg">Add faculty</h3>
                        <label className="block text-sm">Name
                            <input required name="name" value={form.name || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Department
                            <input required name="department" value={form.department || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Email
                            <input required type="email" name="email" value={form.email || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <div className="mt-3 text-sm">
                            <p className="mb-1 font-medium">Can teach (<span className="mono">{(form.subject_ids || []).length}</span>)</p>
                            <input value={addSubjectSearch} onChange={(e) => setAddSubjectSearch(e.target.value)} placeholder="Filter subjects…" className="input-shell mb-2 w-full" />
                            <div className="soft-scroll max-h-40 overflow-auto rounded-lg border border-[var(--line)] p-2">
                                {data.subjects.filter((s) => matches(`${s.code} ${s.name}`, addSubjectSearch)).map((s) => (
                                    <label key={s.id} className="flex items-center gap-2 py-1 text-sm">
                                        <input
                                            type="checkbox"
                                            checked={(form.subject_ids || []).includes(s.id)}
                                            onChange={(e) => setForm((prev) => ({
                                                ...prev,
                                                subject_ids: e.target.checked
                                                    ? [...(prev.subject_ids || []), s.id]
                                                    : (prev.subject_ids || []).filter((id) => id !== s.id)
                                            }))}
                                        />
                                        {s.code} — {s.name}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <button type="submit" className="btn-primary mt-4 w-full">Add faculty</button>
                    </form>
                    <div className="md:col-span-2 overflow-auto max-h-[500px]">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th><th>Department</th>
                                    <th>Email</th><th>Teaches</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>{data.faculty.map(facultyRow)}</tbody>
                        </table>
                    </div>
                </div>
            );
        }

        if (activeTab === 'rooms') {
            return (
                <div className="grid gap-6 md:grid-cols-3">
                    <form onSubmit={(e) => handleSubmit(e, '/resources/rooms')} className="md:col-span-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                        <h3 className="mb-3 text-lg">Add room</h3>
                        <label className="block text-sm">Room number
                            <input required name="room_number" value={form.room_number || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Capacity
                            <input required type="number" name="capacity" value={form.capacity || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                        </label>
                        <label className="mt-3 block text-sm">Type
                            <select name="type" value={form.type || 'Classroom'} onChange={handleChange} className="input-shell mt-1 w-full">
                                <option>Classroom</option><option>Lab</option><option>Seminar Hall</option>
                            </select>
                        </label>
                        <button type="submit" className="btn-primary mt-4 w-full">Add room</button>
                    </form>
                    <div className="md:col-span-2 overflow-auto max-h-[500px]">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Room</th><th>Capacity</th>
                                    <th>Type</th><th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>{data.rooms.map(roomRow)}</tbody>
                        </table>
                    </div>
                </div>
            );
        }

        // programs
        return (
            <div className="grid gap-6 md:grid-cols-3">
                <form onSubmit={(e) => handleSubmit(e, '/programs/programs')} className="md:col-span-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                    <h3 className="mb-3 text-lg">Add program</h3>
                    <label className="block text-sm">Name
                        <input required name="name" value={form.name || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                    </label>
                    <label className="mt-3 block text-sm">Department
                        <input required name="department" value={form.department || ''} onChange={handleChange} className="input-shell mt-1 w-full" />
                    </label>
                    <button type="submit" className="btn-primary mt-4 w-full">Add program</button>
                </form>
                <div className="md:col-span-2 overflow-auto max-h-[500px]">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Program</th><th>Department</th>
                                <th className="text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>{data.programs.map(programRow)}</tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-5">
            <section className="card p-6 md:p-7">
                {renderTabs()}
                {error && <div className="alert-danger mt-4 p-3 text-sm">{error}</div>}
                {loading ? (
                    <div className="mt-6 space-y-3">
                        <div className="h-8 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                        <div className="h-8 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    </div>
                ) : (
                    <div className="mt-6">{renderPanel()}</div>
                )}
            </section>

            {editingFaculty && (
                <div className="modal-overlay" onClick={() => setEditingFaculty(null)}>
                    <div className="modal-panel soft-scroll" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl">Subjects for {editingFaculty.name}</h3>
                        <p className="mt-1 text-sm text-[var(--text-2)]">Only faculty who can teach a subject will be offered it in the designer and generator.</p>
                        <input value={editSubjectSearch} onChange={(e) => setEditSubjectSearch(e.target.value)} placeholder="Filter subjects…" className="input-shell my-3 w-full" />
                        <div className="soft-scroll max-h-64 overflow-auto rounded-lg border border-[var(--line)] p-2">
                            {data.subjects
                                .filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(editSubjectSearch.toLowerCase()))
                                .map((s) => (
                                <label key={s.id} className="flex items-center gap-2 py-1 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={(editingFaculty.subject_ids || []).includes(s.id)}
                                        onChange={(e) => setEditingFaculty({
                                            ...editingFaculty,
                                            subject_ids: e.target.checked
                                                ? [...(editingFaculty.subject_ids || []), s.id]
                                                : (editingFaculty.subject_ids || []).filter((id) => id !== s.id)
                                        })}
                                    />
                                    {s.code} — {s.name}
                                </label>
                            ))}
                        </div>
                        <div className="confirm-actions mt-4">
                            <button type="button" className="btn-secondary" onClick={() => setEditingFaculty(null)}>Cancel</button>
                            <button type="button" className="btn-primary" onClick={() => saveFacultySubjects(editingFaculty.id, editingFaculty.subject_ids)}>Save</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MasterDataPage;
