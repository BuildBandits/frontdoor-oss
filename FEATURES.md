# Frontdoor — Feature Map

A capability-oriented overview of what Frontdoor does. The [README](README.md) covers the elevator pitch and quick start; this document is the structured tour.

Legend: 🛡️ owner-only · 🔧 admin-only · 🕶️ hidden (no nav entry)

---

## Authentication & SSO

- **Microsoft Entra ID (Azure AD) SSO** via OAuth 2.0 Authorization Code flow with PKCE (S256) and a single-use, browser-bound state (`@azure/msal-node`).
- **JWT session cookie** (`httpOnly`, signed) — frontend never sees the raw token.
- **DEV_LOGIN mode** — local development without Azure AD, switched on via env var.
- **Token introspection** endpoint (`POST /api/auth/verify-sso-token`) for satellite apps that do not share the JWT secret.
- **Session profile** endpoint (`GET /api/auth/me`) returns user, preferences, app order, role.
- **Compose-locked owners** — emails in `ADMIN_EMAILS` are auto-promoted at login and cannot be demoted from the UI.
- **Auto-provisioning** — first-time users are created from the Microsoft profile on initial login.

## User Roles

Four role tiers with distinct scopes:

| Role | Capabilities |
|------|--------------|
| `owner` 🛡️ | Everything: branding, logs, audit, backup, retention, log purge |
| `admin` 🔧 | App/group/user CRUD, Entra import & force-sync, role assignments |
| `admin_readonly` | Read-only access to admin pages |
| `user` | App catalog only, with personal preferences |

## App Catalog

- **Card grid** and **compact list** views, toggleable per session.
- **Search** across name, slug, description.
- **Group-by-tag** view for semantic clustering (tags normalized case-insensitively).
- **Favorites** pinned to the top, persisted per user.
- **Drag-and-drop reordering** with timestamped per-user persistence.
- **Live app counter** next to the search field.
- **App icon variants**: emoji, uploaded image, pasted SVG (versioned URLs, disk-cached).
- **App mode badges** on cards (ext / SSO / Entra), toggleable globally.
- **Long Markdown descriptions** in app detail.

## App Connection Modes

How Frontdoor hands the user off to a target application:

- **`redirect-plain`** — plain external link, no auth forwarding.
- **`internal-link`** — plain link to a private IP literal, for rare on-prem/internal targets.
- **`redirect`** — JWT forwarded via GET query or POST form to the app's SSO endpoint. Verified either locally (shared `JWT_SECRET`) or via Frontdoor's introspection endpoint (no secret sharing).
- **`shared-cookie`** — `httpOnly` JWT cookie scoped to a wildcard domain, ideal for `*.example.com` subdomains.
- **`entra-app`** — Microsoft MyApps launcher redirect for native Entra-enrolled apps. Accepts either a UUID or a full `launcher.myapps.microsoft.com/...` URL.

## App Management 🔧

- Create / edit / duplicate / delete apps from `/admin`.
- Auto-suggested slug from name (until manually edited).
- Per-app: name, slug, description, long description, target URL, icon, tags, mode, SSO endpoint & method, sort order, group assignments, active flag.
- `internal-link` mode for rare private-IP targets that must stay reachable through Frontdoor.
- Unlabeled-apps quick filter with live count, surfaced as a discreet badge.
- Orphan-app warning with direct edit links for apps without group assignments.
- Deactivate via `is_active` (hidden from the catalog, history kept); deleting an app removes it together with its permissions and access logs.
- **Restore demo apps** — one-click reset to a seeded showcase set.

## Groups & RBAC 🔧

- **Local groups** with names, descriptions, members, and app permissions.
- **Entra group import** — discover groups from Microsoft Graph and import them as local groups linked by `entra_group_id`.
- **Force-sync** — refresh all Entra group memberships across users (app-only Graph call).
- **Group-of-groups** — composite local groups can include other local groups *and* reference discovered Entra groups directly (without importing them).
- **Transitive membership resolution** — recursive SQL resolves inherited access across the full chain.
- **App-permission transfer** 🕶️ — copy or move all app permissions from one group to another in a single action.
- **Bulk delete**, search across name / members / app slugs, and a default group auto-assigned to new apps.

