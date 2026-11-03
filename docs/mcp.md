# AI assistants (MCP)

Frontdoor can expose an [MCP](https://modelcontextprotocol.io) server so that
people use the catalogue from the AI assistant they already have: "where is the
holiday portal?", "add Jira to my favourites". It ships **off**. This page is
for operators, owners and the data protection officer who has to assess it.

Design and decisions: [`docs/design/mcp/`](design/mcp/) and ADRs
[0002](adr/0002-use-mcp-typescript-sdk-v2.md),
[0003](adr/0003-frontdoor-as-minimal-oauth-authorization-server.md),
[0004](adr/0004-register-mcp-clients-via-cimd-and-preregistration.md).

## Turning it on

1. `FRONTEND_URL` must be the public **https** origin of Frontdoor (plain http
   is accepted only outside production). The MCP endpoint is
   `<FRONTEND_URL>/mcp`.
2. The owner opens **AI assistants** in the account menu and switches
   *AI assistant connections* on.
3. The owner adds each assistant the organisation has approved:

| Assistant | How to add it |
| --- | --- |
| Claude (claude.ai, Desktop, Code), VS Code | *Metadata document*: paste the assistant's client metadata URL (for example `https://vscode.dev/oauth/client-metadata.json`, or `https://claude.ai/oauth/claude-code-client-metadata` for Claude Code) |
| ChatGPT, Copilot Studio, any assistant that asks for a client ID and secret | *Registered client*: paste the redirect addresses the assistant shows when you create its connector; copy the client ID and secret Frontdoor shows **once** into the assistant |

ChatGPT's metadata document declares `private_key_jwt`, which Frontdoor does
not support; add ChatGPT as a registered client. Dynamic client registration
is not offered: nothing registers itself.

Then each user adds `<FRONTEND_URL>/mcp` in their assistant, signs in with the
usual Microsoft account and approves the connection on a Frontdoor page.

## What reaches the AI provider

Only what the user could already see in Frontdoor, through narrow tools:

| Tool | Who | Returns |
| --- | --- | --- |
| `search_my_apps` | everyone | name, slug, description, tags of the apps the user can open, a Frontdoor launch link, favourite flag |
| `get_my_preferences`, `set_favorite_app`, `set_color_scheme`, `set_language` | everyone | the user's own favourites (by slug), colour scheme, language |
| `list_apps` | admin roles | name, slug, tags, mode, active flag, number of groups |
| `get_app_access` | admin roles | group names, nested group names (an Entra group without a known name is only counted) and the **number** of users reaching an app |
| `list_groups` | admin roles | group names, source, member and app counts |

Never: target URLs (internal-link addresses included — launch links go
through Frontdoor, which applies RBAC and SSO as today), emails, names or IDs of
people, IP addresses, access or audit logs, tenant or client IDs, secrets,
settings. Every tool result is built from an explicit field list and a test
fails if anything else appears.

**Declared limit:** Frontdoor controls what leaves Frontdoor, not what the user
types into the assistant. A name typed in a question is already at the provider.

The only write is the user's own preferences, applied directly and recorded in
the audit log as `mcp.preference_changed` with the assistant's name.

## Security model

- **Identity stays with Microsoft Entra.** Frontdoor acts as the OAuth 2.1
  authorization server for assistants and signs the user in through the
  existing Entra login. No Entra or Graph token is ever given to, or accepted
  from, an assistant.
- **Tokens.** Opaque random values, stored only as SHA-256 hashes. Access tokens
  live 10 minutes and work only on `/mcp`; refresh tokens rotate on every use
  (30 days idle, 90 days at most), and reusing an old one revokes the
  connection. Session tokens are refused on `/mcp` and MCP tokens on `/api`.
- **Consent.** Authorization code flow with PKCE S256 and the resource
  indicator required; redirect addresses matched exactly. The consent page is
  bound to the browser that started the request, cannot be framed, and its
  decision is accepted only from Frontdoor's own origin.
- **Revocation.** Users disconnect their assistants from *AI assistants*; the
  owner removes an assistant (disconnecting all its users) or disconnects
  everyone at once. Deactivating a user, removing an assistant or switching the
  MCP off stops access on the next request.
- **Backups** never contain MCP tokens or codes, and a restore removes any that
  exist, so an old archive cannot bring back a revoked token. Users reconnect
  after a restore. A restore does bring back the approved assistants and the
  on/off switch as they were in the archive: check *AI assistants* after
  restoring an older backup.
- **Deactivated users** lose their connections; reactivating them does not
  bring the connections back.

## Personal data

| Data | Purpose | Retention |
| --- | --- | --- |
| Connection (user, assistant, created, last used) | show and revoke connections | until revoked, then the log retention period |
| Token and code hashes | authentication | removed hourly once expired |
| Counts of users per group (sent to the provider, admins only) | answer admin questions | provider's terms; aggregate |

The legal basis for letting staff use an approved assistant is the deploying
organisation's decision (typically Art. 6(1)(f) or 6(1)(b) GDPR for workforce
tools), as is the processing agreement with the assistant's provider.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FRONTEND_URL` | — | public origin; required to switch the MCP on |
| `MCP_IP_RATE_LIMIT_MAX` | 300 | `/mcp` requests per minute per client IP, before authentication |
| `MCP_RATE_LIMIT_MAX` | 60 | `/mcp` requests per minute per connection |
| `MCP_TOKEN_RATE_LIMIT_MAX` | 60 | token and revocation requests per minute per IP |
| `MCP_AUTHORIZE_RATE_LIMIT_MAX` | 30 | authorization requests per minute per IP |

With the MCP off, `/mcp`, `/oauth/*` and the `/.well-known/oauth-*` documents
answer 404. Behind a reverse proxy, forward `/mcp`, `/oauth/` and
`/.well-known/oauth-` to Frontdoor like `/api`.
