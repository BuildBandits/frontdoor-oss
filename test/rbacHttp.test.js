// End-to-end access checks through the real routes and group resolution
// (groupHierarchy.js), unlike rbac.test.js which exercises a schema copy.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'rbac-http-test-secret-0123456789abcdef';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

let server;
let baseUrl;

const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const get = (path, userId) => fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${tokenFor(userId)}` }, redirect: 'manual' });
const visibleSlugs = async (userId) => (await (await get('/api/apps', userId)).json()).apps.map((app) => app.slug).sort();

before(async () => {
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  for (const [id, active] of [['u-direct', 1], ['u-nested', 1], ['u-entra', 1], ['u-outsider', 1], ['u-inactive', 0]]) {
    run('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, ?)', id, `${id}@rbac.test`, id, 'user', active);
  }
  run("INSERT INTO user_groups (id, name) VALUES ('g-parent', 'Parent'), ('g-child', 'Child'), ('g-container', 'Container')");
  // g-child is linked into g-parent: members of the child get the parent's apps.
  run("INSERT INTO group_group_memberships (parent_group_id, child_group_id) VALUES ('g-parent', 'g-child')");
  run("INSERT INTO group_entra_group_memberships (parent_group_id, entra_group_id) VALUES ('g-container', 'entra-1')");

  run("INSERT INTO apps (id, name, slug, target_url, mode) VALUES ('a-parent', 'Parent App', 'parent-app', 'https://parent.example.com', 'redirect-plain')");
  run("INSERT INTO apps (id, name, slug, target_url, mode) VALUES ('a-entra', 'Entra App', 'entra-app', 'https://entra.example.com', 'redirect-plain')");
  run("INSERT INTO apps (id, name, slug, target_url, mode, is_active) VALUES ('a-off', 'Off App', 'off-app', 'https://off.example.com', 'redirect-plain', 0)");
  run("INSERT INTO app_permissions (app_id, group_id) VALUES ('a-parent', 'g-parent'), ('a-entra', 'g-container'), ('a-off', 'g-parent')");

  run("INSERT INTO user_group_members (user_id, group_id) VALUES ('u-direct', 'g-parent'), ('u-nested', 'g-child'), ('u-inactive', 'g-parent')");
  run("INSERT INTO entra_user_group_memberships (user_id, entra_group_id, synced_at) VALUES ('u-entra', 'entra-1', '2026-10-09 08:00:00')");

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('the app list follows direct, nested and Entra-linked group access', async () => {
  assert.deepEqual(await visibleSlugs('u-direct'), ['parent-app']);
  assert.deepEqual(await visibleSlugs('u-nested'), ['parent-app']);
  assert.deepEqual(await visibleSlugs('u-entra'), ['entra-app']);
  assert.deepEqual(await visibleSlugs('u-outsider'), []);
});

test('opening an app is allowed only through a granting group', async () => {
  assert.equal((await get('/api/apps/parent-app/sso-redirect', 'u-direct')).status, 302);
  assert.equal((await get('/api/apps/parent-app/sso-redirect', 'u-nested')).status, 302);
  assert.equal((await get('/api/apps/entra-app/sso-redirect', 'u-entra')).status, 302);

  for (const [slug, userId] of [['parent-app', 'u-outsider'], ['parent-app', 'u-entra'], ['entra-app', 'u-direct']]) {
    const res = await get(`/api/apps/${slug}/sso-redirect`, userId);
    assert.equal(res.status, 403, `${userId} opening ${slug}`);
    assert.equal((await res.json()).code, 'access_denied');
  }
});

test('inactive apps and inactive users get no access', async () => {
  assert.notEqual((await get('/api/apps/off-app/sso-redirect', 'u-direct')).status, 302);
  assert.equal((await get('/api/apps', 'u-inactive')).status, 401);
});

test('admin endpoints are refused to plain users', async () => {
  for (const path of ['/api/apps/all', '/api/users', '/api/groups', '/api/logs/audit']) {
    assert.equal((await get(path, 'u-direct')).status, 403, path);
  }
});
