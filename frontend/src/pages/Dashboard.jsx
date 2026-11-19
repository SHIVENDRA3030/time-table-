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
        { label: 'Active Sections', value: stats.sections },
        { label: 'Faculty Pool', value: stats.faculty },
        { label: 'Teaching Rooms', value: stats.rooms },
        { label: 'Scheduled Classes', value: stats.classes },
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
        return list.map((item) => {
            const sharePct = Math.round((item.value / total) * 100);
            return {
                ...item,
                fill: `${Math.max(8, Math.round((item.value / max) * 100))}%`,
                share: `${sharePct}%`,
                sharePct,
            };
        });
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

    const [aiInsight, setAiInsight] = useState('');
    const [aiModel, setAiModel] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');

    const loadAiInsight = async () => {
        setAiLoading(true);
        setAiError('');
        try {
            const res = await api.post('/ai/insights');
            setAiInsight(res.data.insight || '');
            setAiModel(res.data.model || '');
        } catch (err) {
            const status = err?.response?.status;
            const detail = err?.response?.data?.error;
            if (status === 403) {
                setAiError(`${detail || 'AI Gateway unavailable.'} Add AI Gateway credits on the Neon Billing page to enable model calls.`);
            } else {
                setAiError(detail || 'Could not load AI insights.');
            }
        } finally {
            setAiLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((card, index) => (
                    <article
                        key={card.label}
                        className="metric-card stagger-in"
                        style={{ animationDelay: `${index * 80}ms` }}
                    >
                        <p className="caption uppercase tracking-[0.05em]">{card.label}</p>
                        {loading ? (
                            <div className="mt-3 h-8 w-20 animate-pulse rounded bg-[var(--surface-2)]" />
                        ) : (
                            <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{card.value}</p>
                        )}
                    </article>
                ))}
            </section>

            {error && (
                <div className="alert-danger">
                    {error}
                </div>
            )}

            <section className="card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="caption">Data quality</p>
                        <h2 className="mt-1 text-[20px] leading-7">Room mapping audit</h2>
                    </div>
                    {auditUpdatedLabel && (
                        <p className="mono text-[11px] leading-[14px] text-[var(--text-3)]">Last scan: {auditUpdatedLabel}</p>
                    )}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-lg border border-[var(--line)] p-4">
                        <p className="caption uppercase tracking-[0.05em]">Total Entries</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{auditMetrics.totalEntries}</p>
                    </article>
                    <article className="rounded-lg border border-[var(--line)] p-4">
                        <p className="caption uppercase tracking-[0.05em]">Missing Rooms</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{auditMetrics.missingRooms}</p>
                    </article>
                    <article className="rounded-lg border border-[var(--line)] p-4">
                        <p className="caption uppercase tracking-[0.05em]">Non-Online Missing</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{auditMetrics.nonOnlineMissing}</p>
                    </article>
                    <article className="rounded-lg border border-[var(--line)] p-4">
                        <p className="caption uppercase tracking-[0.05em]">Online Classes</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{auditMetrics.onlineClasses}</p>
                    </article>
                </div>

                <p className="mt-4 text-xs text-[var(--text-2)]">
                    {auditMetrics.isInferred
                        ? 'Values are inferred from current timetable rows. Run an upload (dry run or final) to refresh the parser-based room gaps.'
                        : `Values are from the latest ${auditMetrics.source === 'dry-run' ? 'dry run' : 'upload'} parser audit.`}
                </p>
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
                <article className="card p-6">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="caption">Analytics</p>
                            <h2 className="mt-1 text-[20px] leading-7">Room utilization</h2>
                        </div>
                        <p className="caption">Top occupied rooms</p>
                    </div>

                    {loading ? (
                        <div className="mt-5 space-y-3">
                            <div className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
                            <div className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
                            <div className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
                        </div>
                    ) : roomChartData.length === 0 ? (
                        <p className="mt-5 text-sm text-[var(--text-2)]">No room data available yet.</p>
                    ) : (
                        <div className="mt-5 space-y-3">
                            {roomChartData.map((row) => (
                                <div key={row.name}>
                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                        <span className="font-medium text-[var(--text-1)]">{row.name}</span>
                                        <span className={`mono text-[var(--text-2)]${row.sharePct >= 90 ? ' text-[var(--warn)]' : ''}`}>
                                            {row.value} classes | {row.share}
                                        </span>
                                    </div>
                                    <div className={`hbar${row.sharePct >= 90 ? ' is-warn' : ''}`}>
                                        <span style={{ '--fill': row.fill }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </article>

                <article className="card p-6">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <p className="caption">Analytics</p>
                            <h2 className="mt-1 text-[20px] leading-7">Faculty load</h2>
                        </div>
                        <p className="caption">Top teaching load</p>
                    </div>

                    {loading ? (
                        <div className="mt-5 space-y-3">
                            <div className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
                            <div className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
                            <div className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
                        </div>
                    ) : facultyChartData.length === 0 ? (
                        <p className="mt-5 text-sm text-[var(--text-2)]">No faculty timetable load found yet.</p>
                    ) : (
                        <div className="mt-5 space-y-3">
                            {facultyChartData.map((row) => (
                                <div key={row.name}>
                                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                        <span className="truncate pr-3 font-medium text-[var(--text-1)]">{row.name}</span>
                                        <span className="mono shrink-0 text-[var(--text-2)]">{row.value} classes</span>
                                    </div>
                                    <div className="hbar"><span style={{ '--fill': row.fill }} /></div>
                                </div>
                            ))}
                        </div>
                    )}
                </article>
            </section>

            <section className="card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="caption">Neon AI Gateway</p>
                        <h2 className="mt-1 text-[20px] leading-7">AI workload insights</h2>
                    </div>
                    <button
                        type="button"
                        onClick={loadAiInsight}
                        disabled={aiLoading}
                        className="btn-primary"
                    >
                        {aiLoading ? 'Analyzing…' : 'Generate insights'}
                    </button>
                </div>

                {aiError && (
                    <div className="alert-warning mt-4" role="alert">
                        {aiError}
                    </div>
                )}

                {aiInsight && (
                    <div className="mt-4 rounded-lg border border-[var(--line)] p-4">
                        {aiModel && (
                            <p className="mono mb-2 text-[11px] leading-[14px] uppercase tracking-[0.05em] text-[var(--text-3)]">
                                Model: {aiModel}
                            </p>
                        )}
                        <p className="whitespace-pre-line text-sm leading-relaxed text-[var(--text-1)]">{aiInsight}</p>
                    </div>
                )}

                {!aiInsight && !aiError && (
                    <p className="mt-4 text-sm text-[var(--text-2)]">
                        Run the gateway-backed analysis to summarize faculty load and get a balancing suggestion.
                    </p>
                )}
            </section>

            <section className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <div className="card p-6 md:p-7">
                    <p className="caption">Pipeline</p>
                    <h2 className="mt-1 text-[20px] leading-7">Next steps</h2>
                    <p className="section-subtitle">
                        Import, validate outcomes, and inspect the timetable without leaving the flow.
                    </p>

                    <div className="mt-6 grid gap-4 sm:grid-cols-2">
                        <div className="rounded-lg border border-[var(--line)] p-4">
                            <h3 className="text-base">Bulk import</h3>
                            <p className="mt-2 text-sm text-[var(--text-2)]">
                                Import session sheets and populate sections, faculty, rooms, and entries in one pass.
                            </p>
                            <Link to="/admin/import" className="btn-primary mt-4 w-full sm:w-auto">Open Import</Link>
                        </div>

                        <div className="rounded-lg border border-[var(--line)] p-4">
                            <h3 className="text-base">Timetable explorer</h3>
                            <p className="mt-2 text-sm text-[var(--text-2)]">
                                Query by section, faculty, or room and inspect the weekly grid.
                            </p>
                            <Link to="/timetables" className="btn-secondary mt-4 inline-flex w-full justify-center sm:w-auto">
                                Explore timetables
                            </Link>
                        </div>
                    </div>
                </div>

                <aside className="card p-6">
                    <p className="caption">Ops notes</p>
                    <h2 className="mt-1 text-[20px] leading-7">Ready checks</h2>
                    <ul className="mt-4 space-y-3 text-sm text-[var(--text-2)]">
                        <li className="rounded-lg border border-[var(--line)] p-3">
                            Keep Excel headers exactly as provided by the scheduler template for highest parse accuracy.
                        </li>
                        <li className="rounded-lg border border-[var(--line)] p-3">
                            Use dry-run mode before bulk import whenever a new semester format is introduced.
                        </li>
                        <li className="rounded-lg border border-[var(--line)] p-3">
                            Resolve duplicate and constraint warnings from the upload summary before final publish.
                        </li>
                    </ul>
                </aside>
            </section>
        </div>
    );
};

export default Dashboard;
