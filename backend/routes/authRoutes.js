// Mobile token lifecycle endpoints (enterprise plan F2). Exchanged for the
// Neon session cookie at sign-in; refresh tokens rotate on every use and
// reuse revokes the family. Rate limited by authLimiter in server.js.
const express = require('express');
const tokenService = require('../services/tokenService');

const router = express.Router();

const tokenErrorStatus = (code) => {
    if (code === 'reuse_detected') return 401;
    if (code === 'expired') return 401;
    return 401;
};

// POST /api/auth/token — exchange a Neon session cookie for an API token pair.
router.post('/token', async (req, res) => {
    try {
        const { sessionCookie } = req.body || {};
        if (!sessionCookie || typeof sessionCookie !== 'string') {
            return res.status(400).json({ error: 'sessionCookie is required.' });
        }
        const tokens = await tokenService.issueTokensForSession(sessionCookie);
        if (!tokens) {
            return res.status(401).json({ error: 'Session is invalid or expired.' });
        }
        res.json(tokens);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/auth/refresh — rotate: old refresh token becomes unusable, reuse
// of a superseded token revokes the whole family.
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body || {};
        if (!refreshToken) {
            return res.status(400).json({ error: 'refreshToken is required.' });
        }
        const result = await tokenService.rotateRefreshToken(refreshToken);
        if (result.error) {
            return res.status(tokenErrorStatus(result.error)).json({
                error: result.error === 'reuse_detected'
                    ? 'Refresh token reuse detected; all sessions for this account were revoked. Sign in again.'
                    : 'Refresh token is invalid or expired. Sign in again.',
                code: result.error,
            });
        }
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/auth/revoke — explicit sign-out: revoke the whole token family.
router.post('/revoke', async (req, res) => {
    try {
        const { refreshToken } = req.body || {};
        if (!refreshToken) {
            return res.status(400).json({ error: 'refreshToken is required.' });
        }
        await tokenService.revokeByRefreshToken(refreshToken);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
