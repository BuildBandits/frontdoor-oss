import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { ConfidentialClientApplication } from '@azure/msal-node';

process.env.JWT_SECRET = 'entra-deleted-groups-secret-0123456789abcdef';
process.env.ENTRA_GROUP_SYNC = 'true';
process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000002';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { forceSyncAllEntraUsers, protectDeletedGroupsBeforeUserSync, syncUserEntraGroups } = await import('../server/services/entraGroups.js');
const { getAccessibleGroupIdsForUser } = await import('../server/services/groupHierarchy.js');

const SALES = '00000000-0000-0000-0000-00000000a001';
const OPS = '00000000-0000-0000-0000-00000000a002';
const ALICE = '00000000-0000-0000-0000-00000000b001';
const BOB = '00000000-0000-0000-0000-00000000b002';
const acquireToken = async () => 'test-token';
const realFetch = globalThis.fetch;

const graphResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const notFound = () => graphResponse(404, { error: { code: 'Request_ResourceNotFound' } });

// Graph mock: `tenant` lists the groups that exist; users are members of `memberships`.
function mockGraph(t, { tenant, memberships }) {
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => ({ accessToken: 'test-token' }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = String(url);
    if (!target.startsWith('https://graph.microsoft.com/')) return realFetch(url, options);
    if (target.includes('/groups?')) return graphResponse(200, { value: tenant.map((id) => ({ id, displayName: id === SALES ? 'Sales' : 'Ops' })) });
    const groupMatch = target.match(/\/groups\/([0-9a-f-]+)\?/);
    if (groupMatch) return tenant.includes(groupMatch[1]) ? graphResponse(200, { id: groupMatch[1] }) : notFound();
    const userMatch = target.match(/\/users\/([0-9a-f-]+)\/transitiveMemberOf/);
    if (userMatch) {
      const ids = (memberships[userMatch[1]] || []).filter((id) => tenant.includes(id));
      return graphResponse(200, { value: ids.map((id) => ({ id, displayName: id === SALES ? 'Sales' : 'Ops' })) });
    }
    return notFound();
  });
}

let server;
let baseUrl;
const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const call = (method, path, userId) => realFetch(`${baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${tokenFor(userId)}` } });
const members = (groupId) => db.prepare('SELECT user_id FROM user_group_members WHERE group_id = ? ORDER BY user_id').all(groupId).map((row) => row.user_id);
const groupRow = (id) => db.prepare('SELECT source, entra_group_id, entra_deleted_at, entra_deleted_snapshot FROM user_groups WHERE id = ?').get(id);
const openNotification = (groupId) => db.prepare("SELECT * FROM notifications WHERE type = 'entra_group_deleted' AND subject_key = ? AND resolved_at IS NULL").get(groupId);

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  delete process.env.ENTRA_DELETED_GROUP_POLICY;
  for (const table of ['notification_reads', 'notifications', 'app_permissions', 'user_group_members', 'group_group_memberships', 'group_entra_group_memberships', 'entra_user_group_memberships']) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  db.prepare("DELETE FROM user_groups WHERE id LIKE 'dg-%'").run();
  db.prepare("DELETE FROM apps WHERE id LIKE 'dg-%'").run();
  db.prepare("DELETE FROM users WHERE id LIKE 'dg-%'").run();
  const insertUser = db.prepare('INSERT INTO users (id, email, display_name, microsoft_id, role) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('dg-admin', 'admin@contoso.com', 'Admin', null, 'admin');
  insertUser.run('dg-alice', 'alice@contoso.com', 'Alice', ALICE, 'user');
  insertUser.run('dg-bob', 'bob@contoso.com', 'Bob', BOB, 'user');
  db.prepare("INSERT INTO user_groups (id, name, source, entra_group_id, entra_display_name) VALUES ('dg-sales', 'Sales', 'entra', ?, 'Sales')").run(SALES);
  db.prepare("INSERT INTO user_groups (id, name, source) VALUES ('dg-parent', 'All staff', 'local')").run();
  db.prepare("INSERT INTO group_entra_group_memberships (parent_group_id, entra_group_id) VALUES ('dg-parent', ?)").run(SALES);
  db.prepare("INSERT INTO apps (id, name, slug, target_url, mode) VALUES ('dg-crm', 'CRM', 'dg-crm', 'https://crm.example.com', 'redirect-plain')").run();
  db.prepare("INSERT INTO app_permissions (app_id, group_id) VALUES ('dg-crm', 'dg-sales')").run();
  for (const user of ['dg-alice', 'dg-bob']) {
    db.prepare("INSERT INTO user_group_members (user_id, group_id) VALUES (?, 'dg-sales')").run(user);
    db.prepare("INSERT INTO entra_user_group_memberships (user_id, entra_group_id, synced_at) VALUES (?, ?, '2026-10-01 08:00:00')").run(user, SALES);
  }
});

test('force sync flags a deleted group, keeps its members (freeze) and notifies with a snapshot', async (t) => {
  mockGraph(t, { tenant: [OPS], memberships: { [ALICE]: [SALES], [BOB]: [SALES] } });
  await forceSyncAllEntraUsers({ acquireToken });

  const row = groupRow('dg-sales');
  assert.ok(row.entra_deleted_at);
  const snapshot = JSON.parse(row.entra_deleted_snapshot);
  assert.deepEqual(snapshot.members.map((member) => member.name), ['Alice', 'Bob']);
  assert.deepEqual(snapshot.apps.map((app) => app.name), ['CRM']);
  assert.deepEqual(snapshot.linkedIn.map((group) => group.name), ['All staff']);

  assert.deepEqual(members('dg-sales'), ['dg-alice', 'dg-bob'], 'frozen: nobody loses the group');
  assert.ok(getAccessibleGroupIdsForUser('dg-alice').includes('dg-parent'), 'access through the linked local group is kept');

  const notification = openNotification('dg-sales');
  assert.equal(notification.severity, 'warning');
  assert.deepEqual(JSON.parse(notification.payload), { groupId: 'dg-sales', groupName: 'Sales', memberCount: 2, appCount: 1, linkedInCount: 1, policy: 'freeze' });
});

