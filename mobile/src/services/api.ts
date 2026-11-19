// Axios layer for the Express API. Mobile auth (enterprise plan F2): carries
// the short-lived access token, and on a 401 rotates the refresh token once
// before retrying — reuse detection on the server revokes stolen families.
// Mutations get an Idempotency-Key so network retries never double-apply (F6).
import axios, { AxiosError } from 'axios';
import { getActiveBaseUrl } from '../config';
import { getApiToken, refreshTokens, signOut } from './auth';

const api = axios.create({
  timeout: 20000,
});

const uuid4 = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export function invalidateApiToken(): void {
  // Kept for call-site compatibility: the token lives in SecureStore now and
  // rotation is the only refresh path.
}

api.interceptors.request.use(async (config) => {
  // The active base URL is chosen at boot (emulator loopback vs LAN address).
  config.baseURL = getActiveBaseUrl();
  const token = await getApiToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (['post', 'put', 'patch', 'delete'].includes((config.method || '').toLowerCase())) {
    config.headers = config.headers ?? {};
    config.headers['Idempotency-Key'] = uuid4();
  }
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

const rotateOnce = (): Promise<string | null> => {
  if (!refreshInFlight) {
    refreshInFlight = refreshTokens().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
};

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const alreadyRetried = (error.config as { __retriedAuth?: boolean } | undefined)?.__retriedAuth;

    if (status === 401 && !alreadyRetried && error.config) {
      const newToken = await rotateOnce();
      if (newToken) {
        (error.config as { __retriedAuth?: boolean }).__retriedAuth = true;
        error.config.headers = error.config.headers ?? {};
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return api.request(error.config);
      }
      // The token family is gone — sign out locally.
      await signOut();
    }
    return Promise.reject(error);
  }
);

export function apiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    return data?.error || error.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

export default api;
