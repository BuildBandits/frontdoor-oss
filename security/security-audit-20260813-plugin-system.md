# FrontDoor plugin security review

**Date:** 2026-08-13

**Branch:** `hardening/plugin-system-shippable`

**Base:** `7f9842704fdb65aa82e370b110d749fe95599a11`

**Implementation:** `47110440fc4cf56f8574b7b6cea7ad859d16f563`

**Trigger:** pre-ship review of the plugin architecture

**Decision:** **SHIP for reviewed first-party plugins; NO-GO for untrusted third-party code**

## Scope and trust decision

The reviewed release supports locally packaged JavaScript that an owner has
reviewed and explicitly approved. It does not advertise isolation from a
malicious plugin author. Approved modules execute in FrontDoor's browser realm,
so untrusted third-party code remains outside the supported release scope until
an iframe or worker protocol provides a separate execution boundary.

Within that stated first-party trust model there are no open critical or high
findings. The global plugin switch remains off by default, and switching it off
does not remove the plugin administration control plane needed for recovery.

## Remediated findings

### FD-PLUG-01 — Unauthenticated runtime metadata and artifacts (HIGH)

**Status:** fixed in `4711044`.

Runtime metadata and module files now require an authenticated session and are
filtered by the active user's role. Anonymous requests receive `401`; users
outside the plugin policy do not receive metadata or artifact bytes.

### FD-PLUG-02 — Approval was not bound to executable bytes (HIGH)

**Status:** fixed in `4711044`.

Production plugins are local, immutable and content-addressed. Approval stores
the digest of both executable bytes and canonical security metadata. A code,
entry, permission, role, event, backend, version or secret-envelope change
invalidates approval. Serving re-hashes the artifact and fails closed on a
mismatch or missing file.

### FD-PLUG-03 — Remote mutable code and CSP conflict (HIGH)

**Status:** fixed in `4711044`.

Arbitrary HTTP(S) entry modules and production environment loaders were
removed. The production runtime accepts only the same-origin digest path issued
by the server. Legacy remote plugins must be repackaged and reapproved.

### FD-PLUG-04 — Declared capabilities were not enforced (HIGH)

**Status:** fixed in `4711044`.

The host API is deny-by-default and exposes only approved capabilities.
Unknown permissions, events and roles are rejected. Routes are restricted to a
plugin namespace, core and cross-plugin collisions are blocked, entries are
role-checked at access time, and external links require an explicit capability.

### FD-PLUG-05 — Webhook SSRF and rebinding surface (HIGH)

**Status:** fixed in `4711044`.

Delivery accepts HTTPS on port 443 only, rejects URL credentials and private,
reserved, loopback, link-local, multicast and metadata IPv4/IPv6 ranges,
resolves every address immediately before connection, rejects mixed DNS
answers, and pins the validated public IP for the connection. Redirects are not
followed. Request/response size and time are bounded.

### FD-PLUG-06 — Revocation and kill switch did not unload code (MEDIUM)

**Status:** fixed with a documented same-realm limit in `4711044`.

Replacement, revocation, deletion, switch-off and provider unmount clear the
registry before invoking a bounded, idempotent cleanup hook. Changes propagate
across tabs. Cleanup cannot pre-empt already running synchronous JavaScript;
that limitation is why untrusted plugins are not supported.

### FD-PLUG-07 — Over-broad event subscriptions and payloads (MEDIUM)

**Status:** fixed in `4711044`.

Wildcard subscriptions are rejected. Only the documented authentication and
application-access events can be subscribed to. Delivery omits email,
display name, Microsoft identifiers and internal request context.

### FD-PLUG-08 — Backend secrets stored in plaintext (MEDIUM)

**Status:** fixed in `4711044`.

Plugin backend secrets use AES-256-GCM authenticated encryption at rest. A
dedicated 32+ character `PLUGIN_SECRET_ENCRYPTION_KEY` is supported and
recommended; `JWT_SECRET` is a compatibility fallback. Legacy plaintext values
are refused rather than silently used.

### FD-PLUG-09 — Insufficient package parser limits (MEDIUM)

**Status:** fixed in `4711044`.

ZIP imports now enforce archive, entry, manifest and module limits; validate
paths, flags, bounds, compression method, sizes and CRC; and reject duplicate or
ambiguous manifest/module entries.

### FD-PLUG-10 — Plugin artifacts absent from backup/restore (MEDIUM)

**Status:** fixed in `4711044`.

Backups include the plugin artifact bucket. Restore preserves the immutable
layout and reapplies restrictive file permissions.

### FD-PLUG-11 — Vulnerable dependency graph (HIGH)

**Status:** fixed in `4711044`.

Runtime and build dependencies were upgraded. A clean full `npm audit` reports
zero production or development vulnerabilities. CI now installs from the lock
file and runs audit, unit/integration, build and Chromium E2E gates on Node 22.

### FD-PLUG-12 — Standalone production image could not open SQLite (MEDIUM)

**Status:** fixed in `4711044` during container smoke testing.

The image now defaults all writable state to `/data`. Its entrypoint prepares
the mounted directory and then starts Node as UID/GID 1001.

## Empirical verification

The following checks passed from a clean `npm ci` under Node `22.22.2`:

- i18n dictionaries aligned: 1047 English and 1047 Italian keys;
- unit/integration/security suite: 101 passed, 0 failed;
- Vite 8 production build: passed;
- complete dependency audit: 0 vulnerabilities;
- Playwright Chromium E2E: 6 passed, 0 failed;
- Docker production image: built successfully;
- container smoke: `/api/health` returned `200`, with the Node process running
  as UID/GID `1001:1001`.

The browser suite exercises anonymous access, the real dev-login UI, owner
catalogue/search/admin/deep links, read-only admin and standard-user RBAC,
logout/session invalidation, approved role-filtered plugin loading, revocation,
`onUnload`, reapproval and the global kill switch. It also asserts that plugin
runtime and asset requests do not occur while the feature is disabled.

The OpenClaw interactive browser runner refused navigation to the local test
server under its localhost safety policy. This was a tooling restriction, not
an application failure; the same production build completed the requested
browser verification through real headless Chromium in Playwright.

## Residual risks and operating constraints

- Reviewed plugin code shares `window`, DOM, storage and ambient browser
  authority with FrontDoor. Do not install code from an untrusted publisher.
- Revocation prevents future loads and clears registered contributions, but
  cannot undo side effects already performed by a plugin.
- A synchronous infinite loop cannot be interrupted in the current realm.
- Keep `PLUGIN_SECRET_ENCRYPTION_KEY` stable and back it up separately; rotation
  requires deliberate secret migration or re-entry.
- Package review remains a human security control. Digest approval guarantees
  that reviewed bytes are the bytes served; it does not prove those bytes safe.

## Migration and rollback

Before upgrade, back up the SQLite database, `/data/plugins`, and the plugin
secret encryption key. Remote-entry plugins must be exported or rebuilt as
local packages, imported and reapproved. Existing plaintext backend secrets
must be entered again. Database changes are additive, so an older core can
ignore the new columns; restore the pre-upgrade database and plugin asset bucket
for a complete rollback.

## Release gate

The branch is shippable for the documented reviewed first-party plugin model.
Any proposal to accept untrusted or marketplace code reopens a stop-ship HIGH
finding until execution moves behind a sandboxed, message-based boundary.
