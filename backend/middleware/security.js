// Security middleware stack (enterprise plan F10): security headers, rate
// limits, and request logging. Rate limits are per-IP; stricter on auth,
// upload, AI, and the Neon proxy routes.
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// CSP is intentionally not enforced yet: the SPA and the brand assets would
// need a tuned policy first. Everything else from helmet is active.
const headers = helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
});

// Local development traffic (Vite HMR, smoke tests, parallel agents) shares
// one IP and would burn the per-IP budget — exempt loopback unless production.
const isLocalDev = (req) =>
    process.env.NODE_ENV !== 'production' &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip || '');

const jsonLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: isLocalDev,
    message: { error: 'Too many requests. Slow down and retry shortly.' },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: isLocalDev,
    message: { error: 'Too many authentication attempts. Try again later.' },
});

const heavyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many heavy operations. Try again later.' },
});

const proxyLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Proxy rate limit exceeded.' },
});

// Request IDs + a structured access log line per request (enterprise plan F16,
// minimal form: logs are JSON, greppable, and carry the request id through).
let logSeq = 0;
const requestLogging = (req, res, next) => {
    req.requestId = `req_${Date.now().toString(36)}_${(logSeq++).toString(36)}`;
    res.set('X-Request-Id', req.requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        if (req.path === '/health' || req.path === '/') return; // probe noise
        console.log(JSON.stringify({
            level: 'info',
            msg: 'request',
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl.split('?')[0],
            status: res.statusCode,
            ms: Math.round(ms),
            userId: req.auth?.userId || null,
        }));
    });
    next();
};

module.exports = { headers, jsonLimiter, authLimiter, heavyLimiter, proxyLimiter, requestLogging };
