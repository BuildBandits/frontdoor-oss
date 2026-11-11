// Two MCP scopes, chosen at consent (ADR 0006, spec §4 rule 15): frontdoor.read
// is always granted and strictly read-only; frontdoor.preferences carries the
// three set_* tools and the user can untick it even when the client asks.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'mcp-scopes-test-secret-0123456789abcdefg';
process.env.MCP_AUTHORIZE_RATE_LIMIT_MAX = '1000';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

const READ = 'frontdoor.read';
const PREFS = 'frontdoor.preferences';
const BOTH = `${READ} ${PREFS}`;
const SET_TOOLS = ['set_color_scheme', 'set_favorite_app', 'set_language'];
const REDIRECT = 'https://assistant.example/callback';

let server;
let base;
let client;

const sessionFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
const basic = (id, secret) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

const api = (method, path, { userId, body, cookie } = {}) => fetch(`${base}${path}`, {
  method,
  redirect: 'manual',
  headers: {
    ...(userId ? { Authorization: `Bearer ${sessionFor(userId)}` } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    'Sec-Fetch-Site': 'same-origin',
  },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

const form = (path, params) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic(client.client_id, client.secret) },
  body: new URLSearchParams(params).toString(),
});

// GET /oauth/authorize; `scope: undefined` omits the parameter.
async function authorize(scope, challenge) {
  const url = new URL(`${base}/oauth/authorize`);
  const params = { client_id: client.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', resource: `${base}/mcp`, state: 's', scope };
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.append(key, value);
  return fetch(url, { redirect: 'manual' });
}

async function pending(scope, challenge = pkce().challenge) {
  const res = await authorize(scope, challenge);
  const location = new URL(res.headers.get('location'));
  return { res, location, requestId: location.pathname.split('/').pop(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const decide = ({ requestId, cookie }, body, userId = 's-user') => api('POST', `/api/mcp/authorizations/${requestId}/decision`, { userId, cookie, body });

// authorize → consent (keeping `keep`, or the client's request when omitted) → token.
async function connect(scope, keep, userId = 's-user') {
  const { challenge, verifier } = pkce();
  const request = await pending(scope, challenge);
  const decision = await decide(request, { approve: true, ...(keep ? { scopes: keep } : {}) }, userId);
  assert.equal(decision.status, 200);
  const code = new URL((await decision.json()).location).searchParams.get('code');
  const res = await form('/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${base}/mcp` });
  assert.equal(res.status, 200);
  return res.json();
}

async function mcp(token, method, params = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const raw = await res.text();
  const data = raw.split('\n').find((line) => line.startsWith('data: '));
  return JSON.parse(data ? data.slice(6) : raw);
}
const toolNames = async (token) => (await mcp(token, 'tools/list')).result.tools.map((tool) => tool.name);

before(async () => {
  for (const [id, role] of [['s-owner', 'owner'], ['s-user', 'user'], ['s-other', 'user']]) {
    db.prepare('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)').run(id, `${id}@scopes.test`, id, role);
  }
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FRONTEND_URL = base;
  assert.equal((await api('PUT', '/api/mcp/settings', { userId: 's-owner', body: { enabled: true } })).status, 200);
  const created = await (await api('POST', '/api/mcp/clients', { userId: 's-owner', body: { kind: 'registered', name: 'Assistant', redirectUris: [REDIRECT] } })).json();
  client = { ...created.client, secret: created.clientSecret };
});

after(() => new Promise((resolve) => server.close(resolve)));

test('metadata advertises both scopes', async () => {
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual(as.scopes_supported, [READ, PREFS]);
  assert.deepEqual(prm.scopes_supported, [READ, PREFS]);
});

test('the consent page receives the requested scopes; read is always included', async () => {
  for (const [scope, expected] of [
    [undefined, [READ, PREFS]],
    ['', [READ, PREFS]],
    [READ, [READ]],
    [PREFS, [READ, PREFS]],
    [`${PREFS} ${READ} ${PREFS}`, [READ, PREFS]],
  ]) {
    const request = await pending(scope);
    const details = await (await api('GET', `/api/mcp/authorizations/${request.requestId}`, { userId: 's-user', cookie: request.cookie })).json();
    assert.deepEqual(details.authorization.scopes, expected, JSON.stringify(scope));
  }
});

test('an unknown scope is invalid_scope, back to the client', async () => {
  for (const scope of [`${READ} admin`, 'frontdoor.propose', 'FRONTDOOR.READ']) {
    const { location } = await pending(scope);
    assert.equal(`${location.origin}${location.pathname}`, REDIRECT, scope);
    assert.equal(location.searchParams.get('error'), 'invalid_scope', scope);
  }
});

test('approving without a choice grants what the client requested', async () => {
  assert.equal((await connect(undefined)).scope, BOTH);
  assert.equal((await connect(READ)).scope, READ);
});

test('the user can untick preferences: the grant and token are read-only, and no set_* tool exists', async () => {
  const tokens = await connect(BOTH, [READ]);
  assert.equal(tokens.scope, READ);
  const names = await toolNames(tokens.access_token);
  assert.ok(names.includes('search_my_apps') && names.includes('get_my_preferences'));
  for (const name of SET_TOOLS) assert.ok(!names.includes(name), name);
  const call = await mcp(tokens.access_token, 'tools/call', { name: 'set_language', arguments: { language: 'it' } });
  assert.ok(call.error || call.result?.isError, 'a read-only grant cannot change a preference');
  assert.equal(db.prepare("SELECT preferred_language FROM users WHERE id = 's-user'").get().preferred_language ?? null, null);
});

test('with preferences granted, the set_* tools are listed and work', async () => {
  const tokens = await connect(BOTH, [READ, PREFS]);
  assert.equal(tokens.scope, BOTH);
  const names = await toolNames(tokens.access_token);
  for (const name of SET_TOOLS) assert.ok(names.includes(name), name);
  const call = await mcp(tokens.access_token, 'tools/call', { name: 'set_color_scheme', arguments: { scheme: 'dark' } });
  assert.ok(!call.result.isError);
});

test('the decision cannot add a scope, drop read, or carry junk', async () => {
  for (const [scope, scopes] of [
    [READ, [READ, PREFS]],
    [BOTH, [PREFS]],
    [BOTH, []],
    [BOTH, 'frontdoor.read'],
    [BOTH, [READ, 'admin']],
    [BOTH, [READ, 42]],
  ]) {
    const request = await pending(scope);
    const res = await decide(request, { approve: true, scopes });
    assert.equal(res.status, 400, JSON.stringify({ scope, scopes }));
    assert.equal((await res.json()).code, 'mcp_consent_invalid_scope');
    // A refused decision does not consume the request: the user can try again.
    assert.equal((await decide(request, { approve: false })).status, 200);
  }
});

test('re-consenting replaces the scopes of the existing grant, and live tokens follow at once', async () => {
  const wide = await connect(BOTH, [READ, PREFS], 's-other');
  assert.ok((await toolNames(wide.access_token)).includes('set_language'));
  const narrow = await connect(BOTH, [READ], 's-other');
  assert.equal(narrow.scope, READ);
  const grants = db.prepare("SELECT scope FROM mcp_grants WHERE user_id = 's-other' AND revoked_at IS NULL").all();
  assert.deepEqual(grants, [{ scope: READ }], 'one grant per user and client');
  assert.ok(!(await toolNames(wide.access_token)).includes('set_language'), 'the older token lost the scope too');
  const audit = db.prepare("SELECT details FROM rbac_audit_logs WHERE action = 'mcp.grant_scopes_changed' AND actor_id = 's-other'").all();
  assert.equal(audit.length, 1);
  assert.deepEqual(JSON.parse(audit[0].details).details?.scopes ?? JSON.parse(audit[0].details).scopes, [READ]);
});

test('refresh never widens: a scope beyond the grant is invalid_scope; a subset gets the grant scopes', async () => {
  const tokens = await connect(BOTH, [READ], 's-user');
  const beyond = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope: BOTH });
  assert.equal(beyond.status, 400);
  assert.equal((await beyond.json()).error, 'invalid_scope');
  const same = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope: READ });
  assert.equal(same.status, 200);
  assert.equal((await same.json()).scope, READ);
});

test('the connections list shows each connection\'s scopes', async () => {
  const { connections } = await (await api('GET', '/api/mcp/connections', { userId: 's-other' })).json();
  assert.deepEqual(connections.map((connection) => connection.scopes), [[READ]]);
});
