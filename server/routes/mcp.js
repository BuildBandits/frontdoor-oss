// Session-authenticated MCP API: the consent page, each user's connected
// assistants, and the owner's controls.
import express from 'express';
import db, { logRbacAudit } from '../db.js';
import { authenticate, isOwner } from '../middleware/auth.js';
import { getMcpUrls, scopeList } from '../services/mcp/config.js';
import { ClientError, addCimdClient, createRegisteredClient, disableClient, listClients } from '../services/mcp/clients.js';
import { OAuthError, decideAuthorization, describeAuthorization } from '../services/mcp/oauth.js';
import { getMcpSettings, isMcpEnabled, killSwitch, revokeGrants, setMcpEnabled } from '../services/mcp/settings.js';
import { MCP_EXPOSED_FIELDS } from '../services/mcp/projection.js';
import { AUTHORIZATION_COOKIE_PREFIX, authorizationCookieOptions } from './oauth.js';

const router = express.Router();

function requireEnabled(req, res, next) {
  if (!isMcpEnabled(db)) return res.status(404).json({ error: 'MCP is disabled', code: 'mcp_disabled' });
  return next();
}

// Stricter than the /api cross-site guard, which trusts CORS_ALLOWED_ORIGINS:
// a satellite app must never be able to approve a consent (spec §4 rule 9).
// Browsers send Sec-Fetch-Site on every fetch; a request without it is refused.
function strictSameOrigin(req, res, next) {
  if (req.get('sec-fetch-site') === 'same-origin') return next();
  return res.status(403).json({ error: 'Consent must be given on the Frontdoor page', code: 'mcp_consent_cross_site' });
}

// The whole MCP API is for Frontdoor's own pages: CORS-allowlisted satellites
// must not list, revoke or approve connections either.
router.use(strictSameOrigin);

const browserNonce = (req) => req.cookies?.[`${AUTHORIZATION_COOKIE_PREFIX}${req.params.id}`];

router.get('/status', authenticate, (req, res) => {
  res.json({ enabled: isMcpEnabled(db) && Boolean(getMcpUrls()) });
});

router.get('/authorizations/:id', authenticate, requireEnabled, (req, res) => {
  const details = describeAuthorization(db, { requestId: req.params.id, browserNonce: browserNonce(req) });
  if (!details) return res.status(404).json({ error: 'Authorization request not found', code: 'mcp_authorization_not_found' });
  return res.json({ authorization: { ...details, exposedFields: MCP_EXPOSED_FIELDS } });
});

router.post('/authorizations/:id/decision', authenticate, (req, res) => {
  try {
    const { location } = decideAuthorization(db, {
      requestId: req.params.id,
      browserNonce: browserNonce(req),
      user: req.user,
      actor: req.actor,
      approve: req.body?.approve === true,
      scopes: req.body?.scopes,
    });
    res.clearCookie(`${AUTHORIZATION_COOKIE_PREFIX}${req.params.id}`, { ...authorizationCookieOptions(req.params.id), maxAge: undefined });
    return res.json({ location });
  } catch (error) {
    if (error instanceof OAuthError) return res.status(error.status).json({ error: error.description, code: error.error });
    console.error('MCP consent decision failed:', error?.message);
    return res.status(500).json({ error: 'Consent failed', code: 'mcp_consent_failed' });
  }
});

router.get('/connections', authenticate, (req, res) => {
  const connections = db.prepare(`
    SELECT id, client_name, scope, created_at, last_used_at
    FROM mcp_grants WHERE user_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(req.user.id);
  res.json({ connections: connections.map(({ scope, ...connection }) => ({ ...connection, scopes: scopeList(scope) })) });
});

router.delete('/connections/:id', authenticate, (req, res) => {
  const revoked = revokeGrants(db, { where: 'id = ? AND user_id = ?', params: [req.params.id, req.user.id], reason: 'user' });
  if (revoked === 0) return res.status(404).json({ error: 'Connection not found', code: 'mcp_connection_not_found' });
  logRbacAudit(req.user.id, 'mcp.grant_revoked', 'auth', req.params.id, { by: 'user' }, req.impersonation?.sessionId ?? null);
  return res.status(204).end();
});

// --- Owner controls ---

router.get('/settings', authenticate, isOwner, (req, res) => {
  const settings = getMcpSettings(db);
  const urls = getMcpUrls();
  res.json({
    settings: { enabled: settings.enabled, updatedAt: settings.updatedAt },
    endpoint: urls?.resource || null,
    configurable: Boolean(urls),
    clients: listClients(db),
  });
});

router.put('/settings', authenticate, isOwner, (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean', code: 'mcp_settings_invalid' });
  if (req.body.enabled && !getMcpUrls()) return res.status(409).json({ error: 'FRONTEND_URL must be a valid https URL', code: 'mcp_frontend_url_required' });
  const settings = setMcpEnabled(db, { enabled: req.body.enabled, actorId: req.user.id });
  logRbacAudit(req.user.id, req.body.enabled ? 'mcp.enabled' : 'mcp.disabled', 'branding', 'mcp');
  res.json({ settings: { enabled: settings.enabled, updatedAt: settings.updatedAt } });
});

router.post('/kill-switch', authenticate, isOwner, (req, res) => {
  const { grantsRevoked } = killSwitch(db, { actorId: req.user.id });
  logRbacAudit(req.user.id, 'mcp.kill_switch', 'branding', 'mcp', { grantsRevoked });
  res.json({ grantsRevoked });
});

function clientError(res, error) {
  if (error instanceof ClientError) return res.status(400).json({ error: error.message, code: error.code });
  console.error('MCP client change failed:', error?.message);
  return res.status(500).json({ error: 'Client change failed', code: 'mcp_client_change_failed' });
}

router.post('/clients', authenticate, isOwner, (req, res) => {
  try {
    if (req.body?.kind === 'cimd') {
      const client = addCimdClient(db, { clientId: req.body.clientId, name: req.body.name, actorId: req.user.id });
      logRbacAudit(req.user.id, 'mcp.client_created', 'auth', client.id, { kind: 'cimd', name: client.name, clientId: client.client_id });
      return res.status(201).json({ client });
    }
    if (req.body?.kind === 'registered') {
      const { client, clientSecret } = createRegisteredClient(db, { name: req.body.name, redirectUris: req.body.redirectUris, actorId: req.user.id });
      logRbacAudit(req.user.id, 'mcp.client_created', 'auth', client.id, { kind: 'registered', name: client.name, clientId: client.client_id });
      res.set('Cache-Control', 'no-store');
      return res.status(201).json({ client, clientSecret });
    }
    return res.status(400).json({ error: 'kind must be cimd or registered', code: 'mcp_client_kind_invalid' });
  } catch (error) {
    return clientError(res, error);
  }
});

router.delete('/clients/:id', authenticate, isOwner, (req, res) => {
  const result = disableClient(db, { id: req.params.id });
  if (!result) return res.status(404).json({ error: 'Client not found', code: 'mcp_client_not_found' });
  logRbacAudit(req.user.id, 'mcp.client_disabled', 'auth', req.params.id, { name: result.name, grantsRevoked: result.grantsRevoked });
  return res.status(204).end();
});

export default router;
