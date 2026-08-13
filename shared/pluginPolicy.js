export const PLUGIN_API_VERSION = 1;

export const PLUGIN_PERMISSIONS = Object.freeze({
  ACTIONS_WRITE: 'actions.write',
  SURFACES_WRITE: 'surfaces.write',
  ROUTES_WRITE: 'routes.write',
  NAVIGATION_WRITE: 'navigation.write',
  USER_READ: 'user.read',
  BRANDING_READ: 'branding.read',
  LANGUAGE_READ: 'language.read',
  NAVIGATION_USE: 'navigation.use',
  NOTIFICATIONS_WRITE: 'notifications.write',
  EXTERNAL_LINKS_OPEN: 'external-links.open',
});

export const SUPPORTED_PLUGIN_PERMISSIONS = Object.freeze(
  Object.values(PLUGIN_PERMISSIONS)
);

export const SUPPORTED_PLUGIN_EVENTS = Object.freeze([
  'auth.login',
  'auth.devLogin',
  'app.access',
]);

export const SUPPORTED_PLUGIN_ROLES = Object.freeze([
  'owner',
  'admin',
  'admin_readonly',
  'user',
]);

export function validatePluginPermissions(permissions = []) {
  const normalized = [...new Set(
    (Array.isArray(permissions) ? permissions : [])
      .map((permission) => String(permission ?? '').trim())
      .filter(Boolean)
  )];
  const supported = new Set(SUPPORTED_PLUGIN_PERMISSIONS);
  const unknown = normalized.filter((permission) => !supported.has(permission));
  if (unknown.length > 0) {
    throw new Error(`Unsupported plugin permission(s): ${unknown.join(', ')}`);
  }
  return normalized;
}

export function validatePluginEventSubscriptions(events = []) {
  const normalized = [...new Set(
    (Array.isArray(events) ? events : [])
      .map((event) => String(event ?? '').trim())
      .filter(Boolean)
  )];
  const supported = new Set(SUPPORTED_PLUGIN_EVENTS);
  const unknown = normalized.filter((event) => !supported.has(event));
  if (unknown.length > 0) {
    throw new Error(`Unsupported plugin event subscription(s): ${unknown.join(', ')}`);
  }
  return normalized;
}

export function validatePluginRoles(roles = []) {
  const normalized = [...new Set(
    (Array.isArray(roles) ? roles : [])
      .map((role) => String(role ?? '').trim())
      .filter(Boolean)
  )];
  const supported = new Set(SUPPORTED_PLUGIN_ROLES);
  const unknown = normalized.filter((role) => !supported.has(role));
  if (unknown.length > 0) {
    throw new Error(`Unsupported plugin role(s): ${unknown.join(', ')}`);
  }
  return normalized;
}