## Users 🔧

- List, search, role-edit, activate/deactivate, delete (with cascade cleanup).
- **Per-user "visible apps"** modal — see exactly which apps a user can reach and through which group.
- **Avatars** from Microsoft 365 photos with Gravatar fallback and generated initials as last resort. Disk-cached (configurable TTL); prewarm script for batch fetch.
- Compose-locked admins are visibly flagged and cannot be demoted from the UI.

## Personalization (per user)

- **Home view** preference (cards vs compact) with reset-to-system action.
- **App order** persisted with last-saved timestamp.
- **UI language** preference, independent of the global default.
- Selectors live in the account menu, hiding the "reset" affordance when the personal choice already matches the system default.

## Branding & Customization 🛡️

The `/admin/customization` page covers:

- **Hero text** (two lines + subtitle) and per-platform hero visibility toggles (desktop / mobile).
- **Company logo** upload, served from a stable URL.
- **Default home view** and **default UI language** for users who haven't set a personal preference.
- **Mobile compact forcing** option.
- **Date format** (DD/MM/YYYY vs MM/DD/YYYY) and **24-hour time** toggle.
- **App-mode badge visibility** on cards.
- **Connection-mode availability** toggles in the admin editor (Shared Cookie / Redirect SSO / Entra App).
- **SSO login-page bypass** — skip the welcome page and go straight to Microsoft.
- **Log retention** slider (0–90 days; `0` = logless mode).
- **Cache maintenance** — refresh avatar cache, clear app-icon cache, with size and file count stats.
- **Access log clear** — one-shot purge of access logs (audit log untouched).

## Access Logs & Analytics 🛡️

- Access events are recorded on every app open across all connection modes (`access_logs` table).
- `/admin/logs` viewer: paginated (50–250/page), search by email / app / IP, period filter (1 to 90 days), timezone-aware rendering.
- **Top apps** analytics — most-accessed apps in the selected period with click counts.
- Unique-users metric per period.

## Audit Trail 🛡️

- `rbac_audit_logs` captures privileged mutations: role changes, user activation, group/app edits, branding updates, cache refresh, backup operations.
- Stored fields: actor, action, target type & id, JSON details, timestamp. Updates store only the fields that changed (`changes: [{ field, from, to }]`); saves that change nothing are not logged. Details keep a snapshot of the names of the users, groups and apps involved (`refs`), so rows stay readable after deletions.
- `/admin/audit` page with actor filter, period filter, and pagination matching the access-log UI. Each row reads as a sentence (who did what to which entity, by name), with changed fields as `old → new`; the raw JSON can be copied or expanded.

## Retention 🛡️

- Single slider (0–90 days) drives both access and audit logs.
- Purge runs at startup and daily; saving a stricter retention shows a deferred-purge warning.
- Setting `0` enters **logless mode** and clears existing rows.

## Media Library 🕶️🔧

- `/admin/icons` (hidden, linked from Customization) indexes every app icon and branding logo currently on disk.
- **Content-hash deduplication** — assets shared across apps appear as a single card with merged occurrences.
- Filter by kind (app-icon / branding-logo) and orphan status; search by app, filename, or ID.
- Inline preview, **copy asset link**, **copy SVG markup**.
- Referential-integrity guarded deletion — assets still in use cannot be removed.
- **Large icons** — app icons over 200 KB are listed at the top; **Optimize icons** shrinks the PNG, JPEG and WebP ones to at most 256 px in the browser and saves them on their apps (audited). The same list appears in the startup log.

## Backup & Restore 🛡️

