# FrontDoor plugin hardening plan

Status: completed on 2026-08-13 for the reviewed first-party plugin trust model

Branch: `hardening/plugin-system-shippable`

Base: `lombax85/oss-frontdoor@7f9842704fdb65aa82e370b110d749fe95599a11`

## Goal

Make the FrontDoor plugin system safe and predictable enough to ship without
regressing FrontDoor's standard behaviour. The result must be demonstrated by
repeatable unit, integration, end-to-end, and real-browser tests rather than by
manual inspection alone.

"Shippable" means all of the following are true:

- no open critical or high-severity finding in the plugin trust boundary;
- disabling plugins preserves the existing core routes, login, catalogue,
  administration, branding, and RBAC behaviour;
- only authenticated and authorised users can obtain or execute a plugin;
- approval is bound to an immutable, content-addressed plugin artifact;
- every granted capability is enforced at runtime and defaults to deny;
- revocation and the global kill switch stop future plugin execution and run
  registered cleanup for the current page lifecycle;
- outbound plugin delivery resists SSRF, redirect, DNS rebinding, and accidental
  disclosure of user data;
- the complete automated test and build matrix is green in the supported Node
  and Chromium environment;
- upgrade, rollback, operations, and residual-risk documentation is complete.

## Trust boundaries and current risks

The plugin subsystem crosses four trust boundaries:

1. an administrator imports code and metadata into FrontDoor;
2. an owner reviews and approves that code;
3. the browser downloads and runs the approved artifact inside the application;
4. the server sends selected events to an optional plugin backend.

The hardening work starts from these verified risks:

- plugin modules currently execute through dynamic `import()` in FrontDoor's
  main browser realm;
- manifest permissions are metadata and do not constrain the API exposed to a
  plugin;
- approval identifies a registry row, not the exact bytes that execute;
- runtime metadata and plugin files can be fetched without an authenticated
  and role-authorised request;
- revocation does not invoke the parsed `onUnload` hook;
- backend URL checks do not cover IPv6, DNS resolution, redirects, or rebinding;
- wildcard event subscriptions and broad payloads can disclose user data;
- audit coverage is incomplete for import, update, load, delivery, and failure;
- remote module URLs conflict with the production Content Security Policy.

## Architectural decisions

### 1. Core-off invariant

The global switch remains fail-closed and off by default. With the switch off,
the browser does not request plugin runtime metadata or assets, no plugin route
or surface is registered, and no backend event is delivered. Core requests and
rendering must not depend on plugin storage being available.

### 2. Immutable local artifacts

The first shippable release accepts packaged JavaScript only. FrontDoor stores
the package locally, calculates SHA-256 over the executable artifact and the
canonical security-relevant manifest, and records the digest. Approval records
the same digest. Any code, entry, permission, role, backend, subscription, or
version change invalidates approval.

Arbitrary `http(s)` module entries and build-time environment source lists are
legacy development mechanisms and are not accepted as production plugins.

### 3. Capabilities are deny-by-default

The host exposes only capabilities declared in the manifest and approved for
the current digest. Registration methods are separately gated (`actions.write`,
`surfaces.write`, `routes.write`, `navigation.write`) and user/context methods
are gated (`user.read`, `branding.read`, `language.read`, `navigation.use`,
`notifications.write`, `external-links.open`). Unknown permissions fail import.

Entry visibility is not an authorisation boundary. The host must also reject
registration or execution when the active user does not satisfy the plugin and
entry role/access policy.

### 4. Containment and lifecycle

The implementation will first remove ambient trust (remote code, mutable
artifacts, over-broad APIs) and make lifecycle deterministic. A browser-realm
plugin still shares the page's JavaScript authority; therefore support for
untrusted third-party code requires a sandboxed iframe/worker protocol before
that trust level can be advertised. Until then, the supported trust level is
reviewed first-party code with enforced host capabilities.

The registry stores cleanup hooks and invokes them on replacement, revocation,
switch-off, and provider unmount. Cleanup is idempotent and bounded; a failed
cleanup is isolated and audited.

### 5. Safe outbound delivery

