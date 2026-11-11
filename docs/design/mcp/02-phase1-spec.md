# Frontdoor MCP — phase 1 specification (read)

- Status: draft for review
- Date: 2026-11-03
- Builds on: `01-proposal.md`, ADR 0002, 0003, 0004
- Research: `research/codebase-survey.md`, `research/mcp-spec-and-sdk.md`

Phase 1 lets a signed-in Frontdoor user connect an owner-approved AI assistant
and ask read-only questions, with the same visibility as the UI. The only write
is the user's own preferences. Admin write proposals (phase 2) and log
aggregates (phase 3) are out of scope.

## 1. Scope

In scope:

- OAuth 2.1 authorization server for MCP clients (ADR 0003), with CIMD and
  owner pre-registered clients (ADR 0004).
- `/mcp` Streamable HTTP endpoint on the existing Express process (SDK v2,
  ADR 0002), serving protocol revisions 2026-07-28 and 2025-11-25.
- The fail-closed mediation layer (field projection and pseudonymisation).
- Read tools for `user` and `admin_readonly` (and roles above them); preference
  tools for every user.
- Owner controls (enable, client allowlist, pre-registered clients, kill
  switch) and the per-user "connected assistants" list with revocation.
- Audit, rate limits, documentation of what leaves Frontdoor.

Out of scope: any admin write, log or audit data, plugins exposing tools, DCR,
any IdP other than Entra.

## 2. Decisions taken on the proposal's open questions

| Question | Phase 1 answer | Reason |
| --- | --- | --- |
| Client registration | CIMD + pre-registered (ADR 0004) | Entra has neither DCR nor CIMD |
| Dependency | SDK v2 (ADR 0002) | v1 is maintenance-only |
| Transport | `/mcp` in the same Express process, own limiter | No second deployable, no second trust boundary |
| Pseudonyms | Deferred to the phase that first returns users | No phase 1 tool returns a user: counts only. A key and HMAC nobody uses would be surface without purpose |
| Plugins exposing tools | No | Plugin platform is locked; revisit with its own ADR |
| Preferences without confirmation | Yes, for favourites, colour scheme, language | Self-only and reversible from the UI; audited |

The last three remain open for the maintainers to overturn in review.

## 3. Endpoints

All OAuth and MCP endpoints return `404` while the MCP is disabled, so a
disabled instance advertises nothing.

| Method + path | Purpose |
| --- | --- |
| GET `/.well-known/oauth-protected-resource/mcp` | RFC 9728 metadata: `resource` = `<FRONTEND_URL>/mcp`, `authorization_servers` = [`<FRONTEND_URL>`] |
| GET `/.well-known/oauth-authorization-server` | RFC 8414 metadata: `code_challenge_methods_supported: ["S256"]`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `token_endpoint_auth_methods_supported: ["none","client_secret_basic"]`, `client_id_metadata_document_supported: true`, `authorization_response_iss_parameter_supported: true`, `scopes_supported: ["frontdoor.read","frontdoor.preferences"]` |
| GET `/oauth/authorize` | Validates the request, stores it as a pending authorization bound to this browser, redirects to the SPA consent page `/connect/<id>` (the SPA sends signed-out users through the normal Entra login and back) |
| GET `/api/mcp/authorizations/:id` | Consent page data: client name, client and redirect hosts, requested scopes, fields that leave Frontdoor |
| POST `/api/mcp/authorizations/:id/decision` | Approve or deny, with the scopes the user keeps; strict same-origin, browser-bound; returns the client redirect URL with the code or the error |
| POST `/oauth/token` | `authorization_code` and `refresh_token` grants |
| POST `/oauth/revoke` | RFC 7009 revocation by the client |
| POST `/mcp` | MCP Streamable HTTP; bearer required, `401` with `WWW-Authenticate: Bearer resource_metadata=…` otherwise |
| `/api/mcp/*` | Owner settings, client management, user connections (session cookie, normal RBAC) |

## 4. Authorization server rules

Each rule below gets at least one test.

1. `response_type=code` only; `code_challenge_method=S256` required; `plain`
   or missing → error.
