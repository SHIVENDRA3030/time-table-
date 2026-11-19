// Reusable UI primitives styled after the web app's glass/teal design system:
// Card (glass-panel), Chip, Button (primary/muted/danger), Input, Label,
// ErrorText, Spinner and a Screen container with the gradient background.
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import type { Theme } from '../theme';

export const Screen = ({
  children,
  scroll = true,
  padding = true,
  keyboardAvoid = false,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padding?: boolean;
  keyboardAvoid?: boolean;
}) => {
  const { theme, isDark } = useTheme();
  const style = styles(theme);
  // Core SafeAreaView supports Android edge-to-edge since RN 0.81 — keeps
  // content clear of the status bar without a native dependency.
  const content = (
    <SafeAreaView style={[style.screen, padding && style.screenPadding]}>
      {children}
    </SafeAreaView>
  );
  return (
    <View style={[style.screenBg, { backgroundColor: theme.background }]}>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            opacity: isDark ? 0.55 : 0.9,
            backgroundColor: theme.backgroundMid,
          },
        ]}
      />
      {keyboardAvoid ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={style.flex}>
          {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={style.grow}>{content}</ScrollView> : content}
        </KeyboardAvoidingView>
      ) : scroll ? (
        <ScrollView contentContainerStyle={style.grow}>{content}</ScrollView>
      ) : (
        content
      )}
    </View>
  );
};

export const Card = ({
  children,
  strong = false,
  style,
}: {
  children: React.ReactNode;
  strong?: boolean;
  style?: ViewStyle | ViewStyle[];
}) => {
  const { theme } = useTheme();
  return <View style={[styles(theme).card, strong && { backgroundColor: theme.surfaceStrong }, style]}>{children}</View>;
};

export const Chip = ({
  label,
  active = false,
  onPress,
  tone,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: 'ok' | 'danger' | 'warning';
}) => {
  const { theme } = useTheme();
  const color = tone === 'ok' ? theme.ok600 : tone === 'danger' ? theme.danger600 : tone === 'warning' ? theme.warning600 : undefined;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles(theme).chip,
        active && styles(theme).chipActive,
        onPress && pressed && { opacity: 0.7 },
        color && !active ? { borderColor: color, backgroundColor: 'transparent' } : null,
      ]}
    >
      <Text style={[styles(theme).chipText, active && { color: theme.ink900 }, color && !active && { color }]}>{label}</Text>
    </Pressable>
  );
};

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'muted' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) => {
  const { theme } = useTheme();
  const base: ViewStyle[] = [styles(theme).button];
  if (variant === 'primary') base.push(styles(theme).buttonPrimary);
  if (variant === 'muted') base.push(styles(theme).buttonMuted);
  if (variant === 'danger') base.push(styles(theme).buttonDanger);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [...base, pressed && { opacity: 0.85 }, (disabled || loading) && { opacity: 0.5 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? theme.btnInk : theme.ink700} />
      ) : (
        <Text
          style={[
            styles(theme).buttonText,
            variant === 'primary' && { color: theme.btnInk },
            variant === 'danger' && { color: theme.danger600 },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
};

export const Label = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useTheme();
  return <Text style={styles(theme).label}>{children}</Text>;
};

// Themed text: plain <Text> defaults to black on both schemes, so screens use
// this to keep copy readable in dark mode.
export const T = ({
  children,
  tone = 'ink900',
  numberOfLines,
  style,
  onPress,
}: {
  children: React.ReactNode;
  tone?: 'ink900' | 'ink700' | 'ink600' | 'ink500';
  numberOfLines?: number;
  style?: TextStyle | (TextStyle | false | undefined)[];
  onPress?: () => void;
}) => {
  const { theme } = useTheme();
  const color = { ink900: theme.ink900, ink700: theme.ink700, ink600: theme.ink600, ink500: theme.ink500 }[tone];
  return (
    <Text onPress={onPress} numberOfLines={numberOfLines} style={[{ color }, style]}>
      {children}
    </Text>
  );
};

export const Input = ({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize = 'none',
  keyboardType,
  multiline,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  keyboardType?: 'default' | 'email-address';
  multiline?: boolean;
  style?: TextStyle;
}) => {
  const { theme } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.ink500}
      secureTextEntry={secureTextEntry}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      multiline={multiline}
      textAlignVertical={multiline ? 'top' : 'center'}
      style={[styles(theme).input, style]}
    />
  );
};

export const ErrorText = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useTheme();
  if (!children) return null;
  return (
    <View style={[styles(theme).alert, { borderColor: theme.danger600 }]}>
      <Text style={[styles(theme).alertText, { color: theme.danger600 }]}>{children}</Text>
    </View>
  );
};

export const Spinner = ({ label }: { label?: string }) => {
  const { theme } = useTheme();
  return (
    <View style={styles(theme).spinner}>
      <ActivityIndicator color={theme.accent600} />
      {label ? <Text style={styles(theme).spinnerLabel}>{label}</Text> : null}
    </View>
  );
};

export const SectionHeading = ({ chip, title, subtitle }: { chip?: string; title: string; subtitle?: string }) => {
  const { theme } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      {chip ? <Chip label={chip} /> : null}
      <Text style={[styles(theme).h1, { color: theme.ink900 }]}>{title}</Text>
      {subtitle ? <Text style={[styles(theme).subtitle, { color: theme.ink600 }]}>{subtitle}</Text> : null}
    </View>
  );
};

const styles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screenBg: { flex: 1 },
    screen: { paddingBottom: spacing.xxl },
    screenPadding: { padding: spacing.lg },
    grow: { flexGrow: 1 },
    card: {
      backgroundColor: t.surface,
      borderColor: t.stroke,
      borderWidth: 1,
      borderRadius: 18,
      padding: spacing.lg,
      shadowColor: '#173936',
      shadowOpacity: 0.10,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
    chip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(109,141,137,0.45)',
      backgroundColor: 'rgba(109,141,137,0.14)',
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    chipActive: {
      borderColor: t.accent600,
      backgroundColor: t.accent100,
    },
    chipText: { fontSize: 12, fontWeight: '600', color: t.ink700 },
    button: {
      borderRadius: 14,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 46,
    },
    buttonPrimary: {
      backgroundColor: t.accent600,
      borderColor: t.accent700,
    },
    buttonMuted: {
      backgroundColor: t.surfaceStrong,
      borderColor: t.stroke,
    },
    buttonDanger: {
      backgroundColor: t.surfaceStrong,
      borderColor: t.danger600,
    },
    buttonText: { fontSize: 15, fontWeight: '600', color: t.ink700 },
    label: { fontSize: 13, fontWeight: '600', color: t.ink600, marginBottom: 6 },
    input: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.stroke,
      backgroundColor: t.surfaceStrong,
      color: t.ink900,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
    },
    alert: {
      borderWidth: 1,
      borderRadius: 12,
      backgroundColor: t.surfaceStrong,
      padding: 12,
    },
    alertText: { fontSize: 13, fontWeight: '500' },
    spinner: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
    spinnerLabel: { color: t.ink500, fontSize: 13 },
    h1: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
    subtitle: { fontSize: 14, lineHeight: 20 },
  });
