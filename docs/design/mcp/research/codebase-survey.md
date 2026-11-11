# Codebase survey for the MCP server

- Date: 2026-11-03
- Method: read-only subagent survey of `server/` and `test/` at commit eebc93a.

## 1. Auth
- **Issued:** `server/routes/auth.js:355-372`, at the end of the Microsoft callback (`auth.js:187`). It calls `jwt.sign({ userId, email, name, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN || '7d', issuer: JWT_ISSUER || 'frontdoor' })`. The algorithm is the HS256 default.
- **Cookie:** `frontdoor_token`, set with `httpOnly`, `secure` only when `NODE_ENV=production`, `sameSite: 'lax'`, `domain: .${BASE_DOMAIN}` (a wildcard shared with satellite apps) and `maxAge` of 7 days, hardcoded even if `JWT_EXPIRES_IN` differs.
- **Logout:** `auth.js:532-539`. It clears the cookie and ends any impersonation session.
- **Verify:** `server/middleware/auth.js:75-141`. It reads `Authorization: Bearer` first (`:80`), then the cookie (`:82`). It checks HS256 and the issuer, and rejects tokens that have an `aud` claim or no `userId` (`:92-98`), because `aud` marks the per-app SSO tokens. On every request it reloads the user from the DB with `is_active = 1` (`:10-16`). So role changes and deactivation apply at once, and the role claim in the JWT is not trusted.
- **Revocation:** there is no token version, `jti` or session table. A token stays valid until it expires unless the user is deactivated or deleted. Logout only clears the cookie.
- **Other JWTs on the same secret:**
  - SSO token: `apps.js:126-140`. Claims are `sub, email, name, role, aud=slug`, lifetime 5 minutes.
  - Impersonation cookie: `services/impersonation.js:83-90`, `aud: 'frontdoor-impersonation'`.
  - Introspection: `POST /api/auth/verify-sso-token` (`auth.js:636`, limited to 120/min) using `services/verifySsoToken.js`.
- **JWT_SECRET (`server/config.js`):**
  - Required unless dev login is on (`:102-104`).
  - It must be at least 32 characters, or startup errors (`:134-140`).
  - Known placeholder values are rejected (`:9-14`, `:141`).
  - With dev login on and no secret, it falls back to `'frontdoor-dev-secret-do-not-use-in-production'` (`:114-116`).
  - It is redacted in the startup config dump (`:88`).
- **DEV_LOGIN:** `isDevLoginEnabled()` requires `DEV_LOGIN==='true' && NODE_ENV!=='production'` (`config.js:93-95`). `POST /api/auth/dev-login` (`auth.js:568-630`) takes `body.role` (default `owner`) and upserts `dev-<role>@frontdoor.local` in the default group. It signs the same JWT and sets the cookie with `secure: false` and no domain on localhost. `GET /api/auth/dev-status` is at `:562`.
- **Impersonation (`middleware/auth.js:34-72`, `:116-131`):**
  - `req.actor` is always the real admin. When a valid `frontdoor_impersonation` cookie is present, `req.user` becomes the target user.
  - That cookie is host-only, `sameSite: 'strict'`, and backed by the `impersonation_sessions` row.
  - `req.impersonation` holds `{ sessionId, actor, expiresAt, reason }`.
  - The cookie is only honoured for same-origin requests (`isFrontdoorRequest`, `:22-32`).
  - The target must have role `user`, and the impersonator must be `owner`, `admin` or `admin_readonly` (`services/impersonation.js:12`).
  - All non-GET requests are blocked with 403 `impersonation_read_only` and audited as `write_blocked` (`:61-72`). App launches are blocked separately (`apps.js:30-33`).
  - The timeout is 30 minutes by default, clamped to 5–240 (`config.js:48-57`), and capped at the admin's token expiry.