2. `resource` required and must equal the canonical `<FRONTEND_URL>/mcp`
   exactly; the issued token is bound to it.
3. `client_id` is either an allowlisted CIMD HTTPS URL or a pre-registered ID.
   Unknown → error page shown to the user, never a redirect (no open redirect).
   A CIMD document declaring a token endpoint auth method other than `none`
   (ChatGPT declares `private_key_jwt`) is refused, not downgraded: such an
   assistant connects as an owner-registered client. The consent page shows the
   owner's label for the client, never the name the client claims.
4. `redirect_uri` must match a registered or CIMD-declared URI by exact string
   comparison; loopback URIs (`http://127.0.0.1`, `http://localhost`) may vary
   only by port, per RFC 8252. Mismatch → error page, never a redirect.
5. CIMD fetch: HTTPS only, the URL must be on the owner allowlist, the address
   is checked public inside the connection's own DNS lookup (no separate
   pre-check, so no rebinding window), no redirects, 5 s timeout, 64 KiB cap,
   JSON with `client_id` equal to the URL, cached for at most 1 hour.
6. No consent while impersonating (`req.actor` ≠ `req.user`) and no consent for
   inactive users.
7. Consent page: shows client name, client ID host and redirect host, each
   requested scope in plain words, and the list of fields that leave Frontdoor.
   `frontdoor.preferences` has a checkbox, checked by default; unticking it
   grants `frontdoor.read` only (ADR 0006). The
   `/connect/*` SPA route is served with `frame-ancestors 'none'` and
   `X-Frame-Options: DENY`.
8. A pending authorization lives 10 minutes, is single-use, and is bound to
   the browser that started it by an httpOnly cookie holding a random nonce
   (stored hashed). The decision is refused without that cookie, so a
   `/connect/<id>` link forwarded to someone else cannot be approved by them.
   It does not stop an attacker sending a victim the `/oauth/authorize` URL of
   the attacker's own flow: the victim starts a fresh, correctly bound request.
   Whether the code then lands in the attacker's assistant account depends on
   the client binding `state` to its session, which is outside Frontdoor. The
   consent page therefore names the signed-in account and tells the user to
   cancel a connection they did not start (review 2026-11-03, finding 5).
9. The decision endpoint accepts only `Sec-Fetch-Site: same-origin`, stricter
   than the `/api` cross-site guard, which trusts `CORS_ALLOWED_ORIGINS`:
   satellite apps must not be able to approve a consent.
10. `state` is passed back unchanged; `iss` is added to every authorization
   response.
11. Authorization codes: 256-bit random, single-use, 60 s lifetime, bound to
   client, redirect URI, PKCE challenge, resource and user. A replayed code
   revokes every token issued from it.
12. Access tokens: opaque, 256-bit, 10 minute lifetime. Refresh tokens: opaque,
    rotated on every use, 30 days idle, 90 days absolute. Reuse of a rotated
    refresh token revokes the whole grant.
13. Only SHA-256 hashes of codes and tokens are stored. Tokens are never
    logged.
14. Confidential clients authenticate with `client_secret_basic`; secrets are
    stored as hashes, shown once at creation.
15. Scopes (ADR 0006): `frontdoor.read` (read tools) and `frontdoor.preferences`
    (the three `set_*` tools). No scope requested means both. `frontdoor.read` is
    always part of a grant and is added when a request omits it; an unknown scope
    is `invalid_scope`. The decision can only remove `frontdoor.preferences`,
    never add a scope the client did not request. The token response states the
    granted scopes. A refresh may not ask for a scope beyond the grant, and always
    receives the grant's scopes. Re-consenting with the same client replaces the
    grant's scopes.

## 5. `/mcp` request handling

Order: rate limit → body limit (64 KiB) → `Origin` check (present and not the
Frontdoor origin → `403`) → bearer lookup by hash → token not expired, not
revoked, audience = `/mcp`, MCP enabled, client still allowed, user active →
`req.user` loaded from the DB exactly as the session middleware does → tool
dispatch. The session cookie is never read on `/mcp`, and a session JWT sent as
bearer is rejected.

