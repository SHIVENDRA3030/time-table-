// Timetable browse: view without a faculty link see published sections; faculty
// and staff can also browse by faculty member or room. Selecting a target opens
// the weekly list wired to a Neon Realtime live query (auto-refreshing).
import React, { useEffect, useMemo, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import api from '../services/api';
import { apiErrorMessage } from '../services/api';
import { useLiveTimetable } from '../services/realtime';
import { useSession } from '../context/SessionContext';
import { Card, Chip, ErrorText, Screen, SectionHeading, Spinner, T } from '../components/ui';
import { TimetableGrid } from '../components/TimetableGrid';
import type { TimetableEntry, TimeSlot } from '../components/TimetableGrid';
import { DAYS, spacing } from '../theme';

type Section = {
  id: string;
  name: string;
  year: number | null;
  advisor: string | null;
  status: string;
  published_at: string | null;
  program: { name: string } | null;
};

type Faculty = { id: string; name: string; department: string | null; email: string | null };
type Room = { id: string; room_number: string; building: string | null };

type ViewKind = 'section' | 'faculty' | 'room';
type Target = { kind: ViewKind; id: string; title: string; subtitle: string } | null;

const listEndpoint = (kind: ViewKind) =>
  kind === 'section' ? '/programs/sections' : kind === 'faculty' ? '/resources/faculty' : '/resources/rooms';

export const BrowseScreen = () => {
  const { me } = useSession();
  const isEditor = me?.role === 'admin' || me?.role === 'editor';
  const [kind, setKind] = useState<ViewKind>('section');
  const [items, setItems] = useState<(Section | Faculty | Room)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Target>(null);
  const [dayFilter, setDayFilter] = useState<string>('All');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .get(listEndpoint(kind))
      .then((res) => {
        if (!active) return;
        const rows = Array.isArray(res.data) ? res.data : [];
        setItems(kind === 'section' && !isEditor ? rows.filter((s: Section) => s.status === 'published') : rows);
      })
      .catch((err) => active && setError(apiErrorMessage(err, 'Could not load the list.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [kind, isEditor]);

  const itemTitle = (item: Section | Faculty | Room) =>
    kind === 'section' ? (item as Section).name : kind === 'faculty' ? (item as Faculty).name : (item as Room).room_number;

  const itemSubtitle = (item: Section | Faculty | Room) =>
    kind === 'section'
      ? `${(item as Section).program?.name || ''}${(item as Section).advisor ? ` · ${(item as Section).advisor}` : ''}`
      : kind === 'faculty'
        ? (item as Faculty).department || (item as Faculty).email || ''
        : (item as Room).building || '';

  if (target) {
    return <TimetableView target={target} onBack={() => setTarget(null)} dayFilter={dayFilter} setDayFilter={setDayFilter} />;
  }

  return (
    <Screen>
      <SectionHeading
        chip="Timetables"
        title="Browse schedules"
        subtitle="Pick a section, teacher, or room to see its weekly timetable — live."
      />

      <View style={styles.kindRow}>
        {(['section', 'faculty', 'room'] as ViewKind[]).map((k) => (
          <Chip key={k} label={k === 'section' ? 'Sections' : k === 'faculty' ? 'Faculty' : 'Rooms'} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Spinner label="Loading…" />
      ) : items.length === 0 ? (
        <Card>
          <T tone="ink600" style={styles.emptyText}>
            {kind === 'section' && !isEditor
              ? 'No timetables have been published yet. Check back later.'
              : 'Nothing to show here yet.'}
          </T>
        </Card>
      ) : (
        <View style={styles.grid}>
          {items.map((item) => (
            <Card key={item.id} strong style={styles.card}>
              <View style={styles.cardBody}>
                <View>
                  <T tone="ink500" style={styles.cardKicker}>{itemSubtitle(item) || (kind === 'section' ? 'Program' : ' ')}</T>
                  <T style={styles.cardTitle}>{itemTitle(item)}</T>
                </View>
                <Chip label="View →" onPress={() => setTarget({ kind, id: item.id, title: itemTitle(item), subtitle: itemSubtitle(item) })} />
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
};

const TimetableView = ({
  target,
  onBack,
  dayFilter,
  setDayFilter,
}: {
  target: NonNullable<Target>;
  onBack: () => void;
  dayFilter: string;
  setDayFilter: (day: string) => void;
}) => {
  const [fallback, setFallback] = useState<TimetableEntry[] | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([
      api.get(`/timetable/${target.kind}/${target.id}`),
      api.get('/timetable/time-slots'),
    ])
      .then(([entriesRes, slotsRes]) => {
        if (!active) return;
        setFallback(Array.isArray(entriesRes.data) ? entriesRes.data : []);
        setSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
      })
      .catch((err) => active && setError(apiErrorMessage(err, 'Could not load the timetable.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [target.kind, target.id]);

  // Live subscription refreshes rows whenever the office edits this timetable.
  const live = useLiveTimetable<TimetableEntry>(target.kind, target.id, fallback);

  const visible = useMemo(
    () => (dayFilter === 'All' ? live.rows : live.rows.filter((e) => e.day === dayFilter)),
    [live.rows, dayFilter]
  );

  return (
    <Screen>
      <Card style={styles.headerCard}>
        <Chip label="← All timetables" onPress={onBack} />
        <T style={styles.targetTitle}>{target.title}</T>
        {!!target.subtitle && <T tone="ink600" style={styles.targetSub}>{target.subtitle}</T>}
        <View style={styles.liveRow}>
          <View
            style={[
              styles.liveDot,
              { backgroundColor: live.state === 'live' ? '#34d399' : live.state === 'error' ? '#f43f5e' : '#fbbf24' },
            ]}
          />
          <T tone="ink600" style={styles.liveText}>
            {live.state === 'live'
              ? 'Live — updates automatically'
              : live.state === 'unavailable'
                ? 'Static snapshot'
                : live.state === 'error'
                  ? 'Live unavailable'
                  : 'Connecting…'}
          </T>
        </View>
      </Card>

      <View style={styles.dayRow}>
        {['All', ...DAYS].map((d) => (
          <Chip key={d} label={d} active={dayFilter === d} onPress={() => setDayFilter(d)} />
        ))}
      </View>

      <ErrorText>{error || live.error}</ErrorText>

      {loading ? (
        <Spinner label="Loading timetable…" />
      ) : (
        <TimetableGrid entries={visible} highlightDay={dayFilter} emptyText="No classes on this day." />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  kindRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  card: { flexBasis: '47%', flexGrow: 1 },
  cardBody: { gap: spacing.sm },
  cardKicker: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, opacity: 0.6 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginTop: 2 },
  emptyText: { fontSize: 14, opacity: 0.8 },
  headerCard: { gap: spacing.sm },
  targetTitle: { fontSize: 24, fontWeight: '700', marginTop: spacing.xs },
  targetSub: { fontSize: 13, opacity: 0.7 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 12, opacity: 0.7 },
  dayRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md, flexWrap: 'wrap' },
});
