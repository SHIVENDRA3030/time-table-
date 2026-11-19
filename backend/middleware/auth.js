// Verifies Bearer JWTs and exposes the verified user id as req.auth.userId.
// Two token families are accepted (enterprise plan F2):
//   1. Neon Auth JWTs (web clients, verified against the auth server's JWKS)
//   2. This API's own HS256 access tokens (mobile, issued by services/tokenService
//      after server-side session verification) — audience 'timetable-api'
const { createRemoteJWKSet, jwtVerify } = require('jose');
const tokenService = require('../services/tokenService');

const authBaseUrl = process.env.NEON_AUTH_BASE_URL;
const jwksUrl = process.env.NEON_AUTH_JWKS_URL || (authBaseUrl && `${authBaseUrl}/.well-known/jwks.json`);

if (!authBaseUrl || !jwksUrl) {
    throw new Error(
        'Missing NEON_AUTH_BASE_URL / NEON_AUTH_JWKS_URL. Run `neon deploy` in the project root to provision Neon Auth.'
    );
}

// Issuer and audience are the auth URL's origin, per the Neon Auth JWT docs.
const issuer = new URL(authBaseUrl).origin;
const jwks = createRemoteJWKSet(new URL(jwksUrl));

const verifyNeonToken = async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer });
    return { userId: payload.sub, email: payload.email || null, name: payload.name || null };
};

const verifyAuth = async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return next();
    }

    // Mobile access tokens carry the API audience — try them first so a valid
    // mobile token never depends on a JWKS round-trip.
    const apiPayload = await tokenService.verifyAccessToken(token);
    if (apiPayload) {
        req.auth = { userId: apiPayload.sub, email: apiPayload.email || null, name: apiPayload.name || null };
        return next();
    }

    try {
        req.auth = await verifyNeonToken(token);
    } catch (error) {
        console.error('Token verification failed:', error.message);
        req.auth = undefined;
    }

    next();
};

module.exports = { verifyAuth };
