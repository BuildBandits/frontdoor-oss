// Minimal OAuth 2.1 authorization server for MCP clients (ADR 0003).
// Rules are numbered as in docs/design/mcp/02-phase1-spec.md §4.
//
// Every credential (code, access token, refresh token, browser nonce) is a
// 256-bit random value stored only as its SHA-256 hash. Timestamps use
// SQLite's datetime('now') format (UTC) and are compared inside SQL.
import { logRbacAudit } from '../../db.js';
import { ClientError, redirectUriMatches, resolveClient, verifyClientSecret } from './clients.js';
import { MCP_SCOPES, MCP_SCOPE_READ, getMcpUrls, parseScopes, scopeList } from './config.js';
import { isValidS256Challenge, randomToken, sha256, verifyPkceS256 } from './crypto.js';
import { isMcpEnabled, revokeGrants } from './settings.js';

export const AUTHORIZATION_REQUEST_TTL_SECONDS = 10 * 60;
export const CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
export const REFRESH_TOKEN_IDLE_DAYS = 30;
export const REFRESH_TOKEN_ABSOLUTE_DAYS = 90;
const STATE_MAX = 512;

export class OAuthError extends Error {
  constructor(error, description, status = 400) {
    super(description);
    this.error = error;
    this.description = description;
    this.status = status;
  }
}

function single(value) {
  return typeof value === 'string' ? value : undefined;
}

function appendParams(uri, params) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

const UNKNOWN_SCOPE = `Available scopes: ${MCP_SCOPES.join(', ')}`;

// The scopes the user keeps on the consent page (ADR 0006): a subset of the
// request that still holds read. Omitted means the whole request.
function keptScopes(requested, kept) {
  if (kept === undefined) return requested;
  const valid = Array.isArray(kept)
    && kept.every((scope) => typeof scope === 'string' && requested.includes(scope))
    && kept.includes(MCP_SCOPE_READ);
  return valid ? requested.filter((scope) => kept.includes(scope)) : null;
}

/**
 * Validates GET /oauth/authorize (rules 1–5, 10). Returns one of:
 * - { kind: 'error_page', code } — client or redirect URI cannot be trusted:
 *   show an error, never redirect (no open redirect);
 * - { kind: 'redirect', location } — a protocol error reported to the client;
 * - { kind: 'pending', requestId, browserNonce } — stored, awaiting consent.
 */