## 2. RBAC
- **Roles:** `owner`, `admin`, `admin_readonly`, `user`. There is a CHECK on `users.role` (`db.js:26`) and constants in `middleware/auth.js:156-162`.
- **How roles are set:**
  - Stored in `users.role` and never computed.
  - Users whose email is in `ADMIN_EMAILS` are promoted to `owner` at startup (`db.js:641-646`) and at login (`auth.js:282,305`).
  - `owner` cannot be assigned from the web app (`users.js:260`).
  - The last editor (owner or admin) cannot be demoted, deactivated or deleted (`users.js:264,307,341`).
- **Middleware:** `authorize(...roles)` (`auth.js:144`), `isOwner`, `isAdminViewer` (owner, admin, admin_readonly), `isAdminEditor` (= `isAdmin`: owner, admin).
- **App visibility:** `getAccessibleGroupIdsForUser(userId)` in `server/services/groupHierarchy.js:7-32` is a reusable recursive CTE. It covers direct local membership, Entra memberships, and parents reached through `group_group_memberships` and `group_entra_group_memberships`. Turning group IDs into apps happens inline in the route:
  - The list query joins `app_permissions` with `is_active = 1` (`apps.js:37-64`). This applies to admins too.
  - The per-app `hasAccess` SQL is copied three times (`apps.js:76-82`, `187-193`, `243-249`).
  - The URL each app gets is derived inline (`apps.js:55-59`).
- **Route handlers:** almost all business logic is inline SQL in the handlers. Services hold only part of it: `groupHierarchy`, `groupAppTransfer`, `entraGroups`, `entraDirectory`, `userPreferences`, `auditDetails`, `notifications`.

`server/routes/apps.js`:

| Method + path | Required role | Logic |
|---|---|---|
| GET `/` (`:37`) | any authenticated user | service for group IDs, inline SQL for apps |
| GET `/:slug/sso-redirect` (`:67`) | any authenticated user | inline (RBAC check, access log, JWT) |
| GET `/:slug/entra-redirect` (`:178`) | any authenticated user | inline |
| POST `/:slug/track-access` (`:235`) | any authenticated user | inline |
| POST `/:id/clone` (`:281`) | Editor | inline (returns a draft) |
| GET `/:id/icon` (`:307`) | public | service |
| GET `/all` (`:316`) | Viewer | inline |
| POST `/restore-defaults` (`:348`) | Editor | service (`demoApps`) |
| POST `/` (`:480`) | Editor | inline, with validation from `shared/appSlug.js` and `shared/targetUrl.js` |
| PUT `/:id` (`:572`) | Editor | inline |
| POST `/:id/groups` (`:684`) | Editor | inline transaction |
| DELETE `/:id` (`:747`) | Editor | inline |
| GET and POST `/bulk` (`:786`, `:808`) | `x-api-key` equal to `ADMIN_API_KEY` (`:769-781`); audit actor is `'api-key'` | inline |

`server/routes/groups.js` (Viewer for GET, Editor for everything else):
- GET `/` (`:64`), GET `/entra/candidates` (`:96`, uses `listDiscoveredEntraGroups`), GET `/:id` (`:280`).
- POST `/entra/import` (`:101`, service), POST `/entra/force-sync` (`:121`, service).
- POST `/:id/convert-to-local` (`:156`), POST `/entra-links/:entraGroupId/convert-to-local` (`:194`).
- POST `/bulk-delete` (`:231`), POST `/` (`:315`), PUT `/:id` (`:335`), DELETE `/:id` (`:383`).
- POST and DELETE `/:id/groups` (`:408`, `:528`), POST and DELETE `/:id/entra-groups` (`:472`, `:545`).
- POST and DELETE `/:id/members` (`:566`, `:615`), POST and DELETE `/:id/apps` (`:634`, `:666`).
- POST `/:id/apps/transfer` (`:679`, uses the `transferGroupApps` service).
- Everything not marked as a service is inline SQL. Name validation is a local helper (`:27-41`).

