import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.FRONTEND_URL = 'https://frontdoor.example';

const { default: db } = await import('../server/db.js');
const {
  addCimdClient, clearCimdCache, createRegisteredClient, disableClient, redirectUriMatches, resolveClient, validateCimdUrl, validateRedirectUri,
} = await import('../server/services/mcp/clients.js');
const { startAuthorization, decideAuthorization } = await import('../server/services/mcp/oauth.js');
const { setMcpEnabled } = await import('../server/services/mcp/settings.js');

const CIMD = 'https://assistant.example/oauth/client.json';
const docFor = (overrides = {}) => async (url) => ({ client_id: url, client_name: 'I am Totally Frontdoor', redirect_uris: ['https://assistant.example/cb'], ...overrides });

beforeEach(() => {
  clearCimdCache();
  db.exec('DELETE FROM mcp_authorization_requests; DELETE FROM mcp_grants; DELETE FROM mcp_clients;');
});

test('redirect URIs: https or loopback http only; loopback may change port, nothing else may change', () => {
  for (const uri of ['https://a.example/cb', 'http://127.0.0.1/callback', 'http://localhost:8080/cb', 'http://[::1]/cb']) assert.equal(validateRedirectUri(uri), true, uri);
  for (const uri of ['http://a.example/cb', 'https://a.example/cb#frag', 'https://u:p@a.example/cb', 'javascript:alert(1)', 'not a url']) assert.equal(validateRedirectUri(uri), false, uri);

  assert.equal(redirectUriMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:53111/callback'), true);
  assert.equal(redirectUriMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:53111/other'), false);
  assert.equal(redirectUriMatches(['http://127.0.0.1/callback'], 'http://localhost:53111/callback'), false);
  assert.equal(redirectUriMatches(['https://a.example/cb'], 'https://a.example:444/cb'), false);
  assert.equal(redirectUriMatches(['https://a.example/cb'], 'https://a.example/cb/'), false);
  assert.equal(redirectUriMatches(['https://a.example/cb'], 'https://A.example/cb'), false);
});

test('CIMD client ids must be https URLs with a path', () => {
  assert.equal(validateCimdUrl(CIMD), true);
  for (const url of ['http://assistant.example/c.json', 'https://assistant.example/', 'https://assistant.example', 'https://assistant.example/c.json#x']) assert.equal(validateCimdUrl(url), false, url);
});

test('only allowlisted CIMD clients resolve, under the owner label, with the document redirects', async () => {
  await assert.rejects(resolveClient(db, CIMD, { fetchJson: docFor() }), { code: 'mcp_client_unknown' });
  addCimdClient(db, { clientId: CIMD, name: 'Assistant (approved)', actorId: 'owner' });
  const client = await resolveClient(db, CIMD, { fetchJson: docFor() });
  assert.equal(client.name, 'Assistant (approved)', 'the self-declared name is never shown');
  assert.deepEqual(client.redirectUris, ['https://assistant.example/cb']);
  assert.equal(client.confidential, false);
});

test('CIMD documents that do not describe the client, or need another auth method, are refused', async () => {
  addCimdClient(db, { clientId: CIMD, name: 'Assistant', actorId: 'owner' });
  for (const [fetchJson, code] of [
    [docFor({ client_id: 'https://evil.example/c.json' }), 'mcp_client_metadata_invalid'],
    [docFor({ redirect_uris: ['http://assistant.example/cb'] }), 'mcp_client_metadata_invalid'],
    [docFor({ redirect_uris: [] }), 'mcp_client_metadata_invalid'],
    [docFor({ token_endpoint_auth_method: 'private_key_jwt' }), 'mcp_client_auth_method_unsupported'],
    [async () => { const error = new Error('x'); error.code = 'destination_not_public'; throw error; }, 'mcp_client_metadata_unavailable'],
  ]) {
    clearCimdCache();
    await assert.rejects(resolveClient(db, CIMD, { fetchJson }), { code });
  }
});

test('the CIMD document is cached, and disabling the client drops it and its grants', async () => {
  addCimdClient(db, { clientId: CIMD, name: 'Assistant', actorId: 'owner' });
  let fetches = 0;
  const counting = async (url) => { fetches += 1; return docFor()(url); };
  await resolveClient(db, CIMD, { fetchJson: counting });
  await resolveClient(db, CIMD, { fetchJson: counting });
  assert.equal(fetches, 1);

  db.prepare("INSERT OR IGNORE INTO users (id, email, display_name, role, is_active) VALUES ('cl-user', 'cl@mcp.test', 'C', 'user', 1)").run();
  db.prepare("INSERT INTO mcp_grants (id, user_id, client_id, client_name, scope) VALUES ('cl-grant', 'cl-user', ?, 'Assistant', 'frontdoor.read')").run(CIMD);
  const { id } = db.prepare('SELECT id FROM mcp_clients WHERE client_id = ?').get(CIMD);
  assert.equal(disableClient(db, { id }).grantsRevoked, 1);
  await assert.rejects(resolveClient(db, CIMD, { fetchJson: counting }), { code: 'mcp_client_unknown' });
});

test('registered clients: names and redirect lists are validated', () => {
  assert.throws(() => createRegisteredClient(db, { name: '', redirectUris: ['https://a.example/cb'], actorId: 'o' }), { code: 'mcp_client_name_invalid' });
  assert.throws(() => createRegisteredClient(db, { name: 'X', redirectUris: [], actorId: 'o' }), { code: 'mcp_redirect_uris_invalid' });
  assert.throws(() => createRegisteredClient(db, { name: 'X', redirectUris: ['http://a.example/cb'], actorId: 'o' }), { code: 'mcp_redirect_uris_invalid' });
  const { client } = createRegisteredClient(db, { name: 'Copilot\u0007 Studio ', redirectUris: ['https://a.example/cb'], actorId: 'o' });
  assert.equal(client.name, 'Copilot Studio');
});

test('rule 6: no consent while impersonating, none for inactive users', async () => {
  setMcpEnabled(db, { enabled: true, actorId: 'owner' });
  addCimdClient(db, { clientId: CIMD, name: 'Assistant', actorId: 'owner' });
  const pending = await startAuthorization(db, {
    client_id: CIMD, redirect_uri: 'https://assistant.example/cb', response_type: 'code',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', resource: 'https://frontdoor.example/mcp',
  }, { fetchJson: docFor() });
  assert.equal(pending.kind, 'pending');
  const base = { requestId: pending.requestId, browserNonce: pending.browserNonce, approve: true };
  assert.throws(() => decideAuthorization(db, { ...base, user: { id: 'target', is_active: 1 }, actor: { id: 'admin' } }), { error: 'mcp_authorization_impersonating' });
  assert.throws(() => decideAuthorization(db, { ...base, user: { id: 'target', is_active: 0 }, actor: { id: 'target' } }), { error: 'mcp_authorization_user_inactive' });
  assert.equal(db.prepare('SELECT consumed_at FROM mcp_authorization_requests WHERE id = ?').get(pending.requestId).consumed_at, null, 'a refused attempt does not consume the request');
});

test('a failing metadata host is fetched once per minute, not once per request', async () => {
  addCimdClient(db, { clientId: CIMD, name: 'Assistant', actorId: 'owner' });
  let fetches = 0;
  const failing = async () => { fetches += 1; throw Object.assign(new Error('down'), { code: 'timeout' }); };
  await assert.rejects(resolveClient(db, CIMD, { fetchJson: failing }), { code: 'mcp_client_metadata_unavailable' });
  await assert.rejects(resolveClient(db, CIMD, { fetchJson: failing }), { code: 'mcp_client_metadata_unavailable' });
  assert.equal(fetches, 1);
});

test('concurrent resolutions share one metadata fetch', async () => {
  addCimdClient(db, { clientId: CIMD, name: 'Assistant', actorId: 'owner' });
  let fetches = 0;
  const slow = async (url) => { fetches += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return docFor()(url); };
  await Promise.all([resolveClient(db, CIMD, { fetchJson: slow }), resolveClient(db, CIMD, { fetchJson: slow }), resolveClient(db, CIMD, { fetchJson: slow })]);
  assert.equal(fetches, 1);
});