Rate limits: 300 requests/minute per client IP before authentication (so
random bearer values cannot each get a fresh budget), then 60 requests/minute
per connection (grant); `MCP_IP_RATE_LIMIT_MAX`, `MCP_RATE_LIMIT_MAX`,
`MCP_TOKEN_RATE_LIMIT_MAX` (token and revocation endpoints, per IP).

## 6. Mediation layer

- Every tool declares an output projection: an explicit list of fields per
  entity. A projection helper copies only those fields; anything not listed is
  dropped. A test asserts that the serialised output of every tool contains no
  key outside its projection.
- Fields that never leave: tenant ID, client ID, SSO endpoints, `target_url` of
  any app, Entra application IDs, Entra group object IDs (an Entra group
  without a cached display name is counted, not named), branding and security settings, secrets,
  emails, display names, Entra object IDs, IP addresses, user agents.
- App links: tools return the Frontdoor launch URL (`<FRONTEND_URL>` + the
  existing SSO redirect path for the slug), never the target URL. Launching still
  passes through Frontdoor RBAC and SSO.
- Phase 1 returns no user at all, only counts. Pseudonymised references
  (`U-xxxxxxxx`) arrive with the first tool that needs to name users.
- Catalogue text written by admins (app names, descriptions, tags, group names)
  goes out as data inside structured results, never inside tool descriptions or
  instructions. Tool descriptions are static strings in code.

## 7. Tools

Every tool calls the same service functions the HTTP routes use. App
visibility comes from a service extracted from `server/routes/apps.js` (today
inline SQL, copied three times); the routes are switched to it first, with
their existing tests green, before any tool uses it.

| Tool | Minimum role, scope | Input | Output (projection) |
| --- | --- | --- | --- |
| `search_my_apps` | user, read | `query?`, `tag?`, `limit≤50`, `cursor?` | name, slug, description, tags, launch URL, favourite |
| `get_my_preferences` | user, read | — | favourites (slugs), colour scheme, language |
| `set_favorite_app` | user, preferences | `slug`, `favorite: boolean` | updated favourites |
| `set_color_scheme` | user, preferences | `light \| dark \| auto` | updated preferences |
| `set_language` | user, preferences | `en \| it` | updated value |
| `list_apps` | admin_readonly, read | `filter: all \| no_groups \| no_tags`, `limit≤200`, `cursor?` | name, slug, tags, mode, active, group count |
| `get_app_access` | admin_readonly, read | `slug` | groups granting access (name, source, nested local and Entra-linked groups, active users reaching the app through it) and the distinct total |
| `list_groups` | admin_readonly, read | `query?`, `limit≤200`, `cursor?` | name, source, member count, app count |

List tools (`search_my_apps`, `list_apps`, `list_groups`) are paged and never
truncate silently: each answer carries `total`, `hasMore` and, while more items
exist, `nextCursor`. The cursor is an opaque offset bound to the tool and its
filters; with other arguments, or malformed, it is a tool error rather than a
restart from the first page. A cursor past the end, because items were removed
between calls, is an empty last page. Ordering is deterministic (the routes'
order plus a unique tie-breaker). Tool descriptions tell the assistant to follow
`nextCursor` before calling a list complete. (Review round 1, lombax85.)

Tool inputs are validated with strict schemas (unknown keys rejected, string
lengths capped). Tools not allowed for the caller's role, or by the
grant's scopes, are not listed for that caller.

## 8. Data model (new)

Implemented in `server/migrations/mcp.js`.

| Table | Key columns |
| --- | --- |
| `mcp_settings` | single row `default`: enabled (0), updated_by, updated_at |
| `mcp_authorization_requests` | id, client, redirect_uri, state, PKCE challenge, resource, scope, browser_nonce_hash, expires_at (10 min), consumed_at |
| `mcp_clients` | id, kind (`cimd`/`registered`), client_id (unique), name, redirect_uris (JSON), secret_hash (required for `registered`, forbidden for `cimd`), created_by, created_at, disabled_at |
| `mcp_grants` | id, user_id (cascade on user delete), client_id, client_name, scope, created_at, last_used_at, revoked_at, revoke_reason |
| `mcp_auth_codes` | code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at, used_at |
| `mcp_tokens` | token_hash, grant_id, kind (`access`/`refresh`), family_id, resource, expires_at, absolute_expires_at, rotated_at, revoked_at |