`server/routes/users.js`:
- Viewer: GET `/` (`:37`), GET `/:id` (`:164`).
- Editor: GET `/directory/search` (`:54`) and POST `/preonboard` (`:65`), both using the `entraDirectory` service; PUT `/:id/preferences` (`:96`, uses `createPreferenceUpdate`); PUT `/:id/role` (`:237`), PUT `/:id/active` (`:277`), DELETE `/:id` (`:323`).
- Authenticated, any role: GET `/:id/avatar` (`:79`).
- Everything not marked as a service is inline.

`server/routes/logs.js` (all Owner):
- GET `/` (`:307`), POST `/clear-access` (`:310`), GET `/top-apps` (`:321`), GET `/audit` and `/rbac-audit` (`:344`, `:347`).
- The loaders `loadAccessLogs` (`:202`) and `loadAuditLogs` (`:254`) are named, but take `(req, res)`. The filter builders `buildAccessWhere` and `buildAuditWhere` (`:112`, `:155`) are pure functions but not exported. Only `purgeLogsOlderThan` and `purgeAccessLogs` are exported.

Other route files:
- branding: PUT and the maintenance routes are Owner.
- backups: all Owner.
- plugins: Viewer and Editor, with approve and revoke as Owner.
- notifications: Viewer, with resolve as Editor.
- media-assets: Viewer, with delete as Editor.
- impersonation: authenticated, with eligibility checked in the service.

## 3. DB (`server/db.js`)
- **Setup:** one better-sqlite3 handle with WAL, `foreign_keys = ON` and `busy_timeout = 5000` (`:12-17`).
- **Tables (`:20-262`):**
  - `users` (`:21`). Preferences are columns on it: `home_desktop_view`, `preferred_language`, `preferred_timezone`, `preferred_color_scheme`, `app_order`, `favorite_apps`, `home_tour_seen_at`. `entra_missing_since` is added at `:619`.
  - `apps` (`:43`), with `mode` in `redirect`, `redirect-plain`, `internal-link`, `shared-cookie`, `entra-app`, plus `sso_endpoint`, `sso_method`, `tags` (JSON) and `icon_file_name`.
  - `branding_settings`, a single row with `id = 'default'` (`:61`, seeded at `:598`).
  - `access_logs` (`:88`), `media_assets` (`:97`).
  - Groups: `user_groups` (`:114`, with entra and deleted-snapshot columns), `user_group_members`, `app_permissions`, `group_group_memberships`, `group_entra_group_memberships`, `entra_group_cache`, `entra_user_group_memberships`.
  - `rbac_audit_logs` (`:164`), `impersonation_sessions` (`:175`), `auth_pending_states` (`:189`, OAuth state plus PKCE verifier and hashed nonce).
  - `plugin_registry` (`:194`), `notifications` and `notification_reads` (`:217-234`).
- **Migrations:** there are no version numbers, no `user_version` and no `down()`. On every boot `db.js` runs:
  - `CREATE TABLE IF NOT EXISTS`.
  - `ensureColumn` / `addColumnIfMissing` (`:264-278`), which checks `PRAGMA table_info` and then runs `ALTER TABLE ADD COLUMN`.
  - Rebuild-by-detection blocks that inspect `sqlite_master.sql` text and call `runTableRebuild` (`:282-296`): create `_new`, copy, drop, rename inside a transaction, with foreign keys turned off.
  - Data backfills (`:564-616`).
  - Tests for this are in `test/dbMigrations.test.js`.
- **Owner toggles:** there is no generic key-value table. Toggles are columns on `branding_settings`: `plugins_enabled`, `show_shared_cookie_mode`, `show_redirect_sso_mode`, `show_entra_app_mode`, `hide_login_page`, `log_retention_days`, and others. They are read and written through `getBrandingSettings` / `updateBrandingSettings` in `server/services/branding.js`.

