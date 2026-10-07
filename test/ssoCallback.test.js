import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { ConfidentialClientApplication } from '@azure/msal-node';

process.env.JWT_SECRET ||= 'sso-callback-test-secret-0123456789abcdef';
process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000002';
process.env.AZURE_REDIRECT_URI = 'http://localhost:3001/api/auth/microsoft/callback';
process.env.FRONTEND_URL = 'http://localhost:3001';
process.env.BASE_DOMAIN = 'localhost';
process.env.ENTRA_GROUP_SYNC = 'false';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

const realFetch = globalThis.fetch;
let server;
let baseUrl;
let graphProfile;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

// Completes the Microsoft callback for graphProfile with MSAL and Graph mocked.
async function signIn(t) {
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByCode', async () => ({ accessToken: 'test-access-token' }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = String(url);
    if (target === 'https://graph.microsoft.com/v1.0/me') {
      return new Response(JSON.stringify(graphProfile), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target.startsWith('https://')) return new Response('', { status: 404 });
    return realFetch(url, options);
  });
  const state = `state-${Math.random().toString(36).slice(2)}`;
  db.prepare('INSERT INTO auth_pending_states (state) VALUES (?)').run(state);
  return realFetch(`${baseUrl}/api/auth/microsoft/callback?code=test-code&state=${state}`, { redirect: 'manual' });
}

test('a deactivated user signing in with Microsoft is refused with account_disabled, not a server error', async (t) => {
  db.prepare("INSERT INTO users (id, email, display_name, microsoft_id, role, is_active, entra_missing_since) VALUES ('sso-disabled', 'disabled@sso-test.local', 'Disabled', 'ms-disabled', 'user', 0, '2026-10-01 08:00:00')").run();
  graphProfile = { id: 'ms-disabled', mail: 'disabled@sso-test.local', displayName: 'Disabled' };

  const res = await signIn(t);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'http://localhost:3001/login?error=account_disabled');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'disabled@sso-test.local'").get().n, 1);
  assert.deepEqual(db.prepare("SELECT is_active, entra_missing_since FROM users WHERE id = 'sso-disabled'").get(), { is_active: 0, entra_missing_since: '2026-10-01 08:00:00' });
});

test('an active user signing in clears the "not found in Entra" mark', async (t) => {
  db.prepare("INSERT INTO users (id, email, display_name, microsoft_id, role, is_active, entra_missing_since) VALUES ('sso-back', 'back@sso-test.local', 'Back', 'ms-back', 'user', 1, '2026-10-01 08:00:00')").run();
  graphProfile = { id: 'ms-back', mail: 'back@sso-test.local', displayName: 'Back' };

  const res = await signIn(t);
  assert.equal(res.status, 302);
  assert.doesNotMatch(res.headers.get('location') || '', /error=/);
  assert.match(res.headers.get('set-cookie') || '', /frontdoor_token=/);
  assert.equal(db.prepare("SELECT entra_missing_since FROM users WHERE id = 'sso-back'").get().entra_missing_since, null);
});
