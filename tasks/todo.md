# MCP server — phase 1 plan

Branch: `feat/mcp-server` (fork `amargiovanni/frontdoor-oss`).
Spec: `docs/design/mcp/02-phase1-spec.md`. ADRs 0002–0004.
Status: approved 2026-11-03 (plan and the M1 `npm install`). M0, M1, M2 done.

Each milestone ends with lint, tests, i18n check and build green, a commit, a
push, and this file updated.

## M0 — Prerequisite refactor (no behaviour change)
- [x] Characterisation tests for app visibility through `GET /api/apps`,
      `sso-redirect`, `entra-redirect`, `track-access` (direct, nested, Entra, inactive app)
- [x] Extract `server/services/appCatalog.js` (`listAccessibleAppsForUser`, `userCanAccessApp`;
      the MCP launch URL lands with the tools in M3) and switch the three duplicated `hasAccess` queries to it
- [x] Tests green with no route test modified (284 tests, 283 pass, 1 skip: frontend not built)
- Note: `GET /api/users/:id` keeps its own query on purpose: it lists inactive
  apps too (admin view), so it is a different question, not a duplicate.

## M1 — Dependencies and data model
- [x] `npm install @modelcontextprotocol/server@^2.4.0 @modelcontextprotocol/express@^2.0.2`
      → server 2.4.0, express 2.0.2, core 2.4.0 (Apache-2.0, Node >= 20), zod 4.6.7
      already in the lockfile; 3 packages added; `npm audit --omit=dev`: 0 vulnerabilities
- [x] Reversible migration `server/migrations/mcp.js` (own `mcp_settings` table instead of
      `branding_settings` columns; audit uses existing target types — see spec §8)
- [x] Test: up, down, up again on a populated DB; `down()` run on a real DB file and shown
- [x] Backups never carry `mcp_tokens`/`mcp_auth_codes`; restores empty them (both formats, mutation-checked)
- [x] Hourly purge of expired codes and tokens and of revoked grants past log retention, with a test

- [x] Approved 2026-11-03 and installed: `zod@^4.2.0` (4.6.7, already in the tree) and
      `@modelcontextprotocol/node@^2.1.2` (brings `hono` 4.13.16, `@hono/node-server` 2.1.6);
      `npm audit --omit=dev`: 0 vulnerabilities

## M2 — Authorization server
- [x] Metadata endpoints (RFC 9728, RFC 8414), 404 when disabled
- [x] Client resolution: pre-registered and CIMD (allowlist, connect-time SSRF guard, 1 h cache)
- [x] `/oauth/authorize` → pending request bound to the browser → SPA consent `/connect/:id`;
      decision API strict same-origin; framing headers on `/connect`; impersonation and
      inactive-user refusal
- [x] `/oauth/token` (code + PKCE + resource; refresh rotation and reuse detection)
- [x] `/oauth/revoke`
- [x] Owner API (enable, clients, kill switch) and user connections API
- [x] Tests for every rule in spec §4 (`mcpOAuth`, `mcpClients`, `mcpCrypto`, `networkGuardFetch`);
      mutation-checked: same-origin guard, browser binding, code burning, PKCE
- Found while building: `throw` inside `db.transaction` rolls back the code burn and the
  replay/reuse revocations; the transactions now return the failure and throw outside.

## M3 — MCP endpoint, mediation, tools
- [ ] Bearer middleware for `/mcp` (hash lookup, audience, user reload, Origin, limiter, body cap)
- [ ] Projection helper and pseudonymiser, with the fail-closed output test
- [ ] User tools: `search_my_apps`, `get_my_preferences`, `set_favorite_app`,
      `set_color_scheme`, `set_language`
- [ ] Admin read tools: `list_apps`, `get_app_access`, `list_groups`
- [ ] RBAC tests per tool and role; session JWT rejected as bearer

## M4 — UI and i18n
- [ ] Owner: enable switch, CIMD allowlist, registered clients (secret shown once),
      kill switch
- [ ] User: connected assistants list with revoke
- [ ] en/it strings for UI and every new error code

## M5 — Documentation and review
- [ ] SECURITY.md: MCP data flow, what leaves Frontdoor, declared limit
- [ ] Operator docs: enabling, client setup per assistant (Claude, ChatGPT, VS Code, Copilot Studio manual)
- [ ] CHANGELOG `[Unreleased]` → Added
- [ ] End-to-end check with a real client; `curl` evidence of disabled 404s
- [ ] Security review of the branch; findings recorded in `docs/design/mcp/reviews/`
- [ ] Open draft PR against `BuildBandits/frontdoor-oss` `main` only when asked

## Flagged, not in scope
- `frontdoor_token` is set on `.${BASE_DOMAIN}` and accepted as a bearer on
  `/api`: every satellite subdomain receives a 7-day, non-revocable Frontdoor
  session. To verify whether this is intended for `shared-cookie` mode and
  report separately.
- **Confirmed vulnerability (low):** plugin webhook delivery (`server/services/plugins.js:590`)
  checks the destination with `isPublicDestination` and then calls `fetch`, which resolves
  DNS again: a DNS-rebinding host can pass the check and be reached on a private address,
  with the plugin secret header. Exposure is limited (plugin platform locked, admin-chosen
  URLs). Fix in a separate PR with `publicOnlyLookup` from `networkGuard.js`.
- Removing the "additional SSO providers" roadmap entry is a maintainer
  decision, not part of this branch.
