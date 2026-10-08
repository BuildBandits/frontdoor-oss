import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'http-test-secret-0123456789abcdef';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

const distIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');

let server;
let baseUrl;
const tokens = {};

function createUser(role) {
  const id = `http-test-${role}`;
  db.prepare('INSERT OR REPLACE INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(id, `${role}@http-test.local`, `HTTP ${role}`, role);
  tokens[role] = jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: '5m' });
  return id;
}

function request(pathname, { role, headers = {}, ...options } = {}) {
  const authHeaders = role ? { Authorization: `Bearer ${tokens[role]}` } : {};
  return fetch(`${baseUrl}${pathname}`, { ...options, headers: { ...authHeaders, ...headers }, redirect: 'manual' });
}

before(async () => {
  for (const role of ['owner', 'admin', 'admin_readonly', 'user']) createUser(role);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('health endpoint answers with JSON and rate limit headers', async () => {
  const res = await request('/api/health');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal((await res.json()).status, 'ok');
  assert.ok(res.headers.get('ratelimit-limit'), 'missing RateLimit-Limit header');
  assert.ok(res.headers.get('ratelimit-policy'), 'missing RateLimit-Policy header');
});

test('security headers are set', async () => {
  const res = await request('/api/health');
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('malformed URI is rejected with 400', async () => {
  const res = await request('/%E0%A4%A');
  assert.equal(res.status, 400);
});

test('SPA fallback serves index.html for deep links', { skip: !fs.existsSync(distIndex) && 'frontend not built' }, async () => {
  for (const pathname of ['/', '/admin/users', '/some/deep/link?x=1']) {
    const res = await request(pathname);
    assert.equal(res.status, 200, pathname);
    assert.match(await res.text(), /<div id="root">/, pathname);
  }
});

test('POST without a JSON body reaches the handler as an empty body', async () => {
  const noBody = await request('/api/auth/verify-sso-token', { method: 'POST' });
  assert.equal(noBody.status, 400);
  assert.deepEqual(await noBody.json(), { error: 'bad_request' });

  const textBody = await request('/api/auth/verify-sso-token', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'not json',
  });
  assert.equal(textBody.status, 400);
  assert.deepEqual(await textBody.json(), { error: 'bad_request' });
});

test('malformed JSON body is rejected with 400', async () => {
  const res = await request('/api/auth/verify-sso-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad',
  });
  assert.equal(res.status, 400);
});

test('protected routes require a valid token', async () => {
  const missing = await request('/api/users');
  assert.equal(missing.status, 401);
  assert.deepEqual(await missing.json(), { error: 'No token provided', code: 'not_authenticated' });

  const invalid = await request('/api/users', { headers: { Authorization: 'Bearer not-a-jwt' } });
  assert.equal(invalid.status, 401);
  assert.deepEqual(await invalid.json(), { error: 'Invalid token', code: 'invalid_token' });

  const cookie = await request('/api/users', { headers: { Cookie: `frontdoor_token=${tokens.owner}` } });
  assert.equal(cookie.status, 200);
});

test('role guards: admin viewers read, editors write, owners only for logs', async () => {
  assert.equal((await request('/api/users', { role: 'user' })).status, 403);
  assert.equal((await request('/api/users', { role: 'admin_readonly' })).status, 200);
  assert.equal((await request('/api/users', { role: 'admin' })).status, 200);

  const readonlyWrite = await request('/api/users/http-test-user/active', {
    role: 'admin_readonly',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: false }),
  });
  assert.equal(readonlyWrite.status, 403);
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get('http-test-user').is_active, 1);

  assert.equal((await request('/api/logs/audit', { role: 'admin' })).status, 403);
  assert.equal((await request('/api/logs/audit', { role: 'owner' })).status, 200);
});

