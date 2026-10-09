// Remembers the page a signed-out user was trying to open, so the sign-in can
// bring them back there. Only same-origin paths are accepted (no "//host", no
// backslashes, never the login page itself). Kept in sessionStorage so it
// survives the round trip through Microsoft sign-in.

const STORAGE_KEY = 'frontdoor.returnPath';
const MAX_LENGTH = 512;

export function isSafeReturnPath(path) {
  return typeof path === 'string'
    && path.length > 1
    && path.length <= MAX_LENGTH
    && /^\/(?![/\\])/.test(path)
    && !path.includes('\\')
    && !path.startsWith('/login');
}

export function loginPathFor({ pathname = '/', search = '' } = {}) {
  const path = `${pathname}${search}`;
  return isSafeReturnPath(path) ? `/login?next=${encodeURIComponent(path)}` : '/login';
}

export function rememberReturnPath(path) {
  if (!isSafeReturnPath(path)) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // Storage unavailable: the user lands on Home after signing in.
  }
}

/** Returns the remembered path (or "/") and forgets it. */
export function takeReturnPath() {
  try {
    const path = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return isSafeReturnPath(path) ? path : '/';
  } catch {
    return '/';
  }
}
