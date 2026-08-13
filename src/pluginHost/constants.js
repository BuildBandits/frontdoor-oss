export {
  PLUGIN_API_VERSION,
  PLUGIN_PERMISSIONS,
  SUPPORTED_PLUGIN_PERMISSIONS,
  SUPPORTED_PLUGIN_ROLES,
  validatePluginPermissions,
  validatePluginRoles,
} from '../../shared/pluginPolicy.js';

export const PLUGIN_ACCESS = {
  PUBLIC: 'public',
  AUTHENTICATED: 'authenticated',
  ADMIN: 'admin',
  ADMIN_EDITOR: 'adminEditor',
  OWNER: 'owner',
};

export const PLUGIN_SURFACES = {
  LAYOUT_NAV_DESKTOP: 'layout.nav.desktop',
  LAYOUT_NAV_MOBILE: 'layout.nav.mobile',
  LAYOUT_ACCOUNT_MENU: 'layout.accountMenu',
  HOME_HERO_AFTER: 'home.hero.after',
  HOME_CONTROLS_BEFORE: 'home.controls.before',
  HOME_CONTROLS_AFTER: 'home.controls.after',
  HOME_CATALOG_BEFORE: 'home.catalog.before',
  HOME_CATALOG_AFTER: 'home.catalog.after',
  ADMIN_HEADER_ACTIONS: 'admin.header.actions',
  ADMIN_PAGE_TOP: 'admin.page.top',
  ADMIN_PAGE_BOTTOM: 'admin.page.bottom',
  CUSTOMIZATION_PAGE_TOP: 'customization.page.top',
  CUSTOMIZATION_PAGE_BOTTOM: 'customization.page.bottom',
  CUSTOMIZATION_SECTION_SIDEBAR: 'customization.section.sidebar',
  CUSTOMIZATION_SECTION_BODY: 'customization.section.body',
};

export const ADMIN_ROLE_SETS = {
  viewer: ['owner', 'admin', 'admin_readonly'],
  editor: ['owner', 'admin'],
};
