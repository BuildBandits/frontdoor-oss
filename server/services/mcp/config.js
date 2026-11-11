// Canonical URLs of the MCP authorization server and resource. Everything is
// derived from FRONTEND_URL, the public origin users and AI clients reach.

// Scopes (ADR 0006): read is the base of every grant and strictly read-only;
// preferences carries the tools that change the user's own preferences and
// can be unticked on the consent page.
export const MCP_SCOPE_READ = 'frontdoor.read';
export const MCP_SCOPE_PREFERENCES = 'frontdoor.preferences';
export const MCP_SCOPES = Object.freeze([MCP_SCOPE_READ, MCP_SCOPE_PREFERENCES]);

// Canonical, de-duplicated scope list in MCP_SCOPES order, or null when any
// scope is unknown. Nothing requested means every scope; read is always added.
export function parseScopes(raw) {
  if (raw === undefined || raw === null || raw === '') return [...MCP_SCOPES];
  if (typeof raw !== 'string') return null;
  const requested = new Set(raw.split(' ').filter(Boolean));
  if ([...requested].some((scope) => !MCP_SCOPES.includes(scope))) return null;
  requested.add(MCP_SCOPE_READ);
  return MCP_SCOPES.filter((scope) => requested.has(scope));
}

export const scopeList = (stored) => (stored ? stored.split(' ').filter(Boolean) : []);

export function getMcpBaseUrl() {
  const raw = process.env.FRONTEND_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getMcpUrls() {
  const base = getMcpBaseUrl();
  if (!base) return null;
  return {
    issuer: base,
    resource: `${base}/mcp`,
    protectedResourceMetadata: `${base}/.well-known/oauth-protected-resource/mcp`,
    authorizationEndpoint: `${base}/oauth/authorize`,
    tokenEndpoint: `${base}/oauth/token`,
    revocationEndpoint: `${base}/oauth/revoke`,
    consentPage: (requestId) => `${base}/connect/${encodeURIComponent(requestId)}`,
  };
}
