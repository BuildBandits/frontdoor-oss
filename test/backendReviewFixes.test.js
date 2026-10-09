import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'backend-review-secret-0123456789abcdef';
process.env.ADMIN_API_KEY = 'backend-review-api-key';

const { default: db, DEFAULT_GROUP_ID } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { restoreDefaultDemoApps } = await import('../server/services/demoApps.js');

const OWNER_ID = 'backend-review-owner';
let server;
let baseUrl;
let token;

before(async () => {
  db.prepare('INSERT OR REPLACE INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(OWNER_ID, 'owner@backend-review.test', 'Review Owner', 'owner');
  token = jwt.sign({ userId: OWNER_ID }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
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

test('bulk import validates slugs and tags and audits what it changes', async () => {
  const headers = { 'x-api-key': process.env.ADMIN_API_KEY };
  const res = await request('/api/apps/bulk', {
    method: 'POST',
    headers,
    body: {
      apps: [
        { slug: 'Bad Slug', name: 'Bad', target_url: 'https://bad.example.com' },
        { slug: 'string-tags', name: 'Tags', target_url: 'https://tags.example.com', tags: 'hr' },
        { slug: 'bulk-ok', name: 'Bulk OK', target_url: 'https://ok.example.com', tags: ['ops'] },
      ],
    },
  });
  const { results } = await res.json();
  assert.deepEqual(results.map((r) => r.status), ['skipped', 'skipped', 'created']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM apps WHERE slug IN ('Bad Slug', 'string-tags')").get().n, 0);

  const created = db.prepare("SELECT a.action, a.actor_id, a.details FROM rbac_audit_logs a JOIN apps p ON p.id = a.target_id WHERE p.slug = 'bulk-ok'").get();
  assert.equal(created.action, 'create');
  assert.equal(created.actor_id, 'api-key');

  await request('/api/apps/bulk', { method: 'POST', headers, body: { apps: [{ slug: 'bulk-ok', name: 'Bulk OK 2', target_url: 'https://ok.example.com' }] } });
  const updated = db.prepare("SELECT a.details FROM rbac_audit_logs a JOIN apps p ON p.id = a.target_id WHERE p.slug = 'bulk-ok' AND a.action = 'update'").get();
  assert.deepEqual(JSON.parse(updated.details).changes, [{ field: 'name', from: 'Bulk OK', to: 'Bulk OK 2' }]);
});

test('user detail lists groups reached through Entra links', async () => {
  db.prepare("INSERT INTO users (id, email, display_name, role, is_active) VALUES ('br-user', 'user@backend-review.test', 'Review User', 'user', 1)").run();
  db.prepare("INSERT INTO user_groups (id, name) VALUES ('br-container', 'Container Group')").run();
  db.prepare("INSERT INTO entra_user_group_memberships (user_id, entra_group_id, synced_at) VALUES ('br-user', 'br-entra-1', '2026-10-09 08:00:00')").run();
  db.prepare("INSERT INTO group_entra_group_memberships (parent_group_id, entra_group_id) VALUES ('br-container', 'br-entra-1')").run();

  const res = await request('/api/users/br-user');
  const body = await res.json();
  assert.ok(body.groups.some((group) => group.id === 'br-container'), 'container group reached through an Entra link is listed');
});

test('group description null clears it, other types are refused', async () => {
  db.prepare("INSERT INTO user_groups (id, name, description) VALUES ('br-desc', 'Desc Group', 'Old text')").run();
  let res = await request('/api/groups/br-desc', { method: 'PUT', body: { description: null } });
  assert.equal(res.status, 200);
  assert.equal(db.prepare("SELECT description FROM user_groups WHERE id = 'br-desc'").get().description, '');
  res = await request('/api/groups/br-desc', { method: 'PUT', body: { description: 42 } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'group_description_invalid');
});

test('changing only the app mode re-validates the stored URL, and names cannot be emptied', async () => {
  db.prepare("INSERT INTO apps (id, name, slug, target_url, mode) VALUES ('br-internal', 'Internal', 'br-internal', 'http://10.0.0.5', 'internal-link')").run();
  let res = await request('/api/apps/br-internal', { method: 'PUT', body: { mode: 'redirect-plain' } });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'target_url_private_network');
  res = await request('/api/apps/br-internal', { method: 'PUT', body: { name: '   ' } });
  assert.equal(res.status, 400);
  assert.equal(db.prepare("SELECT mode, name FROM apps WHERE id = 'br-internal'").get().mode, 'internal-link');
});

test('restoring the demo apps leaves real apps that reuse a demo slug untouched', () => {
  db.prepare("DELETE FROM app_permissions WHERE app_id IN (SELECT id FROM apps WHERE slug = 'docs')").run();
  db.prepare("DELETE FROM access_logs WHERE app_id IN (SELECT id FROM apps WHERE slug = 'docs')").run();
  db.prepare("DELETE FROM apps WHERE slug = 'docs'").run();
  db.prepare("INSERT INTO apps (id, name, slug, target_url) VALUES ('br-docs', 'Real Docs', 'docs', 'https://docs.company.test')").run();
  const result = restoreDefaultDemoApps(db, DEFAULT_GROUP_ID);
  assert.equal(result.skipped, 1);
  assert.deepEqual(db.prepare("SELECT name, target_url FROM apps WHERE slug = 'docs'").get(), { name: 'Real Docs', target_url: 'https://docs.company.test' });
});

test('log tables have created_at indexes', () => {
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_access_logs_created', 'idx_rbac_audit_created')").all();
  assert.equal(indexes.length, 2);
});