## 4. Audit
- **Writer:** `logRbacAudit(actorId, action, targetType, targetId, details = null, impersonationSessionId = null)` at `db.js:665-673`. It never throws. It inserts into `rbac_audit_logs` (`actor_id`, `action`, `target_type`, `target_id`, `details` JSON, `impersonation_session_id`, `created_at`).
- **Allowed `target_type` values** (CHECK at `db.js:168`, extended by a rebuild at `:503-528`): `group`, `membership`, `permission`, `role`, `user_status`, `app`, `branding`, `auth`, `plugin`, `impersonation`. Adding a new value means another table rebuild.
- **Who gets audited:** logins are audited only for admin roles (`auth.js:345`).
- **`services/auditDetails.js`:** pure helpers that take a DB handle (this avoids an import cycle).
  - `withAuditRefs` snapshots entity names into `details.refs`, using `ID_KEYS` such as `userId`, `groupIds`, `appId` (`:8-21`, max 500 IDs per type), so rows stay readable after deletes or renames.
  - `collectAuditIds` and `lookupAuditNames` are used by the logs view.
  - `diffAuditFields(before, after, fields)` produces `[{ field, from, to }]` for update rows.

## 5. Express wiring (`server/app.js`, `createApp()` at `:26`)
Middleware runs in this order:
1. `trust proxy 1`.
2. helmet with CSP (`:31-42`): default and script `'self'`; style `'self' 'unsafe-inline'` plus Google Fonts; font `'self'` plus fonts.gstatic; connect `'self'`; img `'self' data: https:`.
3. cookieParser.
4. cors (`:45-55`), added only if `CORS_ALLOWED_ORIGINS` is set, with `credentials: true`.
5. Cross-site write guard on `/api` (`:66-73`). It applies only to non-GET requests that carry the `frontdoor_token` cookie. It allows `sec-fetch-site` of `same-origin` or `none`, or an `origin` in the allowlist or matching `FRONTEND_URL`. Otherwise it returns 403 `cross_site_request`. Requests authenticated with a Bearer header and no cookie skip it.
6. `express.json({ limit: '5mb' })`, then a shim that sets `req.body = {}` when it is undefined.
7. Rate limiters (env-tunable through `parsePositiveInt`):
   - `/api/auth/microsoft`: 5000 requests per 15 minutes (`AUTH_RATE_LIMIT_*`).
   - `rbacMutationLimiter` on `/api/groups` and `/api/users`: 500 per minute, GET skipped (`RBAC_RATE_LIMIT_*`).
   - `/api/`: 6000 per minute (`API_RATE_LIMIT_*`).
   - The verify-sso-token limiter (120/min) is defined in `auth.js`.
8. `GET /api/health`.
9. `/api/plugins/files` static, then the routers mounted at `:138-148` (auth, impersonation, branding, apps, backups, media-assets, plugins, users, groups, logs, notifications).
10. JSON 404 for unknown `/api` paths, then the `dist` static files and the SPA fallback.
11. Error handler (`:162-169`): `URIError` becomes 400, anything else goes to the default handler.

`services/errors.js` defines `UserFacingError(message, { statusCode, code, hint, details })` with `expose = true`. `respondWithError(res, err, fallback)` passes exposed errors through and turns everything else into `{ error: humanized code, code }`. Responses everywhere have the shape `{ error, code }`.

## 6. Tests
- **Runner:** `npm test` runs `node --import ./test/setup.js --test test/*.test.js` (`package.json:18`).
- **`test/setup.js`:** gives each test process a temporary `DATABASE_PATH` and cache, branding and plugin directories. It deletes `JWT_SECRET`, `ADMIN_EMAILS`, `DEV_LOGIN`, `CORS`, `FRONTEND_URL`, the `AZURE_*` variables and others, and adds an import hook for JSON imports.
- **Pattern** (`test/http.test.js:9-38`, `test/rbacHttp.test.js:7-42`): set `JWT_SECRET`, then dynamically import `server/db.js` and `createApp`, insert users with the wanted role straight into the DB, sign a token, listen on port 0, and call it with `fetch` using a Bearer header:
```js
process.env.JWT_SECRET ||= 'http-test-secret-0123456789abcdef';
const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
db.prepare('INSERT OR REPLACE INTO users (id,email,display_name,role,is_active) VALUES (?,?,?,?,1)').run(id, email, name, role);
const token = jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
fetch(`${baseUrl}/api/apps`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
```
- **Shared helper:** none. Each file defines its own `createUser` / `tokenFor`. `rbacHttp.test.js` seeds groups, nested and Entra links, and permissions with raw SQL.

