# Changelog

All notable changes to this project will be documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Changed
- **Home tour**: the onboarding flow now opens with a centered welcome step, then guides users through search, the catalog, app-card favorites/info icons, the personal menu, and a final step about setting Frontdoor as homepage or bookmarking it. The last step also suggests browser-specific help based on the detected browser.

## [1.2.1] — 2026-05-21

### Added
- **Dark mode**: full theme support across every page. Tenant default is set from the Personalizza page (`light`, `dark`, or `auto` to follow the user's OS preference), and each user can override it from the personal account menu (☀ / 🌙 / 💻 toggle). The preference is stored per user (`users.preferred_color_scheme`) and per tenant (`branding_settings.default_color_scheme`), and the `dark` class is applied on `<html>` reactively, including a live `prefers-color-scheme` listener when the effective choice is `auto`. Works on Login too (pre-auth pages still respect the tenant default).
- **Home search shortcuts**: the search field is now auto-focused on Home open, and pressing Enter launches the first matching app. The Enter handler reuses the regular launch path so access logging behaves identically to a click.
- **Home tour**: first-time visitors now get a guided "Take a tour" flow on the Home page that highlights the hero, search/filter controls, and app catalog. The "seen" state is persisted per user in the database, the tour can be skipped, and it can be restarted anytime from the personal menu in the top-right account dropdown.

### Fixed
- **Search fields UX**: the main search inputs now no longer steal focus on page load, but they are first in the keyboard tab order on Home, App, Gruppi, Utenti, Audit, Log, Icone and Trasferisci gruppi so the first `Tab` lands in search. The shared search component still supports `Esc` to clear and restore the last cleared text plus an inline `X` button for mouse/touch clearing. The Personalizza page is unchanged because it has no search field.
- **Docker SQLite startup**: the production image now reclaims ownership of `/data` at container start before dropping privileges to the `frontdoor` user. This keeps the SQLite database and its WAL/shm sidecars writable on named volumes, preventing `SQLITE_READONLY` crashes on boot after upgrading to Frontdoor 1.2.0.
- **Hardcoded UI strings**: removed English success labels and shared control fallbacks from the admin flows and common components, so visible text now comes from the localization dictionaries instead of backend payloads or component defaults.
- **SSO deep-link redirect across the OAuth roundtrip**: `GET /api/auth/microsoft?redirect=<slug>` now persists the requested redirect target in a short-lived (10 min) `httpOnly`/`SameSite=lax` cookie scoped to `/api/auth`, recovered by `/api/auth/microsoft/callback` and propagated to `/login?sso=ok&redirect=<slug>` so the Login SPA can deep-link the user to the target app subdomain after Microsoft SSO. Previously the SPA already supported `?redirect=`, but the backend never propagated it through the OAuth roundtrip (Microsoft doesn't forward custom query params), so the parameter was only honored for already-authenticated users — breaking the single-click flow for satellite apps that bounce unauthenticated users here. Slug is validated against the same `^[a-z0-9][a-z0-9-]*[a-z0-9]$` regex used by the Login SPA, both on set (cookie not even written if invalid) and on read (defense-in-depth). The cookie value is bound to the CSRF `state` (`<slug>.<stateUuid>`) and only honored when the callback's `req.query.state` matches the embedded UUID, giving single-use semantics: leftover cookies from aborted OAuth flows cannot redirect an unrelated later login. `/api/auth/microsoft` also clears any stale cookie when called without a valid `?redirect=`, so a user who aborts a flow and starts a new one without the parameter does not silently land on the previous target.
- **Login deep-link routes through the app launcher**: after SSO (and for already-authenticated visits to `/login?redirect=<slug>`), the Login SPA now navigates to `/api/apps/<slug>/sso-redirect` instead of jumping straight to `https://<slug>.<base-domain>`. For `mode=redirect` apps this is required for correctness — the launcher emits the SSO POST to the app's `sso_endpoint`, which is what lets the satellite establish its local session; a direct subdomain jump skipped that step and bounced the user back into a login loop. To keep the launcher usable for every app, `/api/apps/:slug/sso-redirect` now returns a `302` to `target_url` for non-`redirect` apps (shared-cookie / redirect-plain) instead of `404`, after the usual RBAC check and access logging. The `?redirect=` slug is propagated to `/api/auth/microsoft` from the `hideLoginPage` auto-launch and the manual SSO button as well.

## [1.2.0] — 2026-05-13

### Added
- **Dev login mode** (`DEV_LOGIN=true`): local development no longer requires Azure AD credentials. When enabled (and `NODE_ENV` is not `production`), the login page shows a role picker (`owner` / `admin` / `admin_readonly` / `user`) that creates a local dev user and signs in immediately. Azure env vars and `JWT_SECRET` become optional with automatic fallbacks. Completely ignored when `NODE_ENV=production`.
  - New endpoints: `GET /api/auth/dev-status`, `POST /api/auth/dev-login`
  - `.env.example.node` now ships with `DEV_LOGIN=true` by default
  - `.env.example.docker` documents the variable (commented out, no effect in production)
- **`FEATURES.md`**: structured feature map of the project organized by capability area (auth, app catalog, connection modes, RBAC, personalization, branding, logs, audit, retention, media library, backup, bulk API, i18n, security, deployment). Linked from the README as the entry point for contributors and evaluators looking for a complete overview without scrolling the full changelog.
- **OSS-readiness documentation**: `CONTRIBUTING.md` (with DCO sign-off requirement), `GOVERNANCE.md`, `MAINTAINERS.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `TRADEMARK.md` (common-law trademark policy for FrontDoor™), GitHub pull-request and issue templates under `.github/`. `SECURITY.md` rewritten as a vulnerability-disclosure policy (the previous content, an audit report, has been removed and remains accessible via git history). `README.md` now links to Contributing, Security, Brand and trademark sections.

### Changed
- **Changelog**: rewrote and reorganized the file. Releases are now ordered newest-first per Keep a Changelog. Items that were previously parked under `[Unreleased]` have been redistributed into the release where they actually shipped (1.1.1 or 1.1.0) based on commit dates, so the historical record matches what was actually deployed.

### Fixed
- Asset cache directories: `BRANDING_ASSET_DIR`, `APP_ICON_CACHE_DIR` and `AVATAR_CACHE_DIR` are now passed through `path.resolve()` at module load. A relative env value like `./data/branding` (the default in `.env.example.node`) is normalized to an absolute path, so `res.sendFile()` no longer throws `TypeError: path must be absolute` when serving cached SVGs, app icons, branding logos or avatars in dev mode.

### Security
- **CSRF state SSO persisted in SQLite**: replaced the in-memory `pendingAuthStates` map used by the Microsoft SSO flow with a SQLite-backed `auth_pending_states` table. Validation and TTL (10 min) are enforced atomically with a single conditional `DELETE`, so the OAuth state now survives across replicas without a Redis dependency.
- **helmet 7 → 8**: bumped `helmet` to `^8.1.0`. CSP directives in `server/index.js` stay unchanged; option shape is unaffected.
- **Vite 5 → 8, plugin-react 4 → 5**: clears the two remaining moderate dev-dependency CVEs (`GHSA-67mh-4wv8-2f99` esbuild dev-server SSRF and `GHSA-4w7w-66w2-5vf9` vite `.map` path traversal). `npm audit` is now clean (0 vulnerabilities). Production build verified, all 57 tests pass, `vite.config.js` needed no changes.
- **Audit log triage**: open findings in `security/security-audit-20260513.md` split into Won't fix / Open / Done buckets. Four findings explicitly accepted (GET redirect with token in query, bulk API key constant-time, wildcard cookie domain, sameSite=lax) with documented rationale, so the next audit doesn't reopen risks already weighed.
- **Dependencies**: upgraded `axios` to `^1.16.0` (fixes SSRF GHSA-3p68-rc4w-qgx5 / GHSA-pmwg-cvhr-8vh7, prototype-pollution GHSA-w9j2-pvgh-6h63 / GHSA-pf86-5x62-jrwf, cloud metadata exfiltration GHSA-fvcv-3m26-pcqx, CRLF injection GHSA-445q-vr5w-6q77 and 7 more advisories). Ran `npm audit fix` to resolve transitive `lodash`, `postcss` and `follow-redirects` advisories.
- **SVG uploads**: app icons, branding logos and media-library assets uploaded as SVG are now sanitized server-side with DOMPurify before being persisted, stripping `<script>`, `on*` handlers, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `<use>` and `javascript:` URLs. Sanitized SVGs are served with a defense-in-depth response CSP (`default-src 'none'; sandbox`) plus `X-Content-Type-Options: nosniff` so a payload that slipped past the sanitizer cannot execute scripts or reach cookies.
- **CSP hardening**: removed `'unsafe-inline'` from the global `script-src` directive in `helmet()`. Vite production bundles only emit `<script type="module" src="...">` external scripts; no inline script is required by the app. The SSO POST redirect (`/api/apps/:slug/sso-redirect`) keeps its own scoped CSP that still allows the one-line auto-submit script.
- **Docker hardening**: the container now runs as a dedicated non-root `frontdoor` user (uid/gid 1001) created in the runtime stage. Reduces blast radius of any future RCE / file traversal vulnerability.
- **JWT_SECRET hardening**: server startup now rejects known placeholder values (`change-this-in-production`, `your-jwt-secret`, `changeme`, the dev fallback) and short secrets (<32 chars) in production, instead of just emitting a warning. Dev mode (`DEV_LOGIN=true`) still permits the dev fallback for local work.
- **Error sanitization**: 500-level responses no longer leak raw `error.message` (which could expose DB/fs paths). A new `UserFacingError` class marks errors that are safe to forward verbatim; everything else is downgraded to a generic message and only logged server-side. Applied to `/api/branding` (PUT), `/api/groups/entra/import`, `/api/groups/entra/force-sync` and `/api/backups/restore`.
- **PII in logs**: replaced user email with user id in `console.error/log` statements (`server/routes/users.js`, `server/scripts/prewarmAvatars.js`), aligning with the project's no-PII-in-logs policy.
- **Admin UI**: the Admin app editor now displays a warning when an admin selects `sso_method=GET` for a Redirect SSO app, explaining that the token leaks via Referer, browser history and access logs and recommending POST when the target app supports it.
- Verified: `ADMIN_API_KEY` empty or unset correctly returns 503 on bulk endpoints (`GET /api/apps/bulk`, `POST /api/apps/bulk`). No bypass possible — the guard short-circuits before any key comparison.

## [1.1.1] — 2026-05-08

### Added
- **`POST /api/auth/verify-sso-token`** — server-to-server token introspection endpoint for satellite apps in `mode=redirect` that don't share `JWT_SECRET` with the frontdoor. Validates a short-lived token issued by `/api/apps/:slug/sso-redirect` against expected audience, issuer, signature, expiration and user/app activation. Body: `{ token, expected_aud }`. Returns `{ valid, user, aud, exp }` on 200, distinct error codes on 401/403/400/429. Rate limited to 120 req/min per IP. RFC 7662-inspired but scoped to the frontdoor SSO flow. Lets satellites stay loosely coupled: a compromised satellite can no longer be parlayed into forging tokens for sibling apps.
- Admin Groups: added a hidden admin-only utility page to copy or move all direct app permissions from one group to another in a single action, with copy/move confirmation.
- Admin app editor: apps without at least one label now surface only through a quick filter badge with a live count, keeping the warning discrete while still making unlabeled items easy to spot and filter.
- Admin Groups: clicking a problematic group from the warning banner now expands it and scrolls the row into view, making the missing-assignment fix faster to reach.
- Group-of-groups support: local groups can now link multiple child groups and inherit app visibility through that container, so one Frontdoor group can represent several Entra groups at once. The admin Groups page now exposes linked-group management, and RBAC/user detail lookups resolve the inherited access path.
- Admin Groups: local composite groups can now also reference discovered Entra groups directly without importing them into the main group list, keeping the list cleaner while preserving inherited app visibility.
- Admin Groups: the new "Collega gruppi" modal now exposes a filtered "select all" shortcut, matching the bulk-selection behavior already available in the other admin modals.
- Backup and restore: owner-only download/upload flow for portable Frontdoor snapshots, including the database plus persisted app icon, branding and avatar cache files, exposed through a new `/admin/backup` page and `/api/backups` endpoints.
- Personalizza: added an Owner-only action to clear the access log immediately from the retention section, leaving Audit untouched.
- Admin app editor: new apps now get an automatic slug suggestion from the app name until you edit the slug manually, and the Entra App field now explains that you can paste the full MyApps URL.
- Media library index: uploaded app icons and branding logos are now indexed directly from their existing caches, with admin-only browse and file endpoints under `/api/media-assets`. No separate media archive directory is required.
- Hidden admin media browser: a new on-demand `/admin/icons` page lets privileged users inspect the media index, preview files, copy asset links and filter by icon/logo kind without adding a visible navigation entry.
- Media library backfill: on startup, existing app icon and branding files already stored on disk are indexed so the hidden page starts with the historic assets too.
- Home now shows a live application counter next to the search field, so users can see how many apps are currently visible while browsing or filtering.
- Entra App creation now accepts the full Microsoft MyApps launcher URL and automatically stores only the Application ID.
- Media library deduplication: assets with the same content hash are now grouped into a single card in `/admin/icons`, while preserving the linked app references and merged occurrence count.
- Account menu: users can now save a personal UI language (`English` / `Italiano`) independently from the global branding default. The preference is persisted per user in both localStorage and the database, matching the existing personal Home-view and app-order behavior.
- Webapp localization foundation based on UTF-8 JSON dictionaries under `src/i18n/`, with English as the default language and Italian available as a persisted option from `Personalizza`.
- Admin App and Groups pages now surface info boxes for orphan apps and incomplete groups, making unassigned apps and groups missing apps/members easier to spot before they cause visibility gaps.

### Changed
- Version bumped to `1.0.1` after the latest UI and menu polish batch.
- Layout: the personal Home view and language selectors now use a stronger dropdown treatment, with the faint accent aura removed so they read more clearly as menus.
- Home: the `Raggruppa` and `Compatta` toggles now swap icons between selected and unselected states so their behavior is easier to distinguish at a glance.
- Layout: choosing the system Home view or language now silently clears the personal override instead of keeping a redundant "reset" state around.
- Home: `Raggruppa` now uses the four-square grid icon when off, a single-window icon when on, and `Compatta` uses the grid icon when off with a distinct icon when on.
- Layout: the personal view and language selects are now styled like the simpler filter dropdowns used elsewhere, instead of a framed menu block.
- Home: `Compatta` keeps the previous non-selected icon style, while only `Raggruppa` uses the new four-square behavior when off.
- Admin Groups: the group detail view now keeps `App visibili` fixed in its own column, while `Membri` and `Gruppi collegati` behave like a click-to-expand accordion on desktop so the active section can take the available height with a single tap on its title.
- Home: the active `Compatta` view toggle now uses a colored sky/cyan gradient instead of a flat black fill, matching the more vivid selected treatment used by the other controls.
- Home and personalization: the Home view labels now consistently use `Card` and `Compatta`, including the toolbar toggle, the personal view picker and the customization dropdown.
- Home: the app counter next to the search field now reads more like a passive label than an action button, reducing the visual suggestion that it is clickable.
- Home: the search field and app counter now sit inside the same white filter bar while the toolbar buttons stay on one line, and the counter is rendered as plain text instead of a pill.
- Theme cleanup: residual emerald-positive badges and status chips were normalized to the lime accent family across the app, including the media library, notices, layout chips and admin status pills.
- Theme: the shared `accent` palette is back to the original lime family, with a darker `accent-dark` so buttons and links stay readable.
- Theme cleanup: generic accent links/buttons now lean on `accent-dark` or dark text instead of pale lime text, while semantic success/status greens stay unchanged.
- UI polish: the app editor shortcut and the media-library link now use safer hover treatments so the lime palette stays readable on hover.
- Admin Groups: the group list rows now use a denser, Users-like layout with slimmer padding, smaller metadata text and tighter count/badge treatment while keeping the same content and actions.
- Admin: the "Aggiungi ai gruppi" modal on app creation/editing now includes a "seleziona tutti i filtrati" bulk action so every visible group can be selected in one shot, matching the Entra import flow.
- Admin and Admin Groups: the "select all filtered" action is now shown only after typing a search term, so it appears when bulk-selecting a filtered result set rather than on the full unfiltered list.
- Admin app editor: existing apps now have a "save and assign groups" shortcut inside the edit modal, so you can jump straight into group assignment without leaving the app flow.
- Admin app list payload: the editor now receives each app's current `groupIds`, so the "save and assign groups" shortcut can correctly detect when the default group is already attached.
- Removed the marketing/product claim from the shared footer and deleted the matching localized strings, leaving only the product name/version and license notice.
- Hidden admin media browser: SVG assets now expose a dedicated "Copy SVG" action so the raw markup can be pasted directly into the App icon editor.
- Media library search and cards now carry the source app name, slug, URL and mode for app icons, so the index can be searched and reopened by the app context rather than only by technical asset id.
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
- Personalizza: the avatar and app-icon cache cleanup buttons now share the same size and icon, and the avatar action was relabeled to "Pulisci cache avatar" for consistency.
- Personalizza: removed the extra avatar-cache helper hint from the "Criteri e preferenze" section and cleaned the unused i18n entries.
- Media Library: delete actions now use the shared confirmation dialog instead of a native browser popup, matching the rest of Frontdoor.
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
- Account menu and Home: resetting the per-user Home view now returns to the global default from Personalizza, not always to the card view.
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
- Account menu: the Home view choice now uses a single-line segmented switch for `Card` / `Compatta` instead of two separate stacked buttons.
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

### Fixed
- Footer: the displayed app version now matches the project bump in `src/config/appInfo.js`, so it no longer stays stuck on `1.0.0` after a release update.
- Layout: the personal menu now hides the restore buttons whenever the selected home view or language already matches the current system default, even if a stale personal override was saved earlier.
- Admin Groups: the Entra import toast now uses the correct singular/plural wording from the active locale, so importing one group no longer shows a plural message.
- Admin Groups: the create-local-group modal now reads the cancel label from the shared common namespace, so the button no longer renders empty when a locale is selected.
- Account menu: changing the personal Home view no longer closes the menu, matching the language selector behavior.
- CI: group app transfer tests now work with both `better-sqlite3` and `node:sqlite` database handles, so the GitHub Actions suite no longer fails on `dbHandle.transaction is not a function`.
- Home: `Compatta` and `Raggruppa` are now mutually exclusive, with the inactive compact state using a different icon so the toggle state is easier to read.
- User avatars: users without a Microsoft or Gravatar photo now receive a generated initials placeholder image instead of a 404, so Chrome no longer logs missing-avatar requests in the console.
- Layout: the top navigation now hides the redundant Home link for plain users, the personal logout action disappears when direct SSO login is enabled, and the "default view/language" badges are no longer shown once the system defaults are already active.
- Admin Users: deleting a user now clears imported Entra membership rows as well, so the delete flow no longer fails with a foreign key constraint after restoring a populated database from another environment.
- RBAC test schema: the in-memory RBAC suite now creates `entra_user_group_memberships`, matching production and unblocking the CI visibility tests.
- Admin app clone flow: when the default group is disabled in the clone modal, the new app is no longer created with the original app's group memberships first. The follow-up group picker now controls the real final memberships, so unchecking a group removes it from the cloned app.
- Admin app table: the "Modo" badge now stays on a single line instead of wrapping when the adjacent columns need more room.
- Backup page: the download flow now reflects the real export stages with live SSE progress, green checkmarks for each included snapshot block and aligned action buttons.
- Backup page: the export and restore cards now keep their primary actions aligned at the bottom, and the export flow shows a progress bar plus checkmarked snapshot contents.
- Backup CTA in Personalizza now uses a database icon, and the page sections support hash links like `#maintenance` for direct jumps.
- Backup CTA in Personalizza now shows an icon again, matching the other actions in the Maintenance block.
- Maintenance backup CTA in Personalizza now uses a proper router link button, so the text renders correctly and opens the backup page cleanly.
- Admin media library: delete is now blocked for assets still referenced by an app or branding setting, while orphaned/old assets remain removable.
- Maintenance in Personalizza now shows a clearer backup/restore CTA button with localized label, so the owner can jump to the backup page directly.
- Backup is owner-only again: the route now matches the original permission model, and the Maintenance block in Personalizza links directly to the backup page.
- Personalizza now shows "Manutenzione" in Italian for the Maintenance section, with a clearer CTA to open Backup and restore.
- The media library is no longer presented as an on-demand-only page. The `/admin/icons` entry is now linked from the app icon cache maintenance box in Personalizza, making it easier for admins to reach.
- Media library: grouped assets now paginate 25 per page by default, with 50/75/100 options and an `Orphans` type filter. Live assets remain the default representative, orphaned members are flagged inside the expandable duplicate list, and groups made only of missing files stay hidden from the main grid unless explicitly filtered.
- Admin Groups: the expanded member/app lists now reserve scrollbar space so long lists do not overlap the right-edge action icons or other nearby elements.
- Media library asset indexing now respects the provided database handle when app icons and branding logos are archived, so isolated test databases and cache stats stay in sync.
- Admin media library previews now render the actual image/SVG first and fall back to the missing-file placeholder only if the browser cannot load the asset URL.
- Admin Users: the imported and detected Entra group badges now read the correct user-section labels and keep the compact pill style in the right-hand Entra groups panel.
- Admin Groups: Entra badges were restored to the original `main` treatment, with bold group names and the small rounded badge style from the pre-regression page.
- Media library assets now fall back to another duplicate with the same content hash when the representative file is missing, so `/admin/icons` and the download link stay usable after partial file loss.
- Media library assets now resolve from the existing app icon and branding caches, and startup refreshes the index instead of copying files into a separate media-library directory.
- Startup migration: existing databases without the new `media_assets.app_slug` column no longer crash on boot; the column is ensured before the related index is created.
- POST SSO redirect: the auto-submitted form was being blocked by helmet's default `form-action 'self'` CSP directive when the target app lived on a different origin (e.g. `autoprompter.coolify.logotel.cloud/api/.../sso-callback`). The `/sso-redirect` handler now sets a per-response CSP that allows `form-action` only towards the configured target app origin, leaving the global CSP untouched.
- Docker image: production runtime now copies the shared language catalog into `/app/shared`, fixing the startup crash introduced by the new language-preference imports.
- App editor: the duplicate action, icon mode buttons, icon helper text and SSO labels are now fully localized; the Customize logo picker text is easier to read, and changing the default language no longer re-translates the page before saving.
- Apps: the connection filter now shows the Entra App option correctly, the group/user confirm dialogs use the localized cancel label, the superadmin deactivate action shows the proper blocked message, and the Customize logo picker now uses translated file controls instead of the browser default text.
- Admin App and Groups: the quick filters now automatically reset back to the full page once there are no more unassigned apps or problematic groups left to show.
- Admin App: the orphan-app info box now reads from the correct `admin.apps` translation namespace, preventing the page from crashing on render.
- Admin App: the orphan-app box now lists the actual unassigned apps and lets you open each app's editor directly from the warning.
- Admin Groups: the incomplete-groups warning now lists the actual problematic group names and lets you jump straight into each group's details.
- Admin App and Groups: the orphan/incomplete alerts now use a shared amber warning banner style so they look more standard and consistent.
- Admin App and Groups: both warning areas now sit apart from the table and expose a compact text link inside the warning box to show only unassigned/problematic items.
- `AdminGroups`: the "Nuovo gruppo da Entra" button no longer crashes the page with `selectedEntraGroups.includes is not a function`. The click handler was passing the React `SyntheticEvent` as the first argument to `openEntraImport`, which since the default-args refactor uses it as the `prefillGroupIds` array — the event object would land in state and break the next render. Wrapped the handler in an arrow function so `openEntraImport()` is called with its defaults.

## [1.1.0] — 2026-04-21

### Added
- **`GET /api/apps/bulk`** (X-API-Key auth): exports full metadata of all apps (active + inactive) for server-to-server sync. Returns id, name, slug, description, long_description, icon, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, tags (parsed JSON), created_at, updated_at. Counterpart of the existing `POST /api/apps/bulk` — together they allow round-trip read/write of the app catalog.
- Personalizza Home: added a global toggle to show menu dates in a more European day/month/year format.
- Personalizza Home: added a global toggle to show menu timestamps in 24-hour format.
- Personalizza page: added a per-user Home desktop view dropdown under the Home section, moved the Mobile section after Criteri, and refreshed the Mobile block icon.
- Layout nav: the account dropdown next to the avatar/name now exposes the per-user Home view preference and writes it to the database.
- Personalizza: added a dedicated Mobile section with a mobile-compact Home default toggle and a mobile-only hero hide toggle.
- Roles: introduced `superadmin`, `admin`, and `admin_readonly`, with compose-defined superadmins kept out of the UI for demotion/deletion.
- Admin UX: added a dedicated `Audit` page for privileged actions, visible only to superadmins, with search, retention filters, and pagination.
- Log pages: added search, period filters, and page-size selection up to 250 rows.
- Audit page: added a superadmin-only admin filter so privileged actions can be narrowed to a single actor.
- Retention: logs and audit rows older than 90 days are purged automatically at startup and then once per day.
- Admin UX: `admin_readonly` users can view admin pages but cannot modify apps, groups, or users.
- Personalizza page: sticky save bar, quick navigation sidebar, and grouped sections for Login, Home, Gestione App and Criteri di conservazione.
- Personalizza page: log retention selector from 0 to 90 days with deferred purge warning, plus avatar cache refresh in the conservation section.
- Personalizza page: save success/error feedback now appears in the sticky bottom bar, and the section navigation no longer breaks the mobile layout.
- Personalizza page: fixed the top spacing of the first visible section by replacing `space-y` with a flex gap so hidden mobile navigation does not add extra margin.
- Personalizza page: added a maintenance action to refresh the cached user avatars for Microsoft/Gravatar updates.
- Personalizza page: aligned the `Home` and `App` section icons with the global top navigation for a consistent look and feel.
- BrandMark: removed the decorative shadow/background treatment so the new transparent favicon artwork renders cleanly.
- Layout nav: renamed the top-level Home entry to `Home` and the admin catalog entry to `App`.
- Admin Users: clarified the role action labels to distinguish `admin completo` from `admin sola lettura`.
- Modal UX: `Esc` closes admin modals, with a discard confirmation when there are unsaved changes.
- Admin branding: new toggle to hide the Home hero banner and a tenant-wide option to skip the login page and go straight to Microsoft SSO.
- Admin UX: replaced browser `confirm()`/`alert()` dialogs with inline page notices and custom confirmation modals in Gestione App, Gestione Gruppi and Gestione Utenti.
- Admin UX: search field in Gestione App and cross-search in Gestione Gruppi for group names plus associated app names/slugs.
- New app mode `entra-app`: launches Microsoft Entra SSO via MyApps launcher (`launcher.myapps.microsoft.com/api/signin/<APPLICATION_ID>?tenantId=<TENANT_ID>`), reusing the `sso_endpoint` field for the Application ID.
- DB migration on startup: expands `apps.mode` CHECK constraint to include `entra-app` for existing databases (table reconstruction pattern).
- `AppCard`: violet `entra` badge for `entra-app` mode apps, consistent with admin panel.
- `AppIcon`: emoji/text icons now rendered inside a fixed-size flex container matching image dimensions, ensuring visual consistency between emoji and SVG/image icons at every size.
- `Home`: compact list view — toggle "Compatta" in toolbar, now backed by the authenticated user's database preference and resettable to the global default; apps rendered as dense horizontal rows with icon, name, description, tags and badges in a single line.
- `AppCard`: extracted shared `InfoModal` component to avoid duplication between card and compact layouts.
- `AppCard`: app icons on the Home card are now clickable and open the app link like the name and description.
- Admin UX: search fields in Gestione App, Gestione Gruppi and Gestione Utenti now include a clear button and support `Esc` to clear the current query.
- Admin UX: the Entra app creation field no longer pre-fills `/sso`; it now starts empty and prompts for the Microsoft Entra Application ID.
- Home page: favorites are now pinned at the top of the grid (above non-favorites).
- Home page: drag-and-drop reordering of app tiles with `@dnd-kit/sortable`; personal order is now persisted per user in the database. Drag handle appears on card hover (top-left grip). Drag is disabled in group-by-tag view and while search/tag filters are active to avoid surprising jumps. Cross-section drags (fav ↔ non-fav) are blocked so the "favorites first" invariant always holds.
- Home page footer shows the build's short commit SHA (e.g. `vd83c54e`). Injected at build time by Vite via a `__COMMIT_SHA__` global, resolved from `git rev-parse --short HEAD` with a fallback to the `VITE_COMMIT_SHA` env var. When neither is available (e.g. Docker builds without `.git` in the context), falls back to a compact UTC build timestamp (e.g. `v20260415-1147`) so the footer always shows a meaningful version string.
- New `POST /api/apps/:slug/track-access` endpoint records an access_logs row for a given app. Authenticated + RBAC-gated. Frontend calls it fire-and-forget from `AppCard.handleClick` before opening the target URL in a new tab. Previously only apps with `mode='redirect'` produced access logs (via the `/sso-redirect` server round-trip); apps with `redirect-plain` or `shared-cookie` modes bypass the server on click and were invisible in the access log. This endpoint closes that gap.
- App icon uploads now support pasted images, pasted SVG, and file upload, with cached assets stored on the data volume and icon rendering falling back to emoji when assets are missing.
- New app creation now only asks whether to include the default group; the follow-up group assignment modal opens only when default is not selected, with search and scroll support for existing Frontdoor groups.
- `Personalizza` now exposes global controls for home branding, badge visibility, and app mode visibility.
- App tags are normalized case-insensitively so tag grouping and filters do not duplicate `AI`/`ai` variants.
- GET `/:slug/entra-redirect` endpoint with RBAC check and access logging, redirecting to the Entra MyApps launcher URL.
- Admin UI: violet "Entra App" mode button, Application ID input field, and `entra` badge in the app table.

### Changed
- **`POST /api/apps/bulk`**: API-key validation extracted into a shared `requireBulkApiKey` helper also used by the new GET endpoint. Now returns **503** when `ADMIN_API_KEY` is not configured on the server (previously surfaced as a misleading generic 401).
- `AppCard` is now a `forwardRef` component and accepts optional `dragHandleProps`, `dragging` and `style` props for sortable integration.
- Dockerfile builder stage now installs `git` so the commit SHA can be resolved inside the Docker build context.
- `.dockerignore` no longer excludes `.git` (required for the commit SHA lookup; trivial build-context size impact).
- Rate limits on `/api/auth/microsoft`, `/api/*` and RBAC mutation endpoints are now tunable via env vars (`AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS`, `API_RATE_LIMIT_MAX`, `API_RATE_LIMIT_WINDOW_MS`, `RBAC_RATE_LIMIT_MAX`, `RBAC_RATE_LIMIT_WINDOW_MS`). Defaults have been significantly raised (auth 10→5000/15min, api 100→6000/min, rbac 120→500/min) to support shared-NAT corporate deployments where hundreds of users share a single public IP.

### Fixed
- Entra App clicks now write only one access log row: the frontend no longer sends the extra `track-access` request for `entra-app`, avoiding the duplicate audit/access entry caused by the server-side redirect already recording the action.
- Account menu and Home reload: `/api/auth/me` now returns the full user preference payload again, so a hard refresh no longer drops the saved app order and its timestamp back to the global default.
- Account menu: custom app order and its saved timestamp are now kept in the local user cache too, so a hard refresh no longer falls back to the global order while the profile rehydrates.
- Account menu: the Home view switch no longer mixes the mobile compact default with the desktop preference, so the highlighted state now matches the actual desktop view.
- Gestione App: the deep-link handler for `?edit=` no longer trips a render-time reference error, so the page loads correctly again.
- `server/db.js`: expands user roles and RBAC audit target types on startup for existing databases, mapping legacy admins to `superadmin`.
- `server/routes/auth.js`: compose-defined admin emails are auto-promoted to `superadmin`, and privileged logins are recorded in the audit trail.
- `server/routes/apps.js`, `server/routes/groups.js`, `server/routes/users.js`, and `server/routes/branding.js` now enforce viewer/editor/superadmin role splits instead of a single `admin` gate.
- `src/components/Layout.jsx` and `src/App.jsx`: admin navigation and routes now hide Log/Personalizza from `admin` and `admin_readonly`.
- `src/pages/AdminLogs.jsx`: log loading now refreshes correctly when search, retention, or page size changes.
- `src/pages/Personalizza.jsx` and `src/components/UserAvatar.jsx`: avatar cache refresh now busts both the server cache and the browser cache-buster so updated Microsoft profile photos appear immediately.
- `server/services/avatars.js`: avatar refresh now prefers Microsoft Graph app-only photos when available, so Gravatar does not win after a cache reset.
- `server/routes/logs.js`: audit log rows now include `actor_id`, so the Audit page can render the actor avatar again.
- `server/routes/logs.js`: Log and Audit timestamps now parse SQLite UTC values correctly before formatting them in the configured `TZ`.
- `server/routes/logs.js`: log retention purge now honours the configured retention setting, including `0` for logless mode.
- `server/db.js` and `server/services/branding.js`: persisted `log_retention_days` in branding settings with a 0-90 day range.
- `src/components/BrandMark.jsx`: updated the app mark to reuse the new `public/favicon.svg` artwork everywhere it is rendered.
- Entra group discovery at login now uses an app-only Microsoft Graph token (`/users/{id}/transitiveMemberOf`) instead of a delegated `/me/transitiveMemberOf` call. On tenants with nested group structures, the delegated path with the minimal `User.Read` scope returns `displayName: null` for transitive memberships, so Frontdoor's cache ended up with IDs instead of names for most groups. The app-only path reliably returns `displayName` for both direct and transitive memberships, using the `GroupMember.Read.All` application permission already required by Force Sync — no additional Azure consent needed.
- `Ripristina applicazioni dimostrative` now reinserts missing demo apps without reusing conflicting IDs, so it appends the demo catalog instead of failing on `apps.id`.
- `Sincronizza gruppi` now resyncs imported Entra groups through app-only Graph group membership reads and surfaces sync errors in the page banner under the Gestione Gruppi header.
- `SortableAppCard` now forwards `showModeBadges` and `compact` props to the underlying `AppCard`. Previously these were silently dropped by the wrapper, so in the drag-enabled home view (default view without filters/grouping/compact) the mode badges (ext / SSO / entra) stayed always visible regardless of the `Mostra badge ext / SSO sulle app` toggle in Personalizza.

### Security
- `server/routes/logs.js`: `JSON.parse` on `rbac_audit_logs.details` wrapped in try/catch — prevents 500 crash on malformed entries.
- `server/routes/auth.js`: removed PII (email) from all `console.log/warn` calls; replaced with opaque IDs (`microsoftId` pre-login, `user.id` post-login).
- `server/routes/auth.js`: user profile data (email, role) no longer passed as URL query param in post-SSO redirect — frontend now calls `/api/auth/me` to retrieve profile via httpOnly cookie, preventing leakage in browser history, server logs and Referer headers.
- `server/routes/auth.js`: replaced SQL string interpolation in role-promotion UPDATE with two separate parameterized statements.
- `server/routes/auth.js`: added comment on single-instance limitation of in-memory CSRF state store.

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
