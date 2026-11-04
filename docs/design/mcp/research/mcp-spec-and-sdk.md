# MCP specification, Entra and SDK research

- Date: 2026-11-03
- Method: web research against primary sources (spec pages, Microsoft Learn, vendor docs, npm registry, GitHub advisory API, clients' live metadata documents). Every claim links the page it came from.

## 1. MCP spec: current version and authorization

**Current version: 2026-07-28** ([versioning](https://modelcontextprotocol.io/specification/versioning)). It is a breaking revision ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)):
- It is stateless: the `initialize` handshake and `Mcp-Session-Id` are gone.
- The HTTP GET stream and resumable SSE (`Last-Event-ID`) are removed.
- Requests must carry `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, and the server must reject a header/body mismatch with 400.
- A new `server/discover` RPC is mandatory.

Most clients probably still speak 2025-11-25, so the server should serve both. This is my inference.

What [authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization) requires:
- **Roles:** the MCP server is an OAuth 2.1 resource server. The authorization server may be "hosted with the resource server or a separate entity".
- **Protected Resource Metadata (RFC 9728):** servers MUST implement it, and `authorization_servers` MUST list at least one server. It is found through `WWW-Authenticate: Bearer resource_metadata=…` on a 401, or at `/.well-known/oauth-protected-resource[/path]` ([discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)).
- **Authorization server metadata:** RFC 8414 or OIDC Discovery. The `issuer` must match exactly.
- **PKCE:** clients MUST use S256. If `code_challenge_methods_supported` is absent from the metadata, clients **MUST refuse to proceed** ([security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)).
- **Mix-up protection (RFC 9207):** authorization servers SHOULD send `iss` in responses, and clients MUST validate it when present.
- **Resource indicators (RFC 8707):** clients MUST send `resource` (the server's canonical URI) on both the authorization and token requests.
- **Audience and passthrough:** servers MUST check that the token's audience is themselves and "MUST NOT accept or transit any other tokens". The token must never be forwarded upstream.
- **Short-lived tokens and refresh rotation:** short-lived access tokens are a SHOULD. Rotating refresh tokens for public clients is a MUST.
- **Client registration** ([client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)). Priority order: pre-registered, then **CIMD (SHOULD, preferred)**, then DCR, then manual entry. **DCR is now deprecated** and kept only for backward compatibility. The authorization server advertises CIMD with `client_id_metadata_document_supported: true`, and must fetch the document, validate it and match `redirect_uris` exactly.

## 2. Microsoft Entra ID

**Entra supports neither DCR nor CIMD.** I fetched `login.microsoftonline.com/common/v2.0/.well-known/openid-configuration` myself. It has no `registration_endpoint`, no `client_id_metadata_document_supported`, no `authorization_response_iss_parameter_supported`, and **no `code_challenge_methods_supported`**. That last gap means a client that follows the spec must refuse to use Entra directly.

Microsoft confirms the registration part:
- [M365 Copilot DCR page](https://learn.microsoft.com/microsoft-365/copilot/extensibility/plugin-authentication-dynamic-client-registration): "DCR isn't available for an MCP server that's protected by Microsoft Entra ID".
- [App Service MCP auth](https://learn.microsoft.com/azure/app-service/configure-authentication-mcp): you must pre-configure a client ID.
- [Power BI](https://learn.microsoft.com/power-bi/developer/mcp/remote-mcp-server-external-clients): Claude and ChatGPT users must register their own Entra app.

**Microsoft's official MCP guidance** ([Secure an MCP server with Entra ID](https://learn.microsoft.com/entra/agent-id/secure-mcp-server-with-entra-id)) has Entra as the authorization server directly:
- Use v2 tokens (`requestedAccessTokenVersion: 2`).
- Set the Application ID URI to exactly the MCP URL, or you get AADSTS9010010.
- Point `authorization_servers` at `…/{tenant}/v2.0`.
- Note that `aud` is the client-ID GUID, not the URL.

That only works with pre-registered clients. It also leaves each client vendor to register its own app per tenant, so it does not scale to "any AI client".

**Recommended pattern (my synthesis; Microsoft has no official page for it).** Frontdoor acts as its own OAuth 2.1 authorization server:
- It publishes RFC 8414 metadata with S256, `iss`, CIMD support, and `none` plus `private_key_jwt` client authentication.
- It logs the user in through the existing MSAL confidential client.
- It issues its own short-lived tokens with `aud` set to the MCP URL, and never passes the Entra token through.
- This is exactly the "MCP proxy server" configuration in the confused-deputy section (see point 5), so a Frontdoor-owned consent page per client is mandatory.
- The SDK team pushes the other way: v2 froze its authorization-server helpers, saying "use a dedicated identity provider" (point 4). That needs to be a deliberate ADR decision.

## 3. Client support and redirect URIs

| Client | Registration | Redirect URI(s) |
|---|---|---|
| **claude.ai / Desktop / mobile / Cowork** ([docs](https://claude.com/docs/connectors/building/authentication.md)) | CIMD (used only if the authorization server advertises CIMD **and** `none` client auth; otherwise DCR), or a client ID/secret entered in the custom-connector dialog. PKCE S256 always. Uses only the first `authorization_servers` entry. Needs a 401. | `https://claude.ai/api/mcp/auth_callback` |
| **Claude Code** | CIMD `https://claude.ai/oauth/claude-code-client-metadata` (fetched) | `http://localhost/callback` and `http://127.0.0.1/callback`, matched on any port |
| **ChatGPT** ([Apps SDK auth](https://developers.openai.com/apps-sdk/build/auth)) | CIMD preferred (`https://chatgpt.com/oauth/client.json`, `private_key_jwt`), else DCR, else a predefined client. Requires S256 to be advertised. Sends `resource`. | `https://chatgpt.com/connector_platform_oauth_redirect` (fetched from its CIMD), or `https://chatgpt.com/connector/oauth/{callback_id}` if `iss` requirements aren't met |
| **Copilot Studio** ([docs](https://learn.microsoft.com/microsoft-copilot-studio/mcp-add-existing-server-to-agent)) | "Dynamic discovery" (DCR), "Dynamic", or "Manual" (confidential client ID + secret). **No CIMD mentioned.** | A per-connector URL shown after creation, of the form `https://global.consent.azure-apim.net/redirect/<connector-id>` ([custom connectors](https://learn.microsoft.com/connectors/custom-connectors/)). It cannot be known in advance. |
| **M365 Copilot plugins** | DCR, but only if a client secret is issued | `https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect` ([OAuth page](https://learn.microsoft.com/microsoft-365/copilot/extensibility/plugin-authentication-oauth)) |
| **VS Code** | CIMD `https://vscode.dev/oauth/client-metadata.json` (fetched, native app), or `oauth.clientId` in `mcp.json` ([config ref](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)) | `http://127.0.0.1:33418/` and `https://vscode.dev/redirect` |

Anthropic's outbound traffic comes from `160.79.104.0/21`.

Uncertain: Claude's hosted CIMD URL for claude.ai is not documented, and VS Code's DCR fallback is not documented. To cover Copilot Studio, Frontdoor would still have to offer DCR (deprecated) or let an admin pre-register a confidential client.

## 4. TypeScript SDK (npm registry and GitHub, checked 2026-11-03)

- **v1, `@modelcontextprotocol/sdk` 1.32.2:** released 2026-10-23. Node `>=18`, MIT. It depends directly on `express ^5.2.1`, so it is Express 5 native. Other dependencies include `zod ^3.25 || ^4.0` (also a required peer), `hono`, `jose ^6`, `ajv`, `cors`, `express-rate-limit` and `pkce-challenge`. It gets fixes only, for at least six months after v2 shipped on 2026-07-27.
- **v2 split packages (stable):** `@modelcontextprotocol/server`, `client` and `core` 2.4.0 (2026-10-23), plus `express` 2.0.2, `node` 2.1.2 and `hono`/`fastify`. Node `>=20`, **Apache-2.0** (a different license from v1). `zod ^4.2.0`. The Express adapter has peer `express ^4.18 || ^5`.
- **What v2 does:** it implements 2026-07-28. `createMcpHandler` serves both the 2026 and 2025 versions by default ([migration doc](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)).
- **What v2 provides for auth:** only the resource-server side — `requireBearerAuth` with `expectedResource`, the Protected Resource Metadata router and `hostHeaderValidation`. The authorization-server helpers (`mcpAuthRouter`, `ProxyOAuthServerProvider`) are frozen in the deprecated `server-legacy`, which is "planned for removal in v3" ([README](https://github.com/modelcontextprotocol/typescript-sdk)).
- **Advisories** (GitHub API; IDs as returned):

| Advisory | Severity | Issue | Fixed in |
|---|---|---|---|
| GHSA-rvq5-wwqv-78pq | medium | bearer auth accepted tokens for another service | sdk 1.32.0, server 2.3.0, express 2.0.2 |
| GHSA-46jr-4wx8-v453 | high | one request could exhaust memory | 1.32.0, 2.3.0 |
| GHSA-f897-62hf-6gxq | high | no body or batch size limit | 1.30.1, 2.1.0 |
| GHSA-jm63-cq47-j5jp | high | cross-client message delivery | server 2.3.0 |
| GHSA-345p-7cg4-v4c7 | high | cross-client message delivery | 1.26.0 |
| GHSA-22jm-h49p-29qw | high | experimental tasks not tied to their session | 1.32.0 |
| GHSA-6qxp-vccf-f47h | high | client-side: credentials sent to a server-chosen authorization server | 1.31.0, client 2.2.0 |
| GHSA-6prh-2h8m-c8cw | medium | client-side: cross-origin redirects re-sent headers and bodies | 1.32.0, client 2.3.0 |
| GHSA-cqwc-fm46-7fff | high | ReDoS in `UriTemplate` | 1.25.2 |
| GHSA-w48q-cv73-mx4w | high | DNS rebinding protection off by default on localhost | 1.24.0 |

  The floor is **≥1.32.0 for v1, or server ≥2.3.0 and express ≥2.0.2 for v2**.

Under the repo rules, installing either one needs your explicit permission.

## 5. Security best practices that apply to us ([page](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices))

- **Confused deputy:** this applies directly to the Entra-delegating design. It requires:
  - A consent registry per user and `client_id`, checked *before* redirecting to Entra.
  - A consent page that shows the client name and redirect URI, with CSRF protection and `frame-ancestors`/`X-Frame-Options: DENY`.
  - Consent cookies with the `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`, signed and bound to the `client_id`.
  - Exact-string redirect URI matching.
  - A `state` that is single-use, expires in about 10 minutes and is set only after consent.
- **Token passthrough:** forbidden. Frontdoor must not accept Entra tokens on `/mcp` and must not forward its own tokens anywhere.
- **Session hijacking:** in 2026-07-28 this becomes "state handle hijacking". Possessing a handle is never authentication; handles must be random and bound server-side as `<user_id>:<handle>`. For 2025-11-25 sessions, the [older page](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices.md#session-hijacking) still applies.
- **SSRF:** fetching CIMD documents makes Frontdoor's authorization server fetch URLs chosen by the client. Block private, loopback and link-local ranges, limit redirects, and consider an egress proxy. Loopback redirect URIs can be impersonated, so show the redirect hostname clearly and warn when a client has only loopback redirects.
- **Scope minimization:** keep `scopes_supported` minimal, step up with 403 `insufficient_scope`, and avoid catch-all scopes.
- **Tool poisoning and prompt injection:** the best-practices page has **no dedicated section** on this. The [Tools spec](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) requires servers to validate all inputs, enforce access control, rate-limit calls and sanitize outputs, and says annotations are untrusted. Catalog text written by users and returned in tool results is a prompt-injection vector, so treat it as data.
- **DNS rebinding:** Streamable HTTP servers MUST validate `Origin` and answer 403 when it is present and invalid ([transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)). The SDK adds `hostHeaderValidation`/`allowedHosts`.

Third-party blogs were not used as authorities.
