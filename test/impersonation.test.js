import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'impersonation-http-test-secret-0123456789';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { startSession, signSessionCookie, loadSession, endSession } = await import('../server/services/impersonation.js');

let server;
let baseUrl;

const sessionToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h', issuer: 'frontdoor' });

async function call(path, { method = 'GET', cookies = {}, body } = {}) {
  const headers = { 'Sec-Fetch-Site': 'same-origin' };
  const cookieHeader = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
}

// Cookies of an admin already acting as a user, without going through the start route.
function impersonating(adminId, targetId) {
  const { id, expiresAtMs } = startSession({ adminId, targetUserId: targetId, reason: 'test session' });
  return { sessionId: id, cookies: { frontdoor_token: sessionToken(adminId), frontdoor_impersonation: signSessionCookie(id, expiresAtMs) } };
}

const auditActions = (sessionId) => db.prepare('SELECT action FROM rbac_audit_logs WHERE impersonation_session_id = ? ORDER BY id').all(sessionId).map((row) => row.action);
const setCookies = (res) => res.headers.getSetCookie();

before(async () => {
  const insert = db.prepare('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, ?)');
  insert.run('h-owner', 'owner@example.com', 'Owner', 'owner', 1);
  insert.run('h-admin', 'admin@example.com', 'Admin', 'admin', 1);
  insert.run('h-readonly', 'readonly@example.com', 'Read Only', 'admin_readonly', 1);
  insert.run('h-admin2', 'admin2@example.com', 'Admin Two', 'admin', 1);
  insert.run('h-user', 'user1@example.com', 'User One', 'user', 1);
  insert.run('h-user2', 'user2@example.com', 'User Two', 'user', 1);
  insert.run('h-inactive', 'user3@example.com', 'User Three', 'user', 0);

  db.prepare("INSERT INTO user_groups (id, name) VALUES ('h-group', 'Support')").run();
  db.prepare("INSERT INTO user_group_members (user_id, group_id) VALUES ('h-user', 'h-group')").run();
  db.prepare("INSERT INTO apps (id, name, slug, target_url, mode) VALUES ('h-app', 'CRM', 'crm', 'https://crm.example.com', 'redirect-plain')").run();
  db.prepare("INSERT INTO apps (id, name, slug, target_url, mode) VALUES ('h-entra', 'Portal', 'portal', 'https://portal.example.com', 'entra-app')").run();
  db.prepare("INSERT INTO app_permissions (app_id, group_id) VALUES ('h-app', 'h-group'), ('h-entra', 'h-group')").run();

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('/me returns the impersonated user and the real admin', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  const body = await (await call('/api/auth/me', { cookies })).json();
  assert.equal(body.user.id, 'h-user');
  assert.equal(body.impersonation.sessionId, sessionId);
  assert.equal(body.impersonation.actor.id, 'h-admin');
  assert.equal(body.impersonation.reason, 'test session');
  assert.ok(Date.parse(body.impersonation.expiresAt) > Date.now());
});

test('/me without impersonation reports null', async () => {
  const body = await (await call('/api/auth/me', { cookies: { frontdoor_token: sessionToken('h-admin') } })).json();
  assert.equal(body.user.id, 'h-admin');
  assert.equal(body.impersonation, null);
});

test('writes are refused and audited while impersonating', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  const res = await call('/api/auth/me/preferences', { method: 'PUT', cookies, body: { preferredLanguage: 'it' } });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'impersonation_read_only');
  assert.equal(db.prepare("SELECT preferred_language FROM users WHERE id = 'h-user'").get().preferred_language, null);
  assert.deepEqual(auditActions(sessionId), ['start', 'write_blocked']);
});

test('home activity is ignored without an audit row', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  const res = await call('/api/auth/home-activity', { method: 'POST', cookies });
  assert.equal(res.status, 204);
  assert.equal(db.prepare("SELECT last_activity_at FROM users WHERE id = 'h-user'").get().last_activity_at, null);
  assert.deepEqual(auditActions(sessionId), ['start']);
});