export async function startAuthorization(db, query, { fetchJson } = {}) {
  const urls = getMcpUrls();
  const params = {};
  for (const key of ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state']) {
    if (query[key] !== undefined && single(query[key]) === undefined) return { kind: 'error_page', code: 'mcp_authorize_duplicate_parameter' };
    params[key] = single(query[key]);
  }

  let client;
  try {
    client = await resolveClient(db, params.client_id, { fetchJson });
  } catch (error) {
    return { kind: 'error_page', code: error instanceof ClientError ? error.code : 'mcp_client_unknown' };
  }
  if (!params.redirect_uri || !redirectUriMatches(client.redirectUris, params.redirect_uri)) {
    return { kind: 'error_page', code: 'mcp_redirect_uri_mismatch' };
  }
  if (params.state !== undefined && params.state.length > STATE_MAX) return { kind: 'error_page', code: 'mcp_authorize_state_too_long' };

  const fail = (error, description) => ({
    kind: 'redirect',
    location: appendParams(params.redirect_uri, { error, error_description: description, state: params.state, iss: urls.issuer }),
  });
  if (params.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported');
  if (params.code_challenge_method !== 'S256' || !isValidS256Challenge(params.code_challenge)) return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  if (params.resource !== urls.resource) return fail('invalid_target', 'resource must be the Frontdoor MCP endpoint');
  const scopes = parseScopes(params.scope);
  if (!scopes) return fail('invalid_scope', UNKNOWN_SCOPE);
  const scope = scopes.join(' ');

  const requestId = randomToken(16);
  const browserNonce = randomToken();
  db.prepare(`
    INSERT INTO mcp_authorization_requests (id, client_id, client_name, redirect_uri, state, code_challenge, resource, scope, browser_nonce_hash, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))
  `).run(requestId, client.clientId, client.name, params.redirect_uri, params.state ?? null, params.code_challenge, params.resource, scope, sha256(browserNonce), `+${AUTHORIZATION_REQUEST_TTL_SECONDS} seconds`);
  return { kind: 'pending', requestId, browserNonce };
}

function loadOpenRequest(db, requestId) {
  if (typeof requestId !== 'string' || requestId.length > 64) return null;
  return db.prepare(`
    SELECT * FROM mcp_authorization_requests
    WHERE id = ? AND consumed_at IS NULL AND expires_at > datetime('now')
  `).get(requestId) || null;
}

function hostOf(uri) {
  try {
    return new URL(uri).host;
  } catch {
    return '';
  }
}

// What the consent page shows (rule 7). Requires the starting browser (rule 8).
export function describeAuthorization(db, { requestId, browserNonce }) {
  const request = loadOpenRequest(db, requestId);
  if (!request || !browserNonce || sha256(browserNonce) !== request.browser_nonce_hash) return null;
  return {
    id: request.id,
    clientName: request.client_name,
    // A CIMD client is identified by its document's host; a registered
    // client has no host of its own, only the owner's label.
    clientHost: hostOf(request.client_id) || null,
    redirectHost: hostOf(request.redirect_uri),
    scopes: scopeList(request.scope),
  };
}

function findActiveGrant(db, userId, clientId) {
  return db.prepare('SELECT id, scope FROM mcp_grants WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1').get(userId, clientId);
}

/**
 * Approve or deny a pending authorization (rules 6, 8, 10, 11). Returns
 * { location } to send the browser to, or throws OAuthError when the request
 * cannot be decided here (expired, other browser, impersonation, inactive).
 */
export function decideAuthorization(db, { requestId, browserNonce, user, actor, approve, scopes: kept }) {
  const urls = getMcpUrls();
  if (!isMcpEnabled(db)) throw new OAuthError('mcp_disabled', 'MCP is disabled', 404);
  const request = loadOpenRequest(db, requestId);
  if (!request || !browserNonce || sha256(browserNonce) !== request.browser_nonce_hash) {
    throw new OAuthError('mcp_authorization_not_found', 'This authorization request is not available in this browser', 404);
  }
  if (!user || user.is_active === 0) throw new OAuthError('mcp_authorization_user_inactive', 'Inactive users cannot connect assistants', 403);
  if (actor && actor.id !== user.id) throw new OAuthError('mcp_authorization_impersonating', 'Assistants cannot be connected while acting as another user', 403);
  // Checked before the request is consumed: a malformed choice can be retried.
  const granted = approve ? keptScopes(scopeList(request.scope), kept) : [];
  if (!granted) throw new OAuthError('mcp_consent_invalid_scope', 'Keep frontdoor.read and only scopes the assistant requested', 400);
  const grantedScope = granted.join(' ');

  return db.transaction(() => {
    const consumed = db.prepare("UPDATE mcp_authorization_requests SET consumed_at = datetime('now') WHERE id = ? AND consumed_at IS NULL").run(request.id);
    if (consumed.changes !== 1) throw new OAuthError('mcp_authorization_not_found', 'This authorization request was already used', 404);
    if (!approve) {
      return { location: appendParams(request.redirect_uri, { error: 'access_denied', state: request.state, iss: urls.issuer }) };
    }
    let grant = findActiveGrant(db, user.id, request.client_id);
    if (!grant) {
      grant = { id: randomToken(16) };
      db.prepare('INSERT INTO mcp_grants (id, user_id, client_id, client_name, scope) VALUES (?, ?, ?, ?, ?)')
        .run(grant.id, user.id, request.client_id, request.client_name, grantedScope);
      logRbacAudit(user.id, 'mcp.grant_created', 'auth', grant.id, { clientName: request.client_name, clientHost: hostOf(request.client_id) || request.client_id, scopes: granted });
    } else if (grant.scope !== grantedScope) {
      // The latest consent wins, for the grant's live tokens too (ADR 0006).
      db.prepare('UPDATE mcp_grants SET scope = ? WHERE id = ?').run(grantedScope, grant.id);
      logRbacAudit(user.id, 'mcp.grant_scopes_changed', 'auth', grant.id, { clientName: request.client_name, scopes: granted });
    }
    const code = randomToken();
    db.prepare(`
      INSERT INTO mcp_auth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', ?))
    `).run(sha256(code), grant.id, request.redirect_uri, request.code_challenge, request.resource, `+${CODE_TTL_SECONDS} seconds`);
    return { location: appendParams(request.redirect_uri, { code, state: request.state, iss: urls.issuer }) };
  })();
}

// Client authentication at the token and revocation endpoints (rule 14):
// public clients send client_id only; registered clients must send their
// secret with HTTP Basic.
export async function authenticateClient(db, { authorization, body }, { fetchJson } = {}) {
  let clientId = single(body?.client_id);
  let secret;
  if (typeof authorization === 'string' && authorization.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 0) throw new OAuthError('invalid_client', 'Malformed client credentials', 401);
    let basicId;
    try {
      basicId = decodeURIComponent(decoded.slice(0, colon));
      secret = decodeURIComponent(decoded.slice(colon + 1));
    } catch {
      throw new OAuthError('invalid_client', 'Malformed client credentials', 401);
    }
    if (clientId && clientId !== basicId) throw new OAuthError('invalid_client', 'client_id mismatch', 401);
    clientId = basicId;
  }
  if (single(body?.client_secret) !== undefined) throw new OAuthError('invalid_client', 'Send the client secret with HTTP Basic', 401);
  let client;
  try {
    client = await resolveClient(db, clientId, { fetchJson });
  } catch {
    throw new OAuthError('invalid_client', 'Unknown client', 401);
  }
  if (client.confidential && !verifyClientSecret(client, secret)) throw new OAuthError('invalid_client', 'Client authentication failed', 401);
  if (!client.confidential && secret !== undefined) throw new OAuthError('invalid_client', 'Public clients do not use a secret', 401);
  return client;
}