Backend delivery uses HTTPS by default, a strict event allowlist, minimal
event-specific payload schemas, bounded request size/time, and no automatic
redirects. Hostnames are resolved immediately before connection and every
address must be public; IPv4, IPv6, mapped addresses, loopback, link-local,
private, multicast, and metadata ranges are rejected. Delivery failures do not
include secrets in logs or API responses.

## Delivery phases

### Phase A - executable regression baseline

- add Playwright with an isolated SQLite database and deterministic dev login;
- cover owner, read-only administrator, and standard-user core flows;
- verify login, home catalogue, search/navigation, admin access boundaries,
  branding API, logout, health endpoint, and deep-link fallback;
- assert the plugin switch is off and no runtime/plugin-file request occurs;
- save browser traces/screenshots only on failure and keep them out of Git.

### Phase B - package and approval integrity

- canonicalise manifests and define the supported permission/event vocabulary;
- calculate and persist artifact/approval digests;
- reject mutable remote entries, malformed archives, unsafe paths, oversize
  packages, unknown capabilities, and unsupported API versions;
- invalidate approval atomically on every security-relevant change;
- serve assets using digest-based paths with restrictive content headers.

### Phase C - runtime and authorisation

- require session auth for runtime metadata and asset downloads;
- filter runtime payloads by user/plugin roles;
- enforce capabilities in the plugin host API;
- make route/action/surface checks deny-by-default;
- implement deterministic unload/reload/kill-switch behaviour;
- add negative tests for capability and role bypasses.

### Phase D - backend and privacy

- replace syntactic URL checks with connect-time network validation;
- disable redirects and validate resolved IPv4/IPv6 addresses;
- introduce event schemas and remove wildcard subscriptions;
- redact secrets and minimise payload/context fields;
- audit import, update, approve, revoke, delete, load, delivery, and failure.

### Phase E - ship gate

- run the unit/integration suite serially and remove shared-database races;
- run Playwright E2E in Chromium against a production build;
- perform an independent interactive browser pass of the critical scenarios;
- run i18n, build, dependency audit, and targeted security regression tests;
- document migration from legacy entries, backup/rollback, and known residual
  risks; publish a final ship/no-ship report.

Result: the complete Node 22 gate, production build, Chromium E2E suite,
dependency audit, Docker image build, and non-root container smoke test passed.
The ship decision and residual trust boundary are recorded in
`security/security-audit-20260813-plugin-system.md`.

## Required test matrix

| Mode | Persona | Required result |
| --- | --- | --- |
| Plugins off | anonymous | Login and public core endpoints work; plugin assets are unavailable |
| Plugins off | owner | Core Home and Admin work; plugin UI/routes/runtime are absent |
| Plugins off | user | Catalogue works; Admin remains forbidden |
| Plugins on | owner | Approved plugin appears; pending/revoked/tampered plugins do not |
| Plugins on | admin_readonly | Read-only access is preserved; mutation/approval remains forbidden |
| Plugins on | user | Only role-authorised plugin contributions execute or render |
| Kill switch | any | Registry is cleared, cleanup runs, future delivery/load is blocked |
| Tamper/update | owner | Digest mismatch or any relevant change invalidates approval |
| Backend | owner test event | Public HTTPS target only; redirects/private networks are blocked |

## CI and local gates

The branch is not ready to merge unless these commands pass from a clean
checkout:

```bash
npm ci
npm run check:i18n
npm test
npm run build
npm run test:e2e
npm audit --omit=dev
```

The final gate also checks that generated databases, Playwright artifacts,
uploaded plugin bundles, and secrets are not tracked.

## Compatibility contract

Standard FrontDoor behaviour has priority over legacy plugin behaviour. Existing
core API and UI contracts must remain compatible. A legacy remote-entry plugin
may require repackaging and reapproval; it must never silently retain approval
after migration. Database migrations must be additive and older core versions
must continue to ignore the new fields, enabling code rollback after a database
backup.

## Stop-ship conditions

Any of these blocks release:

- a plugin can execute without an authenticated, role-authorised runtime request;
- approval survives a change to code or security-relevant metadata;
- a denied capability can be called or registered indirectly;
- a plugin backend can reach a private/loopback/link-local/metadata address;
- switching plugins off changes a standard core flow;
- an automated browser scenario is flaky or relies on production credentials;
- any critical/high plugin finding remains open without an explicit decision to
  remove the affected feature from the release.
