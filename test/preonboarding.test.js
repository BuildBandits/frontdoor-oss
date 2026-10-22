import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { ConfidentialClientApplication } from '@azure/msal-node';

process.env.JWT_SECRET = 'preonboard-test-secret-0123456789abcdef';
process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000002';
process.env.ENTRA_GROUP_SYNC = 'true';

const { default: db, DEFAULT_GROUP_ID } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { PREONBOARD_MAX_USERS, preonboardDirectoryUsers, searchDirectoryUsers } = await import('../server/services/entraDirectory.js');
const { forceSyncAllEntraUsers } = await import('../server/services/entraGroups.js');

const NEW_HIRE = '00000000-0000-0000-0000-000000000101';
const TAKEN = '00000000-0000-0000-0000-000000000102';
const GONE = '00000000-0000-0000-0000-000000000103';
const acquireToken = async () => 'test-token';
const realFetch = globalThis.fetch;

function graphResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const directory = {
  [NEW_HIRE]: { id: NEW_HIRE, displayName: 'New Hire', mail: 'New.Hire@contoso.com', userPrincipalName: 'new.hire@contoso.com', accountEnabled: false, userType: 'Member' },
  [TAKEN]: { id: TAKEN, displayName: 'Taken', mail: null, userPrincipalName: 'taken@contoso.com', accountEnabled: true, userType: 'Member' },
};

// Graph mock: /users/{id} from the directory above, /users?$filter returns the whole directory.
function mockGraph(t, { searchStatus = 200 } = {}) {
  const requested = [];
  // The routes acquire a real app token: stub MSAL as well.
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => ({ accessToken: 'test-token' }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = String(url);
    if (!target.startsWith('https://graph.microsoft.com/')) return realFetch(url, options);
    requested.push(target);
    if (target.includes('/users?')) {
      return searchStatus === 200
        ? graphResponse(200, { value: Object.values(directory) })
        : graphResponse(searchStatus, { error: { code: 'Authorization_RequestDenied' } });
    }
    const id = Object.keys(directory).find((key) => target.includes(`/users/${key}?`));
    if (id) return graphResponse(200, directory[id]);
    return graphResponse(404, { error: { code: 'Request_ResourceNotFound' } });
  });
  return requested;
}

