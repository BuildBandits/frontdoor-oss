// Canonical URLs of the MCP authorization server and resource. Everything is
// derived from FRONTEND_URL, the public origin users and AI clients reach.

export const MCP_SCOPE = 'frontdoor.read';

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
