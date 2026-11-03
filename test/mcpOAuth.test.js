// The MCP authorization server end to end, through the real routes. Each test
// names the rule of docs/design/mcp/02-phase1-spec.md §4 it covers.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'mcp-oauth-test-secret-0123456789abcdef';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { verifyAccessToken } = await import('../server/services/mcp/oauth.js');

let server;
let base;
let client; // registered confidential client
const REDIRECT = 'https://assistant.example/callback';

const sessionFor = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
const basic = (id, secret) => `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')}`;

async function api(method, path, { userId, body, headers = {}, cookie } = {}) {
  return fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(userId ? { Authorization: `Bearer ${sessionFor(userId)}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const form = (path, params, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams(params).toString(),
});

function authorizeUrl(overrides = {}) {
  const params = {
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    response_type: 'code',
    code_challenge: overrides.challenge,
    code_challenge_method: 'S256',
    resource: `${base}/mcp`,
    scope: 'frontdoor.read',
    state: 'state-123',
    ...overrides,
  };
  delete params.challenge;
  const url = new URL(`${base}/oauth/authorize`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.append(key, value);
  return url.toString();
}

const authorize = (overrides) => fetch(authorizeUrl(overrides), { redirect: 'manual' });

// Runs authorize → consent → approve and returns the code.
async function obtainCode(userId = 'o-user', { challenge } = {}) {
  const res = await authorize({ challenge });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  const requestId = location.pathname.split('/').pop();
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const decision = await api('POST', `/api/mcp/authorizations/${requestId}/decision`, {
    userId, cookie, body: { approve: true }, headers: { 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.equal(decision.status, 200);
  return new URL((await decision.json()).location).searchParams.get('code');
}

async function exchange(code, verifier, overrides = {}) {
  return form('/oauth/token', {
    grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${base}/mcp`, ...overrides,
  }, { Authorization: basic(client.client_id, client.secret) });
}

before(async () => {
  for (const [id, role] of [['o-owner', 'owner'], ['o-user', 'user'], ['o-other', 'user']]) {
    db.prepare('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)').run(id, `${id}@oauth.test`, id, role);
  }
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FRONTEND_URL = base;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('a disabled MCP advertises nothing', async () => {
  for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/oauth/authorize']) {
    assert.equal((await fetch(`${base}${path}`, { redirect: 'manual' })).status, 404, path);
  }
  assert.equal((await form('/oauth/token', { grant_type: 'refresh_token' })).status, 404);
});

test('only the owner enables the MCP and registers clients; the secret is returned once', async () => {
  assert.equal((await api('PUT', '/api/mcp/settings', { userId: 'o-user', body: { enabled: true } })).status, 403);
  const enabled = await api('PUT', '/api/mcp/settings', { userId: 'o-owner', body: { enabled: true } });
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).settings.enabled, true);

  assert.equal((await api('POST', '/api/mcp/clients', { userId: 'o-user', body: { kind: 'registered', name: 'X', redirectUris: [REDIRECT] } })).status, 403);
  const created = await api('POST', '/api/mcp/clients', { userId: 'o-owner', body: { kind: 'registered', name: 'Assistant', redirectUris: [REDIRECT] } });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  const body = await created.json();
  client = { ...body.client, secret: body.clientSecret };
  assert.match(client.secret, /^[A-Za-z0-9_-]{43}$/);
  const listed = await (await api('GET', '/api/mcp/settings', { userId: 'o-owner' })).json();
  assert.ok(!JSON.stringify(listed).includes(client.secret));
  assert.ok(!JSON.stringify(listed).includes('secret_hash'));
});

test('metadata advertises S256, CIMD, iss and the canonical resource', async () => {
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.issuer, base);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.equal(as.authorization_response_iss_parameter_supported, true);
  assert.equal(as.registration_endpoint, undefined);
  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual(prm, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['frontdoor.read'], bearer_methods_supported: ['header'], resource_name: 'Frontdoor' });
});

