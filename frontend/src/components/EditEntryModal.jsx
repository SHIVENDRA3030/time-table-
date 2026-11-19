import React, { useEffect, useMemo, useRef, useState } from 'react';
import SearchableSelect from './SearchableSelect';
import { X } from '@phosphor-icons/react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatSlotLabel = (slot) => {
    if (!slot) return 'Unknown';
    const start = String(slot.start_time || '').slice(0, 5);
    const end = String(slot.end_time || '').slice(0, 5);
    if (start && end) return `${start} – ${end}`;
    return `Slot ${slot.slot_number || '?'}`;
};

const EditEntryModal = ({
    isOpen,
    onClose,
    onSave,
    entry = null,
    prefillDay = null,
    prefillTimeSlotId = null,
    prefillSectionId = null,
    prefillSubjectId = null,
    prefillFacultyId = null,
    prefillRoomId = null,
    subjects = [],
    faculty = [],
    rooms = [],
    timeSlots = [],
    sections = [],
}) => {
    const isEdit = Boolean(entry?.id);
    const panelRef = useRef(null);

    const [form, setForm] = useState({
        section_id: '',
        subject_id: '',
        faculty_id: '',
        room_id: '',
        day: 'Monday',
        time_slot_id: '',
    });

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;

        if (isEdit) {
            setForm({
                section_id: entry.section_id || '',
                subject_id: entry.subject_id || '',
                faculty_id: entry.faculty_id || '',
                room_id: entry.room_id || '',
                day: entry.day || 'Monday',
                time_slot_id: entry.time_slot_id || '',
            });
        } else {
            setForm({
                section_id: prefillSectionId || '',
                subject_id: prefillSubjectId || '',
                faculty_id: prefillFacultyId || '',
                room_id: prefillRoomId || '',
                day: prefillDay || 'Monday',
                time_slot_id: prefillTimeSlotId || '',
            });
        }

        setError('');
        setSaving(false);
    }, [isOpen, entry, isEdit, prefillDay, prefillTimeSlotId, prefillSectionId, prefillSubjectId, prefillFacultyId, prefillRoomId]);

    // Focus trap: close on Escape
    useEffect(() => {
        if (!isOpen) return undefined;

        const handleKey = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    // Lock body scroll
    useEffect(() => {
        if (!isOpen) return undefined;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [isOpen]);

    const handleChange = (field) => (e) => {
        setForm((prev) => ({ ...prev, [field]: e.target.value }));
        if (error) setError('');
    };

    const isValid = useMemo(() => {
        return form.section_id && form.subject_id && form.faculty_id && form.day && form.time_slot_id;
    }, [form]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isValid) {
            setError('Please fill in all required fields (room is optional for online classes).');
            return;
        }

        setSaving(true);
        setError('');

        try {
            await onSave({
                ...form,
                room_id: form.room_id || null,
            }, isEdit ? entry.id : null);
            onClose();
        } catch (err) {
            const msg = err?.response?.data?.error || err?.message || 'Something went wrong.';
            setError(msg);
        } finally {
            setSaving(false);
        }
    };

    const sectionOptions = useMemo(() => sections.map((s) => ({
        value: s.id,
        label: `${s.name}${s.program?.name ? ` (${s.program.name})` : ''}`
    })), [sections]);

    const subjectOptions = useMemo(() => subjects
        .filter(s => {
            if (!form.faculty_id) return true;
            const fac = faculty.find(f => f.id === form.faculty_id);
            return fac && (fac.subject_ids || []).includes(s.id);
        })
        .map((s) => ({
            value: s.id,
            label: `${s.code} — ${s.name}`
        })), [subjects, faculty, form.faculty_id]);

    const facultyOptions = useMemo(() => faculty
        .filter(f => {
            if (!form.subject_id) return true;
            return (f.subject_ids || []).includes(form.subject_id);
        })
        .map((f) => ({
            value: f.id,
            label: `${f.name}${f.department ? ` (${f.department})` : ''}`
        })), [faculty, form.subject_id]);

    const roomOptions = useMemo(() => rooms.map((r) => ({
        value: r.id,
        label: `${r.room_number}${r.type ? ` (${r.type})` : ''}`
    })), [rooms]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div
                ref={panelRef}
                className="modal-panel soft-scroll"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={isEdit ? 'Edit timetable entry' : 'Add new timetable entry'}
            >
                {/* Header */}
                <div className="flex items-center justify-between gap-3 mb-5">
                    <div>
                        <h2 className="text-xl">{isEdit ? 'Edit entry' : 'Add new entry'}</h2>
                        <p className="text-xs text-[var(--text-2)] mt-1">
                            {isEdit ? 'Modify the fields and save changes.' : 'Fill in class details to create a new entry.'}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="cell-action-btn !w-8 !h-8 !text-base"
                        aria-label="Close modal"
                    >
                        <X size={16} weight="regular" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Section */}
                    <label className="block">
                        <span className="mb-1 block text-sm font-semibold text-[var(--text-2)]">
                            Section <span className="text-[var(--danger)]">*</span>
                        </span>
                        <SearchableSelect
                            name="section_id"
                            value={form.section_id}
                            onChange={handleChange('section_id')}
                            options={sectionOptions}
                            placeholder="-- Choose section --"
                            required
                        />
                    </label>

                    {/* Subject */}
                    <label className="block">
                        <span className="mb-1 block text-sm font-semibold text-[var(--text-2)]">
                            Subject <span className="text-[var(--danger)]">*</span>
                        </span>
                        <SearchableSelect
                            name="subject_id"
                            value={form.subject_id}
                            onChange={handleChange('subject_id')}
                            options={subjectOptions}
                            placeholder="-- Choose subject --"
                            required
                        />
                    </label>

                    {/* Faculty */}
                    <label className="block">
                        <span className="mb-1 block text-sm font-semibold text-[var(--text-2)]">
                            Faculty <span className="text-[var(--danger)]">*</span>
                        </span>
                        <SearchableSelect
                            name="faculty_id"
                            value={form.faculty_id}
                            onChange={handleChange('faculty_id')}
                            options={facultyOptions}
                            placeholder="-- Choose faculty --"
                            required
                        />
                    </label>

                    {/* Room (optional) */}
                    <label className="block">
                        <span className="mb-1 block text-sm font-semibold text-[var(--text-2)]">
                            Room <span className="text-xs text-[var(--text-3)]">(optional — leave empty for online)</span>
                        </span>
                        <SearchableSelect
                            name="room_id"
                            value={form.room_id}
                            onChange={handleChange('room_id')}
                            options={roomOptions}
                            placeholder="-- No room (online) --"
                        />
                    </label>

                    {/* Day & Time Slot in a row */}
                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="mb-1 block text-sm font-semibold text-[var(--text-2)]">
                                Day <span className="text-[var(--danger)]">*</span>
                            </span>
                            <select
                                className="input-shell"
                                value={form.day}
                                onChange={handleChange('day')}
                                required
                            >
                                {DAYS.map((d) => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className="mb-1 block text-sm font-semibold text-[var(--text-2)]">
                                Time slot <span className="text-[var(--danger)]">*</span>
                            </span>
                            <select
                                className="input-shell"
                                value={form.time_slot_id}
                                onChange={handleChange('time_slot_id')}
                                required
                            >
                                <option value="">-- Choose time slot --</option>
                                {timeSlots.map((ts) => (
                                    <option key={ts.id} value={ts.id}>
                                        {formatSlotLabel(ts)}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="alert-danger rounded-lg px-4 py-3 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="confirm-actions pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary text-sm"
                            disabled={saving}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary text-sm"
                            disabled={saving || !isValid}
                        >
                            {saving ? (
                                <span className="flex items-center gap-2">
                                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--text-1)]" />
                                    Saving…
                                </span>
                            ) : (
                                isEdit ? 'Save changes' : 'Create entry'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditEntryModal;
