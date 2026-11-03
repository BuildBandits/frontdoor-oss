<!-- Draft PR description for feat/mcp-server → BuildBandits/frontdoor-oss main. -->

## Summary

Adds an optional MCP server so people use Frontdoor from the AI assistant they
already have (Claude, ChatGPT, Copilot Studio, VS Code): find the apps they can
open, and set their favourites, colour scheme and language. It is phase 1 (read
and own preferences) of the proposal in `docs/design/mcp/01-proposal.md`, and
ships **off**.

## Related issue

N/A — proposal and decisions in `docs/design/mcp/` and ADRs 0001–0004.

## Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor / internal change (no user-visible behavior change)
- [x] Documentation
- [ ] Other:

## What changed

- **Authorization server** (`server/services/mcp/oauth.js`, `server/routes/oauth.js`):
  RFC 8414 / RFC 9728 metadata, authorization code with PKCE S256 and RFC 8707
  resource required, RFC 9207 `iss`, browser-bound consent, opaque tokens
  stored as SHA-256 hashes (10 min access, rotating refresh with reuse
  detection), RFC 7009 revocation. Clients are owner-approved: client metadata
  documents (fetched with a connect-time SSRF guard) or registered clients with
  a secret. No DCR (ADR 0004). Sign-in stays with Microsoft Entra; no Entra
  token is ever issued to or accepted from an assistant (ADR 0003).
- **MCP endpoint** (`server/routes/mcpEndpoint.js`, `server/services/mcp/tools.js`):
  SDK v2 handler (ADR 0002), Origin check, per-IP and per-connection rate
  limits, 64 KiB body cap; 8 tools whose results are built only from declared
  field lists (`projection.js`), with a test that fails on any other field.
- **Shared services**: app visibility, the admin app list and the admin group
  list moved out of the routes into `appCatalog.js` / `groupCatalog.js`, so
  routes and tools use the same queries (characterisation tests first).
- **Data**: `server/migrations/mcp.js`, the first migration with a tested
  `down()`; MCP tokens, codes and pending consents are never archived and are
  emptied by a restore.
- **UI**: consent page `/connect/:id`, error page `/connect`, and an *AI
  assistants* page (account menu) for users' connections and the owner's
  controls (switch, approved assistants, disconnect everyone).
- **Docs**: `docs/mcp.md` (operators, DPO), SECURITY.md pointer, FEATURES.md,
  CHANGELOG.

## Breaking changes

None. With the MCP off (default) every new route answers 404. Backups now leave
out three new tables (empty unless the MCP was used).

## New dependencies

`@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/express` 2.0.2,
`@modelcontextprotocol/node` 2.1.2 (Apache-2.0; brings `hono` 4.13.16 and
`@hono/node-server` 2.1.6) and `zod` 4.6.7 (already in the tree).
`npm audit --omit=dev`: 0 vulnerabilities.

## Checklist

- [x] I have read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [x] All commits are **signed off** (DCO).
- [x] Lint and tests pass locally: `npm run lint` and `npm test`.
- [x] I updated `CHANGELOG.md` under `[Unreleased]`.
- [x] I updated relevant documentation (`FEATURES.md`, `SECURITY.md`, `docs/mcp.md`). The web docs page in BuildBandits/frontdoor.buildbandits.com is a follow-up PR.
- [x] No PII (emails, names, tokens) in new log statements.
- [x] New SQL queries are parameterized.
- [x] New HTML rendered from user input goes through DOMPurify (none: React text only).

## Security impact

High: a new authorization server and a new authenticated endpoint. Threat model
in `docs/design/mcp/02-phase1-spec.md` §11; every rule in §4 has a test, and the
critical checks (same-origin decision, browser binding, code burning, PKCE,
fail-closed projection) were mutation-checked. An independent adversarial
review is recorded in `docs/design/mcp/reviews/`. Two pre-existing issues found
along the way are reported separately, not fixed here (see `tasks/todo.md`).

## How to test

1. `npm ci && npm run build`, then `DEV_LOGIN=true FRONTEND_URL=http://localhost:3001 npm start`.
2. Sign in as Owner, open *AI assistants*, switch it on, add a *Registered client*
   with redirect `http://127.0.0.1:8765/callback`; copy the ID and secret.
3. Follow `docs/design/mcp/reviews/2026-11-03-e2e-local.md` (authorize URL with
   PKCE, consent, `curl` token exchange, `tools/list`, `tools/call`).
4. Or connect Claude Code via CIMD: add `https://claude.ai/oauth/claude-code-client-metadata`
   as a metadata document, then `claude mcp add --transport http frontdoor http://localhost:3001/mcp`.
