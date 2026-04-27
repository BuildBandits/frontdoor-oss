import jwt from 'jsonwebtoken';

// Slug regex mirrors the one used by the apps catalog (lowercase letters,
// digits, internal hyphens, 1..63 chars). Anything else is rejected at the
// body-shape stage so the rest of the chain operates on safe input only.
const SSO_AUD_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate an SSO short-lived token issued by /api/apps/:slug/sso-redirect
 * against an expected audience. Returns { status, body } that the route
 * handler maps directly to res.status(...).json(...).
 *
 * Pure function — receives jwtSecret, expectedIssuer and dbHandle by
 * dependency injection so it can be unit-tested without touching the real
 * database or the runtime env.
 */
export function verifySsoTokenChain({ token, expectedAud, jwtSecret, expectedIssuer, dbHandle }) {
  if (
    typeof token !== 'string' || !token ||
    typeof expectedAud !== 'string' || !SSO_AUD_RE.test(expectedAud)
  ) {
    return { status: 400, body: { error: 'bad_request' } };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    // err.name distinguishes TokenExpiredError from JsonWebTokenError; keep
    // it in the log for ops, but never leak the distinction to the caller —
    // an attacker probing tokens shouldn't learn whether expiration or
    // signature is the failing dimension.
    console.warn('[sso-introspection] token verify failed:', err.name);
    return { status: 401, body: { error: 'invalid_token' } };
  }

  if (decoded.iss !== expectedIssuer) {
    return { status: 401, body: { error: 'invalid_issuer' } };
  }

  if (decoded.aud !== expectedAud) {
    // Likely token replay across apps. Log enough to triage but no email/PII.
    console.warn('[sso-introspection] audience_mismatch', {
      sub: decoded.sub,
      tokenAud: decoded.aud,
      requestedAud: expectedAud,
    });
    return { status: 403, body: { error: 'audience_mismatch' } };
  }

  const user = dbHandle
    .prepare('SELECT id, email, display_name, role FROM users WHERE id = ? AND is_active = 1')
    .get(decoded.sub);
  if (!user) {
    return { status: 401, body: { error: 'user_not_found_or_inactive' } };
  }

  const app = dbHandle
    .prepare('SELECT 1 AS ok FROM apps WHERE slug = ? AND is_active = 1')
    .get(expectedAud);
  if (!app) {
    return { status: 403, body: { error: 'app_inactive' } };
  }

  return {
    status: 200,
    body: {
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.display_name,
        role: user.role,
      },
      aud: decoded.aud,
      exp: decoded.exp,
    },
  };
}