test('users not found in Entra are listed with their mark, and reactivation clears it', async () => {
  db.prepare("INSERT INTO users (id, email, display_name, role, is_active, entra_missing_since) VALUES ('http-test-gone', 'gone@http-test.local', 'Gone', 'user', 0, '2026-10-01 08:00:00')").run();

  const list = await (await request('/api/users', { role: 'admin' })).json();
  assert.equal(list.users.find((user) => user.id === 'http-test-gone').entra_missing_since, '2026-10-01 08:00:00');
  const detail = await (await request('/api/users/http-test-gone', { role: 'admin' })).json();
  assert.equal(detail.user.entra_missing_since, '2026-10-01 08:00:00');

  const reactivate = await request('/api/users/http-test-gone/active', {
    role: 'admin',
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: true }),
  });
  assert.equal(reactivate.status, 200);
  assert.deepEqual(db.prepare('SELECT is_active, entra_missing_since FROM users WHERE id = ?').get('http-test-gone'), { is_active: 1, entra_missing_since: null });
  db.prepare("DELETE FROM users WHERE id = 'http-test-gone'").run();
});

test('query strings with bracket syntax do not break handlers', async () => {
  const res = await request('/api/logs/audit?actor_ids[]=1&q[a]=b&page=1', { role: 'owner' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).logs));
});

test('plugin routes answer 404, not 500, for malformed plugin ids', async () => {
  // The UI keeps the plugin system locked off; enable it in the isolated test DB.
  db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();
  try {
    const badId = encodeURIComponent('__Not A Valid Id__');
    const json = { 'Content-Type': 'application/json' };
    const cases = [
      ['GET', `/api/plugins/${badId}`],
      ['DELETE', `/api/plugins/${badId}`],
      ['POST', `/api/plugins/${badId}/approve`],
      ['POST', `/api/plugins/${badId}/revoke`],
      ['POST', `/api/plugins/${badId}/test-event/auth.login`],
    ];
    for (const [method, pathname] of cases) {
      const res = await request(pathname, { role: 'owner', method, headers: json, body: method === 'GET' ? undefined : '{}' });
      assert.equal(res.status, 404, `${method} ${pathname}`);
      assert.deepEqual(await res.json(), { error: 'Plugin not found', code: 'plugin_not_found' }, `${method} ${pathname}`);
    }
  } finally {
    db.prepare("UPDATE branding_settings SET plugins_enabled = 0 WHERE id = 'default'").run();
  }
});

test('SSO init reports 501 when Microsoft SSO is not configured', async () => {
  // The MSAL client is built at import time from AZURE_* env vars, which tests do not set.
  const res = await request('/api/auth/microsoft');
  assert.equal(res.status, 501);
  assert.deepEqual(await res.json(), { error: 'Microsoft SSO not configured', code: 'sso_not_configured' });
});

test('backup verify describes an archive for owners only and changes nothing', async () => {
  const usersBefore = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const body = zlib.gzipSync(Buffer.from(JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    app: { version: '1.0.0' },
    database: { tables: [{ name: 'users', columns: ['id', 'email'], rows: [{ id: 'v-1', email: 'v@example.com' }] }] },
    buckets: [],
    summary: {},
  })));
  const send = (role) => request('/api/backups/verify', { role, method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body });

  assert.equal((await send('admin')).status, 403);
  const res = await send('owner');
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.sourceVersion, '1.0.0');
  assert.equal(report.totalRows, 1);
  assert.equal(report.newerThanCurrent, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, usersBefore);

  const bad = await request('/api/backups/verify', { role: 'owner', method: 'POST', headers: { 'Content-Type': 'application/gzip' }, body: Buffer.from('nope') });
  assert.equal(bad.status, 400);
});

test('backup export options and encrypted archives over HTTP', async () => {
  const { createBackupArchive } = await import('../server/services/backup.js');
  const tooShort = await request('/api/backups/export-jobs', {
    role: 'owner',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase: 'short' }),
  });
  assert.equal(tooShort.status, 400);
  assert.equal((await tooShort.json()).code, 'backup_passphrase_too_short');

  const { archive } = await createBackupArchive({ passphrase: 'an http test passphrase', excludeLogs: true });
  const verify = (headers = {}) => request('/api/backups/verify', {
    role: 'owner',
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...headers },
    body: archive,
  });

  const locked = await verify();
  assert.equal(locked.status, 400);
  assert.equal((await locked.json()).code, 'backup_passphrase_required');
  const unlocked = await verify({ 'X-Backup-Passphrase': 'an http test passphrase' });
  assert.equal(unlocked.status, 200);
  const report = await unlocked.json();
  assert.ok(report.tablesNotInArchive.includes('access_logs'));
});

