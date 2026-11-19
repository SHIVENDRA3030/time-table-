// Sign-in / sign-up screen. Email + password against Neon Auth (Managed Better
// Auth); the web app's two-mode form with inline errors and a shared-look panel.
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../context/SessionContext';
import { Button, Card, Chip, ErrorText, Input, Label, Screen, T } from '../components/ui';
import { spacing } from '../theme';

export const LoginScreen = () => {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError('');
    if (!form.email.trim() || !form.password) {
      setError('Email and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await signIn(form.email.trim(), form.password);
      } else {
        await signUp(form.email.trim(), form.password, form.name.trim() || form.email.split('@')[0]);
        setMode('signin');
        setError('Account created. Check your email for a verification code, then sign in.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen keyboardAvoid>
      <View style={styles.hero}>
        <Chip label="Timetable Studio" />
        <T style={styles.heroTitle}>Welcome back</T>
        <T tone="ink700" style={styles.heroSub}>
          Secure sign-in for schedules, live timetables, and change requests.
        </T>
      </View>

      <Card strong>
        <View style={styles.form}>
          <T style={styles.title}>{mode === 'signin' ? 'Sign in' : 'Create account'}</T>

          {mode === 'signup' && (
            <View>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChangeText={(name) => setForm((p) => ({ ...p, name }))}
                placeholder="Your name"
                autoCapitalize="words"
              />
            </View>
          )}

          <View>
            <Label>Email *</Label>
            <Input
              value={form.email}
              onChangeText={(email) => setForm((p) => ({ ...p, email }))}
              placeholder="you@college.edu"
              keyboardType="email-address"
            />
          </View>

          <View>
            <Label>Password *</Label>
            <Input
              value={form.password}
              onChangeText={(password) => setForm((p) => ({ ...p, password }))}
              placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'}
              secureTextEntry
            />
          </View>

          <ErrorText>{error}</ErrorText>

          <Button
            title={submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            onPress={submit}
            loading={submitting}
          />

          <T tone="ink600"
            style={styles.switchText}
            onPress={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError('');
            }}
          >
            {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </T>
        </View>
      </Card>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hero: { paddingVertical: spacing.xxl, gap: spacing.sm },
  heroTitle: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  heroSub: { fontSize: 14, opacity: 0.8 },
  form: { gap: spacing.md },
  title: { fontSize: 22, fontWeight: '700' },
  switchText: { textAlign: 'center', fontSize: 13, textDecorationLine: 'underline', paddingVertical: spacing.xs },
});
