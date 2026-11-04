# 0005. Apply admin writes from AI assistants only as proposals confirmed in Frontdoor

**Status**: Proposed
**Date**: 2026-11-04
**Deciders**: Andrea Margiovanni (Claude: drafter)

## Context

Phase 2 of the MCP server lets admins ask their AI assistant for access changes
("remove Figma from Interns"). The assistant's model reads text Frontdoor does
not control: app descriptions, group names, the conversation, other tools'
output. Any of it can carry a prompt injection.

An admin write applied directly with the MCP token would turn one injected
instruction into a real access change. It would happen with the admin's
authority and without the admin seeing it.

MCP tool annotations and client-side confirmation prompts are hints the client
may ignore. Frontdoor has no four-eyes flow today. It already has a pattern for
a decision the user takes on a Frontdoor page that cannot be framed or driven
cross-site: the phase 1 consent page.

## Decision

We will never let an MCP token apply an administrative change. A write tool only
stores a pending change and returns a link. The change is applied when its
proposer opens the link in Frontdoor, reviews the effect that Frontdoor computes
(with real names and no text from the assistant), and confirms with their own
session. At that point Frontdoor re-checks permissions and verifies that the
effect still matches what was shown.

Write tools require a separate OAuth scope, `frontdoor.propose`, which is
granted only to admin roles and shown on the consent page.

## Alternatives considered

- **Apply directly, rely on the client's confirmation prompt.** The prompt is
  rendered by the assistant, which is exactly the component an injection
  controls.
- **Apply directly, with an undo window.** Access is granted, and possibly
  used, before anyone looks.
- **Confirmation inside the MCP session (elicitation).** It is still shown by
  the client. It cannot carry Frontdoor's names-level diff without sending those
  names to the provider.
- **Four-eyes approval by a second admin.** It is a heavier change to the
  admin workflow than the problem needs. The proposal leaves it out and it can
  come later.

## Consequences

**Positive:**
- The worst outcome of a prompt injection is a proposal nobody applies.
- The provider never receives the names of the people affected, only counts.
- Every applied change has a human decision in Frontdoor's own audit log.

**Negative / obligations created:**
- Admins switch from the assistant to a browser for every change, which is one
  more step than a direct write.
- New state to manage: pending changes with expiry, voiding on revocation, and
  exclusion from backups.
- The diff shown and the change applied must come from one shared computation,
  verified by a digest at apply time.

## References

- `docs/design/mcp/01-proposal.md` (writes section), `docs/design/mcp/04-phase2-spec.md`
- ADR 0003 (Frontdoor as authorization server), ADR 0004
- Issue #171
