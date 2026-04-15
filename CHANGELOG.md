# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added
- New app mode `entra-app`: launches Microsoft Entra SSO via MyApps launcher (`launcher.myapps.microsoft.com/api/signin/<APPLICATION_ID>?tenantId=<TENANT_ID>`), reusing the `sso_endpoint` field for the Application ID
- DB migration on startup: expands `apps.mode` CHECK constraint to include `entra-app` for existing databases (table reconstruction pattern)
- `AppCard`: violet `entra` badge for `entra-app` mode apps, consistent with admin panel
- `AppIcon`: emoji/text icons now rendered inside a fixed-size flex container matching image dimensions, ensuring visual consistency between emoji and SVG/image icons at every size
- `Home`: compact list view — toggle "Compatta" in toolbar, persisted in localStorage; apps rendered as dense horizontal rows with icon, name, description, tags and badges in a single line
- `AppCard`: extracted shared `InfoModal` component to avoid duplication between card and compact layouts
- Home page: favorites are now pinned at the top of the grid (above non-favorites)
- Home page: drag-and-drop reordering of app tiles with `@dnd-kit/sortable`; personal order persisted in `localStorage` (`frontdoor_app_order`). Drag handle appears on card hover (top-left grip). Drag is disabled in group-by-tag view and while search/tag filters are active to avoid surprising jumps. Cross-section drags (fav ↔ non-fav) are blocked so the "favorites first" invariant always holds.
- Home page footer shows the build's short commit SHA (e.g. `vd83c54e`). Injected at build time by Vite via a `__COMMIT_SHA__` global, resolved from `git rev-parse --short HEAD` with a fallback to the `VITE_COMMIT_SHA` env var or a compact UTC build timestamp if git metadata is not available.
- App icon uploads now support pasted images, pasted SVG, and file upload, with cached assets stored on the data volume and icon rendering falling back to emoji when assets are missing.
- New app creation now supports selecting one or more existing Frontdoor groups instead of auto-assigning the default group.
- `Personalizza` now exposes global controls for home branding, badge visibility, and app mode visibility.
- App tags are normalized case-insensitively so tag grouping and filters do not duplicate `AI`/`ai` variants.

### Fixed
- `server/routes/logs.js`: `JSON.parse` on `rbac_audit_logs.details` wrapped in try/catch — prevents 500 crash on malformed entries
- `server/routes/auth.js`: removed PII (email) from all `console.log/warn` calls; replaced with opaque IDs (`microsoftId` pre-login, `user.id` post-login)
- `server/routes/auth.js`: user profile data (email, role) no longer passed as URL query param in post-SSO redirect — frontend now calls `/api/auth/me` to retrieve profile via httpOnly cookie, preventing leakage in browser history, server logs and Referer headers
- `server/routes/auth.js`: replaced SQL string interpolation in role-promotion UPDATE with two separate parameterized statements
- `server/routes/auth.js`: added comment on single-instance limitation of in-memory CSRF state store
- GET `/:slug/entra-redirect` endpoint with RBAC check and access logging, redirecting to the Entra MyApps launcher URL
- Admin UI: violet "Entra App" mode button, Application ID input field, and `entra` badge in the app table

### Changed
- `AppCard` is now a `forwardRef` component and accepts optional `dragHandleProps`, `dragging` and `style` props for sortable integration
- Dockerfile builder stage now installs `git` so the commit SHA can be resolved inside the Docker build context
- `.dockerignore` no longer excludes `.git` (required for the commit SHA lookup; trivial build-context size impact)
- Rate limits on `/api/auth/microsoft`, `/api/*` and RBAC mutation endpoints are now tunable via env vars (`AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`, `API_RATE_LIMIT_WINDOW_MS`, `RBAC_RATE_LIMIT_MAX`, `RBAC_RATE_LIMIT_WINDOW_MS`). Defaults have been significantly raised (auth 10→5000/15min, api 100→6000/min, rbac 120→500/min) to support shared-NAT corporate deployments where hundreds of users share a single public IP.

## [1.0.0] — 2026-04-11

### Added
- Authentication gateway with Microsoft SSO (@azure/msal-node)
- App catalog with search, tags, favorites, group-by-tag view
- RBAC system: user groups with per-group app visibility
- Three app modes: redirect (SSO JWT), shared-cookie (wildcard domain), redirect-plain (external link)
- Admin panel: manage apps, users, groups
- User pre-registration by email (before first SSO login)
- Access logs with pagination and analytics (top apps, unique users)
- RBAC audit trail logging
- Bulk app upsert API (for CI/automation, API key auth)
- Auto-seed example apps on first startup
- Docker multi-stage build
- Rate limiting on auth and API endpoints
- Security hardening: helmet, CSP, httpOnly cookies, SSRF protection, parameterized SQL
- RBAC unit tests (node:test + node:sqlite)

---

## Roadmap

- [ ] Support for additional SSO providers (Google, SAML)
- [ ] App health check monitoring
- [ ] User self-service profile page
- [ ] Dark mode
- [ ] i18n support
