// Public OAuth endpoints for MCP clients (spec §3). Everything answers 404
// while the MCP is off, so a disabled instance advertises nothing.
import express from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { MCP_SCOPE, getMcpUrls } from '../services/mcp/config.js';
import { isMcpEnabled } from '../services/mcp/settings.js';
import {
  AUTHORIZATION_REQUEST_TTL_SECONDS,
  OAuthError,
  authenticateClient,
  exchangeAuthorizationCode,
  refreshAccessToken,
  revokeToken,
  startAuthorization,
} from '../services/mcp/oauth.js';

export const AUTHORIZATION_COOKIE_PREFIX = 'frontdoor_mcp_authz_';

// The browser-binding cookie is scoped to the consent API of its own request.
export function authorizationCookieOptions(requestId) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/api/mcp/authorizations/${requestId}`,
    maxAge: AUTHORIZATION_REQUEST_TTL_SECONDS * 1000,
  };
}

function mcpAvailable(req, res, next) {
  const urls = getMcpUrls();
  if (!urls || !isMcpEnabled(db)) return res.status(404).json({ error: 'Not found', code: 'not_found' });
  req.mcpUrls = urls;
  return next();
}

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
}

function sendOAuthError(res, error) {
  noStore(res);
  if (error instanceof OAuthError) {
    if (error.status === 401) res.set('WWW-Authenticate', 'Basic realm="frontdoor-mcp"');
    return res.status(error.status).json({ error: error.error, error_description: error.description });
  }
  console.error('MCP OAuth endpoint failed:', error?.message);
  return res.status(500).json({ error: 'server_error' });
}

export function protectedResourceMetadata(urls) {
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Frontdoor',
  };
}

export function authorizationServerMetadata(urls) {
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorizationEndpoint,
    token_endpoint: urls.tokenEndpoint,
    revocation_endpoint: urls.revocationEndpoint,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    scopes_supported: [MCP_SCOPE],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

export const wellKnownRouter = express.Router();

for (const path of ['/oauth-protected-resource/mcp', '/oauth-protected-resource']) {
  wellKnownRouter.get(path, mcpAvailable, (req, res) => res.json(protectedResourceMetadata(req.mcpUrls)));
}
wellKnownRouter.get('/oauth-authorization-server', mcpAvailable, (req, res) => res.json(authorizationServerMetadata(req.mcpUrls)));

export const oauthRouter = express.Router();

const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number.parseInt(process.env.MCP_TOKEN_RATE_LIMIT_MAX || '60', 10) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    noStore(res);
    res.status(429).json({ error: 'slow_down', error_description: 'Too many requests' });
  },
});

oauthRouter.get('/authorize', mcpAvailable, async (req, res) => {
  noStore(res);
  try {
    const result = await startAuthorization(db, req.query);
    if (result.kind === 'error_page') {
      // Same-origin page, never the client's redirect_uri: an untrusted
      // client or redirect must not turn Frontdoor into an open redirect.
      return res.redirect(`${req.mcpUrls.issuer}/connect?error=${encodeURIComponent(result.code)}`);
    }
    if (result.kind === 'redirect') return res.redirect(result.location);
    res.cookie(`${AUTHORIZATION_COOKIE_PREFIX}${result.requestId}`, result.browserNonce, authorizationCookieOptions(result.requestId));
    return res.redirect(req.mcpUrls.consentPage(result.requestId));
  } catch (error) {
    console.error('MCP authorize failed:', error?.message);
    return res.redirect(`${req.mcpUrls.issuer}/connect?error=mcp_authorize_failed`);
  }
});

const formBody = express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 });

oauthRouter.post('/token', mcpAvailable, tokenLimiter, formBody, async (req, res) => {
  try {
    const client = await authenticateClient(db, { authorization: req.get('authorization'), body: req.body });
    const grantType = req.body?.grant_type;
    let tokens;
    if (grantType === 'authorization_code') tokens = exchangeAuthorizationCode(db, { client, body: req.body });
    else if (grantType === 'refresh_token') tokens = refreshAccessToken(db, { client, body: req.body });
    else throw new OAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
    noStore(res);
    return res.json(tokens);
  } catch (error) {
    return sendOAuthError(res, error);
  }
});

oauthRouter.post('/revoke', mcpAvailable, tokenLimiter, formBody, async (req, res) => {
  try {
    const client = await authenticateClient(db, { authorization: req.get('authorization'), body: req.body });
    revokeToken(db, { client, body: req.body });
    noStore(res);
    return res.status(200).end();
  } catch (error) {
    return sendOAuthError(res, error);
  }
});
