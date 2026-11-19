import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import api from '../../services/api';
import TimetableGrid from '../../components/TimetableGrid';
import EditEntryModal from '../../components/EditEntryModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToasts, ToastContainer } from '../../components/Toast';
import { realtimeClient, renewBeforeExpiry } from '../../services/realtime';
import { useMe } from '../../context/MeContext';

// Admin designer: drag classes across the week, add/remove entries, auto-fill
// remaining workloads, publish, and export. Every write reuses the same REST
// endpoints the rest of the app uses, so conflicts and RBAC behave identically.
const DesignerPage = () => {
    const { me } = useMe();
    const isAdmin = me?.role === 'admin';
    const { toasts, addToast } = useToasts();

    const [sections, setSections] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [timetable, setTimetable] = useState([]);
    const [timeSlots, setTimeSlots] = useState([]);
    const [subjects, setSubjects] = useState([]);
    const [faculty, setFaculty] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [workloads, setWorkloads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [gridError, setGridError] = useState('');
    const [generating, setGenerating] = useState(false);
    const [publishing, setPublishing] = useState(false);

    // Modal state (add / edit entries)
    const [modalOpen, setModalOpen] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);
    const [prefill, setPrefill] = useState({ day: null, timeSlotId: null, sectionId: null, subjectId: null, facultyId: null, roomId: null });

    // Destructive actions live behind the "…" menu and confirm by typed text.
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null); // 'wipe' | 'clear'

    // Realtime: ids of entries that just changed → Volt left border, briefly.
    const [liveIds, setLiveIds] = useState([]);
    const lastSnapshotRef = useRef(null);
    const liveTimerRef = useRef(null);

    const selectedSection = useMemo(
        () => sections.find((s) => s.id === selectedId) || null,
        [sections, selectedId]
    );

    const fetchCore = useCallback(async () => {
        setLoading(true);
        try {
            const [sectionsRes, slotsRes, subjectsRes, facultyRes, roomsRes, workloadsRes] = await Promise.all([
                api.get('/programs/sections'),
                api.get('/timetable/time-slots'),
                api.get('/resources/subjects'),
                api.get('/resources/faculty'),
                api.get('/resources/rooms'),
                api.get('/workloads'),
            ]);
            setSections(Array.isArray(sectionsRes.data) ? sectionsRes.data : []);
            setTimeSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
            setSubjects(Array.isArray(subjectsRes.data) ? subjectsRes.data : []);
            setFaculty(Array.isArray(facultyRes.data) ? facultyRes.data : []);
            setRooms(Array.isArray(roomsRes.data) ? roomsRes.data : []);
            setWorkloads(Array.isArray(workloadsRes.data) ? workloadsRes.data : []);
        } catch (err) {
            setGridError(err?.response?.data?.error || 'Failed to load designer data.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCore(); }, [fetchCore]);

    const fetchTimetable = useCallback(async (sectionId) => {
        if (!sectionId) { setTimetable([]); return; }
        try {
            const response = await api.get(`/timetable/section/${sectionId}`);
            setTimetable(Array.isArray(response.data) ? response.data : []);
            setGridError('');
        } catch (error) {
            setGridError(error?.response?.data?.error || 'Failed to fetch timetable.');
            setTimetable([]);
        }
    }, []);

    useEffect(() => { fetchTimetable(selectedId); }, [selectedId, fetchTimetable]);

    // Live updates for the open section (other admins see your moves instantly)
    const fetchSealedTimetable = useCallback(async () => {
        const response = await api.post(`/realtime/section/${selectedId}`);
        return response.data;
    }, [selectedId]);

    useEffect(() => {
        if (!selectedId) return;
        let active = true;
        let subscription;
        let stopRenewal;

        (async () => {
            let sealed;
            try {
                sealed = await fetchSealedTimetable();
            } catch {
                return;
            }
            if (!active) return;
            subscription = realtimeClient.subscribe(sealed);
            subscription.onChange((snapshot) => {
                if (!active) return;
                if (!Array.isArray(snapshot.data)) return;

                // Mark entries whose day/slot/assignment changed → Volt trace.
                const prev = lastSnapshotRef.current;
                if (prev) {
                    const signature = (e) => `${e.day}|${e.time_slot_id}|${e.subject_id}|${e.faculty_id}|${e.room_id}`;
                    const prevMap = new Map(prev.map((e) => [e.id, signature(e)]));
                    const changed = snapshot.data
                        .filter((e) => prevMap.get(e.id) !== signature(e))
                        .map((e) => e.id);
                    if (changed.length > 0) {
                        setLiveIds(changed);
                        if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
                        liveTimerRef.current = setTimeout(() => setLiveIds([]), 1600);
                    }
                }
                lastSnapshotRef.current = snapshot.data;
                setTimetable(snapshot.data);
            });
            stopRenewal = renewBeforeExpiry(subscription, sealed, fetchSealedTimetable);
        })();

        return () => {
            active = false;
            if (stopRenewal) stopRenewal();
            if (subscription) subscription.unsubscribe();
            if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
        };
    }, [selectedId, fetchSealedTimetable]);

    // Workloads of the selected section with remaining (unscheduled) lectures
    const sectionWorkloads = useMemo(() => {
        const scheduledCounts = new Map();
        for (const entry of timetable) {
            const key = `${entry.section_id}|${entry.subject_id}|${entry.faculty_id}`;
            scheduledCounts.set(key, (scheduledCounts.get(key) || 0) + 1);
        }
        return workloads
            .filter((wl) => wl.section?.id === selectedId)
            .map((wl) => {
                const key = `${wl.section?.id}|${wl.subject?.id}|${wl.faculty?.id}`;
                const scheduled = scheduledCounts.get(key) || 0;
                return { ...wl, scheduled, remaining: Math.max(0, (wl.lectures_per_week || 0) - scheduled) };
            });
    }, [workloads, timetable, selectedId]);

    const openAdd = (day, timeSlotId, workload = null) => {
        setEditingEntry(null);
        setPrefill({
            day,
            timeSlotId,
            sectionId: selectedId,
            subjectId: workload?.subject?.id || null,
            facultyId: workload?.faculty?.id || null,
            roomId: workload?.room?.id || null
        });
        setModalOpen(true);
    };

    const openEdit = (entry) => {
        setEditingEntry(entry);
        setPrefill({ day: null, timeSlotId: null, sectionId: null, workload: null });
        setModalOpen(true);
    };

    const handleSaveEntry = async (formData, existingId) => {
        try {
            if (existingId) {
                await api.put(`/timetable/${existingId}`, formData);
                addToast('Class updated.');
            } else {
                await api.post('/timetable', formData);
                addToast('Class scheduled.');
            }
            setModalOpen(false);
            await fetchTimetable(selectedId);
        } catch (err) {
            addToast(err?.response?.data?.error || 'Save failed.', 'error');
            throw err;
        }
    };

    const handleDeleteEntry = async (entryId) => {
        try {
            await api.delete(`/timetable/${entryId}`);
            addToast('Class removed.');
            await fetchTimetable(selectedId);
        } catch (err) {
            addToast(err?.response?.data?.error || 'Delete failed.', 'error');
        }
    };

    // Optimistic move: apply locally, revert when the API reports a conflict.
    const handleDropEntry = async (entryId, day, timeSlotId) => {
        const entry = timetable.find((e) => String(e.id) === String(entryId));
        if (!entry) return;
        if (entry.day === day && entry.time_slot_id === timeSlotId) return;

        const previous = timetable;
        setTimetable((rows) => rows.map((row) =>
            String(row.id) === String(entryId) ? { ...row, day, time_slot_id: timeSlotId } : row
        ));

        try {
            await api.put(`/timetable/${entryId}`, {
                section_id: entry.section_id,
                subject_id: entry.subject_id,
                faculty_id: entry.faculty_id,
                room_id: entry.room_id,
                day,
                time_slot_id: timeSlotId
            });
            addToast('Class moved.');
        } catch (err) {
            setTimetable(previous);
            addToast(err?.response?.data?.error || 'Move rejected.', 'error');
        }
    };

    const togglePublish = async () => {
        if (!selectedSection) return;
        setPublishing(true);
        try {
            const next = selectedSection.status === 'published' ? 'draft' : 'published';
            await api.put(`/admin/sections/${selectedId}/publish`, { status: next });
            setSections((rows) => rows.map((s) => (s.id === selectedId ? { ...s, status: next } : s)));
            addToast(next === 'published' ? 'Timetable published. Viewers see it immediately.' : 'Timetable returned to draft.');
        } catch (err) {
            addToast(err?.response?.data?.error || 'Publish action failed.', 'error');
        } finally {
            setPublishing(false);
        }
    };

    const clearSection = async () => {
        if (!selectedId) return;
        try {
            const res = await api.delete(`/timetable/section/${selectedId}`);
            addToast(`Removed ${res.data.deleted} classes.`);
            await fetchTimetable(selectedId);
        } catch (err) {
            addToast(err?.response?.data?.error || 'Clear failed.', 'error');
        }
    };

    const autoGenerate = async (wipe = false) => {
        setGenerating(true);
        try {
            const res = await api.post('/timetable/generate', { wipe });
            addToast(res.data.entriesCreated === 0 ? res.data.message : `Generated ${res.data.entriesCreated} classes.`);
            await fetchTimetable(selectedId);
        } catch (err) {
            addToast(err?.response?.data?.error || 'Generation failed.', 'error');
        } finally {
            setGenerating(false);
        }
    };

    const exportExcel = async () => {
        if (!selectedId) return;
        try {
            const res = await api.get(`/export/timetable/${selectedId}.xlsx`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = `timetable-${selectedSection?.name || selectedId}.xlsx`;
            link.click();
            window.URL.revokeObjectURL(url);
            addToast('Excel export downloaded.');
        } catch (err) {
            addToast(err?.response?.data?.error || 'Export failed.', 'error');
        }
    };

    if (loading) {
        return (
            <div className="card p-6">
                <div className="h-8 w-64 animate-pulse rounded bg-[var(--surface-2)]" />
            </div>
        );
    }

    const isPublished = selectedSection?.status === 'published';

    return (
        <div className="space-y-5">
            <section className="card p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-[260px]">
                        <label className="caption block" htmlFor="designer-section">Section</label>
                        <select
                            id="designer-section"
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                            className="input-shell mt-1 w-full max-w-xs"
                        >
                            <option value="">-- Choose a section --</option>
                            {sections.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}{s.status === 'published' ? ' (published)' : ''}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {selectedSection && (
                            <span className={isPublished ? 'chip chip-ok' : 'chip'}>
                                {isPublished ? 'Published' : 'Draft'}
                            </span>
                        )}
                        {isAdmin && selectedId && (isPublished ? (
                            <button type="button" onClick={togglePublish} disabled={publishing} className="btn-secondary">
                                {publishing ? 'Working…' : 'Unpublish'}
                            </button>
                        ) : (
                            <button type="button" onClick={togglePublish} disabled={publishing} className="btn-volt">
                                {publishing ? 'Working…' : 'Publish'}
                            </button>
                        ))}
                        {selectedId && (
                            <button type="button" onClick={exportExcel} className="btn-secondary">Export .xlsx</button>
                        )}
                        <button type="button" onClick={() => autoGenerate(false)} disabled={generating} className="btn-primary">
                            {generating ? 'Solving…' : 'Auto-fill workloads'}
                        </button>
                        <div className="relative">
                            <button
                                type="button"
                                className="icon-btn"
                                title="More actions"
                                aria-haspopup="menu"
                                aria-expanded={menuOpen}
                                onClick={() => setMenuOpen((prev) => !prev)}
                            >
                                <DotsThree size={18} weight="bold" />
                            </button>
                            {menuOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                                    <div
                                        className="card-strong absolute right-0 top-9 z-50 w-60 p-1"
                                        role="menu"
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="sidebar-item w-full text-[var(--danger)]"
                                            onClick={() => { setMenuOpen(false); setConfirmAction('wipe'); }}
                                        >
                                            Regenerate all (wipe)
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="sidebar-item w-full text-[var(--danger)]"
                                            disabled={!selectedId}
                                            onClick={() => { setMenuOpen(false); setConfirmAction('clear'); }}
                                        >
                                            Clear section timetable
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                {gridError && <div className="alert-danger mt-4">{gridError}</div>}
            </section>

            {selectedId && (
                <section className="card p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <p className="caption">Workload tracker</p>
                            <h2 className="mt-1 text-[20px] leading-7">Unplaced lectures for {selectedSection?.name}</h2>
                        </div>
                    </div>

                    {sectionWorkloads.length === 0 ? (
                        <p className="mt-3 text-sm text-[var(--text-2)]">
                            No workloads defined for this section. Add them under Admin → Master Data → Workloads.
                        </p>
                    ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {sectionWorkloads.map((wl) => (
                                <button
                                    key={wl.id}
                                    type="button"
                                    onClick={() => openAdd(null, null, wl)}
                                    className={`chip${wl.remaining > 0 ? ' is-active' : ''}`}
                                    title={wl.remaining > 0 ? 'Click to schedule a remaining lecture' : 'Fully scheduled'}
                                >
                                    {wl.subject?.code} · {wl.faculty?.name}
                                    <span className="mono">
                                        {wl.remaining === 0
                                            ? `${wl.lectures_per_week}/${wl.lectures_per_week}`
                                            : `${wl.remaining} left`}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {selectedId ? (
                <section className="card p-4 md:p-6">
                    <TimetableGrid
                        timetableData={timetable}
                        timeSlots={timeSlots}
                        editable
                        liveEntryIds={liveIds}
                        onAddEntry={(day, timeSlotId) => openAdd(day, timeSlotId)}
                        onEditEntry={openEdit}
                        onDeleteEntry={handleDeleteEntry}
                        onDropEntry={handleDropEntry}
                    />
                </section>
            ) : (
                <section className="card">
                    <div className="empty-state">
                        <span className="empty-state-glyph">⌖</span>
                        <p className="max-w-md text-sm">
                            Select a section to start designing. Drag classes between slots; a drop that would
                            double-book a faculty, room, or section is rejected with the reason shown.
                        </p>
                    </div>
                </section>
            )}

            <EditEntryModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                onSave={handleSaveEntry}
                entry={editingEntry}
                prefillDay={prefill.day}
                prefillTimeSlotId={prefill.timeSlotId}
                prefillSectionId={prefill.sectionId || (editingEntry ? null : selectedId)}
                prefillSubjectId={prefill.subjectId}
                prefillFacultyId={prefill.facultyId}
                prefillRoomId={prefill.roomId}
                subjects={subjects}
                faculty={faculty}
                rooms={rooms}
                timeSlots={timeSlots}
                sections={sections.filter((s) => s.id === selectedId)}
            />

            <ConfirmDialog
                isOpen={confirmAction === 'wipe'}
                title="Regenerate all timetables"
                message="This wipes every section's timetable and regenerates all workloads from scratch. Every existing entry is lost."
                confirmLabel="Regenerate"
                danger
                requireText="REGENERATE"
                onConfirm={() => autoGenerate(true)}
                onClose={() => setConfirmAction(null)}
            />
            <ConfirmDialog
                isOpen={confirmAction === 'clear'}
                title={`Clear ${selectedSection?.name || 'section'} timetable`}
                message="This removes every class from the selected section. The section stays; its entries do not."
                confirmLabel="Clear section"
                danger
                requireText="CLEAR"
                onConfirm={clearSection}
                onClose={() => setConfirmAction(null)}
            />

            <ToastContainer toasts={toasts} />
        </div>
    );
};

export default DesignerPage;
