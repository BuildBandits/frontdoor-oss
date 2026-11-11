# 0002. Use the MCP TypeScript SDK v2 for the MCP server

**Status**: Accepted
**Date**: 2026-11-03
**Accepted**: 2026-11-03
**Deciders**: Andrea Margiovanni (Claude: drafter)

## Context

Frontdoor will expose a remote MCP server over Streamable HTTP inside its
Express 5 process (Node 24). The MCP specification's current revision,
2026-07-28, is breaking (stateless, no `initialize`, new required headers and
`server/discover`), while most clients in the field still speak 2025-11-25.
Two official SDK lines exist: v1 `@modelcontextprotocol/sdk` (1.32.2, MIT,
fixes only for about six months after 2026-07-27) and the v2 split packages
`@modelcontextprotocol/server` 2.4.0 and `@modelcontextprotocol/express` 2.0.2
(Apache-2.0, Node >= 20, Express 4 or 5 as peer, `zod ^4.2`). Several high
severity advisories were fixed in 2026: the safe floors are server >= 2.3.0 and
express >= 2.0.2. Research: `docs/design/mcp/research/mcp-spec-and-sdk.md`.

## Decision

We will build the MCP server on `@modelcontextprotocol/server` (>= 2.4.0) and
`@modelcontextprotocol/express` (>= 2.0.2), using only their resource-server
side: the protocol handler serving both 2026-07-28 and 2025-11-25, bearer
verification hooks and Protected Resource Metadata. We will not use the frozen
authorization-server helpers (`server-legacy`).

## Alternatives considered

- **SDK v1 (`@modelcontextprotocol/sdk`)** — MIT and Express 5 native, but in
  maintenance only; a forced migration within months.
- **No SDK, hand-written JSON-RPC** — zero dependencies, but we would own every
  protocol detail across two incompatible spec revisions, which is where the
  2026 advisories show bugs actually occur.

## Consequences

**Positive:**
- Both spec revisions served by maintained code; security fixes arrive upstream.

**Negative / obligations created:**
- New runtime dependencies (`@modelcontextprotocol/server`,
  `@modelcontextprotocol/express`, `zod` 4) enter the SBOM and need watching.
  Mounting the handler on Express also needs `@modelcontextprotocol/node`
  2.1.2, which brings `hono` and `@hono/node-server` (added 2026-11-03).
- Apache-2.0 packages in an MIT project: compatible, but their licence and any
  NOTICE must be preserved in the Docker image.
- The SDK's major-version cadence is fast; pin the minor and review upgrades.

## References

- `docs/design/mcp/01-proposal.md`
- https://github.com/modelcontextprotocol/typescript-sdk
