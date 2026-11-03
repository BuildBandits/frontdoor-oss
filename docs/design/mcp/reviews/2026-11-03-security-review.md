# Security review of feat/mcp-server (2026-11-03)

Independent adversarial review by a separate agent, given the code and the
spec but not the author's conclusions. Read-only; probes ran against the real
app on an ephemeral port. Result: no critical or high findings. Each finding
was then verified by the author and handled as below.

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | Medium | JSON-RPC batches (up to 100 calls per request) bypass the per-connection limit; 100 × `list_groups` on 3,000 groups blocked the event loop ~290 ms per request | **Fixed**: `/mcp` parses its own body and refuses arrays with `-32600` (batching left MCP in 2025-06-18). Test: `mcpEndpoint` "JSON-RPC batches are refused" |
| 2 | Low | `get_app_access` returned raw Entra object IDs when no display name was cached, against spec §6 | **Fixed**: unnamed Entra groups are counted (`unnamedNestedGroups`), never named. The test that asserted the raw ID now asserts its absence |
| 3 | Low | `/oauth/authorize` unthrottled: unbounded pending rows and cookies; failed CIMD fetches not cached | **Fixed**: per-IP limit (`MCP_AUTHORIZE_RATE_LIMIT_MAX`, 30/min); CIMD failures cached 60 s and concurrent fetches shared. Tests in `mcpClients` |
| 4 | Low | CIMD 5 s timeout was an idle timer, so a dripping host held requests open | **Fixed**: total deadline on the whole exchange. Test in `networkGuardFetch` |
| 5 | Low | Spec over-claimed what browser binding prevents: a victim sent the `/oauth/authorize` URL starts their own bound request | **Spec corrected** (§4 rule 8, §11); the consent page now names the signed-in account and says to cancel if the user did not start it. Residual risk depends on the client binding `state` to its session, which Frontdoor cannot control |
| 6 | Low | Malformed `Basic` header → 500 | **Fixed**: 401 `invalid_client`. Test in `mcpOAuth` |
| 7a | Info | CORS-allowlisted satellites could list and revoke connections through `/api/mcp` | **Fixed**: the whole `/api/mcp` router requires `Sec-Fetch-Site: same-origin`. Test in `mcpOAuth` |
| 7b | Info | A reactivated user got old grants back without consent | **Fixed**: deactivation (admin route and Entra sync) revokes the user's grants (`user_inactive`). Test in `mcpOAuth` |
| 7c | Info | SSRF blocklist lacked NAT64, 6to4, site-local and IPv4-compatible IPv6 | **Fixed**: `64:ff9b::/96`, `64:ff9b:1::/48`, `100::/64`, `2002::/16`, `fec0::/10`, `::/96` added (also protects plugin webhooks). Test in `networkGuardFetch` |
| 7d | Info | Restoring an older backup brings back `mcp_clients` and `mcp_settings` as they were | **Accepted**: a restore restores configuration by design; users must consent again because tokens and codes are purged. Documented in `docs/mcp.md` |
| 7e | Info | A user promoted to an admin role gets the admin tools on existing grants | **Accepted**: the consent page already lists the admin-only fields; the role is re-read on every call, so demotion applies at once |
| 7f | Info | One grant per (user, client): a replay or refresh reuse disconnects all of that user's devices on that client, with no grace period for a client retrying after a network failure | **Accepted** for phase 1: failing closed is the safer default; revisit if clients report spurious disconnects |
| 7g | Info | Pre-existing: `trust proxy 1` lets a directly reachable instance spoof `X-Forwarded-For` and bypass every IP limiter | **Flagged**, not in scope: deployment guidance says to run behind a proxy |

Sound by the reviewer's checks (abridged): exact redirect matching (10 bypass
variants refused), PKCE and code burning, replay revocation, refresh rotation
without races, audience checks at exchange, refresh and every call, token
confusion in both directions, consent single use and impersonation blocks,
framing headers, Origin check, connect-time DNS check, parameterised SQL, tool
RBAC and projections, IDOR-free connection revocation, no tokens or PII in
logs, backup exclusion, migration `down()`, no `dangerouslySetInnerHTML`.