function activeGrantFor(db, grantId) {
  return db.prepare(`
    SELECT g.id, g.user_id, g.client_id, g.scope
    FROM mcp_grants g
    JOIN users u ON u.id = g.user_id AND u.is_active = 1
    JOIN mcp_clients c ON c.client_id = g.client_id AND c.disabled_at IS NULL
    WHERE g.id = ? AND g.revoked_at IS NULL
  `).get(grantId);
}

function issueTokens(db, { grantId, resource, scope, familyId, absoluteExpiresAt }) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const family = familyId || randomToken(16);
  db.prepare(`
    INSERT INTO mcp_tokens (token_hash, grant_id, kind, family_id, resource, expires_at)
    VALUES (?, ?, 'access', ?, ?, datetime('now', ?))
  `).run(sha256(accessToken), grantId, family, resource, `+${ACCESS_TOKEN_TTL_SECONDS} seconds`);
  const absolute = absoluteExpiresAt || db.prepare('SELECT datetime(\'now\', ?) AS at').get(`+${REFRESH_TOKEN_ABSOLUTE_DAYS} days`).at;
  db.prepare(`
    INSERT INTO mcp_tokens (token_hash, grant_id, kind, family_id, resource, expires_at, absolute_expires_at)
    VALUES (?, ?, 'refresh', ?, ?, MIN(datetime('now', ?), ?), ?)
  `).run(sha256(refreshToken), grantId, family, resource, `+${REFRESH_TOKEN_IDLE_DAYS} days`, absolute, absolute);
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
  };
}

