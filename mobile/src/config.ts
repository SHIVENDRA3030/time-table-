// Central app configuration. API candidates are baked from .env at build time
// (EXPO_PUBLIC_*): the Android-emulator loopback first, then the host's LAN
// address for real devices — whichever answers /api/config first wins, so one
// bundle works on both. The Neon Auth and Realtime URLs come from the
// backend's /api/config so they stay in sync with the deployed branch, served
// through the backend's transparent /neon-auth and /neon-rt proxies.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://10.0.2.2:5000/api';
const LAN_API_BASE_URL = process.env.EXPO_PUBLIC_LAN_API_BASE_URL || '';

export type AppConfig = {
  authBaseUrl: string | null;
  realtimeUrl: string | null;
};

let cached: AppConfig | null = null;
let activeBaseUrl = API_BASE_URL;

// The axios layer reads this per request, so a fallback picked at boot applies
// everywhere without recreating the instance.
export function getActiveBaseUrl(): string {
  return activeBaseUrl;
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// GET /api/config — public bootstrap endpoint the backend serves so the mobile
// client never hardcodes branch-specific auth/realtime URLs. When present, the
// backend's /neon-auth proxy is preferred (emulator NATs and VPN'd networks
// often cannot reach the auth server directly; the API is always reachable).
export async function loadAppConfig(): Promise<AppConfig> {
  if (cached) return cached;

  const candidates = [API_BASE_URL, LAN_API_BASE_URL].filter(
    (v, i, arr) => v && arr.indexOf(v) === i
  );

  for (const base of candidates) {
    const { signal, cancel } = withTimeout(2500);
    try {
      const res = await fetch(`${base}/config`, { signal });
      cancel();
      if (!res.ok) continue;
      const data = (await res.json()) as {
        authBaseUrl?: string | null;
        authProxyBaseUrl?: string | null;
        realtimeUrl?: string | null;
      };
      activeBaseUrl = base;
      cached = {
        authBaseUrl: data.authProxyBaseUrl || data.authBaseUrl || null,
        realtimeUrl: data.realtimeUrl || null,
      };
      return cached;
    } catch {
      cancel();
    }
  }

  cached = { authBaseUrl: null, realtimeUrl: null };
  return cached;
}

export function getAuthBaseUrl(): string {
  if (!cached?.authBaseUrl) {
    throw new Error('Auth server URL unavailable — check the API connection.');
  }
  return cached.authBaseUrl;
}

export function getRealtimeUrl(): string | null {
  return cached?.realtimeUrl || null;
}
