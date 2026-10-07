import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ENTRA_GROUP_SYNC = 'true';
process.env.ADMIN_EMAILS = 'owner-gone@example.test';

const { default: db } = await import('../server/db.js');
const { forceSyncAllEntraUsers } = await import('../server/services/entraGroups.js');

const GONE = '00000000-0000-0000-0000-000000000404';
const OWNER_GONE = '00000000-0000-0000-0000-000000000405';
const BAD_URL = '00000000-0000-0000-0000-000000000406';
const DENIED = '00000000-0000-0000-0000-000000000403';
const PRESENT = '00000000-0000-0000-0000-000000000200';
const BACK = '00000000-0000-0000-0000-000000000201';
const INACTIVE = '00000000-0000-0000-0000-000000000999';

function graphResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const userRow = (id) => db.prepare('SELECT is_active, entra_missing_since FROM users WHERE id = ?').get(id);

test('force sync deactivates users deleted from Entra and keeps object IDs out of error messages', async (t) => {
  const insert = db.prepare('INSERT INTO users (id, email, display_name, microsoft_id, role, is_active, entra_missing_since) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run('sync-gone', 'gone@example.test', 'Gone', GONE, 'user', 1, null);
  insert.run('sync-owner-gone', 'owner-gone@example.test', 'Owner gone', OWNER_GONE, 'owner', 1, null);
  insert.run('sync-bad-url', 'bad-url@example.test', 'Bad URL', BAD_URL, 'user', 1, null);
  insert.run('sync-denied', 'denied@example.test', 'Denied', DENIED, 'user', 1, null);
  insert.run('sync-present', 'present@example.test', 'Present', PRESENT, 'user', 1, null);
  insert.run('sync-back', 'back@example.test', 'Back', BACK, 'user', 1, '2026-01-01 00:00:00');
  insert.run('sync-inactive', 'inactive@example.test', 'Inactive', INACTIVE, 'user', 0, null);

  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(url);
    if (url.includes('/groups?')) return graphResponse(200, { value: [] });
    if (url.includes(GONE) || url.includes(OWNER_GONE)) {
      return graphResponse(404, { error: { code: 'Request_ResourceNotFound', message: 'Resource does not exist' } });
    }
    if (url.includes(BAD_URL)) return graphResponse(404, { error: { code: 'BadRequest' } });
    if (url.includes(DENIED)) return graphResponse(403, { error: { code: 'Authorization_RequestDenied' } });
    return graphResponse(200, { value: [{ id: 'group-1', displayName: 'Sales' }] });
  });

  const { deactivatedUsers, ...result } = await forceSyncAllEntraUsers({ acquireToken: async () => 'test-token' });

  assert.equal(result.usersConsidered, 6, 'inactive users are not synced');
  assert.ok(!requested.some((url) => url.includes(INACTIVE)));
  assert.equal(result.usersSynced, 2);
  assert.equal(result.usersNotFound, 2);
  assert.equal(result.usersDeactivated, 1);
  assert.deepEqual(deactivatedUsers.map((user) => user.id), ['sync-gone']);

  assert.equal(userRow('sync-gone').is_active, 0, 'deleted from Entra: deactivated');
  assert.ok(userRow('sync-gone').entra_missing_since);
  assert.equal(userRow('sync-owner-gone').is_active, 1, 'configured owner stays active');
  assert.ok(userRow('sync-owner-gone').entra_missing_since, 'but is marked');
  assert.equal(userRow('sync-bad-url').is_active, 1, 'a 404 without Request_ResourceNotFound changes nothing');
  assert.equal(userRow('sync-back').entra_missing_since, null, 'found again: mark cleared');

  assert.deepEqual(result.errors.map((error) => error.userId).sort(), ['sync-bad-url', 'sync-denied']);
  const denied = result.errors.find((error) => error.userId === 'sync-denied');
  assert.match(denied.message, /status 403 \(Authorization_RequestDenied\)/);
  assert.ok(denied.hint, 'permission errors keep their hint');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('graph.microsoft.com'));
  for (const id of [GONE, OWNER_GONE, BAD_URL, DENIED, PRESENT]) assert.ok(!serialized.includes(id));
});