/** authorization_code grant (rules 2, 11, 12). */
export function exchangeAuthorizationCode(db, { client, body }) {
  const urls = getMcpUrls();
  const code = single(body?.code);
  const verifier = single(body?.code_verifier);
  const redirectUri = single(body?.redirect_uri);
  const resource = single(body?.resource);
  if (!code || !verifier || !redirectUri) throw new OAuthError('invalid_request', 'code, code_verifier and redirect_uri are required');
  if (resource !== urls.resource) throw new OAuthError('invalid_target', 'resource must be the Frontdoor MCP endpoint');

  // Side effects (burning the code, revoking on replay) must commit even when
  // the exchange fails, so the transaction returns the failure instead of
  // throwing (a throw would roll them back).
  const outcome = db.transaction(() => {
    const row = db.prepare('SELECT c.*, g.client_id, g.user_id FROM mcp_auth_codes c JOIN mcp_grants g ON g.id = c.grant_id WHERE c.code_hash = ?').get(sha256(code));
    if (!row) return { error: new OAuthError('invalid_grant', 'Invalid authorization code') };
    if (row.used_at) {
      // A replayed code means it leaked: everything issued from the grant goes.
      revokeGrants(db, { where: 'id = ?', params: [row.grant_id], reason: 'code_replay' });
      logRbacAudit(row.user_id, 'mcp.code_replay_detected', 'auth', row.grant_id, { clientId: row.client_id });
      return { error: new OAuthError('invalid_grant', 'Invalid authorization code') };
    }
    // Burned before any check: a wrong verifier cannot be retried.
    db.prepare("UPDATE mcp_auth_codes SET used_at = datetime('now') WHERE code_hash = ?").run(row.code_hash);
    const expired = db.prepare("SELECT ? <= datetime('now') AS expired").get(row.expires_at).expired === 1;
    if (expired) return { error: new OAuthError('invalid_grant', 'Authorization code expired') };
    if (row.client_id !== client.clientId) return { error: new OAuthError('invalid_grant', 'Code was issued to another client') };
    if (row.redirect_uri !== redirectUri) return { error: new OAuthError('invalid_grant', 'redirect_uri does not match') };
    if (row.resource !== resource) return { error: new OAuthError('invalid_target', 'resource does not match') };
    if (!verifyPkceS256(verifier, row.code_challenge)) return { error: new OAuthError('invalid_grant', 'PKCE verification failed') };
    const grant = activeGrantFor(db, row.grant_id);
    if (!grant) return { error: new OAuthError('invalid_grant', 'Grant is no longer active') };
    return { tokens: issueTokens(db, { grantId: grant.id, resource, scope: grant.scope }) };
  })();
  if (outcome.error) throw outcome.error;
  return outcome.tokens;
}

