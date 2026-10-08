import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'security-hardening-secret-0123456789abcdef';
process.env.FRONTEND_URL = 'https://frontdoor.example.test';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { isEntraUserDeleted } = await import('../server/services/entraGroups.js');

const OWNER_ID = 'security-hardening-owner';
let server;
let baseUrl;

const sessionToken = (options = {}, payload = { userId: OWNER_ID }) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor', ...options });

before(async () => {
  db.prepare('INSERT OR REPLACE INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(OWNER_ID, 'owner@security-hardening.test', 'Security Owner', 'owner');
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('unknown API routes answer with a JSON 404', async () => {
  const res = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'not_found');
});

test('cookie requests that change data must come from a trusted origin', async () => {
  const cookie = `frontdoor_token=${sessionToken()}`;
  const post = (headers) => fetch(`${baseUrl}/api/logs/clear-access`, { method: 'POST', headers: { Cookie: cookie, ...headers } });

  let res = await post({ 'Sec-Fetch-Site': 'same-site', Origin: 'https://other.example.test' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'cross_site_request');

  res = await post({ 'Sec-Fetch-Site': 'same-site' });
  assert.equal(res.status, 403);

  res = await post({ 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(res.status, 200);

  res = await post({ 'Sec-Fetch-Site': 'same-site', Origin: 'https://frontdoor.example.test' });
  assert.equal(res.status, 200);

  // Bearer clients (no session cookie) are not affected.
  res = await fetch(`${baseUrl}/api/logs/clear-access`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken()}`, 'Sec-Fetch-Site': 'cross-site', Origin: 'https://other.example.test' },
  });
  assert.equal(res.status, 200);
});

test('only session tokens are accepted for API sessions', async () => {
  const me = (token) => fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await me(sessionToken())).status, 200);
  assert.equal((await me(jwt.sign({ userId: OWNER_ID }, process.env.JWT_SECRET, { expiresIn: '5m' }))).status, 401);
  assert.equal((await me(sessionToken({ issuer: 'someone-else' }))).status, 401);
  assert.equal((await me(sessionToken({ audience: 'wiki' }))).status, 401);
  assert.equal((await me(sessionToken({}, { sub: OWNER_ID }))).status, 401);
});

test('backup uploads must be sent as binary', async () => {
  const res = await fetch(`${baseUrl}/api/backups/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken()}`, 'Content-Type': 'text/plain' },
    body: 'not a backup',
  });
  assert.equal(res.status, 415);
  assert.equal((await res.json()).code, 'backup_upload_content_type');
});

test('an Entra identity counts as deleted only when Graph says the object does not exist', async () => {
  const originalFetch = global.fetch;
  const respond = (status, body) => { global.fetch = async () => new Response(JSON.stringify(body), { status }); };
  const acquireToken = async () => 'token';
  try {
    respond(404, { error: { code: 'Request_ResourceNotFound' } });
    assert.equal(await isEntraUserDeleted('old-id', { acquireToken }), true);
    respond(200, { value: [] });
    assert.equal(await isEntraUserDeleted('old-id', { acquireToken }), false);
    respond(403, { error: { code: 'Authorization_RequestDenied' } });
    assert.equal(await isEntraUserDeleted('old-id', { acquireToken }), false);
    assert.equal(await isEntraUserDeleted('old-id', { acquireToken: async () => { throw new Error('no credentials'); } }), false);
  } finally {
    global.fetch = originalFetch;
  }
});
