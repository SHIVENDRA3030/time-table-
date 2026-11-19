// Faculty portal: the signed-in teacher's own schedule with workload progress,
// plus a change-request sheet (reschedule / cancel) mirroring the web modal.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import api from '../services/api';
import { apiErrorMessage } from '../services/api';
import { useSession } from '../context/SessionContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import { Button, Card, Chip, ErrorText, Input, Label, Screen, SectionHeading, Spinner, T } from '../components/ui';
import { TimetableGrid } from '../components/TimetableGrid';
import type { TimeSlot, TimetableEntry } from '../components/TimetableGrid';
import { DAYS, spacing } from '../theme';

type Workload = {
  id: string;
  lectures_per_week: number;
  section: { id: string; name: string } | null;
  subject: { id: string; code: string | null; name: string } | null;
  faculty: { id: string; name: string } | null;
};

type Room = { id: string; room_number: string; building: string | null };

const RequestSheet = ({
  entry,
  slots,
  rooms,
  onClose,
  onSubmitted,
}: {
  entry: TimetableEntry;
  slots: TimeSlot[];
  rooms: Room[];
  onClose: () => void;
  onSubmitted: () => void;
}) => {
  const { toast } = useToast();
  const { theme } = useTheme();
  const [type, setType] = useState<'reschedule' | 'cancel'>('reschedule');
  const [day, setDay] = useState<string>('Monday');
  const [slotId, setSlotId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!reason.trim()) {
      setError('Please tell the admin why you need this change.');
      return;
    }
    if (type === 'reschedule' && !slotId) {
      setError('Pick a new period.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/requests', {
        entry_id: entry.id,
        request_type: type,
        proposed_day: type === 'reschedule' ? day : undefined,
        proposed_time_slot_id: type === 'reschedule' ? slotId : undefined,
        proposed_room_id: type === 'reschedule' ? roomId || null : undefined,
        reason: reason.trim(),
      });
      toast('Request submitted — an admin will review it.');
      onSubmitted();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Request failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  const sortedSlots = useMemo(() => [...slots].sort((a, b) => (a.slot_number || 0) - (b.slot_number || 0)), [slots]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheetWrap, { backgroundColor: theme.background }]}>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <SectionHeading chip="Change request" title="Request a change" />
          <Card>
            <T tone="ink600" style={styles.sheetEntry}>
              {entry.subject?.code} {entry.subject?.name} — {entry.section?.name}, currently {entry.day}{' '}
              {String(entry.time_slot?.start_time || '').slice(0, 5)}–{String(entry.time_slot?.end_time || '').slice(0, 5)}
              {entry.room?.room_number ? ` in ${entry.room.room_number}` : ''}.
            </T>

            <View style={styles.typeRow}>
              <Chip label="Reschedule" active={type === 'reschedule'} onPress={() => setType('reschedule')} />
              <Chip label="Cancel class" active={type === 'cancel'} onPress={() => setType('cancel')} />
            </View>

            {type === 'reschedule' && (
              <>
                <Label>New day</Label>
                <View style={styles.dayRow}>
                  {DAYS.map((d) => (
                    <Chip key={d} label={d.slice(0, 3)} active={day === d} onPress={() => setDay(d)} />
                  ))}
                </View>

                <Label>New period</Label>
                <View style={styles.slotRow}>
                  {sortedSlots.map((slot) => (
                    <Chip
                      key={slot.id}
                      label={`P${slot.slot_number ?? ''} ${String(slot.start_time).slice(0, 5)}`}
                      active={slotId === slot.id}
                      onPress={() => setSlotId(slot.id)}
                    />
                  ))}
                </View>

                <Label>Room (optional)</Label>
                <View style={styles.slotRow}>
                  <Chip label="Keep current" active={!roomId} onPress={() => setRoomId('')} />
                  {rooms.map((r) => (
                    <Chip key={r.id} label={r.room_number} active={roomId === r.id} onPress={() => setRoomId(r.id)} />
                  ))}
                </View>
              </>
            )}

            <Label>Reason *</Label>
            <Input
              value={reason}
              onChangeText={setReason}
              placeholder="Why do you need this change?"
              multiline
              style={styles.reasonInput}
            />

            <ErrorText>{error}</ErrorText>

            <View style={styles.sheetActions}>
              <Button title="Cancel" variant="muted" onPress={onClose} style={styles.flexBtn} />
              <Button title={submitting ? 'Sending…' : 'Submit request'} onPress={submit} loading={submitting} style={styles.flexBtn} />
            </View>
          </Card>
        </ScrollView>
      </View>
    </Modal>
  );
};

