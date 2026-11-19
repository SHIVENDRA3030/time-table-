// App root: loads branch config (auth/realtime URLs) once, then gates on the
// restored Neon Auth session — login screen until signed in, role-aware tabs
// after. Toasts and theme are provided app-wide.
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { loadAppConfig } from './src/config';
import { SessionProvider, useSession } from './src/context/SessionContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ToastProvider } from './src/components/Toast';
import { AppNavigator } from './src/AppNavigator';
import { LoginScreen } from './src/screens/LoginScreen';
import { ErrorText, Screen, Spinner } from './src/components/ui';

const Root = () => {
  const { booted, user } = useSession();
  const { isDark } = useTheme();

  if (!booted) {
    return (
      <Screen scroll={false} padding={false}>
        <Spinner label="Restoring your session…" />
      </Screen>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {user ? <AppNavigator /> : <LoginScreen />}
    </>
  );
};

const BootGate = () => {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAppConfig()
      .then((config) => {
        if (!config.authBaseUrl) {
          setError('Could not reach the API to fetch server configuration. Check your connection and restart.');
        }
      })
      .catch(() => setError('Could not reach the API to fetch server configuration. Check your connection and restart.'))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <Spinner label="Connecting to Timetable Studio…" />;
  if (error) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }
  return <Root />;
};

export default function App() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <ToastProvider>
          <BootGate />
        </ToastProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
