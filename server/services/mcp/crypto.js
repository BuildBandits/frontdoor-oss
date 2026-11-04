import crypto from 'node:crypto';

// 256-bit random value, URL-safe. Used for codes, tokens, nonces and ids that
// must not be guessable.
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// Codes, tokens, nonces and client secrets are stored only as this hash.
// They are 256-bit random values, so an unsalted fast hash is the right tool:
// there is nothing to brute-force.
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// RFC 7636 §4.1: 43–128 characters from the unreserved set.
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
// An S256 challenge is base64url(SHA-256) without padding: exactly 43 characters.
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isValidS256Challenge(challenge) {
  return typeof challenge === 'string' && PKCE_S256_CHALLENGE.test(challenge);
}

export function verifyPkceS256(verifier, challenge) {
  if (typeof verifier !== 'string' || !PKCE_VERIFIER.test(verifier)) return false;
  if (!isValidS256Challenge(challenge)) return false;
  const computed = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return constantTimeEqual(computed, challenge);
}
