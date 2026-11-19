import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import api from '../services/api';
import { realtimeClient, renewBeforeExpiry } from '../services/realtime';
import { useToasts, ToastContainer } from '../components/Toast';
import { useMe } from '../context/MeContext';
import TimetableGrid from '../components/TimetableGrid';
import EditEntryModal from '../components/EditEntryModal';

const DAY_FILTERS = ['All', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const viewLabels = {
    section: 'Section',
    faculty: 'Faculty',
    room: 'Room',
};

const getListEndpoint = (viewType) => {
    if (viewType === 'section') return '/programs/sections';
    if (viewType === 'faculty') return '/resources/faculty';
    return '/resources/rooms';
};

const normalizeForSearch = (value) =>
    String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const toTokens = (value) => normalizeForSearch(value).split(' ').filter(Boolean);

const isSubsequence = (needle, haystack) => {
    if (!needle) return false;
    let i = 0;
    for (let j = 0; j < haystack.length; j += 1) {
        if (needle[i] === haystack[j]) i += 1;
        if (i === needle.length) return true;
    }
    return false;
};

const getItemLabel = (item) => item?.name || item?.room_number || item?.code || 'Unknown';

const getSearchFields = (item, viewType) => {
    const primary = getItemLabel(item);
    const extra = [
        item?.code,
        item?.room_number,
        item?.department,
        item?.email,
        item?.program?.name,
        viewType === 'section' ? item?.advisor : '',
    ].filter(Boolean);

    return {
        primary,
        fields: [primary, ...extra].map(normalizeForSearch)
    };
};

const scoreItem = (item, query, viewType) => {
    const cleanedQuery = normalizeForSearch(query);
    if (!cleanedQuery) return { score: 0, reason: '' };

    const { primary, fields } = getSearchFields(item, viewType);
    const primaryNorm = normalizeForSearch(primary);
    const queryTokens = toTokens(cleanedQuery);

    let score = 0;
    let reason = '';

    if (primaryNorm === cleanedQuery) {
        score += 120;
        reason = 'Exact';
    } else if (primaryNorm.startsWith(cleanedQuery)) {
        score += 90;
        reason = 'Starts with';
    } else if (primaryNorm.includes(cleanedQuery)) {
        score += 65;
        reason = 'Contains';
    }

    const joinedFields = fields.join(' ');
    const matchedTokens = queryTokens.filter((token) => joinedFields.includes(token));
    score += matchedTokens.length * 12;
    if (!reason && matchedTokens.length === queryTokens.length && queryTokens.length > 1) {
        reason = 'Token match';
    }

    const compactQuery = cleanedQuery.replace(/\s+/g, '');
    const compactPrimary = primaryNorm.replace(/\s+/g, '');
    if (isSubsequence(compactQuery, compactPrimary)) {
        score += 18;
        if (!reason) reason = 'Fuzzy';
    }

    const queryAcronym = queryTokens.map((t) => t[0]).join('');
    const primaryAcronym = primaryNorm.split(' ').filter(Boolean).map((t) => t[0]).join('');
    if (queryAcronym && primaryAcronym.startsWith(queryAcronym)) {
        score += 15;
        if (!reason) reason = 'Acronym';
    }

    if (score === 0) return { score: 0, reason: '' };

    const firstIndex = primaryNorm.indexOf(cleanedQuery);
    if (firstIndex > 0) score -= Math.min(firstIndex, 12);

    return { score, reason: reason || 'Match' };
};

const highlightMatch = (text, query) => {
    const source = String(text || '');
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return source;

    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'ig');
    const parts = source.split(regex);

    if (parts.length === 1) return source;

    const loweredQuery = cleanQuery.toLowerCase();

    return parts.map((part, index) => (
        part.toLowerCase() === loweredQuery ? (
            <mark key={`${part}-${index}`} className="rounded bg-[var(--surface-2)] px-0.5 text-[var(--text-1)]">
                {part}
            </mark>
        ) : (
            <span key={`${part}-${index}`}>{part}</span>
        )
    ));
};

