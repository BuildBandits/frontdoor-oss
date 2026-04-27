# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [1.1.0] — 2026-04-21

### Added
- **`GET /api/apps/bulk`** (X-API-Key auth): exports full metadata of all apps (active + inactive) for server-to-server sync. Returns id, name, slug, description, long_description, icon, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, tags (parsed JSON), created_at, updated_at. Counterpart of the existing `POST /api/apps/bulk` — together they allow round-trip read/write of the app catalog.

### Changed
- **`POST /api/apps/bulk`**: API-key validation extracted into a shared `requireBulkApiKey` helper also used by the new GET endpoint. Now returns **503** when `ADMIN_API_KEY` is not configured on the server (previously surfaced as a misleading generic 401).

## [Unreleased]

### Added
- **`POST /api/auth/verify-sso-token`** — server-to-server token introspection endpoint for satellite apps in `mode=redirect` that don't share `JWT_SECRET` with the frontdoor. Validates a short-lived token issued by `/api/apps/:slug/sso-redirect` against expected audience, issuer, signature, expiration and user/app activation. Body: `{ token, expected_aud }`. Returns `{ valid, user, aud, exp }` on 200, distinct error codes on 401/403/400/429. Rate limited to 120 req/min per IP. RFC 7662-inspired but scoped to the frontdoor SSO flow. Lets satellites stay loosely coupled: a compromised satellite can no longer be parlayed into forging tokens for sibling apps.
- Account menu: users can now save a personal UI language (`English` / `Italiano`) independently from the global branding default. The preference is persisted per user in both localStorage and the database, matching the existing personal Home-view and app-order behavior.
- Webapp localization foundation based on UTF-8 JSON dictionaries under `src/i18n/`, with English as the default language and Italian available as a persisted option from `Personalizza`.
- Admin App and Groups pages now surface info boxes for orphan apps and incomplete groups, making unassigned apps and groups missing apps/members easier to spot before they cause visibility gaps.

### Fixed
- POST SSO redirect: the auto-submitted form was being blocked by helmet's default `form-action 'self'` CSP directive when the target app lived on a different origin (e.g. `autoprompter.coolify.logotel.cloud/api/.../sso-callback`). The `/sso-redirect` handler now sets a per-response CSP that allows `form-action` only towards the configured target app origin, leaving the global CSP untouched.
- Docker image: production runtime now copies the shared language catalog into `/app/shared`, fixing the startup crash introduced by the new language-preference imports.
- App editor: the duplicate action, icon mode buttons, icon helper text and SSO labels are now fully localized; the Customize logo picker text is easier to read, and changing the default language no longer re-translates the page before saving.
- Apps: the connection filter now shows the Entra App option correctly, the group/user confirm dialogs use the localized cancel label, the superadmin deactivate action shows the proper blocked message, and the Customize logo picker now uses translated file controls instead of the browser default text.
- Admin App and Groups: the quick filters now automatically reset back to the full page once there are no more unassigned apps or problematic groups left to show.
- Admin App: the orphan-app info box now reads from the correct `admin.apps` translation namespace, preventing the page from crashing on render.
- Admin App: the orphan-app box now lists the actual unassigned apps and lets you open each app’s editor directly from the warning.
- Admin Groups: the incomplete-groups warning now lists the actual problematic group names and lets you jump straight into each group’s details.
- Admin App and Groups: the orphan/incomplete alerts now use a shared amber warning banner style so they look more standard and consistent.
- Admin App and Groups: both warning areas now sit apart from the table and expose a compact text link inside the warning box to show only unassigned/problematic items.
- `AdminGroups`: the "Nuovo gruppo da Entra" button no longer crashes the page with `selectedEntraGroups.includes is not a function`. The click handler was passing the React `SyntheticEvent` as the first argument to `openEntraImport`, which since the default-args refactor uses it as the `prefillGroupIds` array — the event object would land in state and break the next render. Wrapped the handler in an arrow function so `openEntraImport()` is called with its defaults.

