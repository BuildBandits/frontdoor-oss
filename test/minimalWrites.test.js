import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'minimal-writes-secret-0123456789abcdef';
process.env.ENTRA_GROUP_SYNC = 'true';
process.env.ADMIN_API_KEY = 'minimal-writes-api-key';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { syncUserEntraGroups } = await import('../server/services/entraGroups.js');
const { approvePluginRegistry, upsertPluginRegistry } = await import('../server/services/plugins.js');
const { updateBrandingSettings } = await import('../server/services/branding.js');

const USER_ID = 'minimal-writes-user';
const OLD = '2020-01-01 00:00:00';

let server;
let baseUrl;
let token;

before(async () => {
  db.prepare('INSERT OR REPLACE INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(USER_ID, 'minimal@writes.local', 'Minimal Writes', 'user');
  token = jwt.sign({ userId: USER_ID }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function request(pathname, { body, headers = {}, ...options } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('Entra sync keeps unchanged memberships instead of deleting and re-adding them', () => {
  db.prepare(`
    INSERT OR REPLACE INTO user_groups (id, name, description, source, entra_group_id, entra_display_name)
    VALUES ('mw-sales', 'MW Sales', 'Sales team', 'entra', 'mw-entra-sales', 'MW Sales')
  `).run();
  const graphGroups = [
    { id: 'mw-entra-sales', displayName: 'MW Sales', description: 'Sales team' },
    { id: 'mw-entra-other', displayName: 'MW Other' },
  ];

  const first = syncUserEntraGroups(USER_ID, graphGroups);
  assert.equal(first.membershipsAdded, 1);
  assert.equal(first.membershipsRemoved, 0);
  const membershipRow = () => db.prepare("SELECT rowid FROM user_group_members WHERE user_id = ? AND group_id = 'mw-sales'").get(USER_ID);
  const cacheRow = () => db.prepare("SELECT rowid FROM entra_user_group_memberships WHERE user_id = ? AND entra_group_id = 'mw-entra-sales'").get(USER_ID);
  const membershipRowId = membershipRow().rowid;
  const cacheRowId = cacheRow().rowid;

  const second = syncUserEntraGroups(USER_ID, graphGroups);
  assert.equal(second.membershipsAdded, 0);
  assert.equal(second.membershipsRemoved, 0);
  assert.equal(membershipRow().rowid, membershipRowId);
  assert.equal(cacheRow().rowid, cacheRowId);

  const left = syncUserEntraGroups(USER_ID, [{ id: 'mw-entra-other', displayName: 'MW Other' }]);
  assert.equal(left.membershipsRemoved, 1);
  assert.equal(membershipRow(), undefined);
  assert.equal(cacheRow(), undefined);
});

test('saving the same preferences leaves the row and its list timestamps alone', async () => {
  let res = await request('/api/auth/me/preferences', { method: 'PUT', body: { favoriteApps: ['a', 'b'], homeDesktopView: 'compact' } });
  assert.equal(res.status, 200);
  db.prepare('UPDATE users SET favorite_apps_updated_at = ?, updated_at = ? WHERE id = ?').run(OLD, OLD, USER_ID);

  res = await request('/api/auth/me/preferences', { method: 'PUT', body: { favoriteApps: ['a', 'b'], homeDesktopView: 'compact' } });
  assert.equal(res.status, 200);
  let row = db.prepare('SELECT favorite_apps_updated_at, updated_at FROM users WHERE id = ?').get(USER_ID);
  assert.deepEqual(row, { favorite_apps_updated_at: OLD, updated_at: OLD });

  res = await request('/api/auth/me/preferences', { method: 'PUT', body: { favoriteApps: ['b'] } });
  assert.equal(res.status, 200);
  row = db.prepare('SELECT favorite_apps, favorite_apps_updated_at, home_desktop_view FROM users WHERE id = ?').get(USER_ID);
  assert.equal(row.favorite_apps, '["b"]');
  assert.notEqual(row.favorite_apps_updated_at, OLD);
  assert.equal(row.home_desktop_view, 'compact');
});

test('re-saving a plugin keeps its secret, enabled state and approval unless reviewed fields change', () => {
  const input = {
    id: 'mw-plugin',
    name: 'MW Plugin',
    version: '1.0.0',
    entry: 'https://plugins.example.com/mw.mjs',
    backendEnabled: true,
    backendUrl: 'https://plugins.example.com/hook',
    backendSecret: 'top-secret',
  };
  upsertPluginRegistry(input);
  approvePluginRegistry('mw-plugin', USER_ID);
  db.prepare("UPDATE plugin_registry SET enabled = 0, updated_at = ? WHERE id = 'mw-plugin'").run(OLD);

  const { backendSecret, ...withoutSecret } = input;
  assert.equal(backendSecret, 'top-secret');
  upsertPluginRegistry(withoutSecret);
  let row = db.prepare("SELECT * FROM plugin_registry WHERE id = 'mw-plugin'").get();
  assert.equal(row.backend_secret, 'top-secret');
  assert.equal(row.enabled, 0);
  assert.equal(row.approved, 1);
  assert.equal(row.approved_by, USER_ID);
  assert.equal(row.updated_at, OLD);

  upsertPluginRegistry({ ...withoutSecret, entry: 'https://plugins.example.com/mw-v2.mjs' });
  row = db.prepare("SELECT * FROM plugin_registry WHERE id = 'mw-plugin'").get();
  assert.equal(row.approved, 0);
  assert.equal(row.approved_by, null);
  assert.equal(row.backend_secret, 'top-secret');
});

test('saving unchanged customization settings writes nothing', async () => {
  await updateBrandingSettings({ showHomeHero: true });
  db.prepare("UPDATE branding_settings SET updated_at = ? WHERE id = 'default'").run(OLD);

  const { auditDetails } = await updateBrandingSettings({ showHomeHero: true });
  assert.equal(auditDetails, null);
  assert.equal(db.prepare("SELECT updated_at FROM branding_settings WHERE id = 'default'").get().updated_at, OLD);
});

test('bulk app import reports unchanged apps without rewriting them', async () => {
  const app = { slug: 'mw-bulk', name: 'MW Bulk', target_url: 'https://bulk.example.com', tags: ['ops'] };
  const headers = { 'x-api-key': process.env.ADMIN_API_KEY };
  let res = await request('/api/apps/bulk', { method: 'POST', headers, body: { apps: [app] } });
  assert.equal((await res.json()).results[0].status, 'created');
  db.prepare("UPDATE apps SET updated_at = ? WHERE slug = 'mw-bulk'").run(OLD);

  res = await request('/api/apps/bulk', { method: 'POST', headers, body: { apps: [app] } });
  assert.equal((await res.json()).results[0].status, 'unchanged');
  assert.equal(db.prepare("SELECT updated_at FROM apps WHERE slug = 'mw-bulk'").get().updated_at, OLD);

  res = await request('/api/apps/bulk', { method: 'POST', headers, body: { apps: [{ ...app, name: 'MW Bulk 2' }] } });
  assert.equal((await res.json()).results[0].status, 'updated');
  const row = db.prepare("SELECT name, tags, updated_at FROM apps WHERE slug = 'mw-bulk'").get();
  assert.equal(row.name, 'MW Bulk 2');
  assert.equal(row.tags, '["ops"]');
  assert.notEqual(row.updated_at, OLD);
});
