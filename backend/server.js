const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load Neon-managed env vars from the repo root (.env.local, written by `neon deploy`)
// first, then backend-local .env for app settings. Existing vars are never overridden.
dotenv.config({ quiet: true, path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ quiet: true });

const { verifyAuth } = require('./middleware/auth');
const { attachUser, requireProvisioned } = require('./middleware/rbac');
const { headers, jsonLimiter, authLimiter, heavyLimiter, proxyLimiter, requestLogging } = require('./middleware/security');
const idempotency = require('./middleware/idempotency');
const jobService = require('./services/jobService');

const app = express();
const PORT = process.env.PORT || 5000;

// Request ids + JSON access log first, then security headers.
app.use(requestLogging);
app.use(headers);

// Middleware
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'exp://',
    process.env.FRONTEND_URL || 'https://time-table-beta-silk.vercel.app'
];

app.use(cors({
    origin: function (origin, callback) {
        // Native mobile clients send no Origin header at all — allow those.
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true
}));

// Cap JSON bodies (Excel uploads are multipart with their own limits).
app.use(express.json({ limit: '1mb' }));

// Global per-IP rate limit for the API surface.
app.use(jsonLimiter);

// Public routes (no auth)
app.get('/', (req, res) => {
    res.send('Timetable Management System API');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Public bootstrap config for the mobile app: the branch's Neon Auth and
// Realtime URLs, so clients never hardcode them. No secrets are exposed —
// both values are already public to every authenticated web client.
// `authProxyBaseUrl` hands mobile clients the local /neon-auth proxy below —
// emulator NATs and locked-down networks often cannot reach the auth server
// directly, but they can always reach this API.
app.get('/api/config', (req, res) => {
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const wsProto = proto === 'https' ? 'wss' : 'ws';
    res.json({
        authBaseUrl: process.env.NEON_AUTH_BASE_URL || null,
        authProxyBaseUrl: process.env.NEON_AUTH_BASE_URL ? `${proto}://${req.get('host')}/neon-auth` : null,
        realtimeUrl: process.env.NEON_REALTIME_URL ? `${wsProto}://${req.get('host')}/neon-rt` : null,
    });
});

// Transparent proxy to the Neon Auth server under /neon-auth/*. Neon Auth is
// cookie-native and origin-checked; native clients replay the signed session
// cookie manually, so this just pipes method, body, and the few headers that
// matter, and streams back status + Set-Cookie + JSON. Public by design — the
// auth server performs all authentication.
const AUTH_PROXY_FORWARDED = ['content-type', 'authorization', 'cookie', 'origin', 'accept'];
const neonAuthProxy = async (req, res) => {
    if (!process.env.NEON_AUTH_BASE_URL) return res.status(503).json({ error: 'Auth server not configured.' });
    const upstream = process.env.NEON_AUTH_BASE_URL.replace(/\/$/, '') + req.originalUrl.slice('/neon-auth'.length);
    const headers = {};
    for (const h of AUTH_PROXY_FORWARDED) {
        if (req.headers[h]) headers[h] = req.headers[h];
    }
    try {
        const upstreamRes = await fetch(upstream, {
            method: req.method,
            headers,
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        });
        res.status(upstreamRes.status);
        const contentType = upstreamRes.headers.get('content-type');
        if (contentType) res.setHeader('Content-Type', contentType);
        const setCookies = upstreamRes.headers.getSetCookie ? upstreamRes.headers.getSetCookie() : [];
        if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
        const buf = Buffer.from(await upstreamRes.arrayBuffer());
        res.send(buf);
    } catch (error) {
        console.error('Auth proxy failed:', error.message);
        res.status(502).json({ error: 'Auth server unreachable via proxy.' });
    }
};
app.use('/neon-auth', proxyLimiter, neonAuthProxy);

// Mobile token lifecycle (enterprise plan F2): session cookie → API token pair
// with rotating refresh tokens. Stricter rate limit.
app.use('/api/auth', authLimiter, require('./routes/authRoutes'));

// Verify Bearer JWTs (Neon JWKS + this API's HS256 tokens) for API routes, then
// resolve the caller's app role + faculty link. Routes with requireAuth /
// requireRole / requireProvisioned then enforce access.
app.use('/api', verifyAuth, attachUser);

// Idempotency for mutations: retries with the same Idempotency-Key replay the
// first response instead of double-applying (enterprise plan F6).
app.use('/api', idempotency());

// Helper to require auth
const requireAuth = (req, res, next) => {
    if (!req.auth || !req.auth.userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

// Data routers additionally require the caller to be on the portal-access
// allowlist (see accessRoutes' /check for the pre-auth lookup the login page
// uses). /api/me, /api/access and /api/admin are exempt: /me must answer so the
// frontend can show the "not added" screen, /access serves the public check, and
// /admin must let the first admin bootstrap; its own requireRole gates apply.
const apiMounts = [
    ['/timetable', [requireAuth, requireProvisioned], './routes/timetableRoutes'],
    ['/programs', [requireAuth, requireProvisioned], './routes/programSectionRoutes'],
    ['/resources', [requireAuth, requireProvisioned], './routes/subjectRoutes'],
    ['/upload', [requireAuth, requireProvisioned, heavyLimiter], './routes/uploadRoutes'],
    ['/workloads', [requireAuth, requireProvisioned], './routes/workloadRoutes'],
    ['/ai', [requireAuth, requireProvisioned, heavyLimiter], './routes/aiRoutes'],
    ['/realtime', [requireAuth, requireProvisioned], './routes/realtimeRoutes'],
    ['/me', [requireAuth], './routes/meRoutes'],
    ['/admin', [requireAuth], './routes/adminRoutes'],
    ['/requests', [requireAuth, requireProvisioned], './routes/requestRoutes'],
    ['/export', [requireAuth, requireProvisioned, heavyLimiter], './routes/exportRoutes'],
    ['/access', [], './routes/accessRoutes'],
];

// Same routers under /api (current clients) and /api/v1 (versioned contract).
for (const prefix of ['/api', '/api/v1']) {
    for (const [routePath, middlewares, modulePath] of apiMounts) {
        app.use(prefix + routePath, ...middlewares, require(modulePath));
    }
}

// Job pipeline endpoints live at the API root (their paths are explicit).
app.use('/api', require('./routes/jobRoutes'));
app.use('/api/v1', require('./routes/jobRoutes'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack || err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Something broke!' });
});

// Background worker (enterprise plan F4/F12/F17): staged imports, exports,
// notification outbox, change-request expiry.
const uploadController = require('./controllers/uploadController');
const exportController = require('./controllers/exportController');
jobService.register('import', uploadController.importHandlers.import);
jobService.register('export', exportController.exportHandler);
jobService.startWorker();

// Transparent WebSocket tunnel to the Neon Realtime server under /neon-rt/*.
// The realtime client speaks raw WebSocket; we forward the upgrade request
// verbatim over TLS to the upstream wss endpoint (path rewritten) and pipe
// bytes both ways — authorization rides in the sealed-query messages.
const tls = require('tls');

const realtimeUrl = process.env.NEON_REALTIME_URL;

if (realtimeUrl) {
    const rtUrl = new URL(realtimeUrl);
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

    server.on('upgrade', (req, clientSocket, head) => {
        if (!req.url.startsWith('/neon-rt')) {
            clientSocket.destroy();
            return;
        }
        const upstreamPath = (rtUrl.pathname || '') + req.url.slice('/neon-rt'.length);
        const upstream = tls.connect(
            { host: rtUrl.hostname, port: rtUrl.port || 443, servername: rtUrl.hostname },
            () => {
                // Minimal clean handshake — clients send extra headers
                // (permessage-deflate, user agents) that the upstream's edge
                // rejects with 403; undici-style minimal handshakes pass.
                const wanted = {
                    host: rtUrl.host,
                    upgrade: 'websocket',
                    connection: 'Upgrade',
                    'sec-websocket-key': req.headers['sec-websocket-key'],
                    'sec-websocket-version': req.headers['sec-websocket-version'],
                    'sec-websocket-protocol': req.headers['sec-websocket-protocol'],
                };
                const raw =
                    `${req.method} ${upstreamPath} HTTP/1.1\r\n` +
                    Object.entries(wanted)
                        .filter(([, v]) => v)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\r\n') +
                    '\r\n\r\n';
                upstream.write(raw);
                if (head && head.length) upstream.write(head);
                upstream.pipe(clientSocket);
                clientSocket.pipe(upstream);
            }
        );
        upstream.on('error', (e) => { console.log('RT tunnel upstream error:', e.message); clientSocket.destroy(); });
        clientSocket.on('error', (e) => { console.log('RT tunnel client error:', e.message); upstream.destroy(); });
        clientSocket.on('close', () => upstream.destroy());
    });
} else {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

process.on('SIGTERM', () => {
    jobService.stopWorker();
    process.exit(0);
});