/** refresh_token grant with rotation and reuse detection (rule 12). */
export function refreshAccessToken(db, { client, body }) {
  const urls = getMcpUrls();
  const refreshToken = single(body?.refresh_token);
  const resource = single(body?.resource);
  if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required');
  if (resource !== undefined && resource !== urls.resource) throw new OAuthError('invalid_target', 'resource must be the Frontdoor MCP endpoint');
  // RFC 6749 §6: a refresh may narrow the request but never go beyond the
  // grant. Tokens always carry the grant's scopes, which the response states.
  const askedScope = single(body?.scope);
  if (body?.scope !== undefined && askedScope === undefined) throw new OAuthError('invalid_scope', UNKNOWN_SCOPE);
  const asked = askedScope === undefined ? [] : askedScope.split(' ').filter(Boolean);
  if (asked.some((scope) => !MCP_SCOPES.includes(scope))) throw new OAuthError('invalid_scope', UNKNOWN_SCOPE);

  const outcome = db.transaction(() => {
    const row = db.prepare(`
      SELECT t.*, g.client_id, g.user_id, g.scope
      FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id
      WHERE t.token_hash = ? AND t.kind = 'refresh'
    `).get(sha256(refreshToken));
    if (!row) return { error: new OAuthError('invalid_grant', 'Invalid refresh token') };
    if (row.client_id !== client.clientId) return { error: new OAuthError('invalid_grant', 'Token was issued to another client') };
    if (row.rotated_at || row.revoked_at) {
      // A rotated token came back: either the client or an attacker holds a
      // copy. They cannot be told apart, so the whole grant is revoked.
      revokeGrants(db, { where: 'id = ?', params: [row.grant_id], reason: 'refresh_reuse' });
      logRbacAudit(row.user_id, 'mcp.refresh_reuse_detected', 'auth', row.grant_id, { clientId: row.client_id });
      return { error: new OAuthError('invalid_grant', 'Invalid refresh token') };
    }
    const live = db.prepare("SELECT ? > datetime('now') AND (? IS NULL OR ? > datetime('now')) AS live").get(row.expires_at, row.absolute_expires_at, row.absolute_expires_at).live === 1;
    if (!live) return { error: new OAuthError('invalid_grant', 'Refresh token expired') };
    const grant = activeGrantFor(db, row.grant_id);
    if (!grant) return { error: new OAuthError('invalid_grant', 'Grant is no longer active') };
    if (asked.some((scope) => !scopeList(grant.scope).includes(scope))) return { error: new OAuthError('invalid_scope', 'The requested scope exceeds the grant') };
    db.prepare("UPDATE mcp_tokens SET rotated_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
    return { tokens: issueTokens(db, { grantId: grant.id, resource: row.resource, scope: grant.scope, familyId: row.family_id, absoluteExpiresAt: row.absolute_expires_at }) };
  })();
  if (outcome.error) throw outcome.error;
  return outcome.tokens;
}

/**
 * RFC 7009. Revoking a refresh token disconnects the grant; revoking an access
 * token drops that token. Unknown or foreign tokens are ignored (always 200).
 */
export function revokeToken(db, { client, body }) {
  const token = single(body?.token);
  if (!token) throw new OAuthError('invalid_request', 'token is required');
  const row = db.prepare('SELECT t.token_hash, t.kind, t.grant_id, g.client_id, g.user_id FROM mcp_tokens t JOIN mcp_grants g ON g.id = t.grant_id WHERE t.token_hash = ?').get(sha256(token));
  if (!row || row.client_id !== client.clientId) return;
  if (row.kind === 'refresh') {
    if (revokeGrants(db, { where: 'id = ?', params: [row.grant_id], reason: 'client' }) > 0) {
      logRbacAudit(row.user_id, 'mcp.grant_revoked', 'auth', row.grant_id, { by: 'client' });
    }
  } else {
    db.prepare('DELETE FROM mcp_tokens WHERE token_hash = ?').run(row.token_hash);
  }
}

/**
 * Bearer check for /mcp (spec §5). Returns the caller or null. Everything is
 * re-read on each call: a disabled MCP, a disabled client, a revoked grant or
 * an inactive user stop access immediately.
 */
export function verifyAccessToken(db, token) {
  const urls = getMcpUrls();
  if (!urls || typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
  if (!isMcpEnabled(db)) return null;
  const row = db.prepare(`
    SELECT t.grant_id, t.resource, CAST(strftime('%s', t.expires_at) AS INTEGER) AS expires_at_epoch,
      g.user_id, g.client_id, g.client_name, g.scope
    FROM mcp_tokens t
    JOIN mcp_grants g ON g.id = t.grant_id AND g.revoked_at IS NULL
    JOIN mcp_clients c ON c.client_id = g.client_id AND c.disabled_at IS NULL
    JOIN users u ON u.id = g.user_id AND u.is_active = 1
    WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked_at IS NULL AND t.expires_at > datetime('now')
  `).get(sha256(token));
  if (!row || row.resource !== urls.resource) return null;
  db.prepare("UPDATE mcp_grants SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-1 minute'))").run(row.grant_id);
  return {
    grantId: row.grant_id,
    userId: row.user_id,
    clientId: row.client_id,
    clientName: row.client_name,
    scopes: scopeList(row.scope),
    expiresAt: row.expires_at_epoch,
    resource: row.resource,
  };
}
