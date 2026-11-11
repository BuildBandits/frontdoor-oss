# 0006. Split the MCP scope into read and preferences, chosen at consent

**Status**: Proposed
**Date**: 2026-11-11
**Deciders**: Andrea Margiovanni (Claude: drafter)

## Context

Phase 1 has one OAuth scope, `frontdoor.read`. It also allows three writes:
`set_favorite_app`, `set_color_scheme` and `set_language` change the signed-in
user's own preferences. The consent page explains this, but the scope name
alone promises read-only access. Review of #167 by lombax85 (2026-11-10)
pointed out the mismatch. The review offered two ways out: rename the single
scope, or split it so a connection can be strictly read-only.

Many MCP clients request every scope listed in `scopes_supported`, or send no
scope at all. A split the user cannot act on would therefore stay theoretical:
the client would ask for everything and the user could only accept or refuse.

Phase 2 already adds a second scope, `frontdoor.propose` (ADR 0005). Multi-scope
handling is needed anyway. Phase 1 has not reached production, so changing the
scope now needs no grant migration.

## Decision

We will offer two phase 1 scopes. `frontdoor.read` covers the read tools and is
always part of a grant. `frontdoor.preferences` covers the three `set_*` tools.
When a client requests `frontdoor.preferences`, or sends no scope, the consent
page shows it as its own line with a checkbox, checked by default. The user can
untick it, and the grant then holds `frontdoor.read` only.

A grant never holds more than the client requested and the user approved. A
connection only lists the tools its grant allows. The token response states the
scopes actually granted. Re-consenting with the same client replaces the
grant's scopes with the new choice.

## Alternatives considered

- **Rename the single scope** (for example `frontdoor.apps`): the least work,
  but no strictly read-only connection exists, and multi-scope handling is
  postponed to phase 2 anyway.
- **Split without a choice at consent**: the scope is honoured only if the
  client requests it alone. Clients that request everything would leave the
  user no read-only option.
- **A per-tool consent**: finer than anyone asked for, and the consent page
  would turn into a checklist users click through.

## Consequences

- A user can connect an assistant that cannot change anything in Frontdoor.
- The consent page, the decision API and the token endpoint handle a set of
  scopes. Each rule needs tests: the subset is enforced, refresh cannot widen,
  and a request without `frontdoor.read` gets it added.
- `/assistants` shows each connection's scopes, so a user can see what they
  granted.
- `frontdoor.propose` in phase 2 follows this model as one more line on the
  consent page.
- Clients that cached `frontdoor.read` as the only scope keep working. They
  receive read-only grants until they request `frontdoor.preferences` or send no
  scope.

## References

- Review comment on #167 by lombax85, 2026-11-10 ("Scope naming")
- `docs/design/mcp/02-phase1-spec.md` §4 and §7
- ADR 0005 (`frontdoor.propose`)
- RFC 6749 §3.3 (the server may grant fewer scopes than requested and must say so)
