export const PLUGIN_DOC_ENV_HINTS = [
  'PLUGIN_ASSET_DIR=/data/plugins',
  'PLUGIN_SECRET_ENCRYPTION_KEY=<stable 32+ character secret>',
  'VITE_FRONTDOOR_ENABLE_SAMPLE_PLUGIN=true (development only)',
];

export function manifestExample() {
  return `{
  "id": "ticket-plugin",
  "name": "Ticket Plugin",
  "version": "1.0.0",
  "description": "Adds a ticket creation action, route and surface",
  "permissions": ["actions.write", "routes.write", "surfaces.write", "notifications.write"],
  "roles": ["owner", "admin"],
  "backend": {
    "enabled": true,
    "url": "https://plugins.example.com/frontdoor-webhook",
    "eventSubscriptions": ["auth.login", "app.access"]
  }
}`;
}

export function packageExample() {
  return `{
  "manifest": {
    "id": "ticket-plugin",
    "name": "Ticket Plugin",
    "version": "1.0.0",
    "description": "Adds a ticket console, quick actions and a summary surface.",
    "author": "FrontDoor",
    "permissions": ["actions.write", "routes.write", "surfaces.write"],
    "roles": ["owner", "admin"]
  },
  "moduleSource": "export function register(api) {\\n  api.registerRoute({\\n    id: 'ticket-plugin.route',\\n    path: '/plugins/ticket-center',\\n    label: 'Ticket Center'\\n  });\\n}\\n\\nexport default { register };"
}`;
}

export function moduleExample() {
  return `export function register(api) {
  api.registerAction({
    id: 'create-ticket',
    label: 'Create Ticket',
    surface: 'layout.accountMenu',
    order: 20,
    onClick: () => api.notify({ type: 'success', message: 'Ticket flow opened' }),
  });
}

export function onUnload({ reason }) {
  console.info('Ticket plugin unloaded:', reason);
}`;
}
