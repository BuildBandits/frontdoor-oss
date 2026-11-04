# 0003. Make Frontdoor a minimal OAuth 2.1 authorization server for MCP clients

**Status**: Accepted
**Date**: 2026-11-03
**Accepted**: 2026-11-03
**Deciders**: Andrea Margiovanni (Claude: drafter)

## Context

The MCP authorization spec makes the MCP server an OAuth 2.1 resource server
and requires clients to discover an authorization server that advertises PKCE
S256, accepts RFC 8707 resource indicators and supports a client registration
method. Microsoft Entra ID publishes no `code_challenge_methods_supported`, no
registration endpoint and no Client ID Metadata Document support, so
spec-following clients refuse to use it directly, and Entra-protected MCP
servers require per-tenant pre-registration of each AI vendor's app. Frontdoor's
principle is that human identity stays with Entra. The session JWT has no
revocation today (no `jti`, no session table) and shares `JWT_SECRET` with
other token types. The MCP SDK v2 deliberately does not ship authorization
server helpers.

## Decision

We will implement inside Frontdoor a minimal OAuth 2.1 authorization server for
MCP clients only: RFC 8414 metadata, the authorization code grant with PKCE
S256 (required), RFC 8707 `resource` bound to the MCP endpoint, RFC 9207 `iss`
in responses, a Frontdoor consent page per user and client, and refresh tokens
rotated on every use with reuse detection. The user authenticates through the
existing Entra login. Access and refresh tokens are opaque random values
(256 bits); only their SHA-256 hashes are stored, in their own tables, with
expiry, user, client and revocation state. Entra tokens are never issued to,
accepted from or forwarded to MCP clients.

## Alternatives considered

- **Entra as the authorization server** — blocked by missing PKCE metadata and
  registration support; would push per-tenant app registration onto every
  customer.
- **`oidc-provider` library** — well reviewed, but brings Koa and a full OIDC
  surface to disable, and lacks native CIMD; we would still write the parts
  that matter.
- **JWT access tokens signed with `JWT_SECRET` or a new key** — stateless, but
  revocation (kill switch, per-client revoke) would need a deny list anyway;
  opaque tokens give immediate revocation with one indexed lookup.
- **SDK `server-legacy` proxy provider** — frozen and planned for removal in v3.

## Consequences

**Positive:**
- Immediate revocation per token, per client, per user and globally.
- No reuse of `JWT_SECRET`; a leaked MCP token is useless outside `/mcp`.

**Negative / obligations created:**
- We own security-critical OAuth code: it needs focused tests (PKCE, redirect
  matching, code replay, refresh reuse, audience) and an external review before
  release.
- One DB lookup per MCP request; tokens must be indexed by hash.
- New tables need migrations, which today have no `down()` mechanism.

## References

- `docs/design/mcp/research/mcp-spec-and-sdk.md`
- https://modelcontextprotocol.io/specification/latest/basic/authorization
- RFC 9700 (OAuth 2.0 Security Best Current Practice)
