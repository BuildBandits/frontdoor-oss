// POST /mcp — the MCP Streamable HTTP endpoint (spec §5). Mounted before the
// global JSON parser so its own 64 KiB body cap applies.
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import db from '../db.js';
import { getMcpUrls } from '../services/mcp/config.js';
import { verifyAccessToken } from '../services/mcp/oauth.js';
import { isMcpEnabled } from '../services/mcp/settings.js';
import { createFrontdoorMcpServer } from '../services/mcp/tools.js';

export const MCP_MAX_BODY_BYTES = 64 * 1024;

const router = express.Router();

function bearerOf(req) {
  const header = req.get('authorization');
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

router.use((req, res, next) => {
  const urls = getMcpUrls();
  if (!urls || !isMcpEnabled(db)) return res.status(404).json({ error: 'Not found', code: 'not_found' });
  req.mcpUrls = urls;
  return next();
});

// Two limits: per client IP before authentication (random bearer values must
// not each get a fresh budget), then per connection once the token is known.
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: Number.parseInt(process.env.MCP_IP_RATE_LIMIT_MAX || '300', 10) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
}));

// DNS rebinding: a browser page on another origin must not drive this endpoint.
router.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== req.mcpUrls.issuer) return res.status(403).json({ error: 'Origin not allowed', code: 'mcp_origin_forbidden' });
  return next();
});

router.use((req, res, next) => {
  const challenge = (error) => `Bearer resource_metadata="${req.mcpUrls.protectedResourceMetadata}"${error ? `, error="${error}"` : ''}`;
  const token = bearerOf(req);
  if (!token) {
    res.set('WWW-Authenticate', challenge());
    return res.status(401).json({ error: 'Authentication required', code: 'not_authenticated' });
  }
  const caller = verifyAccessToken(db, token);
  if (!caller) {
    res.set('WWW-Authenticate', challenge('invalid_token'));
    return res.status(401).json({ error: 'Invalid or expired token', code: 'invalid_token' });
  }
  req.auth = {
    token,
    clientId: caller.clientId,
    scopes: caller.scopes,
    expiresAt: caller.expiresAt,
    resource: new URL(caller.resource),
    extra: { userId: caller.userId, grantId: caller.grantId, clientName: caller.clientName },
  };
  return next();
});

router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: Number.parseInt(process.env.MCP_RATE_LIMIT_MAX || '60', 10) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `grant:${req.auth.extra.grantId}`,
}));

const handler = createMcpHandler(({ authInfo }) => createFrontdoorMcpServer(db, {
  userId: authInfo?.extra?.userId,
  grantId: authInfo?.extra?.grantId,
  scopes: authInfo?.scopes ?? [],
  clientName: authInfo?.extra?.clientName,
}), {
  onerror: (error) => console.error('MCP request failed:', error?.message),
});
const nodeHandler = toNodeHandler(handler, {
  maxRequestBodySize: MCP_MAX_BODY_BYTES,
  onerror: (error) => console.error('MCP adapter failed:', error?.message),
});

const jsonBody = express.json({ limit: MCP_MAX_BODY_BYTES, strict: false });

// JSON-RPC batches are not part of MCP since 2025-06-18; refusing them keeps
// the per-connection limit a limit on tool calls, not on HTTP requests.
function refuseBatches(req, res, next) {
  if (Array.isArray(req.body)) {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batch requests are not supported' } });
  }
  return next();
}

router.all('/', jsonBody, refuseBatches, (req, res) => nodeHandler(req, res, req.body));

// Body errors (too large, malformed JSON) answer as JSON-RPC, never as HTML.
router.use((error, req, res, next) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request body too large' } });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  return next(error);
});

export default router;
