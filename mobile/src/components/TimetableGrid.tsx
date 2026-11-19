// Weekly timetable for phones: the web app's grid becomes a day-grouped list
// (a 6-column grid is unusable at phone widths). Entries render as cards under
// day headings, sorted by period; an optional action opens per-entry actions.
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { DAYS, spacing } from '../theme';
import type { Theme } from '../theme';

export type TimetableEntry = {
  id?: string;
  day: string;
  section_id: string;
  subject_id: string;
  faculty_id: string | null;
  room_id: string | null;
  time_slot_id: string;
  section?: { name: string } | null;
  subject?: { name: string | null; code: string | null } | null;
  faculty?: { name: string | null } | null;
  room?: { room_number: string | null } | null;
  time_slot?: { start_time: string; end_time: string; slot_number: number | null } | null;
};

export type TimeSlot = {
  id: string;
  slot_number: number | null;
  start_time: string;
  end_time: string;
};

const formatTime = (timeValue?: string | null) => {
  if (!timeValue) return '--:--';
  const match = String(timeValue).trim().match(/^(\d{2}:\d{2})/);
  return match ? match[1] : String(timeValue);
};

const slotNumber = (entry: TimetableEntry) => Number(entry.time_slot?.slot_number ?? 99);

export const TimetableGrid = ({
  entries,
  highlightDay = null,
  onPressEntry = null,
  emptyText = 'No classes scheduled.',
}: {
  entries: TimetableEntry[];
  highlightDay?: string | null;
  onPressEntry?: ((entry: TimetableEntry) => void) | null;
  emptyText?: string;
}) => {
  const { theme } = useTheme();
  const days = highlightDay && highlightDay !== 'All' ? [highlightDay] : [...DAYS];

  const grouped = useMemo(() => {
    const map = new Map<string, TimetableEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.day) || [];
      list.push(entry);
      map.set(entry.day, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => slotNumber(a) - slotNumber(b) || formatTime(a.time_slot?.start_time).localeCompare(formatTime(b.time_slot?.start_time)));
    }
    return days.map((day) => ({ day, items: map.get(day) || [] }));
  }, [entries, days.join('|')]);

  if (entries.length === 0) {
    return (
      <View style={styles(theme).empty}>
        <Text style={[styles(theme).emptyText, { color: theme.ink500 }]}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View style={styles(theme).wrap}>
      {grouped.map(({ day, items }) => (
        <View key={day} style={styles(theme).dayBlock}>
          <View style={styles(theme).dayHeader}>
            <Text style={[styles(theme).dayText, { color: theme.ink700 }]}>{day}</Text>
            <View style={[styles(theme).dayRule, { backgroundColor: theme.stroke }]} />
            <Text style={[styles(theme).dayCount, { color: theme.ink500 }]}>{items.length}</Text>
          </View>
          {items.length === 0 ? (
            <Text style={[styles(theme).freeText, { color: theme.ink500 }]}>Free day</Text>
          ) : (
            <View style={styles(theme).list}>
              {items.map((entry, index) => (
                <EntryCard
                  key={entry.id || `${day}-${index}`}
                  entry={entry}
                  onPress={onPressEntry ? () => onPressEntry(entry) : undefined}
                />
              ))}
            </View>
          )}
        </View>
      ))}
    </View>
  );
};

const EntryCard = ({ entry, onPress }: { entry: TimetableEntry; onPress?: () => void }) => {
  const { theme } = useTheme();
  const start = formatTime(entry.time_slot?.start_time);
  const end = formatTime(entry.time_slot?.end_time);
  const body = (
    <>
      <View style={styles(theme).timeCol}>
        <Text style={[styles(theme).timeText, { color: theme.accent700 }]}>{start}</Text>
        <Text style={[styles(theme).timeSub, { color: theme.ink500 }]}>{end}</Text>
      </View>
      <View style={[styles(theme).divider, { backgroundColor: theme.stroke }]} />
      <View style={styles(theme).infoCol}>
        <View style={styles(theme).titleRow}>
          {entry.subject?.code ? (
            <View style={[styles(theme).codeBadge, { backgroundColor: theme.accent100 }]}>
              <Text style={[styles(theme).codeText, { color: theme.accent700 }]}>{entry.subject.code}</Text>
            </View>
          ) : null}
          <Text numberOfLines={2} style={[styles(theme).subjectText, { color: theme.ink900 }]}>
            {entry.subject?.name || 'Class'}
          </Text>
        </View>
        <Text numberOfLines={1} style={[styles(theme).metaText, { color: theme.ink600 }]}>
          {[entry.section?.name, entry.room?.room_number ? `Room ${entry.room.room_number}` : null]
            .filter(Boolean)
            .join(' · ') || ' '}
        </Text>
        {entry.faculty?.name ? (
          <Text numberOfLines={1} style={[styles(theme).metaText, { color: theme.ink500 }]}>
            {entry.faculty.name}
          </Text>
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles(theme).entry}>{body}</View>;
  }
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles(theme).entry, pressed && { opacity: 0.75 }]}>
      {body}
    </Pressable>
  );
};

const styles = (t: Theme) =>
  StyleSheet.create({
    wrap: { gap: spacing.lg },
    dayBlock: { gap: spacing.sm },
    dayHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    dayText: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
    dayRule: { flex: 1, height: 1 },
    dayCount: { fontSize: 12, fontWeight: '600' },
    freeText: { fontSize: 13, fontStyle: 'italic' },
    list: { gap: spacing.sm },
    empty: { padding: spacing.xl, alignItems: 'center' },
    emptyText: { fontSize: 14 },
    entry: {
      flexDirection: 'row',
      backgroundColor: t.surface,
      borderColor: t.stroke,
      borderWidth: 1,
      borderRadius: 14,
      padding: spacing.md,
      gap: spacing.md,
    },
    timeCol: { width: 52, justifyContent: 'center', gap: 2 },
    timeText: { fontSize: 14, fontWeight: '700' },
    timeSub: { fontSize: 12 },
    divider: { width: 1, alignSelf: 'stretch' },
    infoCol: { flex: 1, gap: 3 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
    codeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    codeText: { fontSize: 11, fontWeight: '800' },
    subjectText: { fontSize: 15, fontWeight: '600', flex: 1 },
    metaText: { fontSize: 12.5 },
  });
