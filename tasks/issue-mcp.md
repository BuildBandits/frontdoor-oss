<!-- Opened 2026-11-04 as https://github.com/BuildBandits/frontdoor-oss/issues/171 (Feature request template). Title: "[feat] AI assistants (MCP): administration by conversation, confirmed in Frontdoor" -->

## Problem

Frontdoor's users already work inside an AI assistant (Claude, ChatGPT, Copilot Studio, VS Code), but cannot reach Frontdoor from it. "Where is the holiday portal?" means leaving the conversation to search the catalogue.

The bigger cost is on the admin side. Changing who can open what ("remove Figma from the Interns group, give Payroll to HR Milan") takes dozens of clicks across Apps, Groups and Users. Letting an AI act on Frontdoor directly is not an answer: a prompt injection in an app description or group name would turn into a real access change.

## Proposed solution

An optional MCP server, off by default, in three phases. The assistant proposes, Frontdoor decides, and the human confirms in Frontdoor with their own Entra session.

| Phase | What users get | Status |
| --- | --- | --- |
| **1. Foundation: read and own preferences** | "Which tools do I have for accounting?", "add Jira to my favourites"; admins get read-only answers about apps and groups (counts, never identities) | #167 |
| **2. Admin write proposals** | The assistant prepares a change and answers with a link; the admin opens `/changes/<id>` in Frontdoor, sees the exact diff with real names, and clicks **Apply**. Order: group ↔ app visibility, then app creation and edits, then Entra import and resync | Roadmap, after phase 1 holds in production |
| **3. Log answers for owners** | "Which apps has nobody opened in 90 days?" — aggregates only, never rows, behind a separate owner switch | After phase 2, DPIA screening first |

Phase 1 carries the security foundation phase 2 needs:

- Frontdoor acts as a minimal OAuth 2.1 authorization server for assistants (PKCE, resource indicators, opaque hashed tokens) and signs users in through the existing Entra login. No Entra token reaches an assistant.
- The owner approves each assistant and has a kill switch.
- Tools share the same services and RBAC as the UI routes, and their output is built from explicit field lists.
- Confirmation happens on a Frontdoor page that cannot be framed or driven cross-site.

Design documents:

- [proposal](https://github.com/amargiovanni/frontdoor-oss/blob/feat/mcp-server/docs/design/mcp/01-proposal.md)
- [phase 1 spec and threat model](https://github.com/amargiovanni/frontdoor-oss/blob/feat/mcp-server/docs/design/mcp/02-phase1-spec.md)
- [roadmap for phases 2 and 3](https://github.com/amargiovanni/frontdoor-oss/blob/feat/mcp-server/docs/design/mcp/03-roadmap.md)
- [phase 2 spec, first step](https://github.com/amargiovanni/frontdoor-oss/blob/feat/mcp-server/docs/design/mcp/04-phase2-spec.md)
- [ADRs 0001–0005](https://github.com/amargiovanni/frontdoor-oss/tree/feat/mcp-server/docs/adr)

All of these are proposed for `main`, documentation only, in #172.

### Phase 1 checklist

- [ ] Merge #172 (design documents and ADRs, documentation only).
- [ ] Merge #168 first. It overlaps with #167 in `server/services/networkGuard.js`.
- [ ] Rebase #167 on `main`: reuse #168's guarded request core for the client metadata fetch, and drop `isPublicDestination`.
- [ ] Decide where the extra blocked IPv6 ranges go: a small security PR of their own, or #167.
- [ ] Check with a commercial assistant against a public https staging instance.
- [ ] Web docs page in BuildBandits/frontdoor.buildbandits.com.
- [ ] Merge #167.

### Later

- [x] Phase 2 spec for its first step (group ↔ app access) and ADR 0005 (accepted by the author), in #172.
- [ ] Phase 2 specs for app creation and edits, Entra import, local group membership.
- [ ] Phase 3 spec and DPIA screening.

## Alternatives considered

- **Entra as the authorization server for assistants.** Entra offers neither dynamic registration nor client metadata documents, and it does not publish the PKCE metadata MCP clients expect. Its tokens would also put Graph-capable credentials in the assistant's hands (ADR 0003).
- **Dynamic client registration.** It lets anything register itself. Owner-approved metadata documents plus pre-registered clients keep the allowlist explicit (ADR 0004).
- **Letting the assistant apply admin changes directly.** One injected instruction would become a real access change. Phase 2 deliberately stops at a proposal that only the admin can apply, in Frontdoor.
- **Generic tools (raw API passthrough, SQL) or an AI model inside Frontdoor.** These are out of scope by design: narrow tools with declared outputs are what make the data exposure reviewable.

## Impact

- **Users affected:** end users / admins / owners
- **Touches authentication or RBAC?** yes. It adds a separate OAuth authorization server for assistants, while Entra sign-in and the existing RBAC stay unchanged and are reused.
- **Touches the public API or SSO contract?** no. It adds new `/mcp`, `/oauth/*` and `/.well-known/oauth-*` endpoints, all 404 while the feature is off.
- **Requires a database migration?** yes, reversible (`server/migrations/mcp.js`).
- **Breaking change?** no

## Additional context

Operator and DPO documentation, covering what reaches the AI provider, retention and the legal basis: [`docs/mcp.md`](https://github.com/amargiovanni/frontdoor-oss/blob/feat/mcp-server/docs/mcp.md).
