# 0004. Register MCP clients via CIMD and owner pre-registration, not DCR

**Status**: Accepted
**Date**: 2026-11-03
**Accepted**: 2026-11-03
**Deciders**: Andrea Margiovanni (Claude: drafter)

## Context

The MCP spec ranks client registration methods: pre-registration, then Client
ID Metadata Documents (CIMD, preferred), then Dynamic Client Registration (DCR,
now deprecated). Claude, ChatGPT and VS Code support CIMD; Copilot Studio
supports DCR or a manually entered confidential client; M365 Copilot plugins
support DCR only with a secret. CIMD makes Frontdoor fetch an HTTPS URL chosen
by the client, which is an SSRF vector. The proposal requires the owner to
choose which AI assistants are admitted.

## Decision

We will support two registration methods: CIMD, accepted only for client ID
URLs on the owner's allowlist and fetched through the existing network guard
(HTTPS only, no private, loopback or link-local targets, no redirects, size
and time limits); and confidential clients pre-registered by the owner with a
generated secret. We will not offer DCR.

## Alternatives considered

- **Also DCR** — covers Copilot Studio "Dynamic" and M365 plugins, but it is
  deprecated and creates an anonymous registration endpoint to defend.
- **Pre-registration only** — smallest surface, but Claude and ChatGPT users
  would have to paste client credentials by hand.

## Consequences

**Positive:**
- The owner allowlist is the single admission control; nothing registers itself.

**Negative / obligations created:**
- Copilot Studio works only through the "Manual" path with an owner-created client.
- CIMD fetching needs SSRF tests and a cache with a bounded lifetime.

## References

- `docs/design/mcp/research/mcp-spec-and-sdk.md`
- https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration
