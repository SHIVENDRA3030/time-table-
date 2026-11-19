// Profile: identity, app role + faculty link, theme preference, and sign-out.
// Admins also see a live pending-requests badge count.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../context/SessionContext';
import { useTheme } from '../context/ThemeContext';
import { roleLabel, spacing } from '../theme';
import api from '../services/api';
import { Button, Card, Chip, Screen, SectionHeading, Spinner, T } from '../components/ui';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export const ProfileScreen = () => {
  const { me, loadingMe, signOut, user } = useSession();
  const { preference, setPreference, isDark } = useTheme();
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (me?.role !== 'admin') return;
    let active = true;
    // Pending-requests badge is best-effort; a failure just hides the badge.
    api.get('/requests', { params: { status: 'pending' } })
      .then((res) => {
        if (active) setPending(Array.isArray(res.data) ? res.data.length : 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [me?.role]);

  if (loadingMe && !me) return <Spinner label="Loading profile…" />;

  const role = me?.role ? roleLabel[me.role] || me.role : 'Viewer (no role assigned)';

  return (
    <Screen>
      <SectionHeading chip="Account" title="Profile" />

      <Card style={styles.card}>
        <T style={styles.name}>{me?.user?.name || user?.name || '—'}</T>
        <T tone="ink600" style={styles.email}>{me?.user?.email || user?.email || ''}</T>
        <View style={styles.badgeRow}>
          <Chip label={role} active={!!me?.role} />
          {me?.faculty && <Chip label={`Faculty: ${me.faculty.name}`} />}
          {me?.role === 'admin' && pending !== null && pending > 0 && (
            <Chip label={`${pending} pending request${pending === 1 ? '' : 's'}`} tone="warning" />
          )}
        </View>
        {me?.faculty ? (
          <T tone="ink600" style={styles.dep}>Department: {me.faculty.department || '—'}</T>
        ) : (
          me?.user && (
            <T tone="ink600" style={styles.dep}>
              Not linked to a faculty record — browse-only access until an admin matches your email.
            </T>
          )
        )}
      </Card>

      <Card style={styles.card}>
        <T style={styles.sectionTitle}>Appearance</T>
        <T tone="ink500" style={styles.sectionHint}>Currently {isDark ? 'dark' : 'light'} mode</T>
        <View style={styles.themeRow}>
          {THEME_OPTIONS.map((opt) => (
            <Chip key={opt.value} label={opt.label} active={preference === opt.value} onPress={() => setPreference(opt.value)} />
          ))}
        </View>
      </Card>

      <Button title="Sign out" variant="danger" onPress={signOut} style={styles.signOut} />
    </Screen>
  );
};

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg, gap: spacing.sm },
  name: { fontSize: 20, fontWeight: '700' },
  email: { fontSize: 13.5, opacity: 0.7 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  dep: { fontSize: 12.5, opacity: 0.65 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionHint: { fontSize: 12, opacity: 0.6 },
  themeRow: { flexDirection: 'row', gap: spacing.sm },
  signOut: { marginTop: spacing.xl },
});
