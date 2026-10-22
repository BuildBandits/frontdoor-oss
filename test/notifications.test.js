import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { ConfidentialClientApplication } from '@azure/msal-node';

process.env.JWT_SECRET = 'notifications-test-secret-0123456789abcdef';
process.env.ENTRA_GROUP_SYNC = 'true';
process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000002';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const {
  NOTIFICATION_TYPES,
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
  purgeResolvedNotifications,
  raiseNotification,
  resolveNotifications,
} = await import('../server/services/notifications.js');

const GONE = '00000000-0000-0000-0000-000000000404';
const realFetch = globalThis.fetch;
let server;
let baseUrl;

const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const call = (method, path, userId, body) => realFetch(`${baseUrl}${path}`, {
  method,
  headers: { Authorization: `Bearer ${tokenFor(userId)}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const graphResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const openOf = (type) => db.prepare('SELECT * FROM notifications WHERE type = ? AND resolved_at IS NULL').all(type);

before(async () => {
  const insert = db.prepare('INSERT INTO users (id, email, display_name, microsoft_id, role, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  insert.run('n-admin', 'admin@contoso.com', 'Admin', null, 'admin');
  insert.run('n-viewer', 'viewer@contoso.com', 'Viewer', null, 'admin_readonly');
  insert.run('n-user', 'user1@contoso.com', 'User', null, 'user');
  insert.run('n-gone', 'gone@contoso.com', 'Gone', GONE, 'user');
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('a repeated event refreshes the open notification and shows it as unread again', () => {
  const first = raiseNotification({ type: NOTIFICATION_TYPES.USER_FIRST_SIGN_IN, subjectKey: 'svc-1', severity: 'info', payload: { n: 1 } });
  markNotificationsRead('n-admin', [first]);
  assert.equal(listNotifications('n-admin').find((row) => row.id === first).is_read, true);

  const again = raiseNotification({ type: NOTIFICATION_TYPES.USER_FIRST_SIGN_IN, subjectKey: 'svc-1', severity: 'info', payload: { n: 2 } });
  assert.equal(again, first, 'same subject: same notification');
  const row = listNotifications('n-admin').find((item) => item.id === first);
  assert.equal(row.is_read, false);
  assert.deepEqual(row.payload, { n: 2 });

  assert.equal(resolveNotifications(NOTIFICATION_TYPES.USER_FIRST_SIGN_IN, 'svc-1', 'n-admin'), 1);
  assert.ok(!listNotifications('n-admin').some((item) => item.id === first), 'resolved ones are hidden by default');
  assert.ok(listNotifications('n-admin', { includeResolved: true }).some((item) => item.id === first));

  const reopened = raiseNotification({ type: NOTIFICATION_TYPES.USER_FIRST_SIGN_IN, subjectKey: 'svc-1', severity: 'info' });
  assert.notEqual(reopened, first, 'after resolution a new event opens a new notification');
  resolveNotifications(NOTIFICATION_TYPES.USER_FIRST_SIGN_IN, 'svc-1');
});

test('recently resolved notifications stay listed for a week, older ones do not', () => {
  const id = raiseNotification({ type: NOTIFICATION_TYPES.USER_DEACTIVATED_ENTRA, subjectKey: 'recent-1' });
  resolveNotifications(NOTIFICATION_TYPES.USER_DEACTIVATED_ENTRA, 'recent-1');
  const recent = listNotifications('n-admin', { includeResolved: true }).find((row) => row.id === id);
  assert.ok(recent.resolved_at);
  assert.equal(recent.resolved_by, null, 'resolved on its own');
  db.prepare("UPDATE notifications SET resolved_at = datetime('now', '-8 days') WHERE id = ?").run(id);
  assert.ok(!listNotifications('n-admin', { includeResolved: true }).some((row) => row.id === id));
});

test('read state is per admin and purge removes only old resolved notifications', () => {
  const id = raiseNotification({ type: NOTIFICATION_TYPES.ENTRA_SYNC_FAILED, subjectKey: 'svc-2' });
  const before = countUnreadNotifications('n-viewer');
  markNotificationsRead('n-admin');
  assert.equal(countUnreadNotifications('n-admin'), 0);
  assert.equal(countUnreadNotifications('n-viewer'), before, 'another admin still sees it unread');

  resolveNotifications(NOTIFICATION_TYPES.ENTRA_SYNC_FAILED, 'svc-2');
  db.prepare("UPDATE notifications SET resolved_at = datetime('now', '-40 days') WHERE id = ?").run(id);
  assert.equal(purgeResolvedNotifications(30), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_reads WHERE notification_id = ?').get(id).n, 0, 'read rows go with it');
});

test('only admin roles see notifications and only editors resolve them', async () => {
  const id = raiseNotification({ type: NOTIFICATION_TYPES.USER_FIRST_SIGN_IN, subjectKey: 'http-1', severity: 'info' });
  assert.equal((await call('GET', '/api/notifications', 'n-user')).status, 403);

  const list = await (await call('GET', '/api/notifications', 'n-viewer')).json();
  assert.ok(list.notifications.some((row) => row.id === id));
  assert.ok(list.unreadCount >= 1);

  assert.equal((await call('POST', `/api/notifications/${id}/resolve`, 'n-viewer')).status, 403);
  assert.equal((await call('POST', `/api/notifications/${id}/resolve`, 'n-admin')).status, 200);
  assert.equal((await call('POST', `/api/notifications/${id}/resolve`, 'n-admin')).status, 404);

  const read = await (await call('POST', '/api/notifications/read', 'n-viewer', {})).json();
  assert.equal(read.unreadCount, 0);
});

test('force sync notifies deactivated users and sync errors; reactivation and a clean sync resolve them', async (t) => {
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => ({ accessToken: 'test-token' }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = String(url);
    if (!target.startsWith('https://graph.microsoft.com/')) return realFetch(url, options);
    if (target.includes('/groups?')) return graphResponse(403, { error: { code: 'Authorization_RequestDenied' } });
    if (target.includes(GONE)) return graphResponse(404, { error: { code: 'Request_ResourceNotFound' } });
    return graphResponse(200, { value: [] });
  });

  assert.equal((await call('POST', '/api/groups/entra/force-sync', 'n-admin')).status, 200);
  const deactivated = openOf(NOTIFICATION_TYPES.USER_DEACTIVATED_ENTRA);
  assert.deepEqual(deactivated.map((row) => row.subject_key), ['n-gone']);
  assert.equal(JSON.parse(deactivated[0].payload).displayName, 'Gone');
  const failed = openOf(NOTIFICATION_TYPES.ENTRA_SYNC_FAILED);
  assert.deepEqual(failed.map((row) => row.subject_key), ['force-sync']);
  assert.doesNotMatch(failed[0].payload, new RegExp(GONE), 'no object IDs in the payload');

  assert.equal((await call('PUT', '/api/users/n-gone/active', 'n-admin', { is_active: 1 })).status, 200);
  assert.equal(openOf(NOTIFICATION_TYPES.USER_DEACTIVATED_ENTRA).length, 0, 'reactivation resolves it');

  db.prepare("UPDATE users SET microsoft_id = NULL WHERE id = 'n-gone'").run();
  t.mock.method(globalThis, 'fetch', async (url, options) => (String(url).startsWith('https://graph.microsoft.com/')
    ? graphResponse(200, { value: [] })
    : realFetch(url, options)));
  db.prepare("UPDATE users SET microsoft_id = '00000000-0000-0000-0000-000000000200' WHERE id = 'n-user'").run();
  assert.equal((await call('POST', '/api/groups/entra/force-sync', 'n-admin')).status, 200);
  assert.equal(openOf(NOTIFICATION_TYPES.ENTRA_SYNC_FAILED).length, 0, 'a clean sync resolves it');
});
