# Frontdoor MCP — where phase 1 leads (phases 2 and 3)

- Status: roadmap. Each phase gets its own spec and ADRs before it is built;
  phase 2 starts only once phase 1 has held in production. The first step of
  phase 2 is specified in `04-phase2-spec.md` (ADR 0005, proposed).
- Date: 2026-11-03
- Builds on: `01-proposal.md` (the full proposal), `02-phase1-spec.md`

Phase 1 looks small from the outside: "where is the holiday portal?", "add
Jira to my favourites". It is the foundation. The point of the MCP is phase 2:

> An admin asks their assistant *"remove Figma from the Interns group and give
> Payroll to HR Milan"*. Frontdoor does not apply it. It prepares the change,
> the assistant answers with a link, and the admin opens Frontdoor and sees the
> exact diff — who gains or loses access to what, with real names — then
> clicks **Apply**. Dozens of clicks across Apps, Groups and Users become one
> sentence and one review.

The assistant proposes; Frontdoor decides; the human confirms in Frontdoor with
their Entra session. A prompt injection (a malicious app description or group
name read by the model) can at worst produce a wrong proposal nobody applies.

## What phase 1 already provides for this

| Needed by phase 2 | Built in phase 1 (#167) |
| --- | --- |
| The assistant acts as a specific admin, never as itself | OAuth 2.1 authorization server, per-user grants, Entra sign-in (ADR 0003) |
| The owner decides which assistants exist at all | Owner allowlist of assistants, kill switch (ADR 0004) |
| No authorization path parallel to the UI | App visibility, admin app and group lists moved into shared services used by routes and tools |
| Nothing leaks to the provider that the admin should not send | Fail-closed projections with a test per tool |
| A Frontdoor page the user confirms on, which cannot be framed or driven cross-site | Consent page: browser-bound, `frame-ancestors 'none'`, strict same-origin API |
| Every action traceable to the assistant that started it | Audit entries carry the grant and the assistant's name |
| Revocation that works at once | Per connection, per assistant, per user deactivation, global |

Phase 2 adds the proposal model and its confirmation page; the security
plumbing it needs is built, tested and reviewed in #167.

## Phase 2 — admin write proposals

### Flow

1. **Propose.** A tool such as `propose_group_app_change` checks the caller
   with the same RBAC as the route it mirrors (`admin` or `owner`; an
   `admin_readonly` gets no write tools). If the admin could not do it in the
   UI, no proposal is created. Otherwise Frontdoor stores a pending change and
   returns a link and a summary in the projection vocabulary (app and group
   names, counts; no identities).
2. **Review.** The admin opens `/changes/<id>` in Frontdoor and sees the full
   diff with real names: users and groups gaining or losing access, fields
   changing, before and after.
3. **Apply or discard, one click.** On apply Frontdoor re-checks the admin's
   permissions and the current state; if anything the change depends on moved
   meanwhile, the proposal lapses instead of overwriting.
4. **Trace.** The audit records the proposal ("via MCP, assistant X") and the
   application (who, when), linked to each other.

### Rules (from the proposal, to confirm in the phase 2 spec)

- One request on many items ("remove Payroll from these 12 users") is one
  proposal and one click.
- Only the proposer applies: no new four-eyes flow.
- Unapplied proposals expire after 24 hours.
- The page carries the same protections as the consent page: same-origin only,
  never framed, applied with the admin's own session, never with the MCP token.
- Users' own preferences stay the only write applied directly (phase 1).

### Order of operations

1. Group membership of apps and app visibility (`POST/DELETE /api/groups/:id/apps`
   and friends).
2. App creation and edit (`POST /api/apps`, `PUT /api/apps/:id`), with the same
   validation as the UI (slug, target URL, mode visibility).
3. Entra group import and resync.

Never via MCP: backup, restore, impersonation, log purge, branding, owner
settings (non-goals in the proposal).

### Open design points for the phase 2 spec

- Storage: a `mcp_pending_changes` table with the operation, its parameters,
  a snapshot of the state it was computed against, expiry and outcome; its
  `down()` drops it.
- Diff computation shared with the route that applies it, so preview and
  effect cannot diverge.
- Pseudonymous user references (`U-xxxxxxxx`, stable per grant) arrive here,
  with the first tool that has to name users without sending identities.
- How proposals surface in the UI besides the link (a badge in the admin
  navigation, a list of pending changes).

## Phase 3 — log answers for owners

"Which apps has nobody opened in 90 days?", "top 5 apps this month". Access
logs and audit are personal data (who opened what, when), so: owner only, a
separate switch, **aggregates only, never rows**, and the documentation states
exactly what reaches the provider so the customer's DPO can assess it. Needs its
own DPIA screening before it is built.
