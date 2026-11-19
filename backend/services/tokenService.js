// Mobile token lifecycle (enterprise plan F2). Neon Auth's managed server does
// not expose a bearer/refresh plugin, so this backend acts as the token issuer
// for mobile clients: it verifies the Neon session server-side, then issues
// short-lived access tokens (HS256, 15 min) with rotating refresh tokens
// (30 days, single use, reuse detection revokes the whole family). The
// browser-style cookie replay path is retired for mobile.
const crypto = require('crypto');
const { SignJWT, jwtVerify } = require('jose');
const db = require('../db');

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;
const AUDIENCE = 'timetable-api';

const secret = process.env.API_JWT_SECRET;
if (!secret) {
    throw new Error('Missing API_JWT_SECRET. Set it in backend/.env (generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))").');
}
const secretKey = new TextEncoder().encode(secret);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const verifySessionServerSide = async (sessionCookie) => {
    const authBaseUrl = process.env.NEON_AUTH_BASE_URL;
    if (!authBaseUrl || !sessionCookie) return null;
    try {
        const res = await fetch(`${authBaseUrl.replace(/\/$/, '')}/get-session`, {
            headers: { Cookie: sessionCookie },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data?.user) return null;
        return { user: data.user, sessionToken: data.session?.token || sessionCookie };
    } catch {
        return null;
    }
};

const signAccessToken = async (user) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email: user.email || null, name: user.name || null })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuedAt(now)
        .setExpirationTime(now + ACCESS_TTL_SEC)
        .setAudience(AUDIENCE)
        .setIssuer('timetable-studio-api')
        .sign(secretKey);
};

// Verify one of our own access tokens. Returns null when invalid/expired.
const verifyAccessToken = async (token) => {
    try {
        const { payload } = await jwtVerify(token, secretKey, {
            issuer: 'timetable-studio-api',
            audience: AUDIENCE,
        });
        return payload;
    } catch {
        return null;
    }
};

const issueTokensForSession = async (sessionCookie) => {
    const session = await verifySessionServerSide(sessionCookie);
    if (!session) return null;
    const user = session.user;
    return issueTokensForUser(user);
};

const issueTokensForUser = async (user) => {
    const accessToken = await signAccessToken(user);
    const refreshToken = crypto.randomBytes(48).toString('base64url');
    const familyId = crypto.randomUUID();
    await db.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + INTERVAL '${REFRESH_TTL_SEC} seconds')`,
        [user.id, familyId, sha256(refreshToken)]
    );
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC, user };
};

// Rotation with reuse detection: presenting an already-rotated or revoked
// refresh token revokes the entire family (assume theft) and fails.
const rotateRefreshToken = async (refreshToken) => {
    const tokenHash = sha256(refreshToken);
    const { rows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    const current = rows[0];
    if (!current) {
        return { error: 'invalid' };
    }
    if (current.revoked_at || current.rotated_to) {
        await db.query(
            'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
            [current.family_id]
        );
        return { error: 'reuse_detected' };
    }
    if (new Date(current.expires_at).getTime() < Date.now()) {
        return { error: 'expired' };
    }

    const { rows: userRows } = await db.query(
        `SELECT rt.user_id, u.email, u.name
           FROM refresh_tokens rt
           LEFT JOIN neon_auth.user u ON u.id::text = rt.user_id
          WHERE rt.token_hash = $1`,
        [tokenHash]
    );
    const userId = userRows[0].user_id;
    const user = { id: userId, email: userRows[0].email || null, name: userRows[0].name || null };

    const newRefresh = crypto.randomBytes(48).toString('base64url');
    const { rows: newRows } = await db.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + INTERVAL '${REFRESH_TTL_SEC} seconds')
         RETURNING id`,
        [userId, current.family_id, sha256(newRefresh)]
    );
    await db.query('UPDATE refresh_tokens SET rotated_to = $1 WHERE id = $2', [newRows[0].id, current.id]);

    const accessToken = await signAccessToken(user);
    return { accessToken, refreshToken: newRefresh, expiresIn: ACCESS_TTL_SEC, user };
};

const revokeByRefreshToken = async (refreshToken) => {
    const tokenHash = sha256(refreshToken);
    const { rows } = await db.query('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    if (!rows[0]) return false;
    await db.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
        [rows[0].family_id]
    );
    return true;
};

module.exports = {
    issueTokensForSession,
    issueTokensForUser,
    rotateRefreshToken,
    revokeByRefreshToken,
    verifyAccessToken,
    AUDIENCE,
};
