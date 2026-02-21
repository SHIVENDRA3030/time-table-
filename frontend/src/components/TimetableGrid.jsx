import React, { useMemo, useState } from 'react';

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

const TimetableGrid = ({ timetableData, highlightDay = null }) => {
    const slots = useMemo(() => {
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
    }, [timetableData]);

    const entriesByCell = useMemo(() => {
        const map = new Map();

        for (const entry of timetableData) {
            const slotKey = buildSlotKeyFromEntry(entry);
            const cellKey = `${entry.day}|${slotKey}`;
            const existing = map.get(cellKey) || [];
            existing.push(entry);
            map.set(cellKey, existing);
        }

        return map;
    }, [timetableData]);

    const visibleDays = useMemo(() => {
        if (highlightDay && ALL_DAYS.includes(highlightDay)) return [highlightDay];
        return ALL_DAYS;
    }, [highlightDay]);

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

    if (!Array.isArray(timetableData) || timetableData.length === 0 || slots.length === 0) {
        return (
            <div className="glass-panel p-6 text-sm text-[var(--ink-600)]">
                No timetable data available for grid rendering.
            </div>
        );
    }

    return (
        <section className="glass-panel p-3 md:p-4">
            <div className="space-y-3 md:hidden">
                {mobileDayGroups.map((dayGroup) => {
                    const isExpanded = isDayExpanded(dayGroup.day);
                    const panelId = `mobile-day-panel-${dayGroup.day.toLowerCase()}`;

                    return (
                        <article
                            key={dayGroup.day}
                            className="overflow-hidden rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)]"
                        >
                            <button
                                type="button"
                                aria-expanded={isExpanded}
                                aria-controls={panelId}
                                onClick={() => toggleDay(dayGroup.day, isExpanded)}
                                className={`flex w-full items-center justify-between px-3 py-2.5 text-left ${isExpanded ? 'border-b border-[color:var(--surface-stroke)]' : ''}`}
                            >
                                <div>
                                    <p className="text-base font-semibold text-[var(--ink-900)]">{dayGroup.day}</p>
                                    <p className="text-xs text-[var(--ink-600)]">
                                        {dayGroup.busySlots} busy slot{dayGroup.busySlots === 1 ? '' : 's'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="chip !py-1 text-[10px]">
                                        {dayGroup.totalClasses} class{dayGroup.totalClasses === 1 ? '' : 'es'}
                                    </span>
                                    <span className="text-xs font-semibold text-[var(--ink-600)]">
                                        {isExpanded ? 'Hide' : 'Show'}
                                    </span>
                                </div>
                            </button>

                            {isExpanded ? (
                                dayGroup.rows.length > 0 ? (
                                    <div id={panelId} className="divide-y divide-[color:var(--surface-stroke)]">
                                        {dayGroup.rows.map((row) => (
                                            <div key={`${dayGroup.day}-${row.slot.key}`} className="space-y-2 px-3 py-3">
                                                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-600)]">
                                                    {row.slot.label}
                                                </p>
                                                <div className="space-y-2">
                                                    {row.entries.map((entry, index) => (
                                                        <article
                                                            key={getEntryKey(entry, row.slot.key, index)}
                                                            className="rounded-lg border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-2 shadow-sm"
                                                        >
                                                            <p className="text-xs font-bold tracking-wide text-[var(--accent-700)]">
                                                                {entry.subject?.code || 'N/A'}
                                                            </p>
                                                            <p className="mt-1 text-sm font-semibold text-[var(--ink-800)]">
                                                                {entry.subject?.name || 'Unnamed Subject'}
                                                            </p>
                                                            <div className="mt-1 text-xs text-[var(--ink-600)]">
                                                                <p>Room: {entry.room?.room_number || 'Not assigned'}</p>
                                                                {entry.faculty?.name && <p>{entry.faculty.name}</p>}
                                                            </div>
                                                        </article>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p id={panelId} className="px-3 py-3 text-sm text-[var(--ink-600)]">
                                        No classes scheduled.
                                    </p>
                                )
                            ) : (
                                <p id={panelId} className="px-3 py-2.5 text-xs text-[var(--ink-600)]">
                                    Tap to expand and view time slots.
                                </p>
                            )}
                        </article>
                    );
                })}
            </div>

            <div className="soft-scroll hidden overflow-auto rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] md:block">
                <table className="min-w-[860px] w-full border-separate border-spacing-0">
                    <thead>
                        <tr>
                            <th className="sticky left-0 top-0 z-20 min-w-36 border-b border-r border-[color:var(--surface-stroke)] bg-[var(--accent-100)] px-3 py-3 text-left text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink-700)]">
                                Day / Time
                            </th>
                            {slots.map((slot) => (
                                <th
                                    key={slot.key}
                                    className="sticky top-0 z-10 min-w-44 border-b border-[color:var(--surface-stroke)] bg-[var(--accent-100)] px-3 py-3 text-center text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink-700)]"
                                >
                                    {slot.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleDays.map((day) => (
                            <tr key={day}>
                                <td className="sticky left-0 z-10 border-b border-r border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] px-3 py-4 align-top text-sm font-semibold text-[var(--ink-800)]">
                                    {day}
                                </td>
                                {slots.map((slot) => {
                                    const cellEntries = entriesByCell.get(`${day}|${slot.key}`) || [];
                                    return (
                                        <td key={`${day}-${slot.key}`} className="h-28 min-w-44 border-b border-[color:var(--surface-stroke)] px-2 py-2 align-top">
                                            {cellEntries.length > 0 ? (
                                                <div className="space-y-2">
                                                    {cellEntries.map((entry, index) => (
                                                        <article
                                                            key={getEntryKey(entry, slot.key, index)}
                                                            className="rounded-lg border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-2 shadow-sm"
                                                        >
                                                            <p className="text-xs font-bold tracking-wide text-[var(--accent-700)]">
                                                                {entry.subject?.code || 'N/A'}
                                                            </p>
                                                            <p className="mt-1 text-xs font-medium text-[var(--ink-700)] line-clamp-2">
                                                                {entry.subject?.name || 'Unnamed Subject'}
                                                            </p>
                                                            <div className="mt-1 text-[11px] text-[var(--ink-500)]">
                                                                <p>Room: {entry.room?.room_number || 'Not assigned'}</p>
                                                                {entry.faculty?.name && <p>{entry.faculty.name}</p>}
                                                            </div>
                                                        </article>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-[color:var(--surface-stroke)] text-xs text-[var(--ink-500)]">
                                                    Free
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
};

export default TimetableGrid;