### Changed
- The SSO short-lived token issued by `/api/apps/:slug/sso-redirect` now uses jsonwebtoken's `issuer` option (honoring `JWT_ISSUER`, default `frontdoor`) instead of a hard-coded `iss: 'frontdoor'` literal claim, so cookie tokens and SSO tokens stay in sync if the issuer is overridden via env. No behavioral change at the default.
- Browser tab favicon now uses `public/frontdoor-favicon-appicon.svg`, while the in-page `BrandMark` now uses the recovered `public/frontdoor-icon.svg` asset.
- The in-page `BrandMark` icon now uses a static dark mark for stronger contrast in the app header, while the browser tab favicon keeps the adaptive dark/light artwork.
- Removed unused SVG icon assets from `public` so the folder now keeps only the icons still referenced by the app.
- Audit page: branding updates now log only the changed fields, and the details column renders them as compact plain JSON instead of a full branding snapshot or heavier visual emphasis.
- Admin role actions: the role-assignment buttons now mirror the new badge language too, using a shield for `Admin` and an eye for `Admin (sola lettura)` / `Admin (read only)` instead of relying on the previous generic icon.
- Admin role badges: `Admin` and `Admin (sola lettura)` / `Admin (read only)` now use distinct icons in the admin UI, so the difference is visible beyond color alone.
- Localization/RBAC copy: admin-role actions now say simply `Admin` vs `Admin (sola lettura)` / `Admin (read only)`, removing the redundant `completo` / `full access` wording from role-assignment labels.
- Account menu: the personal Home view switch now uses the same select pattern as the personal language selector, for a more consistent menu interaction.
- Personalizza: the "Criteri e preferenze" card now uses a cleaner single-row layout for language/date/time controls, moves avatar cache into its own maintenance row with action button, and shows log retention as a full-width row with the existing slider logic.
- Personalizza: removed the extra avatar-cache helper hint from the "Criteri e preferenze" section and cleaned the unused i18n entries.
- Localization: language pickers now render from a shared supported-language catalog instead of hardcoded `en/it` buttons, and DB language columns no longer enforce a two-language SQLite check constraint.
- Roles/RBAC: the highest privileged backend role is now `owner` instead of `superadmin`, with startup migration converting existing databases automatically, verbose container-start logging for legacy-role rewrites, and `ADMIN_EMAILS` promoting compose-defined owners at container boot.
- Startup logs: owner-role migration now emits a single concise line when no role migration is needed, while keeping the detailed multi-line output only when an actual legacy rewrite runs.
- Admin Users UI: renamed the visible `superadmin` role label to `Owner` across badges, filters and helper text, and aligned the role filter labels to `Owner`, `Admin`, `Admin (sola lettura)` and `Utenti` with matching English strings.
- i18n: renamed the legacy role badge keys to `ownerBadge` and introduced a dedicated `userBadge` string so the user badge is capitalized without affecting lowercase narrative text.
- Frontend build: admin and auth routes now load lazily, and Vite splits the main vendor libraries into separate chunks to keep the initial bundle smaller and reduce the `500 kB` warning.
- Gestione Gruppi: the "Aggiungi membri" modal now only shows the existing-user picker; the legacy email invitation path and its backend support have been removed.
- Localizations: removed the obsolete email-invite strings from the Admin Groups language files after the modal cleanup.
- Admin route: the personalization page moved from `/admin/personalizza` to `/admin/customization` to match the new English page name and menu links.
- Personalizza Home: the desktop default view is now a true global branding setting, separate from the mobile compact forcing.
- Account menu and Home: resetting the per-user Home view now returns to the global default from Personalizza, not always to box cards.
- Account menu: the Home switch uses a subtler recessed selection state again, with readable text.
- Account menu: the Home reset row now says when the default view is in use and switches to a restore label when overridden.
- Account menu: the app-order reset row now says when the default order is in use and switches to a restore label when overridden.
- Account menu: the per-user preference sections now use compact inline restore/default pills, the Home title is shorter, and the `Ordine app` block stays hidden until the user actually has a custom app order saved.
- Account menu: the selected Home switch now keeps readable contrast between background and text.
- Account menu: the Home selector now uses a higher-contrast accent state so the selected view is easier to read.
- Account menu: the saved app-order timestamp can now be shown with a more European date format, controlled by a global Personalizza toggle.
- Personalizza Home: the 24h and European date toggles now explicitly say they only affect menu rendering, not the stored data.
- Account menu: the "Ordine app" section now shows the last saved custom order timestamp, formatted with the global 12h/24h preference.
- Back-to-top button: the floating label now reads `Torna su`.
- Account menu: the Home view segmented switch now highlights the effective current view immediately, including the global default when the user has no personal override yet.
- Account menu: the Home view choice now uses a single-line segmented switch for `Box pieni` / `Compattata` instead of two separate stacked buttons.
- Personalizza save area: the "Stato modifiche" bar is now integrated inside each section card instead of appearing as a detached block below it.
- User detail modal: "App visibili" now closes with `Esc`, uses App-page-style mode badges, and clicking an app opens its edit modal in `Gestione App` instead of launching it.
- User detail modal: the visible-app count now shows an info icon to hint that it is clickable.
- Personalizza save area: the floating "Stato modifiche" bar has been moved into each section card, keeping the save action inside the page body without a detached duplicate block.
- Home personalization: the desktop Home view preference now lives in the database per user, and the user menu can reset it back to the global default.
- Home ordering: the custom drag-and-drop app order is now stored per user in the database instead of localStorage, with a user-menu reset back to the global order.
- Home mobile toolbar: the search field stays on its own row on small screens, while on desktop it shares the same line with the action buttons again.
- Footer: the MIT license reference in the shared footer now links to the official Open Source Initiative license page.
- Mobile toolbar layout: Home now keeps the search field on its own row on mobile, with action buttons moved below into a single comfortable row; the same mobile-only treatment now applies to the Gestione App and Gestione Gruppi primary actions, while desktop layouts stay unchanged.
- Personalizza responsive: the quick navigation panel now uses a compact grid on mobile instead of horizontal scrolling, reducing overflow and making section jumping easier on small screens.
- Footer: moved the build sigla into a shared footer shown on the login page and all authenticated pages, with the official webapp version pinned to `v1.0.0`, an open-source note, and MIT reference without a repo link.
- Admin UX: the search/filter bars on Gestione App, Gestione Gruppi, Gestione Utenti and Log now use a shared Audit-style surface with a bordered white container and consistent filter controls.
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
- Personalizza Home: added a global toggle to show menu dates in a more European day/month/year format.
- Personalizza Home: added a global toggle to show menu timestamps in 24-hour format.
- Personalizza page: added a per-user Home desktop view dropdown under the Home section, moved the Mobile section after Criteri, and refreshed the Mobile block icon.
- Layout nav: the account dropdown next to the avatar/name now exposes the per-user Home view preference and writes it to the database.
- Personalizza: added a dedicated Mobile section with a mobile-compact Home default toggle and a mobile-only hero hide toggle.
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
- `Home`: compact list view — toggle "Compatta" in toolbar, now backed by the authenticated user's database preference and resettable to the global default; apps rendered as dense horizontal rows with icon, name, description, tags and badges in a single line
- `AppCard`: extracted shared `InfoModal` component to avoid duplication between card and compact layouts
- `AppCard`: app icons on the Home card are now clickable and open the app link like the name and description
- Admin UX: search fields in Gestione App, Gestione Gruppi and Gestione Utenti now include a clear button and support `Esc` to clear the current query
- Admin UX: the Entra app creation field no longer pre-fills `/sso`; it now starts empty and prompts for the Microsoft Entra Application ID
- Home page: favorites are now pinned at the top of the grid (above non-favorites)
- Home page: drag-and-drop reordering of app tiles with `@dnd-kit/sortable`; personal order is now persisted per user in the database. Drag handle appears on card hover (top-left grip). Drag is disabled in group-by-tag view and while search/tag filters are active to avoid surprising jumps. Cross-section drags (fav ↔ non-fav) are blocked so the "favorites first" invariant always holds.
- Home page footer shows the build's short commit SHA (e.g. `vd83c54e`). Injected at build time by Vite via a `__COMMIT_SHA__` global, resolved from `git rev-parse --short HEAD` with a fallback to the `VITE_COMMIT_SHA` env var. When neither is available (e.g. Docker builds without `.git` in the context), falls back to a compact UTC build timestamp (e.g. `v20260415-1147`) so the footer always shows a meaningful version string.
- New `POST /api/apps/:slug/track-access` endpoint records an access_logs row for a given app. Authenticated + RBAC-gated. Frontend calls it fire-and-forget from `AppCard.handleClick` before opening the target URL in a new tab. Previously only apps with `mode='redirect'` produced access logs (via the `/sso-redirect` server round-trip); apps with `redirect-plain` or `shared-cookie` modes bypass the server on click and were invisible in the access log. This endpoint closes that gap.
- App icon uploads now support pasted images, pasted SVG, and file upload, with cached assets stored on the data volume and icon rendering falling back to emoji when assets are missing.
- New app creation now only asks whether to include the default group; the follow-up group assignment modal opens only when default is not selected, with search and scroll support for existing Frontdoor groups.
- `Personalizza` now exposes global controls for home branding, badge visibility, and app mode visibility.
- App tags are normalized case-insensitively so tag grouping and filters do not duplicate `AI`/`ai` variants.

### Fixed
- Account menu and Home reload: `/api/auth/me` now returns the full user preference payload again, so a hard refresh no longer drops the saved app order and its timestamp back to the global default.
- Account menu: custom app order and its saved timestamp are now kept in the local user cache too, so a hard refresh no longer falls back to the global order while the profile rehydrates.
- Account menu: the Home view switch no longer mixes the mobile compact default with the desktop preference, so the highlighted state now matches the actual desktop view.
- Gestione App: the deep-link handler for `?edit=` no longer trips a render-time reference error, so the page loads correctly again.
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
