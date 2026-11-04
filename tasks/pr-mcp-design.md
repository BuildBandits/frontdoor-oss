<!-- PR description for docs/mcp-design → BuildBandits/frontdoor-oss main (design base of #167). Title: "docs(mcp): design and ADRs for AI assistant access (MCP)" -->

## Summary

The design for an optional MCP server, with no code. It covers the proposal, the phase 1 spec, the phase 2 spec, the roadmap and ADRs 0001–0005. It is meant to be read **before** #167, the phase 1 implementation stacked on top of it, so the direction is agreed on a few text files rather than on a 5,000-line diff.

**What we ask the maintainers:** is this the direction you want for Frontdoor? Comments on the principles, the phases and the open points are the most useful input at this stage.

## The goal

**Frontdoor administration by conversation, with a human always applying the change in Frontdoor.**

An admin asks their AI assistant:

> *"Remove Figma from the Interns group and give Payroll to HR Milan."*

Frontdoor does **not** apply it. It prepares the change and the assistant answers with a link. The admin opens Frontdoor, sees the exact effect with real names (who gains and who loses access to what) and clicks **Apply**.

<img src="https://github.com/amargiovanni/frontdoor-oss/raw/0b95c29/docs/design/mcp/mockups/change-review.png" alt="Mockup of the review page: the change Claude prepared, people gaining and losing access, Discard and Apply" width="560">

The assistant proposes, Frontdoor decides, and the human confirms with their own Entra session. A prompt injection can at worst produce a proposal nobody applies (ADR 0005).

| Phase | What users get | Where |
| --- | --- | --- |
| **1. Read and own preferences** | "Which tools do I have for accounting?", "add Jira to my favourites", read-only admin answers (counts, never identities) | Spec `02-phase1-spec.md`, code in #167 |
| **2. Admin write proposals** | The flow above. It starts with which groups can open which apps, then app creation and edits, then Entra import | Spec `04-phase2-spec.md` for the first step; built after phase 1 holds in production |
| **3. Log answers for owners** | "Which apps has nobody opened in 90 days?" (aggregates only) | Roadmap `03-roadmap.md`; DPIA screening first |

## Related issue

Part of #171.

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal change (no user-visible behavior change)
- [x] Documentation
- [ ] Other:

## What changed

- `docs/design/mcp/01-proposal.md`: the proposal, covering the principles, the outbound filter, writes as proposals, owner controls, the non-goals and the open questions.
- `docs/design/mcp/02-phase1-spec.md`: the phase 1 specification, with the authorization server rules, the mediation layer, the data model, GDPR and the threat model.
- `docs/design/mcp/03-roadmap.md`: what phase 1 delivers for phase 2, and the plan for phases 2 and 3.
- `docs/design/mcp/04-phase2-spec.md` and `mockups/`: the first step of phase 2, covering the `propose_access_change` tool, pending changes, the review page, apply with an effect digest, the audit and the threat model.
- `docs/design/mcp/research/`: the codebase survey and the MCP spec and SDK research behind the decisions.
- `docs/adr/`: the ADR process (0001), SDK v2 (0002), Frontdoor as a minimal OAuth authorization server (0003), client registration via metadata documents and pre-registration without DCR (0004), all **Accepted by the author**; and writes only as confirmed proposals (0005), **Proposed**. `accepted.ledger` freezes the Context and Decision of accepted ADRs, and `check_adr_immutability.py` verifies it. Wiring that check into CI can be a small follow-up PR.

ADRs 0001–0004 say "Accepted" for decisions whose code is still in review in #167. That is normal for ADRs: they record the decision, not the merge. If the maintainers disagree with one, it is superseded, not edited.

## Breaking changes

None. Documentation only.

## Checklist

- [x] I have read [CONTRIBUTING.md](../CONTRIBUTING.md).
- [x] All commits are **signed off** (DCO).
- [x] Lint and tests pass locally: not affected (no code).
- [ ] I updated `CHANGELOG.md` under `[Unreleased]`: not needed for design documents; #167 carries the feature entry.
- [x] I updated relevant documentation.
- [x] No PII (emails, names, tokens) in new log statements (none).
- [x] New SQL queries are parameterized (none).
- [x] New HTML rendered from user input goes through DOMPurify (none; the mockup is a static file, not served).

## Merge order

Merge this first. #167 contains these commits as its base: until this merges, its diff also shows them. Once this is in, its diff shrinks to the implementation. GitHub cannot stack a PR from a fork on another fork branch, so #167 keeps targeting `main`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