test('admin routes are closed while impersonating', async () => {
  const { cookies } = impersonating('h-owner', 'h-user');
  assert.equal((await call('/api/users', { cookies })).status, 403);
});

test("another admin's session cookie is ignored and cleared", async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  const res = await call('/api/auth/me', { cookies: { ...cookies, frontdoor_token: sessionToken('h-admin2') } });
  const body = await res.json();
  assert.equal(body.user.id, 'h-admin2');
  assert.equal(body.impersonation, null);
  assert.ok(setCookies(res).some((cookie) => cookie.startsWith('frontdoor_impersonation=;')));
  assert.equal(loadSession(sessionId).ended_at, null);
});

test('a tampered cookie is ignored', async () => {
  const { cookies } = impersonating('h-admin', 'h-user');
  const body = await (await call('/api/auth/me', { cookies: { ...cookies, frontdoor_impersonation: `${cookies.frontdoor_impersonation}x` } })).json();
  assert.equal(body.user.id, 'h-admin');
});

test('an ended session is not used', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  endSession(sessionId, 'manual');
  const body = await (await call('/api/auth/me', { cookies })).json();
  assert.equal(body.user.id, 'h-admin');
});

test('a target deactivated mid-session ends it', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user2');
  db.prepare("UPDATE users SET is_active = 0 WHERE id = 'h-user2'").run();
  try {
    const body = await (await call('/api/auth/me', { cookies })).json();
    assert.equal(body.user.id, 'h-admin');
    assert.equal(loadSession(sessionId).end_reason, 'target_ineligible');
  } finally {
    db.prepare("UPDATE users SET is_active = 1 WHERE id = 'h-user2'").run();
  }
});

test('an admin demoted mid-session ends it', async () => {
  const { sessionId, cookies } = impersonating('h-admin2', 'h-user');
  db.prepare("UPDATE users SET role = 'user' WHERE id = 'h-admin2'").run();
  try {
    await call('/api/auth/me', { cookies });
    assert.equal(loadSession(sessionId).end_reason, 'admin_ineligible');
  } finally {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = 'h-admin2'").run();
  }
});

test('an expired session ends with its expiry reason', async () => {
  const past = Date.now() - 60 * 60 * 1000;
  const { id } = startSession({ adminId: 'h-admin', targetUserId: 'h-user', reason: 'old', now: past });
  // The cookie itself is still valid: only the database row has expired.
  const cookies = { frontdoor_token: sessionToken('h-admin'), frontdoor_impersonation: signSessionCookie(id, Date.now() + 60 * 1000) };
  const body = await (await call('/api/auth/me', { cookies })).json();
  assert.equal(body.user.id, 'h-admin');
  assert.equal(loadSession(id).end_reason, 'timeout');
});

test('logout ends the session and clears both cookies', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  const res = await call('/api/auth/logout', { method: 'POST', cookies });
  assert.equal(res.status, 200);
  assert.equal(loadSession(sessionId).end_reason, 'logout');
  const cleared = setCookies(res);
  assert.ok(cleared.some((cookie) => cookie.startsWith('frontdoor_impersonation=;')));
  assert.ok(cleared.some((cookie) => cookie.startsWith('frontdoor_token=;')));
});

const start = (adminId, body) => call('/api/impersonation', { method: 'POST', cookies: { frontdoor_token: sessionToken(adminId) }, body });
const impersonationCookieOf = (res) => setCookies(res).find((cookie) => cookie.startsWith('frontdoor_impersonation='));

test('owner, admin and read-only admin can start; the cookie is host-only', async () => {
  for (const adminId of ['h-owner', 'h-admin', 'h-readonly']) {
    const res = await start(adminId, { userId: 'h-user', reason: 'ticket 7' });
    assert.equal(res.status, 201, adminId);
    const cookie = impersonationCookieOf(res);
    assert.ok(cookie, adminId);
    assert.doesNotMatch(cookie, /Domain=/i);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.ok(!setCookies(res).some((value) => value.startsWith('frontdoor_token=')), 'frontdoor_token must not change');
    const { sessionId } = await res.json();
    assert.deepEqual(auditActions(sessionId), ['start']);
  }
});

