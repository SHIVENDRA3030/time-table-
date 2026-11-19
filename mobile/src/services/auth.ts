// Mobile auth: Neon Auth session at sign-in, exchanged for an API token pair
// (POST /api/auth/token). From then on the app holds a rotating refresh token
// (30 days, single use, reuse detection revokes the family) plus a short-lived
// access token — no browser cookie replay (enterprise plan F2).
import * as SecureStore from 'expo-secure-store';
import { getAuthBaseUrl, getActiveBaseUrl } from '../config';

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
};

const SESSION_COOKIE_KEY = 'timetable.session.cookie';
const ACCESS_TOKEN_KEY = 'timetable.auth.access';
const REFRESH_TOKEN_KEY = 'timetable.auth.refresh';
const USER_KEY = 'timetable.session.user';

// Neon Auth pre-approves localhost origins; native fetch sends no Origin, so
// we pin the web dev origin (same trust path as the web app).
const AUTH_ORIGIN = process.env.EXPO_PUBLIC_AUTH_ORIGIN || 'http://localhost:5173';

const jsonHeaders = { 'Content-Type': 'application/json', Origin: AUTH_ORIGIN };

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function readStored(): Promise<{
  cookie: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
}> {
  try {
    const [cookie, accessToken, refreshToken, userRaw] = await Promise.all([
      SecureStore.getItemAsync(SESSION_COOKIE_KEY),
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      SecureStore.getItemAsync(USER_KEY),
    ]);
    return {
      cookie,
      accessToken,
      refreshToken,
      user: userRaw ? (JSON.parse(userRaw) as AuthUser) : null,
    };
  } catch {
    return { cookie: null, accessToken: null, refreshToken: null, user: null };
  }
}

async function writeTokens(accessToken: string, refreshToken: string, user: AuthUser | null) {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken, secureOptions);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, secureOptions);
  if (user) await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user), secureOptions);
}

async function clearAll(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_COOKIE_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
}

// Pull the signed session cookie out of a sign-in response's Set-Cookie header.
function extractSessionCookie(headers: Headers): string | null {
  const setCookie = headers.get('set-cookie');
  if (!setCookie) return null;
  const parts = setCookie.split(/,(?=[^;]+?=)/);
  for (const part of parts) {
    const [pair] = part.trim().split(';');
    if (pair && pair.toLowerCase().includes('session_token=')) return pair.trim();
  }
  return null;
}

type BetterAuthErrorShape = { status?: number; message?: string; code?: string };

function toMessage(status: number, body: unknown, fallback: string): string {
  const record = (body && typeof body === 'object' ? body : {}) as BetterAuthErrorShape;
  return record.message || (body as { error?: string })?.error || `${fallback} (${status})`;
}

// POST /sign-in/email on the auth server → session cookie → exchanged once for
// the API token pair at our backend.
export async function signInEmail(email: string, password: string): Promise<AuthUser> {
  const authBase = getAuthBaseUrl();
  const signInRes = await fetch(`${authBase}/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  let signInBody: unknown = null;
  try {
    signInBody = await signInRes.json();
  } catch {
    signInBody = null;
  }
  if (!signInRes.ok) {
    throw new Error(toMessage(signInRes.status, signInBody, 'Sign-in failed'));
  }
  const cookie = extractSessionCookie(signInRes.headers);
  const data = signInBody as { user?: AuthUser };
  if (!cookie || !data.user) throw new Error('Sign-in succeeded but no session was returned.');

  const exchangeRes = await fetch(`${getActiveBaseUrl()}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionCookie: cookie }),
  });
  const exchangeBody = await exchangeRes.json().catch(() => null);
  if (!exchangeRes.ok || !exchangeBody?.accessToken) {
    throw new Error(toMessage(exchangeRes.status, exchangeBody, 'Could not establish the API session'));
  }

  // The refresh token family is now the persistent credential; the cookie has
  // served its purpose.
  await writeTokens(exchangeBody.accessToken, exchangeBody.refreshToken, data.user);
  return data.user;
}

// POST /sign-up/email — Neon Auth sends a verification code over shared SMTP;
// the account is usable once its email is verified (same rule as the web app).
export async function signUpEmail(email: string, password: string, name: string): Promise<boolean> {
  const authBase = getAuthBaseUrl();
  const res = await fetch(`${authBase}/sign-up/email`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ email, password, name }),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error(toMessage(res.status, body, 'Sign-up failed'));
  return true;
}

// Rotate the refresh token on boot: the old token is single use, so a rotated
// pair proves the device still owns the family. Reuse/expiry clears everything.
export async function restoreSession(): Promise<{ user: AuthUser | null } | null> {
  const { refreshToken, user } = await readStored();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${getActiveBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await clearAll();
      return null;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string; user?: AuthUser };
    const mergedUser = data.user || user;
    await writeTokens(data.accessToken, data.refreshToken, mergedUser);
    return { user: mergedUser };
  } catch {
    // Network failure: keep the stored refresh token and retry next launch.
    return { user };
  }
}

// Current access token for the API interceptor (may be expired — the
// interceptor refreshes on a 401).
export async function getApiToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY).catch(() => null);
}

// Rotate the refresh token now (used by the API layer after a 401). Returns
// the new access token, or null when the family is gone (caller signs out).
export async function refreshTokens(): Promise<string | null> {
  const { refreshToken } = await readStored();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${getActiveBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      await clearAll();
      return null;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string; user?: AuthUser };
    await writeTokens(data.accessToken, data.refreshToken, data.user || null);
    return data.accessToken;
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  const { refreshToken } = await readStored();
  if (refreshToken) {
    await fetch(`${getActiveBaseUrl()}/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  await clearAll();
}

export async function getStoredUser(): Promise<AuthUser | null> {
  return (await readStored()).user;
}
