# FrontDoor Plugin Host

FrontDoor loads reviewed, packaged plugins through an authenticated runtime host. The
global switch is off by default. The plugin manager remains available while the
switch is off so owners can inspect, approve, revoke, or remove packages without
executing them.

## Trust model

The current host runs plugin JavaScript in FrontDoor's browser realm. Capabilities
limit the host API, but they are not a JavaScript sandbox: plugin code can still use
ambient browser APIs. Only reviewed first-party code is supported for this release.
Untrusted third-party plugins require a future iframe or worker isolation protocol.

Production plugins must be installed as a JSON or ZIP package. Remote module URLs
and build-time manifest/module lists are rejected. The built-in ticket plugin can be
enabled only during development with `VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN=true`.

## Package and approval

A JSON package contains a manifest and a self-contained ES module:

```json
{
  "manifest": {
    "apiVersion": 1,
    "id": "ticket-plugin",
    "name": "Ticket Plugin",
    "version": "1.0.0",
    "permissions": ["actions.write", "routes.write", "notifications.write"],
    "roles": ["owner", "admin"]
  },
  "moduleSource": "export function register(api) { api.registerRoute({ id: 'ticket-plugin.route', path: '/plugins/ticket-center', label: 'Ticket Center' }); }"
}
```

A ZIP package contains exactly one unambiguous `manifest.json` and `module.mjs`,
normally below a single package directory:

```text
ticket-plugin-1.0.0/
  manifest.json
  module.mjs
```

ZIP input is bounded and validated for paths, entry count, sizes, header
consistency, supported flags, and CRC-32. FrontDoor writes the module to an
immutable content-addressed local path and calculates SHA-256 over both the
artifact and canonical security metadata. New and updated plugins remain pending
until an owner approves that exact digest. Any change to code, permissions, roles,
backend configuration, events, or version invalidates approval.

## Manifest contract

```json
{
  "apiVersion": 1,
  "id": "ticket-plugin",
  "name": "Ticket Plugin",
  "version": "1.0.0",
  "description": "Adds a ticket action and route",
  "permissions": [
    "actions.write",
    "routes.write",
    "navigation.use",
    "notifications.write"
  ],
  "roles": ["owner", "admin"],
  "backend": {
    "enabled": true,
    "url": "https://plugins.example.com/frontdoor-webhook",
    "eventSubscriptions": ["auth.login", "app.access"]
  }
}
```

Supported roles are `owner`, `admin`, `admin_readonly`, and `user`. Plugin routes
must be static paths below `/plugins/`; they cannot shadow core routes. Unknown
permissions, roles, events, surfaces, access levels, or API versions fail closed.

## Module contract and capabilities

The module exports `register(api)` and may export `onUnload({ pluginId, reason })`.
It must be self-contained; relative imports from the FrontDoor source tree are not
available to uploaded packages.

```js
export function register(api) {
  api.registerAction({
    id: 'create-ticket',
    label: 'Create Ticket',
    surface: 'layout.accountMenu',
    onClick: () => api.notify({ type: 'success', message: 'Ticket flow opened' }),
  });
}

export function onUnload({ reason }) {
  // Remove timers, listeners, and other resources created by the plugin.
  console.info(`Ticket plugin unloaded: ${reason}`);
}
```

The host exposes a method only when its matching permission was approved:

- `actions.write` -> `registerAction()`
- `surfaces.write` -> `registerSurface()`
- `routes.write` -> `registerRoute()`
- `navigation.write` -> `registerNavigationItem()`
- `user.read` -> `getCurrentUser()`
- `branding.read` -> `getBranding()`
- `language.read` -> `getLanguage()` and `getUiStrings()`
- `navigation.use` -> `navigate()` and internal link targets
- `notifications.write` -> `notify()`
- `external-links.open` -> `openExternalUrl()` and HTTPS link targets

Host data is returned as a detached, frozen snapshot. External links must use
HTTPS without embedded credentials. Lifecycle cleanup runs on replacement,
revocation, deletion, switch-off, and provider unmount; local and cross-tab
registry changes trigger reload or cleanup.

## Runtime and authorisation

`/api/plugins/runtime` and `/api/plugins/files/...` require an authenticated
session. Runtime results and artifact downloads are filtered by plugin roles.
Artifacts use digest-based URLs, are re-hashed before serving, and are returned
with private immutable caching and `nosniff`. Anonymous users, disallowed roles,
pending plugins, revoked plugins, disabled plugins, and digest mismatches cannot
retrieve executable bytes.

## Backend events

Supported events are `auth.login`, `auth.devLogin`, and `app.access`; wildcard
subscriptions are rejected. Payloads use event-specific allowlists and exclude
email addresses, display names, Microsoft identifiers, internal call context, and
arbitrary caller fields.

Webhook URLs must use HTTPS on port 443 with no embedded credentials. FrontDoor
resolves all addresses immediately before connecting, rejects private, loopback,
link-local, metadata, mapped, reserved, and mixed DNS answers, pins the validated
address for the connection, does not follow redirects, and limits request size and
duration. Backend secrets are stored with AES-256-GCM. Set a stable 32+ character
`PLUGIN_SECRET_ENCRYPTION_KEY`; otherwise `JWT_SECRET` is used as a
rotation-coupled fallback.

## Operations, backup, and migration

- Set `PLUGIN_ASSET_DIR` to persistent storage; Docker Compose uses `/data/plugins`.
- FrontDoor backups include the registry and immutable plugin artifacts. Restore
  them together and retain the encryption key used for backend secrets.
- Back up the database and plugin asset directory before an upgrade or rollback.
- Legacy remote-entry plugins are not migrated to executable packages. Repackage
  the reviewed module, import it, and approve the new digest.
- A legacy plaintext backend secret is never sent; re-enter it once so FrontDoor
  can store an encrypted value.
- Revocation, import, update, deletion, runtime authorisation, delivery, and
  delivery failures are written to the plugin audit trail without secret values.

Useful surfaces include `layout.nav.desktop`, `layout.nav.mobile`,
`layout.accountMenu`, `home.hero.after`, `home.controls.before`,
`home.controls.after`, `home.catalog.before`, `home.catalog.after`,
`admin.header.actions`, `admin.page.top`, `admin.page.bottom`,
`customization.page.top`, `customization.page.bottom`,
`customization.section.sidebar`, and `customization.section.body`.
