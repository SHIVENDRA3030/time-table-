import { createRealtimeClient } from '@neon/realtime/client';

// One client for the whole app — every subscription multiplexes over one WebSocket.
export const realtimeClient = createRealtimeClient({
    url: import.meta.env.VITE_NEON_REALTIME_URL,
    logLevel: 'warn',
});

// Same renewal timing the React/TanStack bindings use: renew 10s before expiry,
// retry a failed renewal after 1s, stop on a rejected renewal (final error).
const RENEW_EARLY_MS = 10_000;
const RETRY_MS = 1_000;

export function renewBeforeExpiry(subscription, sealedQuery, fetchSealedQuery) {
    let timer;
    let stopped = false;

    function schedule(delay) {
        clearTimeout(timer);
        if (!stopped) timer = setTimeout(renew, delay);
    }

    function scheduleBeforeExpiry(expiresAt) {
        schedule(Math.max(0, expiresAt - Date.now() - RENEW_EARLY_MS));
    }

    async function renew() {
        let next;
        try {
            next = await fetchSealedQuery();
        } catch {
            schedule(RETRY_MS);
            return;
        }
        scheduleBeforeExpiry(next.expiresAt);
        subscription.renew(next).catch(() => stop());
    }

    function stop() {
        stopped = true;
        clearTimeout(timer);
    }

    scheduleBeforeExpiry(sealedQuery.expiresAt);
    return stop;
}
