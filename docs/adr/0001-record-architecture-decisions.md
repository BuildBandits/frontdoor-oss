# 0001. Record architecture decisions

**Status**: Accepted
**Date**: 2026-11-03
**Accepted**: 2026-11-03
**Deciders**: Andrea Margiovanni (Claude: drafter)

## Context

Frontdoor's significant decisions (security model, auth flows, data model) have
so far lived in pull request descriptions and the CHANGELOG. The MCP server work
introduces several decisions with rejected alternatives that a future
contributor will want to understand without re-running the research.

## Decision

We will record architecturally significant decisions as ADRs in `docs/adr/`,
numbered sequentially, indexed in `docs/adr/README.md`. Drafts start as
`Proposed`; only a maintainer moves one to `Accepted`. An accepted ADR is not
rewritten: a change of mind is a new ADR that supersedes it.

## Alternatives considered

- **Decisions in PR descriptions only** — not discoverable from the tree, lost
  on squash-merge context.
- **A single DECISIONS.md** — grows without structure and has no per-decision
  status.

## Consequences

**Positive:**
- The "why" of security-relevant choices is reviewable in the same PR as the code.

**Negative / obligations created:**
- Each significant change carries one more file to write and review.

## References

- Michael Nygard, "Documenting Architecture Decisions" (2011)