- `/admin/backup` produces a streamed `.tar.gz` archive (optionally encrypted, `.tar.gz.enc`) with the database rows and schema, app icons, the branding logo, the avatar cache and plugin files, plus the Frontdoor version and commit; the export reads one consistent snapshot without blocking writes.
- **Streaming export** via Server-Sent Events: per-stage progress (database → icons → branding → avatars) with completion checkmarks and download link.
- **Check before restore** describes an archive without changing anything; **restore** is atomic and version-aware, with a destructive-action confirmation. Older `.json.gz` backups can still be checked and restored.
- Raw database export (`.db`) under *Advanced options*, and `npm run backup:rehearse` to rehearse an upgrade on a copy.

## Bulk App API

For CI / automation pipelines that own the app catalog:

- `GET /api/apps/bulk` — full metadata export (active + inactive).
- `POST /api/apps/bulk` — upsert in one call.
- `X-API-Key` authentication with a shared `requireBulkApiKey` helper; the endpoints respond `503` when `ADMIN_API_KEY` is not configured.

## Internationalization

- Languages: **English** (default) and **Italian**.
- Global default in branding; per-user override in the account menu.
- All admin pages, modals, validation messages, and role labels are localized.

## Security & Hardening

- **Helmet CSP** with per-response form-action allowance for SSO POST redirects.
- **Parameterized SQL** throughout (no string interpolation).
- **DOMPurify** sanitization for pasted SVG icons and rich text.
- **HTML tag stripping** in user-supplied text fields.
- **OAuth state** stored in SQLite (single-use, 10-minute TTL) and bound to the browser with an httpOnly nonce cookie; PKCE (S256).
- **Cross-site request check**: requests that change data with the session cookie must come from Frontdoor or an allowlisted origin.
- **Rate limiting** on auth, API, RBAC mutations, and the introspection endpoint; the first three are tunable via env vars, the introspection limit is fixed (120/min).
- **No PII in logs** — emails, names, tokens never written to `console.log` / `console.error`.
- **Environment validation** at startup with fail-fast on missing secrets.

See [SECURITY.md](SECURITY.md) for the disclosure policy and threat model details.

## Database

SQLite (better-sqlite3) in WAL mode with foreign-key enforcement. Schema covers users, apps, groups, group memberships (local + Entra + group-of-groups), app permissions, access logs, audit logs, branding settings, media-asset index, and Entra-group caches. Auto-seeded with demo apps on first startup.

## Deployment

- **Docker multi-stage** build (Node 24 base, production image).
- **Node.js 24** runtime, **Express 5** server, **Vite 8** build for the **React 19** frontend styled with **Tailwind CSS 4**.
- Configuration through `.env`:
  - Node-mode example: `.env.example.node`
  - Docker-mode example: `.env.example.docker`
- Timezone configurable per tenant and per user in the app.
- Static assets served from `dist/` with SPA fallback in production.

## Admin Page Map

| Path | Audience | Purpose |
|------|----------|---------|
| `/admin` | 🔧 admin | App CRUD, search, filters, group assignments |
| `/admin/groups` | 🔧 admin | Local and Entra groups (source filter), Entra import / force-sync, linked groups |
| `/admin/group-transfer` | 🕶️ 🔧 admin (editors) | Copy or move all app permissions from one group to another |
| `/admin/users` | 🔧 admin | Users, roles, activation, group membership, visible-apps view |
| `/admin/logs` | 🛡️ owner | Access log + top apps analytics |
| `/admin/audit` | 🛡️ owner | RBAC audit trail |
| `/admin/customization` | 🛡️ owner | Branding, defaults, retention, cache maintenance |
| `/admin/backup` | 🛡️ owner | Export / restore snapshots |
| `/admin/icons` | 🕶️ 🔧 admin | Media library browser (hidden) |
| `/admin/plugins`, `/admin/plugins/docs` | 🔧 admin | Plugin registry and docs (platform locked off) |
| `/admin/plugins/audit` | 🛡️ owner | Plugin audit trail |
