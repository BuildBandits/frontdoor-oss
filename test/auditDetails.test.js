import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'audit-test-secret-0123456789abcdef';

const { default: db, logRbacAudit } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { collectAuditIds, diffAuditFields, lookupAuditNames } = await import('../server/services/auditDetails.js');
const { describeAuditLog } = await import('../src/utils/auditFormatters.js');
const { getUiStrings } = await import('../src/i18n/index.js');

const OWNER_ID = 'audit-test-owner';
const APP_ID = 'audit-test-app';
const GROUP_ID = 'audit-test-group';
const MEMBER_ID = 'audit-test-member';

let server;
let baseUrl;
let token;

function request(pathname, { body, ...options } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function auditRows(where = '1 = 1', ...params) {
  return db.prepare(`SELECT * FROM rbac_audit_logs WHERE ${where} ORDER BY id`).all(...params)
    .map((row) => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));
}

before(async () => {
  db.prepare('INSERT OR REPLACE INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(OWNER_ID, 'owner@audit-test.local', 'Audit Owner', 'owner');
  token = jwt.sign({ userId: OWNER_ID }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  db.prepare('DELETE FROM rbac_audit_logs').run();
  db.prepare('DELETE FROM user_group_members WHERE group_id = ?').run(GROUP_ID);
  db.prepare('DELETE FROM app_permissions WHERE app_id = ?').run(APP_ID);
  db.prepare('DELETE FROM apps WHERE id = ?').run(APP_ID);
  db.prepare('DELETE FROM user_groups WHERE id = ?').run(GROUP_ID);
  db.prepare('DELETE FROM users WHERE id = ?').run(MEMBER_ID);
  db.prepare(`
    INSERT INTO apps (id, name, slug, description, target_url, mode, tags, updated_at)
    VALUES (?, 'Wiki', 'wiki', 'Team wiki', 'https://wiki.example.com', 'redirect-plain', '["docs"]', '2020-01-01 00:00:00')
  `).run(APP_ID);
  db.prepare("INSERT INTO user_groups (id, name, description) VALUES (?, 'Finance', 'Finance team')").run(GROUP_ID);
  db.prepare("INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, 'member@audit-test.local', 'Alice Member', 'user', 1)")
    .run(MEMBER_ID);
});

test('diffAuditFields reports only changed fields and treats empty values alike', () => {
  const changes = diffAuditFields(
    { name: 'A', description: null, is_active: 1, tags: '["x"]' },
    { name: 'B', description: '', is_active: true, tags: '["x"]' },
    ['name', 'description', 'is_active', 'tags'],
  );
  assert.deepEqual(changes, [{ field: 'name', from: 'A', to: 'B' }]);
});

test('collectAuditIds maps details keys and targets to entity types', () => {
  const ids = collectAuditIds({
    action: 'import',
    targetType: 'group',
    targetId: null,
    details: { groupIds: ['entra-1'] },
  });
  assert.deepEqual([...ids.entraGroups], ['entra-1']);
  assert.equal(ids.groups.size, 0);

  const syncIds = collectAuditIds({ action: 'sync_apps', targetType: 'permission', targetId: APP_ID, details: { groupIds: [GROUP_ID] } });
  assert.deepEqual([...syncIds.apps], [APP_ID]);
  assert.deepEqual([...syncIds.groups], [GROUP_ID]);
  assert.deepEqual(lookupAuditNames(db, syncIds), { groups: { [GROUP_ID]: 'Finance' }, apps: { [APP_ID]: 'Wiki' } });
});

test('audit rows keep a snapshot of entity names after the entities are deleted', () => {
  logRbacAudit(OWNER_ID, 'remove_member', 'membership', GROUP_ID, { userId: MEMBER_ID });
  db.prepare('DELETE FROM users WHERE id = ?').run(MEMBER_ID);

  const [row] = auditRows();
  assert.deepEqual(row.details.refs, {
    users: { [MEMBER_ID]: 'Alice Member' },
    groups: { [GROUP_ID]: 'Finance' },
  });
});

test('saving an app without changes writes nothing and logs nothing', async () => {
  const res = await request(`/api/apps/${APP_ID}`, {
    method: 'PUT',
    body: { name: 'Wiki', slug: 'wiki', description: 'Team wiki', target_url: 'https://wiki.example.com', mode: 'redirect-plain', tags: ['docs'] },
  });
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT updated_at FROM apps WHERE id = ?').get(APP_ID).updated_at, '2020-01-01 00:00:00');
  assert.equal(auditRows().length, 0);
});

test('updating one app field writes and logs only that field', async () => {
  const res = await request(`/api/apps/${APP_ID}`, {
    method: 'PUT',
    body: { name: 'Wiki', slug: 'wiki', description: 'Company wiki', target_url: 'https://wiki.example.com', mode: 'redirect-plain', tags: ['docs'] },
  });
  assert.equal(res.status, 200);
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(APP_ID);
  assert.equal(app.description, 'Company wiki');
  assert.equal(app.tags, '["docs"]');
  assert.notEqual(app.updated_at, '2020-01-01 00:00:00');

  const [row] = auditRows();
  assert.equal(row.action, 'update');
  assert.equal(row.details.name, 'Wiki');
  assert.deepEqual(row.details.changes, [{ field: 'description', from: 'Team wiki', to: 'Company wiki' }]);
});

test('group updates are diffed and skipped when nothing changes', async () => {
  let res = await request(`/api/groups/${GROUP_ID}`, { method: 'PUT', body: { name: 'Finance', description: 'Finance team' } });
  assert.equal(res.status, 200);
  assert.equal(auditRows().length, 0);

  res = await request(`/api/groups/${GROUP_ID}`, { method: 'PUT', body: { name: 'Finance EU', description: 'Finance team' } });
  assert.equal(res.status, 200);
  const [row] = auditRows();
  assert.deepEqual(row.details.changes, [{ field: 'name', from: 'Finance', to: 'Finance EU' }]);
});

test('setting the same role or status logs nothing', async () => {
  let res = await request(`/api/users/${MEMBER_ID}/role`, { method: 'PUT', body: { role: 'user' } });
  assert.equal(res.status, 200);
  res = await request(`/api/users/${MEMBER_ID}/active`, { method: 'PUT', body: { is_active: true } });
  assert.equal(res.status, 200);
  assert.equal(auditRows().length, 0);

  res = await request(`/api/users/${MEMBER_ID}/role`, { method: 'PUT', body: { role: 'admin' } });
  assert.equal(res.status, 200);
  const [row] = auditRows();
  assert.deepEqual(row.details.changes, [{ field: 'role', from: 'user', to: 'admin' }]);
});

test('the audit API resolves current names for rows without a snapshot', async () => {
  db.prepare('INSERT INTO rbac_audit_logs (actor_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)')
    .run(OWNER_ID, 'add_apps', 'permission', GROUP_ID, JSON.stringify({ appIds: [APP_ID], added: 1 }));

  const res = await request('/api/logs/audit');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.refs.groups[GROUP_ID], 'Finance');
  assert.equal(body.refs.apps[APP_ID], 'Wiki');
});

test('describeAuditLog builds a readable summary with names', () => {
  const ui = getUiStrings('en');
  const event = describeAuditLog({
    action: 'add_members',
    target_type: 'membership',
    target_id: GROUP_ID,
    details: { userIds: [MEMBER_ID, 'gone-user'], added: 2, refs: { users: { [MEMBER_ID]: 'Alice Member' } } },
  }, { ui, refs: { groups: { [GROUP_ID]: 'Finance' } } });

  assert.equal(event.actionLabel, 'Members added');
  assert.equal(event.targetName, 'Finance');
  assert.equal(event.summary.template, 'Added {count} members to {target}');
  assert.equal(event.summary.values.count, 2);
  assert.deepEqual(event.facts.map((fact) => [fact.label, fact.value]), [
    ['Users', 'Alice Member, deleted item (gone-user)'],
  ]);

  const single = describeAuditLog({
    action: 'add_apps',
    target_type: 'permission',
    target_id: GROUP_ID,
    details: { appIds: [APP_ID], added: 1 },
  }, { ui, refs: { groups: { [GROUP_ID]: 'Finance' }, apps: { [APP_ID]: 'Wiki' } } });
  assert.equal(single.summary.template, 'Gave {target} access to 1 app');
});

test('describeAuditLog reads legacy role rows and unknown events', () => {
  const ui = getUiStrings('it');
  const legacy = describeAuditLog({
    action: 'update',
    target_type: 'role',
    target_id: MEMBER_ID,
    details: { email: 'member@audit-test.local', from: 'user', to: 'admin_readonly' },
  }, { ui });
  assert.deepEqual(legacy.changes.map(({ label, from, to }) => ({ label, from, to })), [
    { label: 'Ruolo', from: 'Utente', to: 'Admin (sola lettura)' },
  ]);
  assert.deepEqual(legacy.facts.map((fact) => fact.key), ['email']);

  const unknown = describeAuditLog({ action: 'teleport', target_type: 'spaceship', target_id: 'x1', details: 'plain text' }, { ui });
  assert.equal(unknown.summary.template, ui.admin.audit.events.fallback);
  assert.equal(unknown.text, 'plain text');
  assert.equal(unknown.raw, 'plain text');
});

test('audit dates use a compact YYYY-MM-DD, HH:MM:SS format in the viewer time zone', async () => {
  const { formatIsoDateTime } = await import('../src/utils/dateTime.js');
  assert.equal(formatIsoDateTime('2026-10-08 08:54:35', 'Europe/Rome'), '2026-10-08, 10:54:35');
  assert.equal(formatIsoDateTime('2026-01-05 00:00:00', 'UTC'), '2026-01-05, 00:00:00');
  assert.equal(formatIsoDateTime('not a date', 'UTC'), null);
});