test('rules 3, 4: an unknown client or redirect gets an error page, never a redirect to it', async () => {
  const { challenge } = pkce();
  for (const [overrides, code] of [
    [{ client_id: 'nobody' }, 'mcp_client_unknown'],
    [{ redirect_uri: 'https://evil.example/callback' }, 'mcp_redirect_uri_mismatch'],
    [{ redirect_uri: `${REDIRECT}/extra` }, 'mcp_redirect_uri_mismatch'],
    [{ redirect_uri: undefined }, 'mcp_redirect_uri_mismatch'],
  ]) {
    const res = await authorize({ challenge, ...overrides });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${base}/connect?error=${code}`, JSON.stringify(overrides));
  }
  const duplicated = await fetch(`${authorizeUrl({ challenge })}&redirect_uri=${encodeURIComponent('https://evil.example/cb')}`, { redirect: 'manual' });
  assert.equal(duplicated.headers.get('location'), `${base}/connect?error=mcp_authorize_duplicate_parameter`);
});

test('rules 1, 2, 10: protocol errors go back to the client with state and iss', async () => {
  const { challenge, verifier } = pkce();
  for (const [overrides, error] of [
    [{ response_type: 'token' }, 'unsupported_response_type'],
    [{ code_challenge_method: 'plain', challenge: verifier }, 'invalid_request'],
    [{ challenge: undefined }, 'invalid_request'],
    [{ resource: undefined }, 'invalid_target'],
    [{ resource: `${base}/api` }, 'invalid_target'],
    [{ scope: 'frontdoor.read admin' }, 'invalid_scope'],
  ]) {
    const res = await authorize({ challenge, ...overrides });
    const location = new URL(res.headers.get('location'));
    assert.equal(`${location.origin}${location.pathname}`, REDIRECT, JSON.stringify(overrides));
    assert.equal(location.searchParams.get('error'), error);
    assert.equal(location.searchParams.get('state'), 'state-123');
    assert.equal(location.searchParams.get('iss'), base);
  }
});

test('rules 7, 8, 9: consent is bound to the starting browser and must be same-origin', async () => {
  const { challenge } = pkce();
  const res = await authorize({ challenge });
  const requestId = new URL(res.headers.get('location')).pathname.split('/').pop();
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, new RegExp(`Path=/api/mcp/authorizations/${requestId}`));
  const cookie = setCookie.split(';')[0];

  const details = await api('GET', `/api/mcp/authorizations/${requestId}`, { userId: 'o-user', cookie });
  assert.equal(details.status, 200);
  const { authorization } = await details.json();
  assert.equal(authorization.clientName, 'Assistant');
  assert.equal(authorization.redirectHost, 'assistant.example');
  assert.ok(authorization.exposedFields.includes('launchLinks'));
  assert.ok(!authorization.exposedFields.some((field) => /email|user/i.test(field)));

  // Someone else opening the link (no cookie) sees nothing and cannot approve.
  assert.equal((await api('GET', `/api/mcp/authorizations/${requestId}`, { userId: 'o-other' })).status, 404);
  assert.equal((await api('POST', `/api/mcp/authorizations/${requestId}/decision`, { userId: 'o-other', body: { approve: true }, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 404);
  // A satellite (same-site, trusted for /api) still cannot decide.
  assert.equal((await api('POST', `/api/mcp/authorizations/${requestId}/decision`, { userId: 'o-user', cookie, body: { approve: true }, headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);

  const denied = await api('POST', `/api/mcp/authorizations/${requestId}/decision`, { userId: 'o-user', cookie, body: { approve: false }, headers: { 'Sec-Fetch-Site': 'same-origin' } });
  const location = new URL((await denied.json()).location);
  assert.equal(location.searchParams.get('error'), 'access_denied');
  assert.equal(location.searchParams.get('iss'), base);
  // Single use.
  assert.equal((await api('POST', `/api/mcp/authorizations/${requestId}/decision`, { userId: 'o-user', cookie, body: { approve: true }, headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 404);
});

test('rules 11, 12, 13, 14: code exchange issues opaque tokens stored only as hashes', async () => {
  const { challenge, verifier } = pkce();
  const code = await obtainCode('o-user', { challenge });
  const res = await exchange(code, verifier);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const tokens = await res.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.expires_in, 600);
  assert.equal(tokens.scope, 'frontdoor.read');
  const stored = db.prepare('SELECT token_hash FROM mcp_tokens').all().map((row) => row.token_hash);
  assert.ok(!stored.includes(tokens.access_token) && !stored.includes(tokens.refresh_token));
  assert.ok(stored.includes(crypto.createHash('sha256').update(tokens.access_token).digest('hex')));
  assert.equal(verifyAccessToken(db, tokens.access_token).userId, 'o-user');
  assert.equal(verifyAccessToken(db, tokens.refresh_token), null, 'a refresh token is not an access token');
});

test('rule 14: client authentication is enforced at the token endpoint', async () => {
  const { challenge, verifier } = pkce();
  const code = await obtainCode('o-user', { challenge });
  const params = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${base}/mcp` };
  const wrong = await form('/oauth/token', params, { Authorization: basic(client.client_id, 'wrong') });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error, 'invalid_client');
  assert.equal((await form('/oauth/token', { ...params, client_id: client.client_id })).status, 401, 'confidential client without secret');
  assert.equal((await form('/oauth/token', { ...params, client_id: client.client_id, client_secret: client.secret })).status, 401, 'secret in body');
});

test('rule 11: a wrong verifier burns the code, and a replayed code revokes the grant', async () => {
  const first = pkce();
  const tokens = await (await exchange(await obtainCode('o-user', { challenge: first.challenge }), first.verifier)).json();
  assert.ok(verifyAccessToken(db, tokens.access_token));

  const { challenge, verifier } = pkce();
  const code = await obtainCode('o-user', { challenge });
  const bad = await exchange(code, pkce().verifier);
  assert.equal((await bad.json()).error, 'invalid_grant');
  assert.equal((await (await exchange(code, verifier)).json()).error, 'invalid_grant', 'burned');
  // The grant (shared by this user and client) is gone, with every token.
  assert.equal(verifyAccessToken(db, tokens.access_token), null);
  assert.equal(db.prepare("SELECT revoke_reason FROM mcp_grants WHERE user_id = 'o-user' ORDER BY created_at DESC LIMIT 1").get().revoke_reason, 'code_replay');
});

