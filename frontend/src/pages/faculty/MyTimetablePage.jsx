import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import TimetableGrid from '../../components/TimetableGrid';
import { useToasts, ToastContainer } from '../../components/Toast';
import { useMe } from '../../context/MeContext';
import { ArrowsLeftRight } from '@phosphor-icons/react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Faculty portal: the signed-in user's own teaching schedule plus self-service
// reschedule/cancel requests for the classes they own.
const MyTimetablePage = () => {
    const { me } = useMe();
    const facultyId = me?.faculty?.id;
    const { toasts, addToast } = useToasts();

    const [timetable, setTimetable] = useState([]);
    const [timeSlots, setTimeSlots] = useState([]);
    const [workloads, setWorkloads] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // request modal state
    const [requestEntry, setRequestEntry] = useState(null);
    const [requestType, setRequestType] = useState('reschedule');
    const [requestForm, setRequestForm] = useState({ proposed_day: 'Monday', proposed_time_slot_id: '', proposed_room_id: '', reason: '' });
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(async () => {
        if (!facultyId) { setLoading(false); return; }
        setLoading(true);
        try {
            const [entriesRes, slotsRes, workloadsRes, roomsRes] = await Promise.all([
                api.get(`/timetable/faculty/${facultyId}`),
                api.get('/timetable/time-slots'),
                api.get('/workloads'),
                api.get('/resources/rooms'),
            ]);
            setTimetable(Array.isArray(entriesRes.data) ? entriesRes.data : []);
            setTimeSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
            setWorkloads(Array.isArray(workloadsRes.data) ? workloadsRes.data : []);
            setRooms(Array.isArray(roomsRes.data) ? roomsRes.data : []);
            setError('');
        } catch (err) {
            setError(err?.response?.data?.error || 'Failed to load your timetable.');
        } finally {
            setLoading(false);
        }
    }, [facultyId]);

    useEffect(() => { load(); }, [load]);

    const myWorkloads = useMemo(
        () => workloads.filter((wl) => wl.faculty?.id === facultyId),
        [workloads, facultyId]
    );

    const scheduledCounts = useMemo(() => {
        const map = new Map();
        for (const entry of timetable) {
            const key = `${entry.section_id}|${entry.subject_id}|${entry.faculty_id}`;
            map.set(key, (map.get(key) || 0) + 1);
        }
        return map;
    }, [timetable]);

    const openRequest = (entry, proposed = null) => {
        setRequestEntry(entry);
        setRequestType('reschedule');
        setRequestForm({
            proposed_day: proposed?.day || 'Monday',
            proposed_time_slot_id: proposed?.timeSlotId || '',
            proposed_room_id: '',
            reason: ''
        });
    };

    // Dragging a class onto another slot proposes that reschedule (does not
    // move anything directly — an admin still approves it).
    const handleProposeDrop = (entryId, day, timeSlotId) => {
        const entry = timetable.find((e) => String(e.id) === String(entryId));
        if (!entry) return;
        if (entry.day === day && String(entry.time_slot_id) === String(timeSlotId)) return;
        openRequest(entry, { day, timeSlotId });
    };

    const submitRequest = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await api.post('/requests', {
                entry_id: requestEntry.id,
                request_type: requestType,
                proposed_day: requestType === 'reschedule' ? requestForm.proposed_day : undefined,
                proposed_time_slot_id: requestType === 'reschedule' ? requestForm.proposed_time_slot_id : undefined,
                proposed_room_id: requestType === 'reschedule' ? (requestForm.proposed_room_id || null) : undefined,
                reason: requestForm.reason
            });
            addToast('Request submitted — an admin will review it.');
            setRequestEntry(null);
        } catch (err) {
            addToast(err?.response?.data?.error || 'Request failed.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (!facultyId) {
        return (
            <div className="card p-6 text-sm text-[var(--text-2)]">
                Your account email does not match any faculty record yet. Ask an admin to create your faculty profile with
                this exact email: <strong>{me?.user?.email}</strong>.
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <section className="card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="caption">Faculty</p>
                        <h2 className="mt-2 text-xl font-semibold">{me.faculty.name}</h2>
                        <p className="text-sm text-[var(--text-2)]">{me.faculty.department}</p>
                    </div>
                    <Link to="/portal/requests" className="btn-secondary">View my requests →</Link>
                </div>

                {myWorkloads.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                        {myWorkloads.map((wl) => {
                            const key = `${wl.section?.id}|${wl.subject?.id}|${wl.faculty?.id}`;
                            const scheduled = scheduledCounts.get(key) || 0;
                            return (
                                <span key={wl.id} className="chip">
                                    {wl.section?.name} · {wl.subject?.code} — <span className="mono">{scheduled}/{wl.lectures_per_week}</span> scheduled
                                </span>
                            );
                        })}
                    </div>
                )}
            </section>

            {error && <div className="card-strong alert-danger p-4 text-sm">{error}</div>}

            <section className="card p-6">
                <p className="caption">My weekly schedule</p>
                <h2 className="mt-2 text-xl">Classes you teach</h2>
                {loading ? (
                    <div className="mt-4 space-y-3">
                        <div className="h-8 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                        <div className="h-8 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    </div>
                ) : timetable.length === 0 ? (
                    <p className="mt-3 text-sm text-[var(--text-2)]">No classes scheduled for you yet.</p>
                ) : (
                    <div className="mt-4">
                        <TimetableGrid
                            timetableData={timetable}
                            timeSlots={timeSlots}
                            customEntryAction={{
                                icon: <ArrowsLeftRight size={12} weight="regular" />,
                                title: 'Request reschedule / cancel',
                                onClick: openRequest
                            }}
                            onProposeDrop={handleProposeDrop}
                        />
                        <p className="mt-3 text-xs text-[var(--text-3)]">
                            Drag a class onto a different slot — or use the <ArrowsLeftRight size={12} weight="regular" className="inline align-[-2px]" /> button — to ask an admin for a reschedule or cancellation.
                        </p>
                    </div>
                )}
            </section>

            {requestEntry && (
                <div className="modal-overlay" onClick={() => setRequestEntry(null)}>
                    <div className="modal-panel soft-scroll" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl">Request a change</h3>
                        <p className="mt-1 text-sm text-[var(--text-2)]">
                            {requestEntry.subject?.code} {requestEntry.subject?.name} — {requestEntry.section?.name},
                            currently {requestEntry.day} <span className="mono">{requestEntry.time_slot?.start_time}–{requestEntry.time_slot?.end_time}</span>
                            {requestEntry.room?.room_number ? ` in ${requestEntry.room.room_number}` : ''}.
                        </p>

                        <form onSubmit={submitRequest} className="mt-4 space-y-3">
                            <div className="flex gap-2">
                                {['reschedule', 'cancel'].map((type) => (
                                    <button
                                        key={type}
                                        type="button"
                                        onClick={() => setRequestType(type)}
                                        className={`chip ${requestType === type ? 'is-active' : ''}`}
                                    >
                                        {type === 'reschedule' ? 'Reschedule' : 'Cancel class'}
                                    </button>
                                ))}
                            </div>

                            {requestType === 'reschedule' && (
                                <>
                                    <label className="block text-sm">New day
                                        <select
                                            value={requestForm.proposed_day}
                                            onChange={(e) => setRequestForm({ ...requestForm, proposed_day: e.target.value })}
                                            className="input-shell mt-1 w-full"
                                        >
                                            {DAYS.map((d) => <option key={d}>{d}</option>)}
                                        </select>
                                    </label>
                                    <label className="block text-sm">New period
                                        <select
                                            required
                                            value={requestForm.proposed_time_slot_id}
                                            onChange={(e) => setRequestForm({ ...requestForm, proposed_time_slot_id: e.target.value })}
                                            className="input-shell mt-1 w-full"
                                        >
                                            <option value="">-- Choose period --</option>
                                            {[...timeSlots].sort((a, b) => a.slot_number - b.slot_number).map((slot) => (
                                                <option key={slot.id} value={slot.id}>
                                                    Slot {slot.slot_number}: {String(slot.start_time).slice(0, 5)}–{String(slot.end_time).slice(0, 5)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block text-sm">Room (optional)
                                        <select
                                            value={requestForm.proposed_room_id}
                                            onChange={(e) => setRequestForm({ ...requestForm, proposed_room_id: e.target.value })}
                                            className="input-shell mt-1 w-full"
                                        >
                                            <option value="">Keep current room</option>
                                            {rooms.map((r) => <option key={r.id} value={r.id}>{r.room_number}</option>)}
                                        </select>
                                    </label>
                                </>
                            )}

                            <label className="block text-sm">Reason <span className="text-[var(--danger)]">*</span>
                                <textarea
                                    required
                                    rows={3}
                                    value={requestForm.reason}
                                    onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })}
                                    placeholder="Why do you need this change?"
                                    className="input-shell mt-1 w-full"
                                />
                            </label>

                            <div className="confirm-actions">
                                <button type="button" className="btn-secondary" onClick={() => setRequestEntry(null)}>Cancel</button>
                                <button type="submit" disabled={submitting} className="btn-primary">
                                    {submitting ? 'Sending…' : 'Submit request'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ToastContainer toasts={toasts} />
        </div>
    );
};

export default MyTimetablePage;
