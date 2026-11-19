import React, { useMemo, useState } from 'react';
import { PencilSimple, X, ArrowsLeftRight, Plus } from '@phosphor-icons/react';

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Grid coordinates (brand kit §5.4): columns A–F are days, rows 1–8 are periods.
const dayCoord = (day) => String.fromCharCode(65 + Math.max(0, ALL_DAYS.indexOf(day)));

const formatTime = (timeValue) => {
    if (!timeValue) return '--:--';
    const text = String(timeValue).trim();
    const match = text.match(/^(\d{2}):(\d{2})/);
    if (!match) return text;
    return `${match[1]}:${match[2]}`;
};

const buildSlotKeyFromEntry = (entry) => {
    const slotNumber = Number(entry?.time_slot?.slot_number);
    if (Number.isFinite(slotNumber)) return `n-${slotNumber}`;
    if (entry?.time_slot_id) return `id-${entry.time_slot_id}`;

    const start = entry?.time_slot?.start_time || '';
    const end = entry?.time_slot?.end_time || '';
    return `t-${start}-${end}`;
};

const getEntryKey = (entry, slotKey, index = 0) =>
    entry.id || `${entry?.day || 'day'}-${entry?.subject?.code || 'subject'}-${slotKey}-${index}`;

const TimetableGrid = ({
    timetableData,
    timeSlots = null,           // optional explicit period list; shows a full grid even with no entries
    highlightDay = null,
    editable = false,
    onEditEntry = null,
    onDeleteEntry = null,
    onAddEntry = null,
    onDropEntry = null,
    customEntryAction = null,   // { icon, title, onClick(entry) } rendered per entry even when read-only
    onProposeDrop = null,       // (entryId, day, timeSlotId) — read-only grids can still propose a move
    liveEntryIds = null,        // array/Set of entry ids currently updated via realtime → Volt left border
}) => {
    const useProvidedSlots = Array.isArray(timeSlots) && timeSlots.length > 0;

    const slots = useMemo(() => {
        if (useProvidedSlots) {
            const mapped = timeSlots.map((ts) => ({
                key: `id-${ts.id}`,
                slotNumber: Number.isFinite(Number(ts.slot_number)) ? Number(ts.slot_number) : null,
                start: ts.start_time || '',
                end: ts.end_time || '',
                label: ts.start_time && ts.end_time
                    ? `${formatTime(ts.start_time)} - ${formatTime(ts.end_time)}`
                    : `Slot ${ts.slot_number ?? ''}`,
                timeSlotId: ts.id,
            }));
            mapped.sort((a, b) => {
                if (a.slotNumber !== null && b.slotNumber !== null) return a.slotNumber - b.slotNumber;
                if (a.start && b.start) return a.start.localeCompare(b.start);
                return a.key.localeCompare(b.key);
            });
            return mapped;
        }

        const map = new Map();

        for (const entry of timetableData) {
            const slotNumber = Number(entry?.time_slot?.slot_number);
            const start = entry?.time_slot?.start_time || '';
            const end = entry?.time_slot?.end_time || '';
            const key = buildSlotKeyFromEntry(entry);

            if (!map.has(key)) {
                map.set(key, {
                    key,
                    slotNumber: Number.isFinite(slotNumber) ? slotNumber : null,
                    start,
                    end,
                    label: start && end ? `${formatTime(start)} - ${formatTime(end)}` : `Slot ${map.size + 1}`,
                    timeSlotId: entry?.time_slot_id || null,
                });
            }
        }

        const extracted = [...map.values()];
        extracted.sort((a, b) => {
            if (a.slotNumber !== null && b.slotNumber !== null) return a.slotNumber - b.slotNumber;
            if (a.start && b.start) return a.start.localeCompare(b.start);
            return a.key.localeCompare(b.key);
        });

        return extracted;
    }, [timetableData, timeSlots, useProvidedSlots]);

    const slotKeyForEntry = (entry) => {
        if (useProvidedSlots && entry?.time_slot_id) return `id-${entry.time_slot_id}`;
        return buildSlotKeyFromEntry(entry);
    };

    const entriesByCell = useMemo(() => {
        const map = new Map();

        for (const entry of timetableData) {
            const slotKey = slotKeyForEntry(entry);
            const cellKey = `${entry.day}|${slotKey}`;
            const existing = map.get(cellKey) || [];
            existing.push(entry);
            map.set(cellKey, existing);
        }

        return map;
    }, [timetableData, useProvidedSlots]);

    const visibleDays = useMemo(() => {
        if (highlightDay && ALL_DAYS.includes(highlightDay)) return [highlightDay];
        return ALL_DAYS;
    }, [highlightDay]);

    const showSectionLabel = useMemo(() => {
        const distinctSections = new Set(
            timetableData
                .map((entry) => entry?.section?.name)
                .filter(Boolean)
        );
        return distinctSections.size > 1;
    }, [timetableData]);

    const liveIds = useMemo(
        () => (Array.isArray(liveEntryIds) ? new Set(liveEntryIds) : liveEntryIds instanceof Set ? liveEntryIds : null),
        [liveEntryIds]
    );

    const mobileDayGroups = useMemo(
        () =>
            visibleDays.map((day) => {
                const rows = slots
                    .map((slot) => ({
                        slot,
                        entries: entriesByCell.get(`${day}|${slot.key}`) || [],
                    }))
                    .filter((row) => row.entries.length > 0);

                return {
                    day,
                    rows,
                    busySlots: rows.length,
                    totalClasses: rows.reduce((total, row) => total + row.entries.length, 0),
                };
            }),
        [entriesByCell, slots, visibleDays]
    );

    const [dayExpansionOverrides, setDayExpansionOverrides] = useState({});
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const defaultExpandedDay = useMemo(() => {
        if (highlightDay && visibleDays.includes(highlightDay)) return highlightDay;
        const firstBusyDay = mobileDayGroups.find((group) => group.rows.length > 0) || mobileDayGroups[0];
        return firstBusyDay?.day || null;
    }, [highlightDay, mobileDayGroups, visibleDays]);

    const isDayExpanded = (day) =>
        Object.prototype.hasOwnProperty.call(dayExpansionOverrides, day)
            ? dayExpansionOverrides[day]
            : day === defaultExpandedDay;

    const toggleDay = (day, currentExpandedState) => {
        setDayExpansionOverrides((prev) => ({
            ...prev,
            [day]: !currentExpandedState,
        }));
    };

    const handleDeleteClick = (entryId) => {
        setConfirmDeleteId(entryId);
    };

    const handleConfirmDelete = () => {
        if (confirmDeleteId && onDeleteEntry) {
            onDeleteEntry(confirmDeleteId);
        }
        setConfirmDeleteId(null);
    };

    const handleCancelDelete = () => {
        setConfirmDeleteId(null);
    };

    // Drag and Drop handlers. `editable` grids move entries directly;
    // `onProposeDrop` grids (e.g. faculty self-service) propose a change instead.
    const isDraggable = editable || Boolean(onProposeDrop);

    const handleDragStart = (e, entry) => {
        if (!isDraggable) return;
        e.dataTransfer.setData('text/plain', JSON.stringify({ entryId: entry.id }));
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => { e.target.classList.add('tt-dragging'); }, 0);
    };

    const handleDragEnd = (e) => {
        e.target.classList.remove('tt-dragging');
    };

    const handleDragOver = (e) => {
        if (!isDraggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e, day, timeSlotId) => {
        if (!isDraggable) return;
        e.preventDefault();

        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.entryId) {
                e.currentTarget.classList.remove('tt-drop');
                if (editable && onDropEntry) {
                    onDropEntry(data.entryId, day, timeSlotId);
                } else if (onProposeDrop) {
                    onProposeDrop(data.entryId, day, timeSlotId);
                }
            }
        } catch (err) {
            console.error('Failed to parse dropped data', err);
        }
    };

    const handleDragEnter = (e) => {
        if (!isDraggable) return;
        e.preventDefault();
        e.currentTarget.classList.add('tt-drop');
    };

    const handleDragLeave = (e) => {
        if (!isDraggable) return;
        e.currentTarget.classList.remove('tt-drop');
    };

    // Action buttons for entries. Editors get pencil/close; a `customEntryAction`
    // (e.g. "request change" in the faculty portal) renders even for read-only grids.
    const renderCellActions = (entry) => {
        if (!editable && !customEntryAction) return null;

        return (
            <div className="cell-actions">
                {editable && (
                    <button
                        type="button"
                        className="cell-action-btn"
                        title="Edit entry"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEditEntry?.(entry);
                        }}
                    >
                        <PencilSimple size={12} weight="regular" />
                    </button>
                )}
                {editable && (
                    <button
                        type="button"
                        className="cell-action-btn is-danger"
                        title="Delete entry"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(entry.id);
                        }}
                    >
                        <X size={12} weight="regular" />
                    </button>
                )}
                {customEntryAction && (
                    <button
                        type="button"
                        className="cell-action-btn"
                        title={customEntryAction.title || 'Action'}
                        onClick={(e) => {
                            e.stopPropagation();
                            customEntryAction.onClick(entry);
                        }}
                    >
                        {customEntryAction.icon || <ArrowsLeftRight size={12} weight="regular" />}
                    </button>
                )}
            </div>
        );
    };

    const renderEntry = (entry, slotKey, index, isMobileCard) => {
        const live = liveIds ? liveIds.has(entry.id) : false;
        return (
            <article
                key={getEntryKey(entry, slotKey, index)}
                className={`${isMobileCard ? 'timetable-card' : 'timetable-cell'} tt-entry${live ? ' tt-entry-live' : ''}${isDraggable ? ' cursor-grab active:cursor-grabbing' : ''}`}
                draggable={isDraggable}
                onDragStart={(e) => handleDragStart(e, entry)}
                onDragEnd={handleDragEnd}
            >
                {renderCellActions(entry)}
                <p className="mono text-[11px] leading-[14px] text-[var(--text-3)]">
                    {entry.subject?.code || '—'}
                </p>
                <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-[18px] text-[var(--text-1)]">
                    {entry.subject?.name || 'Unnamed subject'}
                </p>
                <div className="mt-1 space-y-0.5 text-[11px] leading-4 text-[var(--text-2)]">
                    {showSectionLabel && entry.section?.name && <p className="truncate">Sec {entry.section.name}</p>}
                    <p className="mono truncate">{entry.room?.room_number || 'No room'}</p>
                    {entry.faculty?.name && <p className="truncate">{entry.faculty.name}</p>}
                </div>
            </article>
        );
    };

    if (!Array.isArray(timetableData) || (timetableData.length === 0 && slots.length === 0)) {
        return (
            <div className="card">
                <div className="empty-state">
                    <span className="empty-state-glyph">⌖</span>
                    <p className="text-sm">No timetable data for this selection.</p>
                </div>
            </div>
        );
    }

    return (
        <>
            <section className="card p-3 md:p-4">
                {/* Mobile Accordion View */}
                <div className="space-y-3 md:hidden">
                    {mobileDayGroups.map((dayGroup) => {
                        const isExpanded = isDayExpanded(dayGroup.day);
                        const panelId = `mobile-day-panel-${dayGroup.day.toLowerCase()}`;

                        return (
                            <article
                                key={dayGroup.day}
                                className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"
                            >
                                <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    aria-controls={panelId}
                                    onClick={() => toggleDay(dayGroup.day, isExpanded)}
                                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left${isExpanded ? ' border-b border-[var(--line)]' : ''}`}
                                >
                                    <div>
                                        <p className="text-sm font-semibold text-[var(--text-1)]">{dayGroup.day}</p>
                                        <p className="mono text-[11px] leading-[14px] text-[var(--text-3)]">
                                            {dayGroup.busySlots} busy slot{dayGroup.busySlots === 1 ? '' : 's'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="mono text-[11px] text-[var(--text-2)]">
                                            {dayGroup.totalClasses} class{dayGroup.totalClasses === 1 ? '' : 'es'}
                                        </span>
                                        <span className="text-xs font-medium text-[var(--text-2)]">
                                            {isExpanded ? 'Hide' : 'Show'}
                                        </span>
                                    </div>
                                </button>

                                {isExpanded ? (
                                    dayGroup.rows.length > 0 ? (
                                        <div id={panelId} className="divide-y divide-[var(--line)]">
                                            {dayGroup.rows.map((row) => (
                                                <div key={`${dayGroup.day}-${row.slot.key}`} className="space-y-2 px-3 py-3">
                                                    <p className="mono text-[11px] leading-[14px] text-[var(--text-3)]">
                                                        {row.slot.label}
                                                    </p>
                                                    <div className="space-y-2">
                                                        {row.entries.map((entry, index) =>
                                                            renderEntry(entry, row.slot.key, index, true)
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p id={panelId} className="px-3 py-3 text-sm text-[var(--text-2)]">
                                            No classes scheduled.
                                        </p>
                                    )
                                ) : (
                                    <p id={panelId} className="px-3 py-2.5 text-xs text-[var(--text-2)]">
                                        Expand to view time slots.
                                    </p>
                                )}
                            </article>
                        );
                    })}
                </div>

                {/* Desktop grid: days as columns (A–F), periods as rows (1–8) */}
                <div className="soft-scroll hidden overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] md:block">
                    <table className="tt-grid">
                        <thead>
                            <tr>
                                <th className="tt-corner min-w-[112px]">
                                    <p className="caption">Period</p>
                                </th>
                                {visibleDays.map((day) => (
                                    <th key={day} className="min-w-44" title={`${day} · periods 1–${slots.length}`}>
                                        <p className="tt-coord">{dayCoord(day)}</p>
                                        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-1)]">
                                            {day.slice(0, 3)}
                                        </p>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {slots.map((slot, rowIdx) => {
                                const periodNumber = slot.slotNumber ?? rowIdx + 1;
                                return (
                                    <tr key={slot.key}>
                                        <td className="tt-time">
                                            <p className="tt-coord">{periodNumber}</p>
                                            <p className="mono text-xs text-[var(--text-2)]">{slot.label}</p>
                                        </td>
                                        {visibleDays.map((day) => {
                                            const cellEntries = entriesByCell.get(`${day}|${slot.key}`) || [];
                                            return (
                                                <td
                                                    key={`${day}-${slot.key}`}
                                                    className="tt-cell"
                                                    onDragOver={handleDragOver}
                                                    onDrop={(e) => handleDrop(e, day, slot.timeSlotId)}
                                                    onDragEnter={handleDragEnter}
                                                    onDragLeave={handleDragLeave}
                                                >
                                                    {cellEntries.length > 0 ? (
                                                        <div className="space-y-1">
                                                            {cellEntries.map((entry, index) =>
                                                                renderEntry(entry, slot.key, index, false)
                                                            )}
                                                        </div>
                                                    ) : editable && onAddEntry ? (
                                                        <button
                                                            type="button"
                                                            className="add-class-btn"
                                                            title={`Add class at ${dayCoord(day)}${periodNumber}`}
                                                            onClick={() => onAddEntry(day, slot.timeSlotId)}
                                                        >
                                                            <Plus size={14} weight="regular" /> Add
                                                        </button>
                                                    ) : null}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Delete Confirmation Modal */}
            {confirmDeleteId && (
                <div className="modal-overlay" onClick={handleCancelDelete}>
                    <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '380px' }}>
                        <h3 className="text-base">Delete entry</h3>
                        <p className="mt-2 text-sm text-[var(--text-2)]">
                            This removes the timetable entry. The action is recorded in the audit log.
                        </p>
                        <div className="confirm-actions">
                            <button type="button" className="btn-ghost" onClick={handleCancelDelete}>
                                Cancel
                            </button>
                            <button type="button" className="btn-danger" onClick={handleConfirmDelete}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default TimetableGrid;
