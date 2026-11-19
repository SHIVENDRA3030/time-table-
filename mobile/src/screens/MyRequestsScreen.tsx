// Faculty "my requests": status list of the change requests they raised, with
// the proposed change, reason, and the admin's decision note.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import api from '../services/api';
import { apiErrorMessage } from '../services/api';
import { Card, Chip, ErrorText, Screen, SectionHeading, Spinner, T } from '../components/ui';
import { spacing } from '../theme';

type ChangeRequest = {
  id: string;
  request_type: 'reschedule' | 'cancel';
  status: 'pending' | 'applied' | 'rejected';
  reason: string | null;
  decision_note: string | null;
  created_at: string;
  proposed_day: string | null;
  proposed_start: string | null;
  proposed_end: string | null;
  proposed_room_number: string | null;
  entry_snapshot: {
    subject_code?: string | null;
    subject_name?: string | null;
    section_name?: string | null;
    day?: string | null;
    slot?: string | null;
  } | null;
};

const statusTone = (status: string): 'ok' | 'danger' | 'warning' =>
  status === 'applied' ? 'ok' : status === 'rejected' ? 'danger' : 'warning';

export const MyRequestsScreen = ({ onBack }: { onBack?: () => void }) => {
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/requests');
      setRequests(Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load requests.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Screen>
      <SectionHeading chip="Faculty" title="My requests" subtitle="Reschedule and cancellation requests you have raised." />
      {onBack && (
        <Chip label="← Back to my timetable" onPress={onBack} />
      )}
      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Spinner label="Loading requests…" />
      ) : requests.length === 0 ? (
        <Card>
          <T tone="ink600" style={styles.empty}>
            No requests yet. Open your timetable and tap a class to ask for a change.
          </T>
        </Card>
      ) : (
        <View style={styles.list}>
          {requests.map((req) => {
            const snap = req.entry_snapshot || {};
            return (
              <Card key={req.id}>
                <View style={styles.headRow}>
                  <T style={styles.title}>
                    {snap.subject_code || snap.subject_name} · {snap.section_name}
                  </T>
                  <Chip label={req.status} tone={statusTone(req.status)} active={req.status === 'applied'} />
                </View>
                <T tone="ink700" style={styles.meta}>
                  {req.request_type === 'cancel'
                    ? `Cancel ${snap.day} ${snap.slot || ''}`
                    : `→ ${req.proposed_day} ${req.proposed_start ? String(req.proposed_start).slice(0, 5) : ''}–${req.proposed_end ? String(req.proposed_end).slice(0, 5) : ''}${req.proposed_room_number ? ` (${req.proposed_room_number})` : ''}`}
                </T>
                {req.reason ? <T tone="ink600" style={styles.reason}>“{req.reason}”</T> : null}
                {req.decision_note ? (
                  <T tone="ink600" style={[styles.note, { opacity: 0.8 }]}>Admin note: {req.decision_note}</T>
                ) : null}
                <T tone="ink500" style={styles.date}>{new Date(req.created_at).toLocaleString()}</T>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  list: { gap: spacing.md, marginTop: spacing.lg },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: 15.5, fontWeight: '700', flex: 1 },
  meta: { fontSize: 13, marginTop: spacing.xs, opacity: 0.85 },
  reason: { fontSize: 13, marginTop: spacing.sm, fontStyle: 'italic' },
  note: { fontSize: 12.5, marginTop: spacing.sm },
  date: { fontSize: 11.5, marginTop: spacing.sm, opacity: 0.55 },
  empty: { fontSize: 14, lineHeight: 20 },
});
