// MCP clients (ADR 0004): owner-allowlisted Client ID Metadata Documents and
// owner-registered confidential clients. Nothing registers itself.
import { fetchPublicJson } from '../networkGuard.js';
import { constantTimeEqual, randomToken, sha256 } from './crypto.js';
import { revokeGrants } from './settings.js';

const NAME_MAX = 80;
const MAX_REDIRECT_URIS = 10;
const CIMD_CACHE_MS = 60 * 60 * 1000;
const cimdCache = new Map();

export class ClientError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function cleanName(name) {
  // Control characters are dropped: the label is shown on the consent page.
  const value = typeof name === 'string'
    ? [...name].filter((char) => { const code = char.codePointAt(0); return code > 0x1f && code !== 0x7f; }).join('').trim()
    : '';
  if (!value || value.length > NAME_MAX) throw new ClientError('mcp_client_name_invalid', 'Client name must be 1-80 characters');
  return value;
}

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === '[::1]' || hostname === 'localhost';
}

// Redirect URIs: https, or http on a loopback host (native apps, RFC 8252).
// No fragments, no credentials.
export function validateRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

function cleanRedirectUris(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_REDIRECT_URIS) {
    throw new ClientError('mcp_redirect_uris_invalid', `Between 1 and ${MAX_REDIRECT_URIS} redirect URIs are required`);
  }
  const uris = [...new Set(list.map((uri) => (typeof uri === 'string' ? uri.trim() : '')))];
  if (!uris.every(validateRedirectUri)) throw new ClientError('mcp_redirect_uris_invalid', 'Redirect URIs must be https, or http on a loopback host');
  return uris;
}

// Exact string match, except that a loopback redirect may use any port
// (RFC 8252 §7.3): native clients pick an ephemeral port at run time.
export function redirectUriMatches(registered, requested) {
  if (typeof requested !== 'string') return false;
  return registered.some((uri) => {
    if (uri === requested) return true;
    let a;
    let b;
    try {
      a = new URL(uri);
      b = new URL(requested);
    } catch {
      return false;
    }
    return a.protocol === 'http:' && b.protocol === 'http:'
      && isLoopbackHost(a.hostname) && a.hostname === b.hostname
      && a.pathname === b.pathname && a.search === b.search && !b.hash && !b.username && !b.password;
  });
}

// A CIMD client_id is an https URL with a path (draft-ietf-oauth-client-id-metadata-document).
export function validateCimdUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.pathname !== '/' && !url.hash && !url.username && !url.password && url.href === value;
}

export function listClients(db) {
  return db.prepare(`
    SELECT c.id, c.kind, c.client_id, c.name, c.redirect_uris, c.created_at, c.disabled_at,
      (SELECT COUNT(*) FROM mcp_grants g WHERE g.client_id = c.client_id AND g.revoked_at IS NULL) AS active_grants
    FROM mcp_clients c
    ORDER BY c.disabled_at IS NOT NULL, c.name
  `).all().map((row) => ({ ...row, redirect_uris: JSON.parse(row.redirect_uris) }));
}

export function addCimdClient(db, { clientId, name, actorId }) {
  if (!validateCimdUrl(clientId)) throw new ClientError('mcp_client_id_invalid', 'A metadata document URL must be https with a path');
  const label = cleanName(name);
  if (db.prepare('SELECT 1 FROM mcp_clients WHERE client_id = ?').get(clientId)) throw new ClientError('mcp_client_exists', 'This client is already listed');
  const id = randomToken(12);
  db.prepare("INSERT INTO mcp_clients (id, kind, client_id, name, created_by) VALUES (?, 'cimd', ?, ?, ?)").run(id, clientId, label, actorId);
  return { id, kind: 'cimd', client_id: clientId, name: label };
}

