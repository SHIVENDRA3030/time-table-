// Recovery: manually allowlist an admin email so a misconfigured install can
// never lock itself out of its own management portal.
//   node scripts/seed-admin-access.js admin@college.edu
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });
const db = require('../db');

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: node scripts/seed-admin-access.js <email>');
    process.exit(1);
}

(async () => {
    const { rows } = await db.query(
        `INSERT INTO portal_access (email, access_role, full_name, is_active)
         VALUES ($1, 'admin', $2, TRUE)
         ON CONFLICT (email) DO UPDATE SET access_role = 'admin', is_active = TRUE
         RETURNING id, email, access_role, is_active`,
        [email, email.split('@')[0]]
    );
    console.log('Allowlisted as admin:', rows[0]);
    process.exit(0);
})().catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
