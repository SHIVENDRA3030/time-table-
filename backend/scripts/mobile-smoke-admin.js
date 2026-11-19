// One-off: grant the mobile admin test account the admin role.
const { neon } = require('@neondatabase/serverless');
const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });

const sql = neon(process.env.DATABASE_URL);

(async () => {
  await sql`
    INSERT INTO app_users (user_id, role, display_name)
    VALUES ('aa82e38e-6609-4aa7-981a-d1fdef69cb76', 'admin', 'Mobile Admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin'`;
  const check = await sql`SELECT user_id, role FROM app_users ORDER BY role`;
  console.log(check);
  console.log('cleanup: DELETE FROM app_users WHERE user_id = \'aa82e38e-6609-4aa7-981a-d1fdef69cb76\';');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