Choices made while implementing (2026-11-03):

- MCP settings live in their own table, not in `branding_settings`, because
  `GET /api/branding` is public: MCP state is not branding.
- No column is added to an existing table and the audit `target_type` CHECK is
  not widened: MCP events use `auth` (clients, grants, tokens) and `branding`
  (the owner switch) with `mcp.*` action names. The migration therefore has a
  `down()` that only drops its own tables, with no table rebuild. It is the
  first reversible migration in the repo, tested by up → down → up.
- `mcp_tokens`, `mcp_auth_codes` and `mcp_authorization_requests` are never exported in backups and are
  emptied by every restore, so an old archive cannot revive a revoked token.
  Grants and clients are kept; users reconnect after a restore.
- Expired codes and tokens are purged hourly; revoked grants are removed after
  the log retention period.

## 9. Audit events

`mcp.enabled`, `mcp.disabled`, `mcp.kill_switch` (target type `branding`);
`mcp.client_created`, `mcp.client_disabled`, `mcp.grant_created`,
`mcp.grant_revoked`, `mcp.refresh_reuse_detected`, `mcp.code_replay_detected`,
`mcp.preference_changed` with the client name (target type `auth`).
Read tool calls are counted per grant (`last_used_at`), not logged per call.

## 10. Personal data (GDPR)

| Data | Where | Purpose | Retention |
| --- | --- | --- | --- |
| Grant (user, client, timestamps) | `mcp_grants` | Show and revoke connections; security | Until revoked, then the log retention period |
| Token and code hashes | `mcp_auth_codes`, `mcp_tokens` | Authentication | Purged after expiry |
| Counts of users per group | Sent to the AI vendor | Answer admin questions without identities | Vendor's terms; aggregate, not identifying |

Legal basis is the deploying organisation's (the controller's) decision,
typically Art. 6(1)(f) or 6(1)(b) for workforce tools; Frontdoor's job is to
ship the feature off, minimised, and documented so the DPO can decide.
Phase 1 sends no names, emails, IPs or log rows. The declared limit stands:
what the user types reaches the vendor.

## 11. Threat model (phase 1)

| Threat | Control |
| --- | --- |
| Stolen MCP access token | 10 min life, audience-bound, revocable; at most the user's own preferences can change, and not even those when the user kept the grant read-only |
| Stolen refresh token | Rotation with reuse detection revokes the grant |
| Malicious client tricking a user (confused deputy) | Owner allowlist, per-client consent page naming the signed-in account, exact redirect matching |
| Open redirect via `redirect_uri` | Errors shown as pages, never redirected |
| Clickjacking the consent page | `frame-ancestors 'none'`, `X-Frame-Options: DENY` |
| SSRF via CIMD URL | Allowlist, pinned public address, no redirects, size and time caps |
| DNS rebinding against `/mcp` | `Origin` validation |
| Prompt injection via catalogue text | Read-only tools; data never in tool descriptions; phase 2 writes need human confirmation |
| Privilege drift | Role reloaded from DB on every call; inactive user rejected |
| Impersonation escalation | No consent while impersonating |
| Recon data leak | Fail-closed projection test per tool |
| Token theft from DB | Only hashes stored |
| Abuse / cost | Per-IP limits on `/mcp`, `/oauth/authorize` and `/oauth/token`; per-connection limit on `/mcp`; JSON-RPC batches refused; 64 KiB body cap; result limits; CIMD failures cached |

## 12. Acceptance

- `npm run lint`, `npm test`, `npm run check:i18n`, `npm run build` green, output shown.
- A manual end-to-end connection from at least one real client (Claude Code or
  VS Code via CIMD, with DEV_LOGIN) shown working, plus the disabled-instance
  `404`s shown with `curl`.
- Migration `down()` run and shown.
- Security review of the branch before the PR leaves draft.
