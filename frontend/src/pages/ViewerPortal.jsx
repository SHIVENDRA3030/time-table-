import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import api from '../services/api';
import TimetableGrid from '../components/TimetableGrid';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Viewer portal: a read-only, student-facing home. Published sections as cards;
// picking one opens the weekly grid with a day filter and a print view.
// With a `fixedSectionId` (students), it skips the picker and shows only their
// own section's published timetable.
const ViewerPortal = ({ fixedSectionId }) => {
    const [sections, setSections] = useState([]);
    const [entries, setEntries] = useState([]);
    const [timeSlots, setTimeSlots] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [dayFilter, setDayFilter] = useState('All');
    const [sectionUnavailable, setSectionUnavailable] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const locked = Boolean(fixedSectionId);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const [sectionsRes, entriesRes, slotsRes] = await Promise.all([
                    api.get('/programs/sections'),
                    api.get('/timetable'),
                    api.get('/timetable/time-slots'),
                ]);
                if (!active) return;
                const published = (Array.isArray(sectionsRes.data) ? sectionsRes.data : [])
                    .filter((s) => s.status === 'published');
                setSections(published);
                setEntries(Array.isArray(entriesRes.data) ? entriesRes.data : []);
                setTimeSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
                if (fixedSectionId) {
                    if (published.some((s) => s.id === fixedSectionId)) {
                        setSelectedId(fixedSectionId);
                    } else {
                        setSectionUnavailable(true);
                    }
                }
            } catch (err) {
                if (!active) return;
                setError(err?.response?.data?.error || 'Could not load published timetables.');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [fixedSectionId]);

    const countsBySection = useMemo(() => {
        const map = new Map();
        for (const entry of entries) {
            map.set(entry.section_id, (map.get(entry.section_id) || 0) + 1);
        }
        return map;
    }, [entries]);

    const sectionEntries = useMemo(
        () => (selectedId ? entries.filter((e) => e.section_id === selectedId) : []),
        [entries, selectedId]
    );

    const print = () => window.print();

    if (loading) {
        return (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => <div key={i} className="card h-32 animate-pulse" />)}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {error && <div className="card-strong alert-danger p-4 text-sm">{error}</div>}

            {sectionUnavailable && (
                <div className="card">
                    <div className="empty-state">
                        <span className="empty-state-glyph">⌖</span>
                        <p className="text-sm">
                            Your class timetable hasn&apos;t been published yet. Check back later; it will appear here
                            as soon as the office publishes it.
                        </p>
                    </div>
                </div>
            )}

            {selectedId ? (
                <section className="card p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                        {!locked && (
                            <button type="button" onClick={() => setSelectedId('')} className="btn-secondary">
                                <ArrowLeft size={14} weight="regular" /> All sections
                            </button>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            {['All', ...DAYS].map((day) => (
                                <button
                                    key={day}
                                    type="button"
                                    onClick={() => setDayFilter(day)}
                                    className={`chip ${dayFilter === day ? 'is-active' : ''}`}
                                >
                                    {day}
                                </button>
                            ))}
                            <button type="button" onClick={print} className="btn-primary">Print</button>
                        </div>
                    </div>

                    {(() => {
                        const section = sections.find((s) => s.id === selectedId);
                        return (
                            <div className="mt-5 print:mt-0">
                                <h2 className="text-2xl">{section?.name}</h2>
                                <p className="text-sm text-[var(--text-2)]">
                                    {section?.program?.name || ''} · {sectionEntries.length} classes per week
                                </p>
                                <div className="mt-4">
                                    <TimetableGrid
                                        timetableData={sectionEntries}
                                        timeSlots={timeSlots}
                                        highlightDay={dayFilter === 'All' ? null : dayFilter}
                                    />
                                </div>
                            </div>
                        );
                    })()}
                </section>
            ) : !locked ? (
                <>
                <section className="card p-6">
                    <p className="caption">Student view</p>
                    <h2 className="mt-3 text-2xl">Published timetables</h2>
                    <p className="section-subtitle mt-2">
                        Pick a class to see its weekly schedule. Only timetables the office has published appear here.
                    </p>
                </section>

                {sections.length === 0 ? (
                    <div className="card">
                        <div className="empty-state">
                            <span className="empty-state-glyph">⌖</span>
                            <p className="text-sm">No timetables have been published yet. Check back later.</p>
                        </div>
                    </div>
                ) : (
                    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {sections.map((section, index) => (
                            <button
                                key={section.id}
                                type="button"
                                onClick={() => { setSelectedId(section.id); setDayFilter('All'); }}
                                className="card-strong metric-card stagger-in p-5 text-left transition hover:shadow-lg"
                                style={{ animationDelay: `${index * 70}ms`, '--metric-accent': 'var(--text-1)' }}
                            >
                                <p className="caption">
                                    {section.program?.name || 'Program'}
                                </p>
                                <p className="mt-2 text-3xl font-bold text-[var(--text-1)]">{section.name}</p>
                                <p className="mt-1 text-sm text-[var(--text-2)]">
                                    {countsBySection.get(section.id) || 0} classes · Year {section.year}
                                    {section.advisor ? ` · ${section.advisor}` : ''}
                                </p>
                                <p className="mt-3 text-xs text-[var(--text-3)]">
                                    {section.published_at ? `Published ${new Date(section.published_at).toLocaleDateString()}` : ''}
                                </p>
                            </button>
                        ))}
                    </section>
                )}
                </>
            ) : null}
        </div>
    );
};

export default ViewerPortal;
