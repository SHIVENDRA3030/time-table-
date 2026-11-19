const path = require('path');
require('dotenv').config({ quiet: true, path: path.resolve(__dirname, '../../.env.local') });
require('dotenv').config({ quiet: true });
const fs = require('fs');
(async () => {
  const BASE = 'http://localhost:5000';
  const AUTH_URL = process.env.NEON_AUTH_BASE_URL;
  const si = await fetch(`${AUTH_URL}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ email: 'mobile.admin@ttstudio.dev', password: 'AdminPass123!' }),
  });
  const sc = si.headers.get('set-cookie') || '';
  const cookie = sc.split(/,(?=[^;]+?=)/)[0].split(';')[0].trim();
  const tok = await (await fetch(BASE + '/api/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionCookie: cookie }) })).json();
  const H = { Authorization: `Bearer ${tok.accessToken}` };

  const buffer = fs.readFileSync(path.resolve(__dirname, '../../Dummy data.xlsx'));
  console.log('file size:', (buffer.length / 1024 / 1024).toFixed(2), 'MB');

  const form = new FormData();
  form.append('file', new Blob([buffer]), 'Dummy data.xlsx');
  const t0 = Date.now();
  const res = await fetch(BASE + '/api/v1/upload', { method: 'POST', headers: H, body: form });
  const ms = Date.now() - t0;
  const body = await res.json();
  console.log('stage status:', res.status, `in ${ms}ms`);
  if (body.preview) {
    console.log('totalParsed:', body.preview.totalParsed, '| missingRooms:', body.preview.quality?.missingRooms, '| online:', body.preview.quality?.onlineClasses);
    console.log('jobId:', body.jobId);
    const job = await (await fetch(BASE + `/api/jobs/${body.jobId}`, { headers: H })).json();
    console.log('job status:', job.status, '(no DB writes — commit not called)');
  } else {
    console.log(JSON.stringify(body).slice(0, 200));
  }
})();
