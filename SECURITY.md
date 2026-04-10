# Security Audit Report — Frontdoor

**Audit date:** 2026-03-30
**Auditor:** Claude Code + manual review

## Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | CRITICAL | Open Redirect in Login.jsx | FIXED |
| 2 | HIGH | JWT in localStorage exposed to XSS | FIXED |
| 3 | HIGH | No URL/SSRF validation on target_url | FIXED |
| 4 | HIGH | Admin email hardcoded in source | FIXED |
| 5 | MODERATE | Missing `.dockerignore` | FIXED |
| 6 | MODERATE | Rate limiting too permissive on auth | FIXED |
| 7 | MODERATE | Sensitive data in logs (emails) | FIXED |
| 8 | MODERATE | Silent catch on access_logs | FIXED |
| 9 | MODERATE | Incorrect slug validation regex | FIXED |
| 10 | MODERATE | XSS in proxy 404 page (unescaped appSlug) | FIXED |
| 11 | LOW | CSP with `unsafe-inline` on scriptSrc | ACCEPTED |
| 12 | LOW | npm audit: esbuild/vite moderate | TODO |

---

## Detailed Findings

### 1. [CRITICAL] Open Redirect in Login.jsx

**File:** `src/pages/Login.jsx:28-29`
**Description:** The `redirect` URL parameter was used directly in `window.location.href` without validation.
**Fix:** Validation that redirect is a valid subdomain slug. Only alphanumeric slugs accepted, domain is reconstructed client-side.

### 2. [HIGH] JWT in localStorage exposed to XSS

**File:** `src/stores/authStore.js:4,9-10`, `src/services/api.js:9`
**Description:** JWT was stored in both httpOnly cookie (secure) and localStorage (readable by JS).
**Fix:** Token is no longer saved in localStorage. Only user profile data (non-sensitive) remains in localStorage for UI. API calls use the httpOnly cookie with `withCredentials: true`.

### 3. [HIGH] No URL/SSRF validation on target_url

**File:** `server/routes/apps.js:35-55`
**Description:** Admin could insert any URL as `target_url`, including private IPs.
**Fix:** Protocol validation (http/https only), private IP blocking, URL validation with `new URL()`.

### 4. [HIGH] Admin email hardcoded in source

**Description:** Admin email was hardcoded in source for auto-promotion.
**Fix:** Moved to `ADMIN_EMAILS` environment variable (comma-separated).

### 5. [MODERATE] Missing `.dockerignore`

**Fix:** Created `.dockerignore` with appropriate exclusions.

### 6. [MODERATE] Rate limiting too permissive on auth

**Fix:** Separate rate limit on `/api/auth/microsoft` (10 requests per 15 minutes).

### 7-10. Various moderate fixes

All addressed. See git history for details.

### 11. [LOW] CSP with `unsafe-inline` — ACCEPTED

Required for Vite/React production build. Risk mitigated by no user-content HTML rendering.

### 12. [LOW] npm audit: esbuild/vite — TODO

Moderate vulnerabilities in esbuild via vite. Dev-only, does not affect production.

---

## Already Secure

- **SQL injection**: all queries parameterized with `?`
- **Cookie security**: httpOnly, secure in prod, sameSite lax
- **CSRF on SSO**: state parameter with Map + cleanup
- **Helmet**: security headers present
- **Secrets**: all in env vars
- **Static files**: `dotfiles: 'deny'` on express.static
- **Body parsing**: `express.json({ limit: '1mb' })`