let server;
let baseUrl;
const tokenFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const call = (method, path, userId, body) => realFetch(`${baseUrl}${path}`, {
  method,
  headers: { Authorization: `Bearer ${tokenFor(userId)}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

before(async () => {
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  run("INSERT INTO users (id, email, display_name, role) VALUES ('pre-admin', 'admin@contoso.com', 'Admin', 'admin')");
  run("INSERT INTO users (id, email, display_name, role) VALUES ('pre-viewer', 'viewer@contoso.com', 'Viewer', 'admin_readonly')");
  run("INSERT INTO users (id, email, display_name, microsoft_id, role) VALUES ('pre-taken', 'taken@contoso.com', 'Taken', ?, 'user')", TAKEN);
  run("INSERT INTO user_groups (id, name, source) VALUES ('pre-local', 'Onboarding', 'local')");
  run("INSERT INTO user_groups (id, name, source, entra_group_id) VALUES ('pre-entra', 'Synced', 'entra', 'entra-pre')");

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('directory search escapes the text and flags users who already have an account', async (t) => {
  const requested = mockGraph(t);
  const users = await searchDirectoryUsers("o'neil", { acquireToken });

  const filter = decodeURIComponent(new URL(requested[0]).searchParams.get('$filter'));
  assert.match(filter, /startswith\(displayName,'o''neil'\)/);
  assert.match(filter, /startswith\(userPrincipalName,'o''neil'\)/);

  const byId = Object.fromEntries(users.map((user) => [user.id, user]));
  assert.equal(byId[NEW_HIRE].email, 'new.hire@contoso.com', 'mail is preferred and lowercased, as at sign-in');
  assert.equal(byId[NEW_HIRE].accountEnabled, false);
  assert.equal(byId[NEW_HIRE].frontdoorUserId, null);
  assert.equal(byId[TAKEN].frontdoorUserId, 'pre-taken');
});

test('directory search refuses too short text without calling Graph', async (t) => {
  const requested = mockGraph(t);
  await assert.rejects(searchDirectoryUsers(' a ', { acquireToken }), { code: 'directory_search_length' });
  assert.equal(requested.length, 0);
});

test('a missing Graph permission is reported with the User.Read.All hint', async (t) => {
  mockGraph(t, { searchStatus: 403 });
  await assert.rejects(searchDirectoryUsers('new', { acquireToken }), (error) => {
    assert.equal(error.code, 'entra_directory_access_denied');
    assert.match(error.hint, /User\.Read\.All/);
    return true;
  });
});

test('pre-onboarding refuses a bad request as a whole', async (t) => {
  const requested = mockGraph(t);
  await assert.rejects(preonboardDirectoryUsers([NEW_HIRE], ['pre-entra'], { acquireToken }), { code: 'preonboard_groups_invalid' });
  await assert.rejects(preonboardDirectoryUsers([], [], { acquireToken }), { code: 'microsoft_ids_required' });
  const tooMany = Array.from({ length: PREONBOARD_MAX_USERS + 1 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
  await assert.rejects(preonboardDirectoryUsers(tooMany, [], { acquireToken }), { code: 'preonboard_too_many_users' });
  assert.equal(requested.length, 0, 'nothing is read from Graph before the request is validated');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE microsoft_id = ?').get(NEW_HIRE).n, 0);
});

test('only admin editors can search the directory and pre-onboard', async () => {
  assert.equal((await call('GET', '/api/users/directory/search?q=new', 'pre-viewer')).status, 403);
  assert.equal((await call('POST', '/api/users/preonboard', 'pre-viewer', { microsoftIds: [NEW_HIRE] })).status, 403);
});

test('pre-onboarding several users creates the valid ones and reports the others', async (t) => {
  mockGraph(t);
  const res = await call('POST', '/api/users/preonboard', 'pre-admin', { microsoftIds: [NEW_HIRE, TAKEN, GONE, 'not-a-guid', NEW_HIRE], groupIds: ['pre-local'] });
  assert.equal(res.status, 200);
  const { results } = await res.json();
  const byId = Object.fromEntries(results.map((result) => [result.microsoftId, result]));
  assert.equal(results.length, 4, 'duplicates are handled once');
  assert.equal(byId[NEW_HIRE].status, 'created');
  assert.deepEqual([byId[TAKEN].code, byId[GONE].code, byId['not-a-guid'].code], ['user_already_exists', 'entra_user_not_found', 'entra_object_id_invalid']);

  const { userId } = byId[NEW_HIRE];
  const user = db.prepare('SELECT email, display_name, microsoft_id, role, is_active, last_login FROM users WHERE id = ?').get(userId);
  assert.deepEqual(user, { email: 'new.hire@contoso.com', display_name: 'New Hire', microsoft_id: NEW_HIRE, role: 'user', is_active: 1, last_login: null });

  const groups = db.prepare('SELECT group_id FROM user_group_members WHERE user_id = ? ORDER BY group_id').all(userId).map((row) => row.group_id);
  assert.deepEqual(groups, [DEFAULT_GROUP_ID, 'pre-local'].sort());

  const audits = db.prepare("SELECT actor_id, target_id, details FROM rbac_audit_logs WHERE action = 'preonboard'").all();
  assert.equal(audits.length, 1, 'only created users are audited');
  assert.equal(audits[0].actor_id, 'pre-admin');
  assert.equal(audits[0].target_id, userId);
  assert.deepEqual(JSON.parse(audits[0].details).groupIds, ['pre-local']);

  const again = await (await call('POST', '/api/users/preonboard', 'pre-admin', { microsoftIds: [NEW_HIRE] })).json();
  assert.deepEqual(again.results.map((result) => result.code), ['user_already_exists']);
});

test('a Graph permission error stops the whole request', async (t) => {
  mockGraph(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => (String(url).startsWith('https://graph.microsoft.com/')
    ? graphResponse(403, { error: { code: 'Authorization_RequestDenied' } })
    : realFetch(url, options)));
  await assert.rejects(preonboardDirectoryUsers([NEW_HIRE, TAKEN], [], { acquireToken }), { code: 'entra_directory_access_denied' });
});

test('force sync gives a pre-onboarded user its Entra groups and does not deactivate it', async (t) => {
  const userId = db.prepare('SELECT id FROM users WHERE microsoft_id = ?').get(NEW_HIRE).id;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const target = String(url);
    if (target.includes('/groups?')) return graphResponse(200, { value: [] });
    if (target.includes(NEW_HIRE)) return graphResponse(200, { value: [{ id: 'entra-pre', displayName: 'Synced' }] });
    return graphResponse(200, { value: [] });
  });

  await forceSyncAllEntraUsers({ acquireToken });

  const row = db.prepare('SELECT is_active, entra_missing_since, last_login FROM users WHERE id = ?').get(userId);
  assert.deepEqual(row, { is_active: 1, entra_missing_since: null, last_login: null });
  const groups = db.prepare('SELECT group_id FROM user_group_members WHERE user_id = ? ORDER BY group_id').all(userId).map((r) => r.group_id);
  assert.deepEqual(groups, [DEFAULT_GROUP_ID, 'pre-entra', 'pre-local'].sort(), 'Entra group added, local groups kept');
});

test('force sync deactivates a pre-onboarded user only when Entra reports it deleted', async (t) => {
  const userId = db.prepare('SELECT id FROM users WHERE microsoft_id = ?').get(NEW_HIRE).id;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const target = String(url);
    if (target.includes('/groups?')) return graphResponse(200, { value: [] });
    if (target.includes(NEW_HIRE)) return graphResponse(404, { error: { code: 'Request_ResourceNotFound' } });
    return graphResponse(200, { value: [] });
  });

  await forceSyncAllEntraUsers({ acquireToken });
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get(userId).is_active, 0);
});
