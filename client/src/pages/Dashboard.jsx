import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const DASHBOARD_QUALITY_KEY = 'timetable-dashboard-quality';

const Dashboard = () => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [stats, setStats] = useState({
        sections: 0,
        faculty: 0,
        rooms: 0,
        classes: 0
    });
    const [timetableEntries, setTimetableEntries] = useState([]);
    const [qualitySnapshot, setQualitySnapshot] = useState(null);

    useEffect(() => {
        let active = true;

        const loadStats = async () => {
            setLoading(true);
            setError('');

            try {
                const [sectionsRes, facultyRes, roomsRes, timetableRes] = await Promise.all([
                    api.get('/programs/sections'),
                    api.get('/resources/faculty'),
                    api.get('/resources/rooms'),
                    api.get('/timetable')
                ]);

                if (!active) return;

                const entries = Array.isArray(timetableRes.data) ? timetableRes.data : [];
                setStats({
                    sections: Array.isArray(sectionsRes.data) ? sectionsRes.data.length : 0,
                    faculty: Array.isArray(facultyRes.data) ? facultyRes.data.length : 0,
                    rooms: Array.isArray(roomsRes.data) ? roomsRes.data.length : 0,
                    classes: entries.length
                });
                setTimetableEntries(entries);
            } catch (err) {
                if (!active) return;
                setError(err?.response?.data?.error || 'Could not load dashboard metrics.');
            } finally {
                if (active) setLoading(false);
            }
        };

        loadStats();
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const raw = window.localStorage.getItem(DASHBOARD_QUALITY_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            setQualitySnapshot(parsed);
        } catch (readError) {
            console.warn('Failed to read quality snapshot:', readError);
        }
    }, []);

    const metricCards = useMemo(() => ([
        { label: 'Active Sections', value: stats.sections, accent: 'var(--ok-600)' },
        { label: 'Faculty Pool', value: stats.faculty, accent: 'var(--accent-500)' },
        { label: 'Teaching Rooms', value: stats.rooms, accent: 'var(--warning-600)' },
        { label: 'Scheduled Classes', value: stats.classes, accent: 'var(--danger-600)' },
    ]), [stats]);

    const roomChartData = useMemo(() => {
        const roomCounts = new Map();
        for (const entry of timetableEntries) {
            const room = entry?.room?.room_number;
            if (!room) continue;
            roomCounts.set(room, (roomCounts.get(room) || 0) + 1);
        }

        const list = [...roomCounts.entries()]
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 7);

        const max = Math.max(...list.map((x) => x.value), 1);
        const total = Math.max(stats.classes, 1);
        return list.map((item) => ({
            ...item,
            fill: `${Math.max(8, Math.round((item.value / max) * 100))}%`,
            share: `${Math.round((item.value / total) * 100)}%`
        }));
    }, [timetableEntries, stats.classes]);

    const facultyChartData = useMemo(() => {
        const facultyCounts = new Map();
        for (const entry of timetableEntries) {
            const name = entry?.faculty?.name;
            if (!name) continue;
            facultyCounts.set(name, (facultyCounts.get(name) || 0) + 1);
        }

        const list = [...facultyCounts.entries()]
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 7);

        const max = Math.max(...list.map((x) => x.value), 1);
        return list.map((item) => ({
            ...item,
            fill: `${Math.max(8, Math.round((item.value / max) * 100))}%`
        }));
    }, [timetableEntries]);

    const dbMissingRoomCount = useMemo(
        () => timetableEntries.filter((entry) => !entry?.room?.room_number).length,
        [timetableEntries]
    );

    const auditMetrics = useMemo(() => {
        if (qualitySnapshot) {
            return {
                totalEntries: Number(qualitySnapshot.totalEntries) || 0,
                missingRooms: Number(qualitySnapshot.missingRooms) || 0,
                nonOnlineMissing: Number(qualitySnapshot.nonOnlineMissing) || 0,
                onlineClasses: Number(qualitySnapshot.onlineClasses) || 0,
                isInferred: false,
                source: qualitySnapshot.source || 'upload',
                updatedAt: qualitySnapshot.updatedAt || null,
            };
        }

        return {
            totalEntries: stats.classes,
            missingRooms: dbMissingRoomCount,
            nonOnlineMissing: 0,
            onlineClasses: dbMissingRoomCount,
            isInferred: true,
            source: 'database-inferred',
            updatedAt: null,
        };
    }, [dbMissingRoomCount, qualitySnapshot, stats.classes]);

    const auditUpdatedLabel = useMemo(() => {
        if (!auditMetrics.updatedAt) return '';
        const timestamp = new Date(auditMetrics.updatedAt);
        if (Number.isNaN(timestamp.getTime())) return '';
        return timestamp.toLocaleString();
    }, [auditMetrics.updatedAt]);

    return (
        <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((card, index) => (
                    <article
                        key={card.label}
                        className="glass-panel-strong metric-card stagger-in p-5"
                        style={{
                            animationDelay: `${index * 80}ms`,
                            '--metric-accent': card.accent,
                        }}
                    >
                        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--ink-500)]">{card.label}</p>
                        {loading ? (
                            <div className="mt-3 h-9 w-20 animate-pulse rounded-md bg-[var(--surface)]" />
                        ) : (
                            <p className="mt-2 text-4xl font-bold text-[var(--ink-900)]">{card.value}</p>
                        )}
                    </article>
                ))}
            </section>

            {error && (
                <div className="glass-panel-strong alert-danger p-4 text-sm">
                    {error}
                </div>
            )}

            <section className="glass-panel p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="chip">Data Quality</p>
                        <h2 className="mt-3 text-2xl">Room Mapping Audit</h2>
                    </div>
                    {auditUpdatedLabel && (
                        <p className="text-xs text-[var(--ink-500)]">Last scan: {auditUpdatedLabel}</p>
                    )}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <article className="glass-panel-strong metric-card p-4" style={{ '--metric-accent': 'var(--accent-500)' }}>
                        <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-500)]">Total Entries</p>
                        <p className="mt-2 text-3xl font-bold text-[var(--ink-900)]">{auditMetrics.totalEntries}</p>
                    </article>
                    <article className="glass-panel-strong metric-card p-4" style={{ '--metric-accent': 'var(--warning-600)' }}>
                        <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-500)]">Missing Rooms</p>
                        <p className="mt-2 text-3xl font-bold text-[var(--ink-900)]">{auditMetrics.missingRooms}</p>
                    </article>
                    <article className="glass-panel-strong metric-card p-4" style={{ '--metric-accent': 'var(--danger-600)' }}>
                        <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-500)]">Non-Online Missing</p>
                        <p className="mt-2 text-3xl font-bold text-[var(--ink-900)]">{auditMetrics.nonOnlineMissing}</p>
                    </article>
                    <article className="glass-panel-strong metric-card p-4" style={{ '--metric-accent': 'var(--ok-600)' }}>
                        <p className="text-xs uppercase tracking-[0.12em] text-[var(--ink-500)]">Online Classes</p>
                        <p className="mt-2 text-3xl font-bold text-[var(--ink-900)]">{auditMetrics.onlineClasses}</p>
                    </article>
                </div>

                <p className="mt-4 text-xs text-[var(--ink-600)]">
                    {auditMetrics.isInferred
                        ? 'Values are inferred from current timetable rows. Run Upload (dry run or final) to refresh exact parser-based online vs non-online room gaps.'
                        : `Values are from the latest ${auditMetrics.source === 'dry-run' ? 'dry run' : 'upload'} parser audit.`}
                </p>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
                <article className="glass-panel p-6">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="chip">Analytics</p>
                            <h2 className="mt-3 text-2xl">Room Utilization</h2>
                        </div>
                        <p className="text-xs text-[var(--ink-500)]">Top occupied rooms</p>
                    </div>

                    {loading ? (
                        <div className="mt-5 space-y-3">
                            <div className="h-8 animate-pulse rounded-lg bg-[var(--surface)]" />
                            <div className="h-8 animate-pulse rounded-lg bg-[var(--surface)]" />
                            <div className="h-8 animate-pulse rounded-lg bg-[var(--surface)]" />
                        </div>
                    ) : roomChartData.length === 0 ? (
                        <div className="mt-5 rounded-lg border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-4 text-sm text-[var(--ink-600)]">
                            No room data available yet.
                        </div>
                    ) : (
                        <div className="mt-5 space-y-3">
                            {roomChartData.map((row) => (
                                <div key={row.name}>
                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                        <span className="font-medium text-[var(--ink-800)]">{row.name}</span>
                                        <span className="text-[var(--ink-600)]">{row.value} classes | {row.share}</span>
                                    </div>
                                    <div className="hbar"><span style={{ '--fill': row.fill }} /></div>
                                </div>
                            ))}
                        </div>
                    )}
                </article>

                <article className="glass-panel p-6">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="chip">Analytics</p>
                            <h2 className="mt-3 text-2xl">Faculty Load</h2>
                        </div>
                        <p className="text-xs text-[var(--ink-500)]">Top teaching load</p>
                    </div>

                    {loading ? (
                        <div className="mt-5 space-y-3">
                            <div className="h-8 animate-pulse rounded-lg bg-[var(--surface)]" />
                            <div className="h-8 animate-pulse rounded-lg bg-[var(--surface)]" />
                            <div className="h-8 animate-pulse rounded-lg bg-[var(--surface)]" />
                        </div>
                    ) : facultyChartData.length === 0 ? (
                        <div className="mt-5 rounded-lg border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-4 text-sm text-[var(--ink-600)]">
                            No faculty timetable load found yet.
                        </div>
                    ) : (
                        <div className="mt-5 space-y-3">
                            {facultyChartData.map((row) => (
                                <div key={row.name}>
                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                        <span className="truncate pr-3 font-medium text-[var(--ink-800)]">{row.name}</span>
                                        <span className="shrink-0 text-[var(--ink-600)]">{row.value} classes</span>
                                    </div>
                                    <div className="hbar"><span style={{ '--fill': row.fill }} /></div>
                                </div>
                            ))}
                        </div>
                    )}
                </article>
            </section>

            <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <div className="glass-panel p-6 md:p-7">
                    <p className="chip">Pipeline</p>
                    <h2 className="mt-3 text-2xl">Move Faster With Guided Actions</h2>
                    <p className="section-subtitle">
                        Start with import, validate outcomes, and switch straight into timetable inspection without leaving this flow.
                    </p>

                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-4">
                            <h3 className="text-lg">Bulk Upload</h3>
                            <p className="mt-2 text-sm text-[var(--ink-600)]">
                                Import session sheets and populate sections, faculty, rooms, and entries in one pass.
                            </p>
                            <Link to="/upload" className="btn-primary mt-4 w-full sm:w-auto">Open Upload Studio</Link>
                        </div>

                        <div className="rounded-xl border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-4">
                            <h3 className="text-lg">Timetable Explorer</h3>
                            <p className="mt-2 text-sm text-[var(--ink-600)]">
                                Query by section/faculty/room and inspect the week with smart cell-level detail cards.
                            </p>
                            <Link to="/timetables" className="btn-muted mt-4 inline-flex w-full justify-center sm:w-auto">
                                Explore Timetables
                            </Link>
                        </div>
                    </div>
                </div>

                <aside className="glass-panel p-6">
                    <p className="chip">Ops Notes</p>
                    <h2 className="mt-3 text-2xl">Ready Checks</h2>
                    <ul className="mt-4 space-y-3 text-sm text-[var(--ink-700)]">
                        <li className="rounded-lg border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-3">
                            Keep Excel headers exactly as provided by the scheduler template for highest parse accuracy.
                        </li>
                        <li className="rounded-lg border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-3">
                            Use dry-run mode before bulk import whenever a new semester format is introduced.
                        </li>
                        <li className="rounded-lg border border-[color:var(--surface-stroke)] bg-[var(--surface-strong)] p-3">
                            Resolve duplicate/constraint warnings from upload summary before final publish.
                        </li>
                    </ul>
                </aside>
            </section>
        </div>
    );
};

export default Dashboard;