test('a sign-in that would drop the group confirms the deletion first', async (t) => {
  mockGraph(t, { tenant: [OPS], memberships: {} });
  // Sign-in path: the tenant catalog was not refreshed, the user simply no longer lists the group.
  await protectDeletedGroupsBeforeUserSync('dg-alice', [], { acquireToken });
  syncUserEntraGroups('dg-alice', []);

  assert.ok(groupRow('dg-sales').entra_deleted_at);
  assert.deepEqual(members('dg-sales'), ['dg-alice', 'dg-bob']);
});

test('a user who really left a group that still exists loses it as before', async (t) => {
  mockGraph(t, { tenant: [SALES, OPS], memberships: {} });
  await protectDeletedGroupsBeforeUserSync('dg-alice', [], { acquireToken });
  syncUserEntraGroups('dg-alice', []);

  assert.equal(groupRow('dg-sales').entra_deleted_at, null);
  assert.deepEqual(members('dg-sales'), ['dg-bob']);
  assert.equal(openNotification('dg-sales'), undefined);
});

test('with the revoke policy the group is flagged and notified, but members are removed', async (t) => {
  process.env.ENTRA_DELETED_GROUP_POLICY = 'revoke';
  mockGraph(t, { tenant: [OPS], memberships: { [ALICE]: [SALES], [BOB]: [SALES] } });
  await forceSyncAllEntraUsers({ acquireToken });

  assert.ok(groupRow('dg-sales').entra_deleted_at);
  assert.deepEqual(members('dg-sales'), []);
  assert.equal(openNotification('dg-sales').severity, 'critical');
  assert.equal(JSON.parse(groupRow('dg-sales').entra_deleted_snapshot).members.length, 2, 'the snapshot still lists who had access');
});

test('a group restored in Entra is unflagged and its notification resolves on its own', async (t) => {
  mockGraph(t, { tenant: [OPS], memberships: { [ALICE]: [SALES], [BOB]: [SALES] } });
  await forceSyncAllEntraUsers({ acquireToken });
  assert.ok(openNotification('dg-sales'));

  mockGraph(t, { tenant: [SALES, OPS], memberships: { [ALICE]: [SALES], [BOB]: [SALES] } });
  await forceSyncAllEntraUsers({ acquireToken });
  assert.equal(groupRow('dg-sales').entra_deleted_at, null);
  assert.equal(openNotification('dg-sales'), undefined);
  assert.deepEqual(members('dg-sales'), ['dg-alice', 'dg-bob']);
});

test('converting to a local group keeps members, apps and the parent link, and is audited', async (t) => {
  mockGraph(t, { tenant: [OPS], memberships: { [ALICE]: [SALES], [BOB]: [SALES] } });
  await forceSyncAllEntraUsers({ acquireToken });

  assert.equal((await call('POST', '/api/groups/dg-parent/convert-to-local', 'dg-admin')).status, 400, 'only flagged imported groups');
  const res = await call('POST', '/api/groups/dg-sales/convert-to-local', 'dg-admin');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { converted: true, memberCount: 2, appCount: 1, linkedInCount: 1 });

  const row = groupRow('dg-sales');
  assert.deepEqual({ ...row }, { source: 'local', entra_group_id: null, entra_deleted_at: null, entra_deleted_snapshot: null });
  assert.deepEqual(members('dg-sales'), ['dg-alice', 'dg-bob']);
  assert.ok(db.prepare("SELECT 1 FROM group_group_memberships WHERE parent_group_id = 'dg-parent' AND child_group_id = 'dg-sales'").get());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM group_entra_group_memberships WHERE entra_group_id = ?').get(SALES).n, 0);
  assert.ok(getAccessibleGroupIdsForUser('dg-bob').includes('dg-parent'), 'access through the parent continues');
  assert.equal(openNotification('dg-sales'), undefined);

  const audit = db.prepare("SELECT details FROM rbac_audit_logs WHERE action = 'convert_to_local' AND target_id = 'dg-sales'").get();
  assert.deepEqual(JSON.parse(audit.details).userIds.sort(), ['dg-alice', 'dg-bob']);

  // A later sync does not touch the converted group.
  await forceSyncAllEntraUsers({ acquireToken });
  assert.deepEqual(members('dg-sales'), ['dg-alice', 'dg-bob']);
});

test('deleting a flagged group drops the frozen Entra memberships and resolves the notification', async (t) => {
  mockGraph(t, { tenant: [OPS], memberships: { [ALICE]: [SALES], [BOB]: [SALES] } });
  await forceSyncAllEntraUsers({ acquireToken });

  assert.equal((await call('DELETE', '/api/groups/dg-sales', 'dg-admin')).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entra_user_group_memberships WHERE entra_group_id = ?').get(SALES).n, 0);
  assert.ok(!getAccessibleGroupIdsForUser('dg-alice').includes('dg-parent'), 'the linked local group no longer grants access');
  assert.equal(openNotification('dg-sales'), undefined);
});
