# MCP server — plan

Branch: `feat/mcp-server` (fork `amargiovanni/frontdoor-oss`).
Spec: `docs/design/mcp/02-phase1-spec.md`. ADRs 0001–0004 accepted 2026-11-03 (ledger `docs/adr/accepted.ledger`).
Status: approved 2026-11-03 (plan and the M1 `npm install`). M0–M5 done; PR ready to open.

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
- [x] Bearer middleware for `/mcp` (hash lookup, audience, user reload, Origin, IP and
      per-grant limiters, 64 KiB body cap), mounted before the global JSON parser
- [x] Projection helper with the fail-closed output test (mutation-checked); pseudonymiser
      deferred: no phase 1 tool returns users
- [x] User tools: `search_my_apps`, `get_my_preferences`, `set_favorite_app`,
      `set_color_scheme`, `set_language`
- [x] Admin read tools: `list_apps`, `get_app_access`, `list_groups`; the admin group and
      app list queries moved into `groupCatalog`/`appCatalog` and the routes use them;
      `get_app_access` checked against `userCanAccessApp` for every user
- [x] RBAC tests per tool and role; session JWT rejected as bearer; MCP token rejected on `/api`
- Found while building: the first rate limiter keyed on the unverified bearer, so random
  tokens each got a fresh budget; split into a per-IP limit before auth and a per-grant one after.

## M4 — UI and i18n
- [x] One page `/assistants` (account menu): the user's connections with disconnect; for the
      owner also the switch, endpoint, approved assistants (CIMD or registered, secret shown
      once), removal and the kill switch
- [x] Consent page `/connect/:id` and error page `/connect?error=`
- [x] en/it strings for UI and every new error code
- [x] Local end-to-end check with a real browser: `docs/design/mcp/reviews/2026-11-03-e2e-local.md`

## M5 — Documentation and review
- [x] SECURITY.md pointer to `docs/mcp.md` (data flow, what leaves Frontdoor, declared limit)
- [x] Operator docs `docs/mcp.md`: enabling, client setup per assistant, personal data, config; FEATURES.md
- [ ] Web docs page in BuildBandits/frontdoor.buildbandits.com (follow-up PR there)
- [x] CHANGELOG `[Unreleased]` → Added, Changed
- [x] End-to-end check: real browser + `curl` client, disabled 404s (`reviews/2026-11-03-e2e-local.md`);
      a commercial assistant against a public https staging instance is still to do
- [x] Security review of the branch: no critical/high; 1 medium and 5 low fixed, info items fixed
      or accepted — `docs/design/mcp/reviews/2026-11-03-security-review.md`
- [x] PR description drafted: `tasks/pr-mcp-phase1.md`
- [x] PR opened 2026-11-03 as draft, moved to review by the author: https://github.com/BuildBandits/frontdoor-oss/pull/167
- [x] Tracking issue opened 2026-11-04: https://github.com/BuildBandits/frontdoor-oss/issues/171 (#167 is "Part of #171")
- [x] Split 2026-11-04, before any review had started: design docs and ADRs moved to their own
      documentation-only PR, https://github.com/BuildBandits/frontdoor-oss/pull/172 (branch
      `docs/mcp-design`); `feat/mcp-server` rewritten to stack on it (tree verified identical to the
      pre-split state, all commits signed off) and force-pushed. #167 merges after #172.
- [x] Phase 2 first-step spec (`docs/design/mcp/04-phase2-spec.md`), review page mockup and ADR 0005
      added to #172; ADR 0005 accepted by the author on 2026-11-04.
- [ ] Not mergeable until the `networkGuard.js` overlap with #168 is decided (see the PR description):
      merge #168 first, rebase, reuse its helper; decide where the extra IPv6 ranges go

## Review round 1 — lombax85, 2026-11-10

Three comments: two on #167 (scope naming, result completeness), one on #172
(future of the `ADMIN_API_KEY` bulk endpoints). Status: plan awaiting confirmation.

Branch logistics: design documents and ADRs live in #172 (`docs/mcp-design`);
code, tests, `docs/mcp.md` and CHANGELOG live in #167 (`feat/mcp-server`). Each
R-block changes #172 first, then rebases `feat/mcp-server` onto it and
force-pushes both. Each block ends with lint, tests, i18n check and build green.

### R1 — Two scopes, chosen at consent (#167, decided 2026-11-11)

Decision: `frontdoor.read` becomes strictly read-only. The three `set_*` tools
move to a new `frontdoor.preferences` scope. On the consent page, the user can
untick `frontdoor.preferences` even when the client requests it. Nothing is in
production yet, so no grant migration is needed.

- [ ] ADR 0006 "Split the MCP scope into read and preferences, chosen at consent"
      (Proposed, drafted with `adr-management`), in #172
- [ ] Phase 1 spec §OAuth and §tools, and phase 2 spec (`frontdoor.propose` joins a
      multi-scope model), in #172
