import { createAuthClient } from '@neon/auth';
import { BetterAuthReactAdapter } from '@neon/auth/react/adapters';

// Neon Auth (Managed Better Auth) client. The URL is the branch's auth server;
// localhost origins are pre-approved as trusted domains by default.
export const authClient = createAuthClient(import.meta.env.VITE_NEON_AUTH_URL, {
    adapter: BetterAuthReactAdapter(),
});

// Dev-only handle for diagnosing auth flows in the browser console.
if (import.meta.env.DEV) {
    window.__authClient = authClient;
}

export default authClient;
