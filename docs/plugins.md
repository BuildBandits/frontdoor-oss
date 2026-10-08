# Frontdoor Plugin Host

> **Status:** the plugin platform is locked off in the current releases: plugin routes answer `404` and the server keeps the plugin setting off. The work required before unlocking it is tracked in [#90](https://github.com/BuildBandits/frontdoor-oss/issues/90). This document describes the design.

Frontdoor can load plugins at runtime through a lightweight host. Plugins run in the page origin, so only reviewed and owner-approved code should ever be enabled.

## Loader inputs

Set one or more URLs before building or deploying:

- `VITE_FRONTDOOR_PLUGIN_MANIFESTS`
- `VITE_FRONTDOOR_PLUGIN_MODULES`
- `VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN`

`VITE_FRONTDOOR_PLUGIN_MANIFESTS` and `VITE_FRONTDOOR_PLUGIN_MODULES` accept a comma-separated or newline-separated list.
`VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN` is a boolean flag that loads the built-in ticket example.

## Manifest contract

```json
{
  "id": "ticket-plugin",
  "name": "Ticket Plugin",
  "version": "1.0.0",
  "description": "Adds a ticket creation action, route and surface",
  "entry": "https://cdn.example.com/ticket-plugin/index.js",
  "permissions": ["actions.write", "routes.write"],
  "roles": ["owner", "admin"],
  "backend": {
    "enabled": true,
    "url": "https://plugins.example.com/frontdoor-webhook",
    "eventSubscriptions": ["auth.login", "app.access"]
  }
}
```

## Module contract

The module should export a `register(api)` function. For convenience, the SDK also exposes `definePlugin()` and `definePluginManifest()` helpers for canonical metadata and plugin definitions.

```js
import { definePlugin, definePluginManifest } from '../pluginHost/sdk';

export const manifest = definePluginManifest({
  id: 'ticket-plugin',
  name: 'Ticket Plugin',
  version: '1.0.0',
});

export function register(api) {
  api.registerAction({
    id: 'create-ticket',
    label: 'Create Ticket',
    surface: 'layout.accountMenu',
    onClick: async () => {
      api.notify({ type: 'success', message: 'Ticket flow opened' });
    },
  });
}

export default definePlugin({
  manifest,
  register,
});
```

## Runtime API

The plugin host currently exposes:

- `getCurrentUser()`
- `getBranding()`
- `getLanguage()`
- `getUiStrings()`
- `navigate()`
- `notify()`
- `openExternalUrl()`
- `registerAction()`
- `registerSurface()`
- `registerRoute()`
- `registerNavigationItem()`

## Server registry

Frontdoor can also persist plugin metadata in SQLite and expose it through `/api/plugins`.
The runtime loader will read `/api/plugins/runtime` and load any enabled plugin that has a frontend `entry`.
The admin screen also shows the server registry separately from the in-memory runtime snapshot.
Plugins can also opt into backend event dispatch by declaring a `backend.url` and `backend.eventSubscriptions`.
Backend dispatch only targets plugins that are both enabled and approved.
From the admin page you can install a plugin by filling in the manifest fields, pasting a module source, uploading a single JSON package, or pointing to an external `entry` URL.
New installs are created as pending until an owner approves them from the same admin screen.
The same page can export the current draft as a JSON package and open a validation wizard before installation or approval.
It can also import or export a ZIP archive containing `manifest.json` and `module.mjs`.

### Package format

For one-file installs, Frontdoor accepts a JSON package with a `manifest` object and optional `moduleSource` string.
The module source should be self-contained and export `register(api)` directly.

```json
{
  "manifest": {
    "id": "ticket-plugin",
    "name": "Ticket Plugin",
    "version": "1.0.0",
    "permissions": ["actions.write", "routes.write", "surfaces.write"],
    "roles": ["owner", "admin"]
  },
  "moduleSource": "export function register(api) { api.registerRoute({ id: 'ticket-plugin.route', path: '/plugins/ticket-center', label: 'Ticket Center' }); } export default { register };"
}
```

The validation wizard highlights the package risk level, required permissions, backend webhook exposure, and the raw package payload before approval.

### ZIP package

Frontdoor also accepts a ZIP archive with the following structure:

```text
my-plugin-1.0.0/
  manifest.json
  module.mjs
```

The ZIP file is ideal for third-party plugins that want a single distributable bundle.

### Audit trail

Plugin approvals and revocations are recorded in the audit log with target type `plugin`, so owners can review who approved or rejected a package later.
The dedicated admin view is available at `/admin/plugins/audit`.

## Surfaces

Useful built-in surfaces include:

- `layout.nav.desktop`
- `layout.nav.mobile`
- `layout.accountMenu`
- `home.hero.after`
- `home.controls.after`
- `home.catalog.after`
- `admin.header.actions`
- `admin.page.top`
- `admin.page.bottom`
- `customization.page.top`
- `customization.page.bottom`
