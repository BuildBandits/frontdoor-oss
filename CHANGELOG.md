# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [1.1.0] — 2026-04-21

### Added
- **`GET /api/apps/bulk`** (X-API-Key auth): exports full metadata of all apps (active + inactive) for server-to-server sync. Returns id, name, slug, description, long_description, icon, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, tags (parsed JSON), created_at, updated_at. Counterpart of the existing `POST /api/apps/bulk` — together they allow round-trip read/write of the app catalog.

### Changed
- **`POST /api/apps/bulk`**: API-key validation extracted into a shared `requireBulkApiKey` helper also used by the new GET endpoint. Now returns **503** when `ADMIN_API_KEY` is not configured on the server (previously surfaced as a misleading generic 401).

## [Unreleased]

### Changed
- App table: the connection filter is now a dropdown with checkbox-style options whose trigger matches the search field look and feel, and the table headers keep the original uppercase treatment while staying clickable for sorting on every field except actions.
- App table: the sortable header labels now apply uppercase directly on the clickable buttons, so the look stays consistent even though the cells are interactive; the sort marker uses chevron up/down icons again.
- App table: `AZIONI` is centered again so it visually matches the rest of the header row.
- Entra group discovery now performs a tenant-wide refresh of the group catalog via `/groups` (app-only) at the start of every login and every Force Sync, so the admin import modal reflects the current state of the tenant without waiting for a specific user to log in. Force Sync has been rewritten to iterate users (one `/users/{id}/transitiveMemberOf` call per user, app-only) instead of iterating imported groups, so it now populates both the discovery cache and per-user memberships in a single pass — and it no longer refuses to run when no Entra groups have been imported yet. Required Graph application permissions: `User.Read.All`, `GroupMember.Read.All` (and optionally `Group.Read.All`), all with admin consent — see README.
- Personalizza page no longer crashes on load because the missing `SlidersHorizontal` import has been restored, and the browser favicon now switches between the new light/dark SVGs via `prefers-color-scheme`.
- App cards no longer show the redundant external-link glyph beside the app name, long descriptions now preserve safe `target="_blank"` links, and the app editor can duplicate an existing app from the modal while preserving its icon asset.
- Entra group sync now stores the source group description in the discovery cache and uses it when importing groups, falling back to `No description available on Entra` instead of the generic placeholder.
- Gestione Gruppi and Gestione Utenti now support a faster Entra flow: detected Entra groups can jump directly into the group import modal, and user details expose a modal with the list of visible apps.
- The app info modal no longer crashes when opened, the browser tab favicon now always uses the dark artwork, the app list includes a direct jump to Gestione Gruppi with a prefilled search, and the tag field shows available labels as soon as it receives focus.

### Added
- Roles: introduced `superadmin`, `admin`, and `admin_readonly`, with compose-defined superadmins kept out of the UI for demotion/deletion
- Admin UX: added a dedicated `Audit` page for privileged actions, visible only to superadmins, with search, retention filters, and pagination
- Log pages: added search, period filters, and page-size selection up to 250 rows
- Audit page: added a superadmin-only admin filter so privileged actions can be narrowed to a single actor
- Retention: logs and audit rows older than 90 days are purged automatically at startup and then once per day
- Admin UX: `admin_readonly` users can view admin pages but cannot modify apps, groups, or users
- Personalizza page: sticky save bar, quick navigation sidebar, and grouped sections for Login, Home, Gestione App and Criteri di conservazione
- Personalizza page: log retention selector from 0 to 90 days with deferred purge warning, plus avatar cache refresh in the conservation section
- Personalizza page: save success/error feedback now appears in the sticky bottom bar, and the section navigation no longer breaks the mobile layout
- Personalizza page: fixed the top spacing of the first visible section by replacing `space-y` with a flex gap so hidden mobile navigation does not add extra margin
- Personalizza page: added a maintenance action to refresh the cached user avatars for Microsoft/Gravatar updates
- Personalizza page: aligned the `Home` and `App` section icons with the global top navigation for a consistent look and feel
- BrandMark: removed the decorative shadow/background treatment so the new transparent favicon artwork renders cleanly
- Layout nav: renamed the top-level Home entry to `Home` and the admin catalog entry to `App`
- Admin Users: clarified the role action labels to distinguish `admin completo` from `admin sola lettura`
- Modal UX: `Esc` closes admin modals, with a discard confirmation when there are unsaved changes
- Admin branding: new toggle to hide the Home hero banner and a tenant-wide option to skip the login page and go straight to Microsoft SSO
- Admin UX: replaced browser `confirm()`/`alert()` dialogs with inline page notices and custom confirmation modals in Gestione App, Gestione Gruppi and Gestione Utenti
- Admin UX: search field in Gestione App and cross-search in Gestione Gruppi for group names plus associated app names/slugs
- New app mode `entra-app`: launches Microsoft Entra SSO via MyApps launcher (`launcher.myapps.microsoft.com/api/signin/<APPLICATION_ID>?tenantId=<TENANT_ID>`), reusing the `sso_endpoint` field for the Application ID
- DB migration on startup: expands `apps.mode` CHECK constraint to include `entra-app` for existing databases (table reconstruction pattern)
- `AppCard`: violet `entra` badge for `entra-app` mode apps, consistent with admin panel
- `AppIcon`: emoji/text icons now rendered inside a fixed-size flex container matching image dimensions, ensuring visual consistency between emoji and SVG/image icons at every size
- `Home`: compact list view — toggle "Compatta" in toolbar, persisted in localStorage; apps rendered as dense horizontal rows with icon, name, description, tags and badges in a single line
- `AppCard`: extracted shared `InfoModal` component to avoid duplication between card and compact layouts
- `AppCard`: app icons on the Home card are now clickable and open the app link like the name and description
- Admin UX: search fields in Gestione App, Gestione Gruppi and Gestione Utenti now include a clear button and support `Esc` to clear the current query
- Admin UX: the Entra app creation field no longer pre-fills `/sso`; it now starts empty and prompts for the Microsoft Entra Application ID
- Home page: favorites are now pinned at the top of the grid (above non-favorites)
- Home page: drag-and-drop reordering of app tiles with `@dnd-kit/sortable`; personal order persisted in `localStorage` (`frontdoor_app_order`). Drag handle appears on card hover (top-left grip). Drag is disabled in group-by-tag view and while search/tag filters are active to avoid surprising jumps. Cross-section drags (fav ↔ non-fav) are blocked so the "favorites first" invariant always holds.
- Home page footer shows the build's short commit SHA (e.g. `vd83c54e`). Injected at build time by Vite via a `__COMMIT_SHA__` global, resolved from `git rev-parse --short HEAD` with a fallback to the `VITE_COMMIT_SHA` env var. When neither is available (e.g. Docker builds without `.git` in the context), falls back to a compact UTC build timestamp (e.g. `v20260415-1147`) so the footer always shows a meaningful version string.
- New `POST /api/apps/:slug/track-access` endpoint records an access_logs row for a given app. Authenticated + RBAC-gated. Frontend calls it fire-and-forget from `AppCard.handleClick` before opening the target URL in a new tab. Previously only apps with `mode='redirect'` produced access logs (via the `/sso-redirect` server round-trip); apps with `redirect-plain` or `shared-cookie` modes bypass the server on click and were invisible in the access log. This endpoint closes that gap.
- App icon uploads now support pasted images, pasted SVG, and file upload, with cached assets stored on the data volume and icon rendering falling back to emoji when assets are missing.
- New app creation now only asks whether to include the default group; the follow-up group assignment modal opens only when default is not selected, with search and scroll support for existing Frontdoor groups.
- `Personalizza` now exposes global controls for home branding, badge visibility, and app mode visibility.
- App tags are normalized case-insensitively so tag grouping and filters do not duplicate `AI`/`ai` variants.