- [ ] Tests first (red): scope parsing (subset, unknown, empty → default, order,
      duplicates); `/oauth/token` and refresh return the granted scope, not the requested
      one; refresh cannot widen; `/mcp` lists only tools allowed by the grant; a
      `set_*` call on a read-only grant is refused; the consent decision cannot add a scope
      the client did not request; PRM and AS metadata list both scopes
- [ ] `config.js`: scope constants and the tool → scope map; `oauth.js`: parse a set,
      store the granted set on the grant, downscope on consent, `scope` in the token response
- [ ] Bearer middleware puts the granted scopes in the tool context; `tools.js` registers
      the `set_*` tools only with `frontdoor.preferences`
- [ ] Consent page `/connect/:id`: one line per requested scope, the preferences line has
      a checkbox (checked by default), `frontdoor.read` is mandatory; en/it strings
- [ ] `/assistants`: each connection shows its granted scopes
- [ ] `docs/mcp.md`, CHANGELOG `[Unreleased]`
- [ ] Browser check of the consent page with both outcomes; `curl` token response shown

### R2 — Result completeness (#167)

- [ ] Tests first (red): 205 apps with `limit` 200 → `hasMore: true` and a cursor that
      returns the remaining 5; default limit and maximum covered for `list_apps`,
      `list_groups`, `search_my_apps`; a filter combined with a cursor; a malformed or
      out-of-range cursor → tool error, never silently restarting from the first page
- [ ] Stable ordering (name, then slug) and an opaque `nextCursor` (offset-based: the
      lists are small and in-memory); every result carries `total`, `hasMore`, `nextCursor`
- [ ] Tool descriptions say results are paged and that the assistant must follow
      `nextCursor` before claiming a complete list; fix "every app in the catalogue"
- [ ] Phase 1 spec §tools updated in #172; CHANGELOG

### R3 — Future of the `ADMIN_API_KEY` bulk endpoints (#172)

Agree with the direction, keep it light: ADRs are being introduced to the
maintainers by #172 itself (ADR 0001), so no new ADR for a maintainer-level
decision until the practice is adopted. Record the question, do not decide it.

Position for the reply: deprecation is a decision to take later, never a removal
in #167. MCP can replace the *interactive* catalogue work only (ADR 0005: a person
confirms every change); unattended server-to-server sync would need its own
revocable, per-integration credential on the regular API.

- [ ] `03-roadmap.md`: a short "Open question: the shared admin API key" section —
      the use cases (export, upsert by slug, tags, groups on create), the gaps lombax85
      listed, and the order (decision → replacement → migration guide → removal in a
      documented breaking release)
- [ ] `04-phase2-spec.md` "Never via MCP": the bulk line points to that open question
- [ ] CHANGELOG roadmap entry (in #167): "Decide the future of the shared admin API key"

### R4 — Close the round

- [ ] Draft the three replies to lombax85 in `tasks/review-round-1-replies.md`;
      post them only after the author approves the text
- [ ] PR descriptions `tasks/pr-mcp-phase1.md` and `tasks/pr-mcp-design.md` updated,
      then pushed to GitHub
- [ ] Re-request review from lombax85

## Phase 2 — admin write proposals (after phase 1 holds in production)

Why it matters and how it builds on phase 1: `docs/design/mcp/03-roadmap.md`.
The assistant proposes, Frontdoor computes the diff, the admin applies it with
one click on a Frontdoor page.

- [ ] Phase 2 spec and ADRs (pending-change model, diff shared with the applying route,
      confirmation page protections, pseudonymous user references)
- [ ] `mcp_pending_changes` table with a tested `down()`
- [ ] Confirmation page `/changes/:id`: full diff with real names, apply/discard,
      re-check of permissions and state on apply, 24 h expiry
- [ ] Write tools, in order: group ↔ app visibility; app create/edit; Entra import and resync
- [ ] Audit linking proposal ("via MCP, assistant X") and application
- [ ] Security review and end-to-end check with a commercial assistant

## Phase 3 — log answers for owners

- [ ] DPIA screening for exposing access/audit aggregates to an AI provider
- [ ] Owner switch (off by default), aggregate-only tools, documentation of what leaves

## Flagged, not in scope
- `frontdoor_token` is set on `.${BASE_DOMAIN}` and accepted as a bearer on
  `/api`: every satellite subdomain receives a 7-day, non-revocable Frontdoor
  session. To verify whether this is intended for `shared-cookie` mode and
  report separately.
- Pre-existing (review 7g): `trust proxy 1` lets a directly reachable instance spoof
  `X-Forwarded-For` and bypass IP rate limits.
- **Confirmed vulnerability (low), fixed in #168** (branch `fix/plugin-webhook-dns-rebinding`, from `main`):
  plugin webhook delivery (`server/services/plugins.js:590`)
  checks the destination with `isPublicDestination` and then calls `fetch`, which resolves
  DNS again: a DNS-rebinding host can pass the check and be reached on a private address,
  with the plugin secret header. Exposure is limited (plugin platform locked, admin-chosen
  URLs). Fix in a separate PR with `publicOnlyLookup` from `networkGuard.js`.
- Removing the "additional SSO providers" roadmap entry is a maintainer
  decision, not part of this branch.
