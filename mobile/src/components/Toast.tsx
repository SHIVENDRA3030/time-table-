// Toast provider: lightweight in-app notifications (success/error), the mobile
// counterpart of the web app's Toast container.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import type { Theme } from '../theme';

type Toast = { id: number; message: string; kind: 'success' | 'error' };

type ToastState = { toast: (message: string, kind?: 'success' | 'error') => void };

const ToastContext = createContext<ToastState | null>(null);

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} />
    </ToastContext.Provider>
  );
};

const ToastHost = ({ toasts }: { toasts: Toast[] }) => {
  const { theme } = useTheme();
  return (
    <View pointerEvents="none" style={styles(theme).host}>
      {toasts.map((t) => (
        <View
          key={t.id}
          style={[styles(theme).toast, { borderColor: t.kind === 'error' ? theme.danger600 : theme.ok600 }]}
        >
          <Text style={[styles(theme).text, { color: t.kind === 'error' ? theme.danger600 : theme.ok600 }]}>
            {t.message}
          </Text>
        </View>
      ))}
    </View>
  );
};

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

const styles = (t: Theme) =>
  StyleSheet.create({
    host: {
      position: 'absolute',
      bottom: 90,
      left: spacing.lg,
      right: spacing.lg,
      gap: spacing.sm,
      alignItems: 'center',
    },
    toast: {
      backgroundColor: t.surfaceStrong,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    text: { fontSize: 13, fontWeight: '600' },
  });
