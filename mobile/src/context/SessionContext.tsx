// Session context: restores the Neon Auth session from secure storage on
// launch, resolves the app role + faculty link via GET /api/me (same shape the
// web app's MeContext consumes), and exposes sign-in / sign-up / sign-out.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as auth from '../services/auth';
import type { AuthUser } from '../services/auth';
import api from '../services/api';
import { apiErrorMessage, invalidateApiToken } from '../services/api';
import { loadAppConfig } from '../config';

export type AppRole = 'admin' | 'editor' | 'viewer';

export type Faculty = { id: string; name: string; department: string | null };

export type Me = {
  user: { id: string; email: string | null; name: string | null };
  role: AppRole | null;
  faculty: Faculty | null;
  needsBootstrap: boolean;
};

type SessionState = {
  booted: boolean;
  user: AuthUser | null;
  me: Me | null;
  loadingMe: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export const SessionProvider = ({ children }: { children: React.ReactNode }) => {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);

  const fetchMe = useCallback(async (authUser: AuthUser | null) => {
    if (!authUser) {
      setMe(null);
      return;
    }
    setLoadingMe(true);
    try {
      const res = await api.get('/me');
      setMe(res.data as Me);
    } catch {
      setMe({
        user: { id: authUser.id, email: authUser.email, name: authUser.name || null },
        role: null,
        faculty: null,
        needsBootstrap: false,
      });
    } finally {
      setLoadingMe(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // The auth client needs the branch URLs before it can restore anything —
      // load config first, then restore the stored session.
      await loadAppConfig();
      const restored = await auth.restoreSession();
      setUser(restored?.user || null);
      if (restored) await fetchMe(restored.user);
      setBooted(true);
    })();
  }, [fetchMe]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const signedIn = await auth.signInEmail(email, password);
      invalidateApiToken();
      setUser(signedIn);
      await fetchMe(signedIn);
    },
    [fetchMe]
  );

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    await auth.signUpEmail(email, password, name);
  }, []);

  const doSignOut = useCallback(async () => {
    await auth.signOut();
    invalidateApiToken();
    setUser(null);
    setMe(null);
  }, []);

  const refreshMe = useCallback(async () => {
    await fetchMe(user);
  }, [fetchMe, user]);

  const value = useMemo(
    () => ({ booted, user, me, loadingMe, signIn, signUp, signOut: doSignOut, refreshMe }),
    [booted, user, me, loadingMe, signIn, signUp, doSignOut, refreshMe]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

export { apiErrorMessage };