test('guard rails refuse invalid starts', async () => {
  const cases = [
    ['h-user', { userId: 'h-user2', reason: 'x' }, 403, 'insufficient_permissions'],
    ['h-admin', { userId: 'h-user', reason: '   ' }, 400, 'impersonation_reason_required'],
    ['h-admin', { userId: 'h-user', reason: 'x'.repeat(501) }, 400, 'impersonation_reason_required'],
    ['h-admin', { userId: 'missing', reason: 'x' }, 404, 'user_not_found'],
    ['h-admin', { userId: 'h-admin', reason: 'x' }, 403, 'impersonation_target_not_allowed'],
    ['h-admin', { userId: 'h-admin2', reason: 'x' }, 403, 'impersonation_target_not_allowed'],
    ['h-owner', { userId: 'h-readonly', reason: 'x' }, 403, 'impersonation_target_not_allowed'],
    ['h-admin', { userId: 'h-inactive', reason: 'x' }, 403, 'impersonation_target_not_allowed'],
  ];
  for (const [adminId, body, status, code] of cases) {
    const res = await start(adminId, body);
    assert.equal(res.status, status, `${adminId} → ${body.userId}`);
    assert.equal((await res.json()).code, code);
    assert.equal(impersonationCookieOf(res), undefined);
  }
});

test('starting while impersonating is refused', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  const res = await call('/api/impersonation', { method: 'POST', cookies, body: { userId: 'h-user2', reason: 'nested' } });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'impersonation_already_active');
  assert.deepEqual(auditActions(sessionId), ['start', 'write_blocked']);
});

test('stop ends the session and restores the admin', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  const res = await call('/api/impersonation/stop', { method: 'POST', cookies });
  assert.equal(res.status, 200);
  assert.equal(loadSession(sessionId).end_reason, 'manual');
  assert.deepEqual(auditActions(sessionId), ['start', 'end']);
  assert.ok(setCookies(res).some((cookie) => cookie.startsWith('frontdoor_impersonation=;')));
  const body = await (await call('/api/auth/me', { cookies: { frontdoor_token: cookies.frontdoor_token } })).json();
  assert.equal(body.user.id, 'h-admin');
});

test('app launches are blocked server side and audited', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  for (const path of ['/api/apps/crm/sso-redirect', '/api/apps/portal/entra-redirect']) {
    const res = await call(path, { cookies });
    assert.equal(res.status, 403, path);
    assert.equal(res.headers.get('location'), null);
    assert.equal((await res.json()).code, 'impersonation_app_launch_blocked');
  }
  assert.deepEqual(auditActions(sessionId), ['start', 'app_launch_blocked', 'app_launch_blocked']);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM access_logs WHERE user_id = 'h-user'").get().count, 0);
});

test('the user can still launch the app themselves', async () => {
  const res = await call('/api/apps/crm/sso-redirect', { cookies: { frontdoor_token: sessionToken('h-user') } });
  assert.equal(res.status, 302);
});

test('the audit API marks and filters impersonation rows', async () => {
  const { sessionId, cookies } = impersonating('h-admin', 'h-user');
  await call('/api/auth/me/preferences', { method: 'PUT', cookies, body: { preferredLanguage: 'it' } });
  const ownerCookies = { frontdoor_token: sessionToken('h-owner') };

  const filtered = await (await call(`/api/logs/audit?impersonation_session_id=${sessionId}`, { cookies: ownerCookies })).json();
  assert.deepEqual(filtered.logs.map((log) => log.action).sort(), ['start', 'write_blocked']);
  for (const log of filtered.logs) {
    assert.equal(log.impersonation_session_id, sessionId);
    assert.equal(log.impersonated_user_id, 'h-user');
    assert.equal(log.impersonated_user_name, 'User One');
    assert.equal(log.actor_id, 'h-admin');
  }

  const byType = await (await call('/api/logs/audit?target_type=impersonation', { cookies: ownerCookies })).json();
  assert.ok(byType.logs.every((log) => log.target_type === 'impersonation'));
});
