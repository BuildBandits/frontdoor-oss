// The /mcp endpoint and its tools, through the real SDK handler (spec §5–§7).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'mcp-endpoint-test-secret-0123456789abcd';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { randomToken, sha256 } = await import('../server/services/mcp/crypto.js');
const { PAGING_FIELDS, PROJECTIONS } = await import('../server/services/mcp/projection.js');
const { describeAppAccess } = await import('../server/services/groupCatalog.js');
const { userCanAccessApp } = await import('../server/services/appCatalog.js');

let server;
let base;
const tokens = {};

const USER_TOOLS = ['get_my_preferences', 'search_my_apps', 'set_color_scheme', 'set_favorite_app', 'set_language'];
const ADMIN_TOOLS = ['get_app_access', 'list_apps', 'list_groups'];

function issueToken(userId) {
  db.prepare("INSERT OR IGNORE INTO mcp_grants (id, user_id, client_id, client_name, scope) VALUES (?, ?, 'ep-client', 'Endpoint Test', 'frontdoor.read frontdoor.preferences')").run(`grant-${userId}`, userId);
  const token = randomToken();
  db.prepare("INSERT INTO mcp_tokens (token_hash, grant_id, kind, family_id, resource, expires_at) VALUES (?, ?, 'access', 'f', ?, datetime('now', '+10 minutes'))")
    .run(sha256(token), `grant-${userId}`, `${base}/mcp`);
  return token;
}

async function rpc(token, method, params = {}, headers = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  const data = raw.split('\n').find((line) => line.startsWith('data: '));
  return { status: res.status, headers: res.headers, raw, body: data ? JSON.parse(data.slice(6)) : (raw ? JSON.parse(raw) : null) };
}

const callTool = async (token, name, args = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).body.result;
const toolNames = async (token) => (await rpc(token, 'tools/list')).body.result.tools.map((tool) => tool.name).sort();

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FRONTEND_URL = base;

  const run = (sql, ...params) => db.prepare(sql).run(...params);
  for (const [id, role] of [['e-user', 'user'], ['e-viewer', 'admin_readonly'], ['e-nested', 'user'], ['e-entra', 'user'], ['e-off', 'user']]) {
    run('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, ?)', id, `${id}@secret-mail.test`, `Name ${id}`, role, id === 'e-off' ? 0 : 1);
  }
  run("INSERT INTO user_groups (id, name) VALUES ('eg-staff', 'Staff'), ('eg-child', 'Interns'), ('eg-empty', 'Nobody')");
  run("INSERT INTO group_group_memberships (parent_group_id, child_group_id) VALUES ('eg-staff', 'eg-child')");
  run("INSERT INTO group_entra_group_memberships (parent_group_id, entra_group_id) VALUES ('eg-staff', 'entra-sales'), ('eg-staff', 'entra-unnamed-0000')");
  run("INSERT INTO entra_group_cache (entra_group_id, display_name) VALUES ('entra-sales', 'Sales EMEA')");
  run("INSERT INTO user_group_members (user_id, group_id) VALUES ('e-user', 'eg-staff'), ('e-viewer', 'eg-staff'), ('e-nested', 'eg-child'), ('e-off', 'eg-staff')");
  run("INSERT INTO entra_user_group_memberships (user_id, entra_group_id, synced_at) VALUES ('e-entra', 'entra-sales', '2026-11-03 08:00:00')");
  run(`INSERT INTO apps (id, name, slug, description, target_url, mode, tags, sort_order) VALUES
    ('ea-payroll', 'Payroll', 'payroll', 'Salaries and payslips', 'https://payroll.example.com', 'redirect', '["hr","finance"]', 1),
    ('ea-nas', 'File server', 'nas', 'Internal shares', 'http://10.20.30.40', 'internal-link', '["infra"]', 2),
    ('ea-orphan', 'Orphan', 'orphan', 'Granted to nobody', 'https://orphan.example.com', 'redirect-plain', '[]', 3)`);
  run("INSERT INTO app_permissions (app_id, group_id) VALUES ('ea-payroll', 'eg-staff'), ('ea-nas', 'eg-staff')");
  // A favourite the user can no longer open must not leak its slug.
  run("UPDATE users SET favorite_apps = '[\"ea-orphan\",\"ea-payroll\"]' WHERE id = 'e-user'");
  run("INSERT INTO mcp_clients (id, kind, client_id, name, redirect_uris, secret_hash, created_by) VALUES ('ep', 'registered', 'ep-client', 'Endpoint Test', '[\"https://x.example/cb\"]', 'h', 'e-viewer')");
  run("UPDATE mcp_settings SET enabled = 1");
  for (const id of ['e-user', 'e-viewer']) tokens[id] = issueToken(id);
});

