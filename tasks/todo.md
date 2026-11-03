# MCP server — phase 1 plan

Branch: `feat/mcp-server` (fork `amargiovanni/frontdoor-oss`).
Spec: `docs/design/mcp/02-phase1-spec.md`. ADRs 0002–0004.
Status: approved 2026-11-03 (plan and the M1 `npm install`). M0, M1 done.

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

- Open before M3: mounting the SDK handler on Express needs `toNodeHandler` from
  `@modelcontextprotocol/node` (not yet approved), and tool schemas import `zod`
  directly, so it must become a declared dependency.

## M2 — Authorization server
- [ ] Metadata endpoints (RFC 9728, RFC 8414), 404 when disabled
- [ ] Client resolution: pre-registered and CIMD (allowlist, SSRF-safe fetch, cache)
- [ ] `/oauth/authorize` + consent page + decision (CSRF, framing headers,
      impersonation and inactive-user refusal)
- [ ] `/oauth/token` (code + PKCE + resource; refresh rotation and reuse detection)
- [ ] `/oauth/revoke`
- [ ] Tests for every rule in spec §4, one or more each

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
- `isPublicDestination` resolves DNS separately from the fetch that follows
  (possible rebinding TOCTOU) — check its existing callers separately.
- Removing the "additional SSO providers" roadmap entry is a maintainer
  decision, not part of this branch.