test('rules 2, 4, 11: redirect_uri, resource and expiry are checked at exchange', async () => {
  for (const [overrides, error] of [
    [{ redirect_uri: `${REDIRECT}?x=1` }, 'invalid_grant'],
    [{ resource: `${base}/other` }, 'invalid_target'],
    [{ resource: undefined }, 'invalid_target'],
  ]) {
    const { challenge, verifier } = pkce();
    const code = await obtainCode('o-other', { challenge });
    const params = { ...overrides };
    for (const key of Object.keys(params)) if (params[key] === undefined) delete params[key];
    const body = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, resource: `${base}/mcp`, ...params };
    if (overrides.resource === undefined && 'resource' in overrides) delete body.resource;
    const res = await form('/oauth/token', body, { Authorization: basic(client.client_id, client.secret) });
    assert.equal((await res.json()).error, error, JSON.stringify(overrides));
  }
  const { challenge, verifier } = pkce();
  const code = await obtainCode('o-other', { challenge });
  db.prepare("UPDATE mcp_auth_codes SET expires_at = datetime('now', '-1 second') WHERE code_hash = ?").run(crypto.createHash('sha256').update(code).digest('hex'));
  assert.equal((await (await exchange(code, verifier)).json()).error, 'invalid_grant');
});

test('rule 12: refresh rotates, and reusing a rotated refresh token revokes the grant', async () => {
  const { challenge, verifier } = pkce();
  const first = await (await exchange(await obtainCode('o-other', { challenge }), verifier)).json();
  const refresh = (token) => form('/oauth/token', { grant_type: 'refresh_token', refresh_token: token, resource: `${base}/mcp` }, { Authorization: basic(client.client_id, client.secret) });

  const second = await (await refresh(first.refresh_token)).json();
  assert.ok(second.access_token && second.refresh_token && second.refresh_token !== first.refresh_token);
  assert.ok(verifyAccessToken(db, second.access_token));

  const reuse = await refresh(first.refresh_token);
  assert.equal((await reuse.json()).error, 'invalid_grant');
  assert.equal(verifyAccessToken(db, second.access_token), null);
  assert.equal((await (await refresh(second.refresh_token)).json()).error, 'invalid_grant');
  const audit = db.prepare("SELECT COUNT(*) AS n FROM rbac_audit_logs WHERE action = 'mcp.refresh_reuse_detected'").get().n;
  assert.ok(audit >= 1);
});

test('revocation: a refresh token disconnects, unknown tokens are accepted silently', async () => {
  const { challenge, verifier } = pkce();
  const tokens = await (await exchange(await obtainCode('o-other', { challenge }), verifier)).json();
  const revoke = (token) => form('/oauth/revoke', { token }, { Authorization: basic(client.client_id, client.secret) });
  assert.equal((await revoke('not-a-token-at-all-0123456789')).status, 200);
  assert.equal((await revoke(tokens.refresh_token)).status, 200);
  assert.equal(verifyAccessToken(db, tokens.access_token), null);
});

test('access stops at once when the user, the client or the MCP is turned off', async () => {
  const issue = async () => {
    const { challenge, verifier } = pkce();
    return (await (await exchange(await obtainCode('o-user', { challenge }), verifier)).json()).access_token;
  };
  let token = await issue();
  db.prepare("UPDATE users SET is_active = 0 WHERE id = 'o-user'").run();
  assert.equal(verifyAccessToken(db, token), null);
  db.prepare("UPDATE users SET is_active = 1 WHERE id = 'o-user'").run();
  assert.ok(verifyAccessToken(db, token));

  await api('PUT', '/api/mcp/settings', { userId: 'o-owner', body: { enabled: false } });
  assert.equal(verifyAccessToken(db, token), null);
  await api('PUT', '/api/mcp/settings', { userId: 'o-owner', body: { enabled: true } });

  const kill = await api('POST', '/api/mcp/kill-switch', { userId: 'o-owner' });
  assert.ok((await kill.json()).grantsRevoked >= 1);
  assert.equal(verifyAccessToken(db, token), null);

  token = await issue();
  assert.ok(verifyAccessToken(db, token));
  const connections = await (await api('GET', '/api/mcp/connections', { userId: 'o-user' })).json();
  assert.equal(connections.connections.length, 1);
  const grantId = connections.connections[0].id;
  assert.equal((await api('DELETE', `/api/mcp/connections/${grantId}`, { userId: 'o-other' })).status, 404, 'not your connection');
  assert.equal((await api('DELETE', `/api/mcp/connections/${grantId}`, { userId: 'o-user' })).status, 204);
  assert.equal(verifyAccessToken(db, token), null);
});

test('rule 7: the consent route is never framed', { skip: !fs.existsSync(new URL('../dist/index.html', import.meta.url)) && 'frontend not built' }, async () => {
  const res = await fetch(`${base}/connect/anything`);
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.doesNotMatch(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const home = await fetch(`${base}/`);
  assert.notEqual(home.headers.get('x-frame-options'), 'DENY');
});