## 7. Sensitive fields
- **Tenant ID, client ID, client secret:** environment only (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`), used in `auth.js:30-39`, `services/entraGroups.js:75-102` and `services/avatars.js:107-139`. The tenant ID appears in Entra launcher URLs (`apps.js:226`). They are redacted at startup (`config.js:84-86`).
- **Graph tokens:**
  - The delegated `tokenResponse.accessToken` is used only during the callback (Graph `/me`, avatar) and is not saved.
  - The app-only token from `acquireGraphAppToken` is cached in memory as `cachedGraphAppToken` (`avatars.js:135`).
  - No Graph token is stored in the DB.
- **Other secrets:** `plugin_registry.backend_secret` (`db.js:206`, `plugins.js:323,368`); `ADMIN_API_KEY` in the environment; PKCE verifiers in `auth_pending_states`; `JWT_SECRET`.
- **App URLs:** `apps.target_url`, `sso_endpoint` (for entra-app mode this is the Entra application ID), and `media_assets.app_target_url`. `GET /api/apps` returns `target_url` to every user (`apps.js:44`).
- **"internal-link":** an app mode whose `target_url` must be a private IP literal (`shared/targetUrl.js:71-74`, code `target_url_private_ip_required`). Every other mode rejects private networks. So these entries reveal internal network addresses. They are linked directly with no SSO (`apps.js:58`). A mode visibility toggle is consulted at `apps.js:390`.

## 8. Personal data
- **`users`:** `email`, `display_name`, `microsoft_id` (the Entra object ID), `avatar_color`, the preference columns, `last_login`, `last_activity_at`, `entra_missing_since`. Avatars are cached on disk (`services/avatars.js`).
- **`access_logs`:** `user_id`, `ip_address` (`req.ip`), `user_agent`.
- **`impersonation_sessions`:** `ip_address`, `user_agent`, `reason`.
- **Audit details:** `email` (`users.js:317,352`), and `ipAddress`/`userAgent` for impersonation start (`impersonation.js:45`).
- **Tokens:** the session JWT carries `email`, `name` and `role`.
- **Other:** `entra_user_group_memberships`, and the notification payload with email and display name (`auth.js:270-275`).
- **Retention:** `log_retention_days` (default 90) drives `purgeLogsOlderThan` (`logs.js:75`).

## 9. i18n and roadmap
- **`scripts/check-i18n.mjs`:** checks only `src/i18n/en.json` and `it.json`, for duplicate keys and key parity. It does not check server messages.
- **Server messages:** they stay in English, but `test/apiErrors.test.js:46-71` scans every `server/**/*.js` and `shared/**/*.js` file for `code: '...'`, `|| 'failed_to_*'`, `archiveError(`/`pluginError(` and the slug and target-URL code maps. It fails unless `ui.errors[code]` exists in both en and it. Any new error code in server code therefore needs translations in `src/i18n/*.json`.
- **CHANGELOG.md:**
  - `[Unreleased]` at `:7`.
  - Roadmap at `:658`, including `- [ ] Support for additional SSO providers (Google, SAML)` (`:660`) and `- [ ] Enable the plugin platform`.
  - MCP is not mentioned. The only AI mention is incidental, about tag normalization (`:597`).
- **MCP design:** the only existing MCP design is `docs/design/mcp/01-proposal.md`, dated 2026-11-02, status "proposal, open questions pending".