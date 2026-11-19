// Theme context with persistence. Defaults to the OS setting; the Profile
// screen can pin light/dark explicitly (stored in SecureStore like the rest of
// the app's persisted state).
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { palette } from '../theme';
import type { Theme } from '../theme';

const THEME_KEY = 'timetable.theme';

type ThemeState = {
  theme: Theme;
  isDark: boolean;
  preference: 'system' | 'light' | 'dark';
  setPreference: (p: 'system' | 'light' | 'dark') => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<'system' | 'light' | 'dark'>('system');

  useEffect(() => {
    SecureStore.getItemAsync(THEME_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setPreference = (p: 'system' | 'light' | 'dark') => {
    setPreferenceState(p);
    SecureStore.setItemAsync(THEME_KEY, p).catch(() => {});
  };

  const isDark = preference === 'system' ? system === 'dark' : preference === 'dark';
  const theme = isDark ? palette.dark : palette.light;

  const value = useMemo(() => ({ theme, isDark, preference, setPreference }), [theme, isDark, preference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
