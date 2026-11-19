// Admin approvals: pending faculty change requests with approve & apply /
// reject actions and an optional note to the faculty member.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import api from '../services/api';
import { apiErrorMessage } from '../services/api';
import { useToast } from '../components/Toast';
import { Button, Card, Chip, ErrorText, Input, Screen, SectionHeading, Spinner, T } from '../components/ui';
import { spacing } from '../theme';

type ChangeRequest = {
  id: string;
  request_type: 'reschedule' | 'cancel';
  status: 'pending' | 'applied' | 'rejected';
  reason: string | null;
  decision_note: string | null;
  requested_by_email: string | null;
  created_at: string;
  proposed_day: string | null;
  proposed_start: string | null;
  proposed_end: string | null;
  proposed_room_number: string | null;
  entry_snapshot: {
    faculty_name?: string | null;
    subject_code?: string | null;
    subject_name?: string | null;
    section_name?: string | null;
    day?: string | null;
    slot?: string | null;
  } | null;
};

const FILTERS = ['pending', 'applied', 'rejected', ''] as const;
const statusTone = (status: string): 'ok' | 'danger' | 'warning' =>
  status === 'applied' ? 'ok' : status === 'rejected' ? 'danger' : 'warning';

export const AdminRequestsScreen = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/requests', { params: statusFilter ? { status: statusFilter } : {} });
      setRequests(Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load requests.'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (request: ChangeRequest, decision: 'approved' | 'rejected') => {
    setDecidingId(request.id);
    try {
      const res = await api.put(`/requests/${request.id}/decide`, {
        decision,
        note: notes[request.id] || null,
      });
      toast(
        decision === 'approved'
          ? res.data.status === 'applied'
            ? 'Approved and applied to the timetable.'
            : 'Decision recorded.'
          : 'Request rejected.'
      );
      await load();
    } catch (err) {
      toast(apiErrorMessage(err, 'Decision failed.'), 'error');
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <Screen>
      <SectionHeading chip="Admin" title="Change requests" subtitle="Approve or reject faculty reschedule and cancellation requests." />

      <View style={styles.filterRow}>
        {FILTERS.map((s) => (
          <Chip key={s || 'all'} label={s || 'all'} active={statusFilter === s} onPress={() => setStatusFilter(s)} />
        ))}
      </View>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Spinner label="Loading requests…" />
      ) : requests.length === 0 ? (
        <Card>
          <T tone="ink600" style={styles.empty}>No {statusFilter || ''} requests.</T>
        </Card>
      ) : (
        <View style={styles.list}>
          {requests.map((req) => {
            const snap = req.entry_snapshot || {};
            return (
              <Card key={req.id}>
                <View style={styles.headRow}>
                  <View style={styles.headText}>
                    <T style={styles.title}>
                      {snap.faculty_name || 'Faculty'} — {req.request_type === 'cancel' ? 'cancel class' : 'reschedule class'}
                    </T>
                    <T tone="ink600" style={styles.meta}>
                      {snap.subject_code} {snap.subject_name} · {snap.section_name} · currently {snap.day} {snap.slot}
                    </T>
                    {req.request_type === 'reschedule' && (
                      <T tone="ink700" style={styles.proposed}>
                        → {req.proposed_day},{' '}
                        {req.proposed_start ? `${String(req.proposed_start).slice(0, 5)}–${String(req.proposed_end).slice(0, 5)}` : ''}
                        {req.proposed_room_number ? ` in ${req.proposed_room_number}` : ' (room unchanged)'}
                      </T>
                    )}
                    <T tone="ink600" style={styles.reason}>Reason: {req.reason || '—'}</T>
                    <T tone="ink500" style={styles.byline}>
                      by {req.requested_by_email || snap.faculty_name} · {new Date(req.created_at).toLocaleString()}
                    </T>
                  </View>
                  <Chip label={req.status} tone={statusTone(req.status)} active={req.status === 'applied'} />
                </View>

                {req.status === 'pending' && (
                  <View style={styles.actions}>
                    <Input
                      value={notes[req.id] || ''}
                      onChangeText={(text) => setNotes((prev) => ({ ...prev, [req.id]: text }))}
                      placeholder="Optional note to the faculty…"
                      style={styles.noteInput}
                    />
                    <View style={styles.actionRow}>
                      <Button
                        title="Approve & apply"
                        onPress={() => decide(req, 'approved')}
                        loading={decidingId === req.id}
                        style={styles.flexBtn}
                      />
                      <Button
                        title="Reject"
                        variant="danger"
                        onPress={() => decide(req, 'rejected')}
                        loading={decidingId === req.id}
                        style={styles.flexBtn}
                      />
                    </View>
                  </View>
                )}

                {req.status !== 'pending' && req.decision_note ? (
                  <T tone="ink600" style={styles.decisionNote}>Note: {req.decision_note}</T>
                ) : null}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  list: { gap: spacing.md, marginTop: spacing.lg },
  headRow: { flexDirection: 'row', gap: spacing.md },
  headText: { flex: 1, gap: 3 },
  title: { fontSize: 15.5, fontWeight: '700' },
  meta: { fontSize: 12.5, opacity: 0.8 },
  proposed: { fontSize: 13, fontWeight: '600' },
  reason: { fontSize: 12.5, opacity: 0.85 },
  byline: { fontSize: 11, opacity: 0.55 },
  actions: { marginTop: spacing.md, gap: spacing.sm },
  noteInput: { fontSize: 14 },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  flexBtn: { flex: 1 },
  decisionNote: { fontSize: 12.5, marginTop: spacing.sm, opacity: 0.75 },
  empty: { fontSize: 14 },
});