test('raw database export is owner-only and can be encrypted', async () => {
  assert.equal((await request('/api/backups/database', { role: 'admin' })).status, 403);

  const plain = await request('/api/backups/database', { role: 'owner' });
  assert.equal(plain.status, 200);
  assert.match(plain.headers.get('content-disposition'), /frontdoor-database-.+\.db"/);
  const body = Buffer.from(await plain.arrayBuffer());
  assert.equal(body.subarray(0, 15).toString('latin1'), 'SQLite format 3');

  const tooShort = await request('/api/backups/database', { role: 'owner', headers: { 'X-Backup-Passphrase': 'short' } });
  assert.equal(tooShort.status, 400);

  const encrypted = await request('/api/backups/database', { role: 'owner', headers: { 'X-Backup-Passphrase': 'a raw export passphrase' } });
  assert.equal(encrypted.status, 200);
  assert.match(encrypted.headers.get('content-disposition'), /\.db\.enc"/);
  assert.equal(Buffer.from(await encrypted.arrayBuffer()).subarray(0, 8).toString('ascii'), 'FDBKENC2');
});

test('streamed v2 export can be checked again, and oversized uploads are refused', async () => {
  const exported = await request('/api/backups/export?excludeLogs=true', { role: 'owner' });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /\.tar\.gz"/);
  assert.equal(exported.headers.get('x-backup-version'), '2');
  const archive = Buffer.from(await exported.arrayBuffer());

  const checked = await request('/api/backups/verify', {
    role: 'owner',
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip' },
    body: archive,
  });
  assert.equal(checked.status, 200);
  const report = await checked.json();
  assert.ok(report.tables.some((table) => table.name === 'users' && table.rows > 0));
  assert.ok(report.tablesNotInArchive.includes('access_logs'));

  const previous = process.env.BACKUP_MAX_UPLOAD_MB;
  process.env.BACKUP_MAX_UPLOAD_MB = '1';
  try {
    const tooLarge = await request('/api/backups/verify', {
      role: 'owner',
      method: 'POST',
      headers: { 'Content-Type': 'application/gzip' },
      body: Buffer.alloc(2 * 1024 * 1024, 1),
    });
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json()).code, 'backup_too_large');
  } finally {
    if (previous === undefined) delete process.env.BACKUP_MAX_UPLOAD_MB;
    else process.env.BACKUP_MAX_UPLOAD_MB = previous;
  }
});

// Keep last: it replaces the users table that the other tests rely on.
test('backup restore refuses newer archives unless allowed and reports whether the session survives', async () => {
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get('http-test-owner');
  const archive = (version, users) => zlib.gzipSync(Buffer.from(JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    app: { version },
    database: { tables: [{ name: 'users', columns: Object.keys(owner), rows: users }] },
    buckets: [],
    summary: {},
  })));
  const restore = (body, query = '') => request(`/api/backups/restore${query}`, {
    role: 'owner',
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip' },
    body,
  });

  const refused = await restore(archive('99.0.0', [owner]));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, 'backup_from_newer_version');

  const kept = await restore(archive('99.0.0', [owner]), '?allowNewer=true');
  assert.equal(kept.status, 200);
  const keptBody = await kept.json();
  assert.equal(keptBody.sessionValid, true);
  assert.equal(keptBody.verification.integrity, 'ok');

  const otherUser = { ...owner, id: 'restored-only-user', email: 'restored@http-test.local' };
  const lost = await restore(archive('1.0.0', [otherUser]));
  assert.equal(lost.status, 200);
  assert.equal((await lost.json()).sessionValid, false);
});
