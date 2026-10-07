import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ENTRA_GROUP_SYNC = 'true';

const { default: db } = await import('../server/db.js');
const { forceSyncAllEntraUsers } = await import('../server/services/entraGroups.js');

const GONE = '00000000-0000-0000-0000-000000000404';
const DENIED = '00000000-0000-0000-0000-000000000403';
const PRESENT = '00000000-0000-0000-0000-000000000200';
const INACTIVE = '00000000-0000-0000-0000-000000000999';

function graphResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('force sync skips users deleted from Entra and keeps object IDs out of error messages', async (t) => {
  const insert = db.prepare('INSERT INTO users (id, email, display_name, microsoft_id, role, is_active) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('sync-gone', 'gone@example.test', 'Gone', GONE, 'user', 1);
  insert.run('sync-denied', 'denied@example.test', 'Denied', DENIED, 'user', 1);
  insert.run('sync-present', 'present@example.test', 'Present', PRESENT, 'user', 1);
  insert.run('sync-inactive', 'inactive@example.test', 'Inactive', INACTIVE, 'user', 0);

  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(url);
    if (url.includes('/groups?')) return graphResponse(200, { value: [] });
    if (url.includes(GONE)) return graphResponse(404, { error: { code: 'Request_ResourceNotFound', message: `Resource '${GONE}' does not exist` } });
    if (url.includes(DENIED)) return graphResponse(403, { error: { code: 'Authorization_RequestDenied' } });
    return graphResponse(200, { value: [{ id: 'group-1', displayName: 'Sales' }] });
  });

  const result = await forceSyncAllEntraUsers({ acquireToken: async () => 'test-token' });

  assert.equal(result.usersConsidered, 3, 'inactive users are not synced');
  assert.ok(!requested.some((url) => url.includes(INACTIVE)));
  assert.equal(result.usersSynced, 1);
  assert.equal(result.usersNotFound, 1);
  assert.equal(result.errors.length, 1);
  const [error] = result.errors;
  assert.equal(error.userId, 'sync-denied');
  assert.match(error.message, /status 403 \(Authorization_RequestDenied\)/);
  assert.ok(error.hint, 'permission errors keep their hint');
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('graph.microsoft.com'));
  for (const id of [GONE, DENIED, PRESENT]) assert.ok(!serialized.includes(id));
});