after(() => new Promise((resolve) => server.close(resolve)));

test('authentication: 401 with the resource metadata challenge; session JWTs and junk are refused', async () => {
  const missing = await rpc(null, 'tools/list');
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get('www-authenticate'), `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
  const session = jwt.sign({ userId: 'e-user' }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
  for (const token of [session, 'x'.repeat(43), randomToken()]) {
    const res = await rpc(token, 'tools/list');
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /error="invalid_token"/);
  }
});

test('a cross-origin browser request is refused (DNS rebinding)', async () => {
  assert.equal((await rpc(tokens['e-user'], 'tools/list', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await rpc(tokens['e-user'], 'tools/list', {}, { Origin: base })).status, 200);
});

test('bodies over 64 KiB are refused before reaching the tools', async () => {
  const res = await rpc(tokens['e-user'], 'tools/call', { name: 'search_my_apps', arguments: { query: 'x'.repeat(70 * 1024) } });
  assert.equal(res.status, 413);
});

test('the access token is not accepted on the session API', async () => {
  const res = await fetch(`${base}/api/apps`, { headers: { Authorization: `Bearer ${tokens['e-user']}` } });
  assert.equal(res.status, 401);
});

test('each role sees exactly its tools', async () => {
  assert.deepEqual(await toolNames(tokens['e-user']), USER_TOOLS);
  assert.deepEqual(await toolNames(tokens['e-viewer']), [...ADMIN_TOOLS, ...USER_TOOLS].sort());
});

test('search_my_apps returns only reachable apps, with Frontdoor launch links and never a target URL', async () => {
  const { structuredContent, content } = await callTool(tokens['e-user'], 'search_my_apps');
  assert.deepEqual(structuredContent.apps.map((app) => app.slug), ['payroll', 'nas']);
  const nas = structuredContent.apps.find((app) => app.slug === 'nas');
  assert.equal(nas.launchUrl, `${base}/api/apps/nas/sso-redirect`);
  assert.ok(!content[0].text.includes('10.20.30.40'));
  assert.ok(!content[0].text.includes('payroll.example.com'));
  assert.deepEqual((await callTool(tokens['e-user'], 'search_my_apps', { tag: 'HR' })).structuredContent.apps.map((app) => app.slug), ['payroll']);
  assert.deepEqual((await callTool(tokens['e-user'], 'search_my_apps', { query: 'payslip' })).structuredContent.apps.map((app) => app.slug), ['payroll']);
});

test('preferences: favourites the user cannot open are hidden; writes are own-only and audited', async () => {
  let prefs = (await callTool(tokens['e-user'], 'get_my_preferences')).structuredContent.preferences;
  assert.deepEqual(prefs.favorites, ['payroll']);

  const refused = await callTool(tokens['e-user'], 'set_favorite_app', { slug: 'orphan', favorite: true });
  assert.equal(refused.isError, true);

  prefs = (await callTool(tokens['e-user'], 'set_favorite_app', { slug: 'nas', favorite: true })).structuredContent.preferences;
  assert.deepEqual(prefs.favorites, ['payroll', 'nas']);
  assert.equal((await callTool(tokens['e-user'], 'set_color_scheme', { scheme: 'dark' })).structuredContent.preferences.colorScheme, 'dark');
  assert.equal(db.prepare("SELECT preferred_color_scheme FROM users WHERE id = 'e-user'").get().preferred_color_scheme, 'dark');
  const audit = db.prepare("SELECT details FROM rbac_audit_logs WHERE action = 'mcp.preference_changed' AND actor_id = 'e-user'").all();
  assert.equal(audit.length, 2);
  assert.match(audit[0].details, /Endpoint Test/);
});

test('tool inputs are strict: unknown keys and invalid values are rejected', async () => {
  for (const [name, args] of [
    ['set_color_scheme', { scheme: 'purple' }],
    ['search_my_apps', { query: 'x', sql: 'DROP TABLE apps' }],
    ['set_favorite_app', { slug: '../etc', favorite: true }],
    ['list_apps', { filter: 'all' }],
  ]) {
    const res = await rpc(tokens['e-user'], 'tools/call', { name, arguments: args });
    assert.ok(res.body.error || res.body.result?.isError, `${name} ${JSON.stringify(args)}`);
  }
});

test('admin tools answer with counts and group names, never identities', async () => {
  const orphans = (await callTool(tokens['e-viewer'], 'list_apps', { filter: 'no_groups' })).structuredContent.apps;
  assert.deepEqual(orphans.map((app) => app.slug), ['orphan']);

  const access = (await callTool(tokens['e-viewer'], 'get_app_access', { slug: 'payroll' })).structuredContent;
  // e-user, e-viewer (direct), e-nested (child group), e-entra (Entra link); e-off is inactive.
  assert.equal(access.totalUsers, 4);
  // An Entra group without a cached display name is counted, never named by its object ID.
  assert.deepEqual(access.groups, [{ name: 'Staff', source: 'local', nestedGroups: ['Interns', 'Sales EMEA'], unnamedNestedGroups: 1, userCount: 4 }]);

  const groups = (await callTool(tokens['e-viewer'], 'list_groups', { query: 'staff' })).structuredContent.groups;
  assert.deepEqual(groups, [{ name: 'Staff', source: 'local', memberCount: 3, appCount: 2 }]);
});

test('get_app_access agrees with the access check for every user', () => {
  const users = db.prepare('SELECT id FROM users WHERE is_active = 1').all().map((row) => row.id);
  for (const appId of ['ea-payroll', 'ea-nas', 'ea-orphan']) {
    const expected = users.filter((userId) => userCanAccessApp(userId, appId)).length;
    assert.equal(describeAppAccess(appId).totalUsers, expected, appId);
  }
});

test('fail closed: every tool result carries only projected fields and no personal data', async () => {
  const allowed = new Set([...Object.values(PROJECTIONS).flat(), ...PAGING_FIELDS, 'apps', 'preferences', 'groups', 'app', 'totalUsers']);
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        assert.ok(allowed.has(key), `unexpected field ${path}.${key}`);
        walk(child, `${path}.${key}`);
      }
    }
  };
  const calls = [
    ['e-user', 'search_my_apps', {}], ['e-user', 'get_my_preferences', {}],
    ['e-viewer', 'list_apps', {}], ['e-viewer', 'get_app_access', { slug: 'payroll' }], ['e-viewer', 'list_groups', {}],
  ];
  for (const [userId, name, args] of calls) {
    const out = await callTool(tokens[userId], name, args);
    walk(out.structuredContent, name);
    for (const secret of ['@secret-mail.test', 'Name e-', 'e-user', 'e-viewer', 'ea-payroll', 'eg-staff', 'payroll.example.com', '10.20.30.40', 'entra-sales', 'entra-unnamed-0000']) {
      assert.ok(!out.content[0].text.includes(secret), `${name} leaked ${secret}`);
    }
  }
});

test('a demoted admin loses the admin tools on the next request', async () => {
  db.prepare("UPDATE users SET role = 'user' WHERE id = 'e-viewer'").run();
  assert.deepEqual(await toolNames(tokens['e-viewer']), USER_TOOLS);
  const res = await rpc(tokens['e-viewer'], 'tools/call', { name: 'list_apps', arguments: {} });
  assert.ok(res.body.error || res.body.result?.isError);
  db.prepare("UPDATE users SET role = 'admin_readonly' WHERE id = 'e-viewer'").run();
});

test('a disabled MCP answers 404 on /mcp', async () => {
  db.prepare('UPDATE mcp_settings SET enabled = 0').run();
  assert.equal((await rpc(tokens['e-user'], 'tools/list')).status, 404);
  db.prepare('UPDATE mcp_settings SET enabled = 1').run();
});

test('JSON-RPC batches are refused, so the rate limit counts tool calls', async () => {
  const batch = Array.from({ length: 5 }, (_, index) => ({ jsonrpc: '2.0', id: index, method: 'tools/call', params: { name: 'list_groups', arguments: {} } }));
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', Authorization: `Bearer ${tokens['e-viewer']}` },
    body: JSON.stringify(batch),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, -32600);
});
