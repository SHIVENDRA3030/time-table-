// Neon Realtime client for React Native. The SDK ships a dedicated react-native
// build (WebSocket from react-native is picked up automatically). Subscribes to
// sealed live queries minted by POST /api/realtime/:viewType/:resourceId, with
// the same renewal timing the web app uses.
import { useEffect, useRef, useState } from 'react';
import { createRealtimeClient } from '@neon/realtime';
import type { RealtimeClient, SealedLiveQuery } from '@neon/realtime';
import api from './api';
import { getRealtimeUrl } from '../config';
import { apiErrorMessage } from './api';

// The sealed query is an opaque bearer capability; rows are re-typed at the
// subscribe call site.
type AnySealed = SealedLiveQuery<unknown>;

let client: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient | null {
  const url = getRealtimeUrl();
  if (!url) return null;
  if (!client) {
    client = createRealtimeClient({ url, logLevel: 'warn' });
  }
  return client;
}

// POST /api/realtime/:viewType/:resourceId — returns a sealed live query whose
// authorization is the seal itself (the API checks publish state for viewers).
async function fetchSealed(viewType: 'section' | 'faculty' | 'room', resourceId: string) {
  const res = await api.post(`/realtime/${viewType}/${resourceId}`);
  return res.data as AnySealed;
}

// Same renewal timing the React/TanStack bindings use: renew 10s before expiry,
// retry a failed renewal after 1s, stop on a rejected renewal (final error).
const RENEW_EARLY_MS = 10_000;
const RETRY_MS = 1_000;

export function renewBeforeExpiry(
  subscription: { renew(next: AnySealed): Promise<unknown> },
  sealedQuery: AnySealed,
  fetchSealedQuery: () => Promise<AnySealed>
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function schedule(delay: number) {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(renew, delay);
  }

  function scheduleBeforeExpiry(expiresAt: number) {
    schedule(Math.max(0, expiresAt - Date.now() - RENEW_EARLY_MS));
  }

  async function renew() {
    let next: AnySealed;
    try {
      next = await fetchSealedQuery();
    } catch {
      schedule(RETRY_MS);
      return;
    }
    scheduleBeforeExpiry(next.expiresAt);
    subscription.renew(next).catch(() => {
      stopped = true;
      clearTimeout(timer);
    });
  }

  scheduleBeforeExpiry(sealedQuery.expiresAt);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

export type LiveQueryState = 'connecting' | 'live' | 'error' | 'unavailable';

// React hook: subscribes to a live timetable query and keeps `rows` fresh.
// Falls back to the initial REST snapshot when realtime is unavailable, so the
// grid still renders on networks that block WebSockets.
export function useLiveTimetable<T>(
  viewType: 'section' | 'faculty' | 'room',
  resourceId: string | null,
  fallbackRows: T[] | null
) {
  const [rows, setRows] = useState<T[] | null>(fallbackRows);
  const [state, setState] = useState<LiveQueryState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const fallbackRef = useRef(fallbackRows);
  fallbackRef.current = fallbackRows;

  useEffect(() => {
    if (!resourceId) {
      setRows(null);
      return;
    }
    let active = true;
    let stopRenewal: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    const rt = getRealtimeClient();

    (async () => {
      try {
        const sealed = await fetchSealed(viewType, resourceId);
        if (!active) return;
        if (!rt) {
          setState('unavailable');
          return;
        }
        const subscription = rt.subscribe<T>(sealed as SealedLiveQuery<T>);
        unsubscribe = () => subscription.unsubscribe();
        subscription.onChange((snapshot) => {
          if (!active) return;
          if (Array.isArray(snapshot.data)) setRows(snapshot.data as T[]);
        });
        subscription.onStateChange((s) => {
          if (!active) return;
          if (s.status === 'live') setState('live');
          if (s.status === 'error') {
            setState('error');
            setError(s.error?.message || 'Live connection error');
          }
        });
        stopRenewal = renewBeforeExpiry(subscription, sealed, () =>
          fetchSealed(viewType, resourceId)
        );
      } catch (err) {
        if (!active) return;
        setState('error');
        setError(apiErrorMessage(err, 'Could not start the live connection.'));
      }
    })();

    return () => {
      active = false;
      stopRenewal?.();
      unsubscribe?.();
    };
  }, [viewType, resourceId]);

  return { rows: rows ?? fallbackRef.current ?? [], state, error };
}
