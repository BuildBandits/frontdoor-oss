import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { ConfidentialClientApplication } from '@azure/msal-node';

process.env.JWT_SECRET = 'force-sync-progress-test-secret-0123456789';
process.env.ENTRA_GROUP_SYNC = 'true';
process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000002';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { forceSyncAllEntraUsers } = await import('../server/services/entraGroups.js');
const {
  FORCE_SYNC_STALE_AFTER_MS,
  beginForceSync,
  finishForceSync,
  getForceSyncStatus,
  resetForceSyncProgress,
  updateForceSyncProgress,
} = await import('../server/services/forceSyncProgress.js');

const USER_A = '00000000-0000-0000-0000-000000000a01';
const USER_B = '00000000-0000-0000-0000-000000000a02';
const GONE = '00000000-0000-0000-0000-000000000a04';
const DENIED = '00000000-0000-0000-0000-000000000a03';
const realFetch = globalThis.fetch;
let server;
let baseUrl;

const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const call = (method, path, userId, body) => realFetch(`${baseUrl}${path}`, {
  method,
  headers: { Authorization: `Bearer ${tokenFor(userId)}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const status = async () => (await call('GET', '/api/groups/entra/force-sync/status', 'p-viewer')).json();
const graphResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

before(async () => {
  const insert = db.prepare('INSERT INTO users (id, email, display_name, microsoft_id, role, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  insert.run('p-admin', 'admin@contoso.com', 'Admin', null, 'admin');
  insert.run('p-viewer', 'viewer@contoso.com', 'Viewer', null, 'admin_readonly');
  insert.run('p-user-a', 'user1@contoso.com', 'User A', USER_A, 'user');
  insert.run('p-user-b', 'user2@contoso.com', 'User B', USER_B, 'user');
  insert.run('p-gone', 'gone@contoso.com', 'Gone', GONE, 'user');
  insert.run('p-denied', 'denied@contoso.com', 'Denied', DENIED, 'user');
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function mockGraph(t, { gate = null } = {}) {
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => ({ accessToken: 'test-token' }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = String(url);
    if (!target.startsWith('https://graph.microsoft.com/')) return realFetch(url, options);
    if (gate && target.includes(USER_B)) await gate;
    if (target.includes('/groups?')) return graphResponse(200, { value: [] });
    if (target.includes(GONE)) return graphResponse(404, { error: { code: 'Request_ResourceNotFound' } });
    if (target.includes(DENIED)) return graphResponse(403, { error: { code: 'Authorization_RequestDenied' } });
    return graphResponse(200, { value: [] });
  });
}

test('force sync reports phases and per-user counters without user data', async (t) => {
  mockGraph(t);
  const events = [];
  const result = await forceSyncAllEntraUsers({
    acquireToken: async () => 'test-token',
    onProgress: (progress) => events.push(progress),
  });

  const phases = [...new Set(events.map((event) => event.phase))];
  assert.deepEqual(phases, ['connecting', 'tenant-groups', 'deleted-groups', 'users']);
  const userEvents = events.filter((event) => event.phase === 'users');
  assert.deepEqual(userEvents.map((event) => event.processed), [0, 1, 2, 3, 4]);
  assert.ok(userEvents.every((event) => event.total === 4));
  assert.deepEqual(userEvents.at(-1), {
    phase: 'users', processed: 4, total: 4, usersSynced: 2, usersNotFound: 1, errorCount: 1,
  });
  assert.equal(result.usersConsidered, 4);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /@contoso\.com|User A|p-user-a/);

  db.prepare("UPDATE users SET is_active = 1, entra_missing_since = NULL WHERE id = 'p-gone'").run();
});

test('status endpoint shows a running sync, refuses a parallel one and keeps the summary', async (t) => {
  resetForceSyncProgress();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  mockGraph(t, { gate });

  const idle = await (await call('GET', '/api/groups/entra/force-sync/status', 'p-viewer')).json();
  assert.equal(idle.running, false);
  assert.equal(idle.result, null);

  const first = call('POST', '/api/groups/entra/force-sync', 'p-admin', { runId: 'page-run-0001' });
  let running;
  for (let i = 0; i < 100; i += 1) {
    running = await (await call('GET', '/api/groups/entra/force-sync/status', 'p-viewer')).json();
    if (running.phase === 'users' && running.processed >= 1) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(running.running, true);
  assert.equal(running.runId, 'page-run-0001', 'the page can recognise its own run');
  assert.equal(running.total, 4);
  assert.ok(running.startedAt);

  const second = await call('POST', '/api/groups/entra/force-sync', 'p-admin');
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, 'entra_sync_already_running');

  release();
  const response = await first;
  assert.equal(response.status, 200);
  const summary = await response.json();

  const done = await (await call('GET', '/api/groups/entra/force-sync/status', 'p-viewer')).json();
  assert.equal(done.running, false);
  assert.equal(done.phase, 'done');
  assert.equal(done.processed, 4);
  assert.equal(summary.runId, 'page-run-0001');
  const { runId: _runId, ...summaryWithoutRunId } = summary;
  assert.deepEqual(done.result, summaryWithoutRunId);
  assert.equal(done.runId, 'page-run-0001');
  assert.ok(done.finishedAt);
  assert.doesNotMatch(JSON.stringify(done), /@contoso\.com/);

  assert.equal((await call('GET', '/api/groups/entra/force-sync/status', 'p-user-a')).status, 403);
});

test('a failed sync ends the run with an error and does not block the next one', async (t) => {
  resetForceSyncProgress();
  db.prepare("UPDATE users SET is_active = 1, entra_missing_since = NULL WHERE id = 'p-gone'").run();
  mockGraph(t);
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => {
    throw new Error('token endpoint unreachable');
  });
  t.mock.method(console, 'error', () => {});

  const failed = await call('POST', '/api/groups/entra/force-sync', 'p-admin', { runId: 'page-run-fail' });
  assert.equal(failed.status, 500);
  const afterFailure = await status();
  assert.equal(afterFailure.running, false);
  assert.equal(afterFailure.runId, 'page-run-fail');
  assert.equal(afterFailure.result, null);
  assert.equal(afterFailure.error.code, 'failed_to_sync_entra_users');
  assert.doesNotMatch(JSON.stringify(afterFailure), /unreachable/, 'raw error text stays server-side');

  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => ({ accessToken: 'test-token' }));
  const retry = await call('POST', '/api/groups/entra/force-sync', 'p-admin');
  assert.equal(retry.status, 200, 'not refused with 409');
  const { runId } = await retry.json();
  assert.ok(runId, 'a run id is generated when the page sends none');
  assert.equal((await status()).result.usersConsidered, 4);
  db.prepare("UPDATE users SET is_active = 1, entra_missing_since = NULL WHERE id = 'p-gone'").run();
});

test('a hung run is abandoned after the stale timeout and cannot overwrite the next run', () => {
  resetForceSyncProgress();
  const t0 = 1_000_000;
  const hung = beginForceSync('hung-run-0001', t0);
  assert.equal(beginForceSync('second-run-01', t0 + 1000), null, 'still running: refused');

  const later = t0 + FORCE_SYNC_STALE_AFTER_MS + 1;
  const stale = getForceSyncStatus(later);
  assert.equal(stale.running, false);
  assert.equal(stale.error.code, 'entra_sync_stalled');

  const next = beginForceSync('second-run-01', later);
  assert.equal(next, 'second-run-01');
  updateForceSyncProgress(hung, { phase: 'users', processed: 9, total: 9, usersSynced: 9, usersNotFound: 0, errorCount: 0 }, later + 1);
  finishForceSync(hung, { error: { code: 'failed_to_sync_entra_users' } }, later + 2);
  const current = getForceSyncStatus(later + 3);
  assert.equal(current.runId, 'second-run-01');
  assert.equal(current.running, true);
  assert.equal(current.processed, 0, 'late updates of the hung run are ignored');
});

test('the estimate of the time left follows the pace of the users phase', () => {
  resetForceSyncProgress();
  const runId = beginForceSync('eta-run-00001', 0);
  const progress = (processed) => ({ phase: 'users', processed, total: 10, usersSynced: processed, usersNotFound: 0, errorCount: 0 });
  updateForceSyncProgress(runId, { ...progress(0), phase: 'tenant-groups' }, 500);
  assert.equal(getForceSyncStatus(600).etaMs, null, 'no estimate before the users phase');
  updateForceSyncProgress(runId, progress(0), 1000);
  assert.equal(getForceSyncStatus(1500).etaMs, null, 'no estimate before the first user');
  updateForceSyncProgress(runId, progress(4), 5000);
  assert.equal(getForceSyncStatus(5000).etaMs, 6000, '1 s per user, 6 users left');
  finishForceSync(runId, { result: { usersConsidered: 10, usersSynced: 10, usersNotFound: 0, errors: [] } }, 11000);
  assert.equal(getForceSyncStatus(12000).etaMs, null);
  assert.equal(getForceSyncStatus(12000).elapsedMs, 11000);
});