### Fixed
- `server/db.js`: expands user roles and RBAC audit target types on startup for existing databases, mapping legacy admins to `superadmin`
- `server/routes/auth.js`: compose-defined admin emails are auto-promoted to `superadmin`, and privileged logins are recorded in the audit trail
- `server/routes/apps.js`, `server/routes/groups.js`, `server/routes/users.js`, and `server/routes/branding.js` now enforce viewer/editor/superadmin role splits instead of a single `admin` gate
- `src/components/Layout.jsx` and `src/App.jsx`: admin navigation and routes now hide Log/Personalizza from `admin` and `admin_readonly`
- `src/pages/AdminLogs.jsx`: log loading now refreshes correctly when search, retention, or page size changes
- `src/pages/Personalizza.jsx` and `src/components/UserAvatar.jsx`: avatar cache refresh now busts both the server cache and the browser cache-buster so updated Microsoft profile photos appear immediately
- `server/services/avatars.js`: avatar refresh now prefers Microsoft Graph app-only photos when available, so Gravatar does not win after a cache reset
- `server/routes/logs.js`: audit log rows now include `actor_id`, so the Audit page can render the actor avatar again
- `server/routes/logs.js`: Log and Audit timestamps now parse SQLite UTC values correctly before formatting them in the configured `TZ`
- `server/routes/logs.js`: log retention purge now honours the configured retention setting, including `0` for logless mode
- `server/db.js` and `server/services/branding.js`: persisted `log_retention_days` in branding settings with a 0-90 day range
- `src/components/BrandMark.jsx`: updated the app mark to reuse the new `public/favicon.svg` artwork everywhere it is rendered
- Entra group discovery at login now uses an app-only Microsoft Graph token (`/users/{id}/transitiveMemberOf`) instead of a delegated `/me/transitiveMemberOf` call. On tenants with nested group structures, the delegated path with the minimal `User.Read` scope returns `displayName: null` for transitive memberships, so Frontdoor's cache ended up with IDs instead of names for most groups. The app-only path reliably returns `displayName` for both direct and transitive memberships, using the `GroupMember.Read.All` application permission already required by Force Sync — no additional Azure consent needed.
- `Ripristina applicazioni dimostrative` now reinserts missing demo apps without reusing conflicting IDs, so it appends the demo catalog instead of failing on `apps.id`
- `Sincronizza gruppi` now resyncs imported Entra groups through app-only Graph group membership reads and surfaces sync errors in the page banner under the Gestione Gruppi header
- `SortableAppCard` now forwards `showModeBadges` and `compact` props to the underlying `AppCard`. Previously these were silently dropped by the wrapper, so in the drag-enabled home view (default view without filters/grouping/compact) the mode badges (ext / SSO / entra) stayed always visible regardless of the `Mostra badge ext / SSO sulle app` toggle in Personalizza
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