// Toast hook
const Timetables = () => {
    const [viewType, setViewType] = useState('section');
    const [selectedId, setSelectedId] = useState('');
    const [list, setList] = useState([]);
    const [searchText, setSearchText] = useState('');
    const [dayFilter, setDayFilter] = useState('All');
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
    const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.innerWidth < 768;
    });

    const [listLoading, setListLoading] = useState(false);
    const [tableLoading, setTableLoading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [listError, setListError] = useState('');
    const [tableError, setTableError] = useState('');
    const [timetable, setTimetable] = useState([]);
    const hideSuggestionsTimerRef = useRef(null);

    // Resource lists for edit modal
    const [allSubjects, setAllSubjects] = useState([]);
    const [allFaculty, setAllFaculty] = useState([]);
    const [allRooms, setAllRooms] = useState([]);
    const [allTimeSlots, setAllTimeSlots] = useState([]);
    const [allSections, setAllSections] = useState([]);

    // Edit modal state
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingEntry, setEditingEntry] = useState(null);
    const [addPrefill, setAddPrefill] = useState({ day: null, timeSlotId: null });

    // Toast
    // Toasts now come from the shared Toast module
    const { toasts, addToast } = useToasts();
    const { me } = useMe();
    const canSeeDrafts = me?.role === 'admin' || me?.role === 'editor';
    const canEdit = canSeeDrafts;

    // Fetch resource lists for modal dropdowns (once on mount)
    useEffect(() => {
        let active = true;

        const fetchResources = async () => {
            try {
                const [subjectsRes, facultyRes, roomsRes, timeSlotsRes, sectionsRes] = await Promise.all([
                    api.get('/resources/subjects'),
                    api.get('/resources/faculty'),
                    api.get('/resources/rooms'),
                    api.get('/timetable/time-slots'),
                    api.get('/programs/sections'),
                ]);

                if (!active) return;
                setAllSubjects(Array.isArray(subjectsRes.data) ? subjectsRes.data : []);
                setAllFaculty(Array.isArray(facultyRes.data) ? facultyRes.data : []);
                setAllRooms(Array.isArray(roomsRes.data) ? roomsRes.data : []);
                setAllTimeSlots(Array.isArray(timeSlotsRes.data) ? timeSlotsRes.data : []);
                setAllSections(Array.isArray(sectionsRes.data) ? sectionsRes.data : []);
            } catch (err) {
                console.warn('Failed to fetch resources for edit modal:', err);
            }
        };

        fetchResources();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        let active = true;

        const fetchList = async () => {
            setListLoading(true);
            setListError('');
            setList([]);
            setSelectedId('');
            setTimetable([]);
            setSearchText('');
            setDayFilter('All');
            setShowSuggestions(false);
            setActiveSuggestionIndex(-1);
            setMobileSheetOpen(false);

            try {
                const response = await api.get(getListEndpoint(viewType));
                if (!active) return;
                let data = Array.isArray(response.data) ? response.data : [];
                // Viewers (and unassigned users) only see published sections.
                if (viewType === 'section' && !canSeeDrafts) {
                    data = data.filter((item) => item.status === 'published');
                }
                setList(data);
            } catch (error) {
                if (!active) return;
                setListError(error?.response?.data?.error || 'Failed to fetch resource list.');
            } finally {
                if (active) setListLoading(false);
            }
        };

        fetchList();
        return () => {
            active = false;
        };
    }, [viewType, canSeeDrafts]);

    const fetchTimetable = useCallback(async () => {
        if (!selectedId) return;

        setTableLoading(true);
        setTableError('');
        setTimetable([]);

        try {
            const response = await api.get(`/timetable/${viewType}/${selectedId}`);
            setTimetable(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            setTableError(error?.response?.data?.error || 'Failed to fetch timetable.');
        } finally {
            setTableLoading(false);
        }
    }, [selectedId, viewType]);

    useEffect(() => {
        if (!selectedId) return;
        fetchTimetable();
    }, [selectedId, viewType, fetchTimetable]);

    // Neon Realtime: keep the open timetable live. The backend seals a query scoped
    // to the selected section/faculty/room; committed changes stream into state.
    const fetchSealedTimetable = useCallback(async () => {
        const response = await api.post(`/realtime/${viewType}/${selectedId}`);
        return response.data;
    }, [selectedId, viewType]);

    useEffect(() => {
        if (!selectedId) return;
        let active = true;
        let subscription;
        let stopRenewal;

        (async () => {
            let sealed;
            try {
                sealed = await fetchSealedTimetable();
            } catch (err) {
                console.warn('Realtime seal failed:', err?.response?.data?.error || err?.message);
                return;
            }
            if (!active) return;

            subscription = realtimeClient.subscribe(sealed);
            subscription.onChange((snapshot) => {
                if (!active) return;
                if (Array.isArray(snapshot.data)) {
                    setTimetable(snapshot.data);
                    setTableError('');
                }
            });
            subscription.onStateChange((state) => {
                if (!active) return;
                if (state.status === 'error') {
                    console.warn('Realtime subscription error:', state.error?.message);
                }
            });
            stopRenewal = renewBeforeExpiry(subscription, sealed, fetchSealedTimetable);
        })();

        return () => {
            active = false;
            if (stopRenewal) stopRenewal();
            if (subscription) subscription.unsubscribe();
        };
    }, [selectedId, viewType, fetchSealedTimetable]);

    useEffect(() => () => {
        if (hideSuggestionsTimerRef.current) {
            window.clearTimeout(hideSuggestionsTimerRef.current);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleResize = () => {
            setIsMobileViewport(window.innerWidth < 768);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (typeof document === 'undefined') return undefined;

        if (mobileSheetOpen && isMobileViewport) {
            const previous = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            return () => {
                document.body.style.overflow = previous;
            };
        }

        return undefined;
    }, [mobileSheetOpen, isMobileViewport]);

    const rankedResults = useMemo(() => {
        const query = searchText.trim();
        if (!query) return [];

        return list
            .map((item) => {
                const { score, reason } = scoreItem(item, query, viewType);
                return {
                    item,
                    score,
                    reason,
                    label: getItemLabel(item),
                    meta: item?.program?.name || item?.department || item?.email || item?.code || item?.room_number || '',
                };
            })
            .filter((entry) => entry.score > 0)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return String(a.label).localeCompare(String(b.label));
            });
    }, [list, searchText, viewType]);

    const suggestions = useMemo(() => rankedResults.slice(0, 8), [rankedResults]);

    const filteredList = useMemo(() => {
        if (!searchText.trim()) return list;
        return rankedResults.map((entry) => entry.item);
    }, [list, searchText, rankedResults]);

    const selectedItem = useMemo(
        () => list.find((item) => String(item.id) === String(selectedId)),
        [list, selectedId]
    );

    const stats = useMemo(() => {
        const subjectCodes = new Set();
        const facultyNames = new Set();
        const rooms = new Set();

        timetable.forEach((entry) => {
            if (entry.subject?.code) subjectCodes.add(entry.subject.code);
            if (entry.faculty?.name) facultyNames.add(entry.faculty.name);
            if (entry.room?.room_number) rooms.add(entry.room.room_number);
        });

        return {
            classes: timetable.length,
            subjects: subjectCodes.size,
            faculty: facultyNames.size,
            rooms: rooms.size,
        };
    }, [timetable]);

    // ── Edit / Delete / Add handlers ──

    const handleEditEntry = (entry) => {
        setEditingEntry(entry);
        setAddPrefill({ day: null, timeSlotId: null });
        setEditModalOpen(true);
    };

    const handleAddEntry = (day, timeSlotId) => {
        setEditingEntry(null);
        setAddPrefill({ day, timeSlotId });
        setEditModalOpen(true);
    };

    const handleDeleteEntry = async (entryId) => {
        try {
            await api.delete(`/timetable/${entryId}`);
            addToast('Entry deleted successfully.', 'success');
            fetchTimetable();
        } catch (err) {
            const msg = err?.response?.data?.error || 'Failed to delete entry.';
            addToast(msg, 'error');
        }
    };

    const handleDropEntry = async (entryId, targetDay, targetTimeSlotId) => {
        try {
            // Find the entry to get its existing details to update just day and time_slot_id
            const entry = timetable.find((e) => String(e.id) === String(entryId));
            if (!entry) return;

            const payload = {
                section_id: entry.section_id,
                subject_id: entry.subject_id,
                faculty_id: entry.faculty_id,
                room_id: entry.room_id || null,
                day: targetDay,
                time_slot_id: targetTimeSlotId,
            };

            await api.put(`/timetable/${entryId}`, payload);
            addToast('Entry moved successfully.', 'success');
            fetchTimetable();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Failed to move entry due to a conflict.', 'error');
        }
    };

    const handleSaveEntry = async (formData, existingId) => {
        if (existingId) {
            // Update
            await api.put(`/timetable/${existingId}`, formData);
            addToast('Entry updated successfully.', 'success');
        } else {
            // Create
            await api.post('/timetable', formData);
            addToast('New entry created successfully.', 'success');
        }
        fetchTimetable();
    };

    const handleCloseModal = () => {
        setEditModalOpen(false);
        setEditingEntry(null);
    };

    const handleGenerate = async () => {
        setGenerating(true);
        addToast('Generating optimal schedule around existing classes. Please wait...', 'info');
        try {
            const res = await api.post('/timetable/generate', {});
            addToast(`Schedule generated. ${res.data.entriesCreated === 0 ? res.data.message : `Created ${res.data.entriesCreated} timetable entries.`}`, 'success');
            fetchTimetable();
        } catch (err) {
            addToast(err?.response?.data?.error || 'Failed to generate schedule.', 'error');
        } finally {
            setGenerating(false);
        }
    };

    // ── Search handlers ──

    const selectSuggestion = (suggestion) => {
        setSelectedId(String(suggestion.item.id));
        setSearchText(suggestion.label);
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
        setMobileSheetOpen(false);
    };

    const handleSearchFocus = () => {
        if (isMobileViewport) {
            setMobileSheetOpen(true);
            setShowSuggestions(true);
            return;
        }

        if (searchText.trim()) setShowSuggestions(true);
    };

    const handleSearchBlur = () => {
        if (isMobileViewport) return;

        hideSuggestionsTimerRef.current = window.setTimeout(() => {
            setShowSuggestions(false);
            setActiveSuggestionIndex(-1);
        }, 120);
    };

    const handleSearchKeyDown = (e) => {
        if (!showSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            setShowSuggestions(true);
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveSuggestionIndex((prev) => {
                const next = prev + 1;
                return next >= suggestions.length ? 0 : next;
            });
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveSuggestionIndex((prev) => {
                if (prev <= 0) return suggestions.length - 1;
                return prev - 1;
            });
            return;
        }

        if (e.key === 'Enter' && suggestions.length > 0) {
            e.preventDefault();
            const selectedSuggestion = suggestions[activeSuggestionIndex] || suggestions[0];
            if (selectedSuggestion) {
                selectSuggestion(selectedSuggestion);
            }
            return;
        }

        if (e.key === 'Escape') {
            setShowSuggestions(false);
            setActiveSuggestionIndex(-1);
            setMobileSheetOpen(false);
        }
    };

    const searchHasQuery = Boolean(searchText.trim());
    const showSuggestionPanel = showSuggestions && searchHasQuery && !isMobileViewport;
    const showMobileSheet = mobileSheetOpen && isMobileViewport;

    const closeMobileSheet = () => {
        setMobileSheetOpen(false);
        setShowSuggestions(false);
        setActiveSuggestionIndex(-1);
    };

    return (
        <div className="space-y-6">
            <section className="card p-6 md:p-7">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h2 className="text-2xl">Find a timetable</h2>
                        <p className="section-subtitle mt-2">
                            Choose a view, search, and filter by day.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                        {canEdit && (
                            <button
                                type="button"
                                onClick={handleGenerate}
                                disabled={generating}
                                className="btn-primary"
                            >
                                {generating ? 'Generating...' : 'Auto generate'}
                            </button>
                        )}
                        {Object.entries(viewLabels).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setViewType(key)}
                                className={`chip ${viewType === key ? 'is-active' : ''}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="block">
                        <div className="mb-1 flex items-center justify-between gap-3">
                            <span className="block text-sm font-semibold text-[var(--text-2)]">Search</span>
                            <div className="flex items-center gap-2">
                                {isMobileViewport && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setMobileSheetOpen(true);
                                            setShowSuggestions(true);
                                        }}
                                        className="text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text-1)]"
                                    >
                                        Open search
                                    </button>
                                )}
                                {searchHasQuery && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchText('');
                                            setShowSuggestions(false);
                                            setActiveSuggestionIndex(-1);
                                        }}
                                        className="text-xs font-semibold text-[var(--text-2)] hover:text-[var(--text-1)]"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                        <input
                            value={searchText}
                            onChange={(e) => {
                                setSearchText(e.target.value);
                                setShowSuggestions(Boolean(e.target.value.trim()));
                                setActiveSuggestionIndex(-1);
                            }}
                            onFocus={handleSearchFocus}
                            onBlur={handleSearchBlur}
                            onKeyDown={handleSearchKeyDown}
                            className="input-shell"
                            placeholder={`Find ${viewLabels[viewType].toLowerCase()}...`}
                            autoComplete="off"
                            readOnly={isMobileViewport}
                        />

                        {showSuggestionPanel && (
                            <div className="mt-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] shadow-lg">
                                <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2 text-xs">
                                    <span className="font-semibold text-[var(--text-2)]">
                                        Suggestions
                                    </span>
                                    <span className="text-[var(--text-2)]">
                                        {suggestions.length} shown
                                    </span>
                                </div>
                                <div className="soft-scroll max-h-60 overflow-auto p-1 sm:max-h-72">
                                {suggestions.length > 0 ? (
                                    suggestions.map((suggestion, index) => (
                                        <button
                                            key={suggestion.item.id}
                                            type="button"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => selectSuggestion(suggestion)}
                                            className={`w-full rounded-lg px-3 py-2 text-left transition ${index === activeSuggestionIndex
                                                ? 'bg-[var(--surface-2)]'
                                                : 'hover:bg-[var(--surface-2)]'}`}
                                        >
                                            <div className="flex items-start justify-between gap-2 sm:items-center">
                                                <p className="truncate text-sm font-semibold text-[var(--text-1)]">
                                                    {highlightMatch(suggestion.label, searchText)}
                                                </p>
                                                <span className="hidden chip !py-1 text-[10px] sm:inline-flex">
                                                    {suggestion.reason}
                                                </span>
                                            </div>
                                            {suggestion.meta && (
                                                <p className="mt-1 truncate text-xs text-[var(--text-2)]">{suggestion.meta}</p>
                                            )}
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-3 py-2 text-sm text-[var(--text-2)]">
                                        No close matches found. Try shorter keywords.
                                    </div>
                                )}
                                </div>
                            </div>
                        )}
                    </label>

                    <label className="block">
                        <span className="mb-1 block text-sm font-semibold text-[var(--text-2)]">Select {viewLabels[viewType]}</span>
                        <select
                            className="input-shell"
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                            disabled={listLoading || filteredList.length === 0}
                        >
                            <option value="">-- Choose --</option>
                            {filteredList.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name || item.room_number || item.code}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    {DAY_FILTERS.map((day) => (
                        <button
                            key={day}
                            type="button"
                            onClick={() => setDayFilter(day)}
                            className={`chip ${dayFilter === day ? 'is-active' : ''}`}
                        >
                            {day}
                        </button>
                    ))}
                </div>

                {listError && (
                    <div className="alert-danger mt-4 rounded-lg px-4 py-3 text-sm">
                        {listError}
                    </div>
                )}
            </section>

            {selectedId && (
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <article className="rounded-lg border border-[var(--line)] p-3">
                        <p className="caption">Selected</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">
                            {selectedItem?.name || selectedItem?.room_number || selectedItem?.code || 'Unknown'}
                        </p>
                    </article>
                    <article className="rounded-lg border border-[var(--line)] p-3">
                        <p className="caption">Classes</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{stats.classes}</p>
                    </article>
                    <article className="rounded-lg border border-[var(--line)] p-3">
                        <p className="caption">Subjects</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{stats.subjects}</p>
                    </article>
                    <article className="rounded-lg border border-[var(--line)] p-3">
                        <p className="caption">Rooms referenced</p>
                        <p className="mono mt-2 text-[22px] leading-7 font-medium text-[var(--text-1)]">{stats.rooms}</p>
                    </article>
                </section>
            )}

            {tableError && (
                <div className="alert-danger rounded-lg px-4 py-3 text-sm">
                    {tableError}
                </div>
            )}

            {tableLoading ? (
                <div className="card p-6">
                    <div className="space-y-3">
                        <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                        <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                        <div className="h-10 animate-pulse rounded-lg bg-[var(--surface-2)]" />
                    </div>
                </div>
            ) : selectedId && timetable.length > 0 ? (
                <TimetableGrid
                    timetableData={timetable}
                    highlightDay={dayFilter === 'All' ? null : dayFilter}
                    editable={canEdit}
                    onEditEntry={handleEditEntry}
                    onDeleteEntry={handleDeleteEntry}
                    onAddEntry={handleAddEntry}
                    onDropEntry={handleDropEntry}
                />
            ) : selectedId ? (
                <div className="card">
                    <div className="empty-state">
                        <span className="empty-state-glyph">⌖</span>
                        <p className="text-sm">No timetable entries found for this selection.</p>
                        {viewType === 'section' && (
                            <button
                                type="button"
                                className="btn-primary text-sm"
                                onClick={() => handleAddEntry('Monday', null)}
                            >
                                <Plus size={14} weight="regular" /> Add
                            </button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="empty-state">
                        <span className="empty-state-glyph">⌖</span>
                        <p className="text-sm">
                            Select a {viewLabels[viewType].toLowerCase()} to open the weekly timetable grid.
                        </p>
                    </div>
                </div>
            )}

            {/* Mobile search sheet */}
            {showMobileSheet && (
                <div
                    className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] md:hidden"
                    onClick={closeMobileSheet}
                >
                    <div
                        className="sheet-up absolute inset-x-0 bottom-0 flex h-[84dvh] flex-col rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-[var(--text-3)]/40" />
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-[var(--text-1)]">Search</p>
                                <p className="text-xs text-[var(--text-2)]">
                                    Find and jump to any {viewLabels[viewType].toLowerCase()}.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeMobileSheet}
                                className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold text-[var(--text-2)]"
                            >
                                Close
                            </button>
                        </div>

                        <input
                            value={searchText}
                            onChange={(e) => {
                                setSearchText(e.target.value);
                                setShowSuggestions(Boolean(e.target.value.trim()));
                                setActiveSuggestionIndex(-1);
                            }}
                            onKeyDown={handleSearchKeyDown}
                            className="input-shell"
                            placeholder={`Find ${viewLabels[viewType].toLowerCase()}...`}
                            autoComplete="off"
                            autoFocus
                        />

                        <div className="mt-3 flex items-center justify-between text-xs">
                            <span className="font-semibold text-[var(--text-2)]">Suggestions</span>
                            <span className="text-[var(--text-2)]">{suggestions.length} shown</span>
                        </div>

                        <div className="soft-scroll mt-2 flex-1 overflow-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1">
                            {searchHasQuery ? (
                                suggestions.length > 0 ? (
                                    suggestions.map((suggestion, index) => (
                                        <button
                                            key={`mobile-${suggestion.item.id}`}
                                            type="button"
                                            onClick={() => selectSuggestion(suggestion)}
                                            className={`w-full rounded-lg px-3 py-2 text-left transition ${index === activeSuggestionIndex
                                                ? 'bg-[var(--surface-2)]'
                                                : 'hover:bg-[var(--surface-2)]'}`}
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <p className="truncate text-sm font-semibold text-[var(--text-1)]">
                                                    {highlightMatch(suggestion.label, searchText)}
                                                </p>
                                                <span className="chip !py-1 text-[10px]">{suggestion.reason}</span>
                                            </div>
                                            {suggestion.meta && (
                                                <p className="mt-1 truncate text-xs text-[var(--text-2)]">{suggestion.meta}</p>
                                            )}
                                        </button>
                                    ))
                                ) : (
                                    <div className="px-3 py-3 text-sm text-[var(--text-2)]">
                                        No close matches found. Try shorter keywords.
                                    </div>
                                )
                            ) : (
                                <div className="px-3 py-3 text-sm text-[var(--text-2)]">
                                    Start typing to see suggestions.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Edit / Add Modal */}
            <EditEntryModal
                isOpen={editModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveEntry}
                entry={editingEntry}
                prefillDay={addPrefill.day}
                prefillTimeSlotId={addPrefill.timeSlotId}
                prefillSectionId={viewType === 'section' ? selectedId : null}
                subjects={allSubjects}
                faculty={allFaculty}
                rooms={allRooms}
                timeSlots={allTimeSlots}
                sections={allSections}
            />

            {/* Toasts */}
            <ToastContainer toasts={toasts} />
        </div>
    );
};

export default Timetables;