// The secret is returned once and only its hash is kept.
export function createRegisteredClient(db, { name, redirectUris, actorId }) {
  const label = cleanName(name);
  const uris = cleanRedirectUris(redirectUris);
  const id = randomToken(12);
  const clientId = `fd-mcp-${randomToken(12)}`;
  const secret = randomToken(32);
  db.prepare("INSERT INTO mcp_clients (id, kind, client_id, name, redirect_uris, secret_hash, created_by) VALUES (?, 'registered', ?, ?, ?, ?, ?)")
    .run(id, clientId, label, JSON.stringify(uris), sha256(secret), actorId);
  return { client: { id, kind: 'registered', client_id: clientId, name: label, redirect_uris: uris }, clientSecret: secret };
}

export function disableClient(db, { id }) {
  return db.transaction(() => {
    const client = db.prepare('SELECT client_id, name FROM mcp_clients WHERE id = ? AND disabled_at IS NULL').get(id);
    if (!client) return null;
    db.prepare("UPDATE mcp_clients SET disabled_at = datetime('now') WHERE id = ?").run(id);
    const grantsRevoked = revokeGrants(db, { where: 'client_id = ?', params: [client.client_id], reason: 'client_disabled' });
    cimdCache.delete(client.client_id);
    return { ...client, grantsRevoked };
  })();
}

export function clearCimdCache() {
  cimdCache.clear();
}

async function loadCimdDocument(clientId, fetchJson) {
  const cached = cimdCache.get(clientId);
  if (cached && Date.now() - cached.fetchedAt < CIMD_CACHE_MS) return cached.document;
  let document;
  try {
    document = await fetchJson(clientId);
  } catch (error) {
    throw new ClientError('mcp_client_metadata_unavailable', `Client metadata could not be fetched (${error.code || 'error'})`);
  }
  if (!document || typeof document !== 'object' || document.client_id !== clientId) {
    throw new ClientError('mcp_client_metadata_invalid', 'Client metadata does not describe this client_id');
  }
  // Only public clients: a CIMD client declaring another method (e.g.
  // private_key_jwt) is refused rather than silently downgraded.
  const method = document.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') throw new ClientError('mcp_client_auth_method_unsupported', `Token endpoint auth method ${String(method).slice(0, 40)} is not supported; register this client instead`);
  let redirectUris;
  try {
    redirectUris = cleanRedirectUris(document.redirect_uris);
  } catch {
    throw new ClientError('mcp_client_metadata_invalid', 'Client metadata has invalid redirect_uris');
  }
  const normalized = { redirectUris, clientName: typeof document.client_name === 'string' ? document.client_name.slice(0, NAME_MAX) : null };
  cimdCache.set(clientId, { document: normalized, fetchedAt: Date.now() });
  return normalized;
}

/**
 * Resolves an OAuth client_id to the client Frontdoor admits, or throws a
 * ClientError. The name shown to users is the owner's label, never the name a
 * client claims about itself.
 */
export async function resolveClient(db, clientId, { fetchJson = fetchPublicJson } = {}) {
  if (typeof clientId !== 'string' || clientId.length === 0 || clientId.length > 512) throw new ClientError('mcp_client_unknown', 'Unknown client');
  const row = db.prepare('SELECT kind, client_id, name, redirect_uris, secret_hash FROM mcp_clients WHERE client_id = ? AND disabled_at IS NULL').get(clientId);
  if (!row) throw new ClientError('mcp_client_unknown', 'Unknown client');
  if (row.kind === 'registered') {
    return { clientId: row.client_id, name: row.name, kind: 'registered', confidential: true, redirectUris: JSON.parse(row.redirect_uris), secretHash: row.secret_hash };
  }
  const document = await loadCimdDocument(row.client_id, fetchJson);
  return { clientId: row.client_id, name: row.name, kind: 'cimd', confidential: false, redirectUris: document.redirectUris, secretHash: null };
}

export function verifyClientSecret(client, secret) {
  if (!client.confidential) return false;
  return typeof secret === 'string' && secret.length > 0 && constantTimeEqual(sha256(secret), client.secretHash);
}
