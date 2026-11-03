// Characterisation of app visibility and launch checks across every route that
// decides "can this user reach this app". Written before extracting that logic
// into server/services/appCatalog.js, so the extraction is proven behaviour-neutral.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'app-access-test-secret-0123456789abcdef';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-00000000aaaa';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

let server;
let baseUrl;

const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const call = (method, path, userId) => fetch(`${baseUrl}${path}`, {
  method,
  headers: { Authorization: `Bearer ${tokenFor(userId)}` },
  redirect: 'manual',
});
const accessLogCount = (userId) => db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE user_id = ?').get(userId).n;

before(async () => {
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  for (const id of ['c-member', 'c-entra', 'c-outsider']) {
    run('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)', id, `${id}@catalog.test`, id, 'user');
  }
  run("INSERT INTO user_groups (id, name) VALUES ('cg-team', 'Team'), ('cg-entra', 'Entra container')");
  run("INSERT INTO group_entra_group_memberships (parent_group_id, entra_group_id) VALUES ('cg-entra', 'entra-c')");

  const apps = [
    ['ca-redirect', 'Alpha', 'alpha', 'https://alpha.example.com', 'redirect', 1],
    ['ca-plain', 'Bravo', 'bravo', 'https://bravo.example.com', 'redirect-plain', 2],
    ['ca-internal', 'Charlie', 'charlie', 'http://10.0.0.5', 'internal-link', 3],
    ['ca-entra', 'Delta', 'delta', 'https://delta.example.com', 'entra-app', 4],
    ['ca-cookie', 'Echo', 'echo', 'https://echo.example.com', 'shared-cookie', 5],
  ];
  for (const [id, name, slug, url, mode, order] of apps) {
    run('INSERT INTO apps (id, name, slug, target_url, mode, sort_order, sso_endpoint) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, name, slug, url, mode, order, mode === 'entra-app' ? '11111111-2222-3333-4444-555555555555' : null);
    run('INSERT INTO app_permissions (app_id, group_id) VALUES (?, ?)', id, 'cg-team');
  }
  // The same app granted twice must still be listed once.
  run("INSERT INTO app_permissions (app_id, group_id) VALUES ('ca-plain', 'cg-entra'), ('ca-entra', 'cg-entra')");
  run("INSERT INTO user_group_members (user_id, group_id) VALUES ('c-member', 'cg-team')");
  run("INSERT INTO entra_user_group_memberships (user_id, entra_group_id, synced_at) VALUES ('c-entra', 'entra-c', '2026-11-03 08:00:00')");

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('the app list is ordered, de-duplicated and carries the launch URL per mode', async () => {
  const { apps } = await (await call('GET', '/api/apps', 'c-member')).json();
  assert.deepEqual(apps.map((app) => [app.slug, app.url]), [
    ['alpha', '/api/apps/alpha/sso-redirect'],
    ['bravo', 'https://bravo.example.com'],
    ['charlie', 'http://10.0.0.5'],
    ['delta', '/api/apps/delta/entra-redirect'],
    ['echo', 'https://echo.example.com'],
  ]);

  const entraView = await (await call('GET', '/api/apps', 'c-entra')).json();
  assert.deepEqual(entraView.apps.map((app) => app.slug), ['bravo', 'delta']);
  assert.deepEqual((await (await call('GET', '/api/apps', 'c-outsider')).json()).apps, []);
});

test('entra-redirect is granted only through a granting group and logs the access', async () => {
  const before = accessLogCount('c-entra');
  const ok = await call('GET', '/api/apps/delta/entra-redirect', 'c-entra');
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('location'), /^https:\/\/launcher\.myapps\.microsoft\.com\/api\/signin\/11111111-2222-3333-4444-555555555555\?tenantId=/);
  assert.equal(accessLogCount('c-entra'), before + 1);

  const denied = await call('GET', '/api/apps/delta/entra-redirect', 'c-outsider');
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'access_denied');
  assert.equal(accessLogCount('c-outsider'), 0);

  assert.equal((await call('GET', '/api/apps/alpha/entra-redirect', 'c-member')).status, 404);
});

test('track-access records only for users who can reach the app', async () => {
  const before = accessLogCount('c-member');
  assert.equal((await call('POST', '/api/apps/charlie/track-access', 'c-member')).status, 204);
  assert.equal(accessLogCount('c-member'), before + 1);

  const denied = await call('POST', '/api/apps/charlie/track-access', 'c-entra');
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'access_denied');

  assert.equal((await call('POST', '/api/apps/missing/track-access', 'c-member')).status, 404);
});

test('sso-redirect sends non-redirect modes straight to the target after the RBAC check', async () => {
  const res = await call('GET', '/api/apps/charlie/sso-redirect', 'c-member');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'http://10.0.0.5');
  assert.equal((await call('GET', '/api/apps/charlie/sso-redirect', 'c-outsider')).status, 403);
});