export const MyTimetableScreen = ({ onOpenRequests }: { onOpenRequests?: () => void }) => {
  const { me } = useSession();
  const facultyId = me?.faculty?.id;
  const [timetable, setTimetable] = useState<TimetableEntry[]>([]);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [workloads, setWorkloads] = useState<Workload[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestEntry, setRequestEntry] = useState<TimetableEntry | null>(null);

  const load = useCallback(async () => {
    if (!facultyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [entriesRes, slotsRes, workloadsRes, roomsRes] = await Promise.all([
        api.get(`/timetable/faculty/${facultyId}`),
        api.get('/timetable/time-slots'),
        api.get('/workloads'),
        api.get('/resources/rooms'),
      ]);
      setTimetable(Array.isArray(entriesRes.data) ? entriesRes.data : []);
      setSlots(Array.isArray(slotsRes.data) ? slotsRes.data : []);
      setWorkloads(Array.isArray(workloadsRes.data) ? workloadsRes.data : []);
      setRooms(Array.isArray(roomsRes.data) ? roomsRes.data : []);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load your timetable.'));
    } finally {
      setLoading(false);
    }
  }, [facultyId]);

  useEffect(() => {
    load();
  }, [load]);

  const myWorkloads = useMemo(() => workloads.filter((wl) => wl.faculty?.id === facultyId), [workloads, facultyId]);

  const scheduledCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of timetable) {
      const key = `${entry.section_id}|${entry.subject_id}|${entry.faculty_id}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [timetable]);

  if (!facultyId) {
    return (
      <Screen>
        <Card>
          <T tone="ink600" style={styles.notice}>
            Your account email does not match any faculty record yet. Ask an admin to create your faculty profile with
            this exact email: <Text style={styles.noticeEmail}>{me?.user?.email}</Text>.
          </T>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <SectionHeading chip="Faculty" title={me?.faculty?.name || ''} subtitle={me?.faculty?.department || undefined} />
        <Pressable onPress={() => onOpenRequests?.()} hitSlop={8} style={styles.requestsLink}>
          <Text style={styles.requestsLinkText}>View my requests →</Text>
        </Pressable>
        {myWorkloads.length > 0 && (
          <View style={styles.workloadWrap}>
            {myWorkloads.map((wl) => {
              const key = `${wl.section?.id}|${wl.subject?.id}|${wl.faculty?.id}`;
              const scheduled = scheduledCounts.get(key) || 0;
              return (
                <Chip key={wl.id} label={`${wl.section?.name} · ${wl.subject?.code} — ${scheduled}/${wl.lectures_per_week}`} />
              );
            })}
          </View>
        )}
      </Card>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Spinner label="Loading your schedule…" />
      ) : (
        <Card style={styles.gridCard}>
          <T style={styles.gridTitle}>My weekly schedule</T>
          <T tone="ink500" style={styles.gridHint}>Tap a class to ask an admin for a reschedule or cancellation.</T>
          <TimetableGrid entries={timetable} onPressEntry={(entry) => setRequestEntry(entry)} emptyText="No classes scheduled for you yet." />
        </Card>
      )}

      {requestEntry && (
        <RequestSheet
          entry={requestEntry}
          slots={slots}
          rooms={rooms}
          onClose={() => setRequestEntry(null)}
          onSubmitted={load}
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  requestsLink: { alignSelf: 'flex-start', marginTop: spacing.sm },
  requestsLinkText: { fontSize: 13.5, fontWeight: '700', color: '#101210' },
  workloadWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  gridCard: { marginTop: spacing.lg, gap: spacing.md },
  gridTitle: { fontSize: 18, fontWeight: '700' },
  gridHint: { fontSize: 12.5, opacity: 0.65 },
  notice: { fontSize: 14, lineHeight: 20 },
  noticeEmail: { fontWeight: '700' },
  sheetWrap: { flex: 1 },
  sheetContent: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 48 },
  sheetEntry: { fontSize: 13.5, lineHeight: 19, opacity: 0.85 },
  typeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  slotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  reasonInput: { height: 90, paddingTop: 12 },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flexBtn: { flex: 1 },
});
