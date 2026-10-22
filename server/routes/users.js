import express from 'express';
import db from '../db.js';
import { createPreferenceUpdate } from '../services/userPreferences.js';
import { logRbacAudit } from '../db.js';
import { authenticate, isAdminViewer, isAdminEditor, ROLE_OWNER } from '../middleware/auth.js';
import { ensureAvatarCached, serveAvatarForUser } from '../services/avatars.js';
import { iconUrlForApp } from '../services/appIcons.js';
import { NOTIFICATION_TYPES, resolveNotifications } from '../services/notifications.js';
import { getAccessibleGroupIdsForUser } from '../services/groupHierarchy.js';
import { isSupportedLanguage } from '../../shared/languages.js';
import { isSupportedColorScheme, normalizeOptionalColorScheme } from '../../shared/colorSchemes.js';
import { isSupportedTimeZone, normalizeOptionalTimeZone } from '../../shared/timeZones.js';

const router = express.Router();
const composeAdminEmails = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

const isComposeLockedAdmin = (email) => composeAdminEmails.has((email || '').trim().toLowerCase());
const isEditorRole = (role) => ['owner', 'admin'].includes(role);
const resolveAppUrl = (app) => (app.mode === 'redirect'
  ? `/api/apps/${app.slug}/sso-redirect`
  : app.mode === 'entra-app'
    ? `/api/apps/${app.slug}/entra-redirect`
    : app.target_url);

const remainingEditorCountExcluding = (userId) => db
  .prepare("SELECT COUNT(*) AS count FROM users WHERE role IN ('owner', 'admin') AND is_active = 1 AND id != ?")
  .get(userId).count;

// List users with group membership counts (viewer roles only)
router.get('/', authenticate, isAdminViewer, (req, res) => {
  const users = db
    .prepare(`
      SELECT u.id, u.email, u.display_name, u.role, u.avatar_color, u.is_active, u.last_login, u.last_activity_at, u.created_at,
        u.entra_missing_since, u.home_desktop_view, u.preferred_language, u.preferred_timezone, u.preferred_color_scheme, u.app_order, u.app_order_updated_at,
        (SELECT COUNT(*) FROM user_group_members WHERE user_id = u.id) AS group_count
      FROM users u ORDER BY u.display_name
    `)
    .all()
    .map((user) => ({
      ...user,
      is_compose_locked_admin: isComposeLockedAdmin(user.email),
    }));
  res.json({ users });
});

// Serve cached user avatar or discover it on demand (authenticated)
router.get('/:id/avatar', authenticate, async (req, res) => {
  const user = db.prepare('SELECT id, email, microsoft_id, display_name, avatar_color FROM users WHERE id = ?').get(req.params.id);

  if (!user) {
    return res.status(404).end();
  }

  try {
    await ensureAvatarCached(user);
    await serveAvatarForUser(user, res);
  } catch (error) {
    console.error(`Avatar serve failed for user ${user.id}:`, error.message);
    res.status(404).end();
  }
});

// Reset one or more personal preferences for a specific user (editor roles only).
router.put('/:id/preferences', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;
  const changes = createPreferenceUpdate();

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found', code: 'user_not_found' });
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'homeDesktopView')) {
    const { homeDesktopView } = req.body;
    if (homeDesktopView !== null && !['cards', 'compact'].includes(homeDesktopView)) {
      return res.status(400).json({ error: 'homeDesktopView must be cards, compact, or null', code: 'invalid_home_view' });
    }
    changes.set('home_desktop_view', homeDesktopView);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'preferredLanguage')) {
    const { preferredLanguage } = req.body;
    if (preferredLanguage !== null && !isSupportedLanguage(preferredLanguage)) {
      return res.status(400).json({ error: 'preferredLanguage must be a supported language or null', code: 'invalid_language' });
    }
    changes.set('preferred_language', preferredLanguage);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'preferredTimeZone')) {
    const { preferredTimeZone } = req.body;
    if (preferredTimeZone !== null && !isSupportedTimeZone(preferredTimeZone)) {
      return res.status(400).json({ error: 'preferredTimeZone must be a supported time zone or null', code: 'invalid_time_zone' });
    }
    changes.set('preferred_timezone', normalizeOptionalTimeZone(preferredTimeZone));
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'preferredColorScheme')) {
    const { preferredColorScheme } = req.body;
    if (preferredColorScheme !== null && !isSupportedColorScheme(preferredColorScheme)) {
      return res.status(400).json({ error: 'preferredColorScheme must be light, dark, auto, or null', code: 'invalid_color_scheme' });
    }
    changes.set('preferred_color_scheme', normalizeOptionalColorScheme(preferredColorScheme));
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'appOrder')) {
    const { appOrder } = req.body;
    if (appOrder !== null && !Array.isArray(appOrder)) {
      return res.status(400).json({ error: 'appOrder must be an array or null', code: 'invalid_app_order' });
    }
    if (Array.isArray(appOrder)) {
      const normalized = [...new Set(appOrder.filter((item) => typeof item === 'string' && item.trim()))];
      if (normalized.length > 0) {
        changes.set('app_order', JSON.stringify(normalized), { touch: 'app_order_updated_at' });
      } else {
        changes.set('app_order', null, { touch: 'app_order_updated_at' });
      }
    } else {
      changes.set('app_order', null, { touch: 'app_order_updated_at' });
    }
  }

  if (changes.size === 0) {
    return res.status(400).json({ error: 'No preference updates provided', code: 'no_preference_updates' });
  }

  changes.apply(db, id);

  res.json({ ok: true });
});

// Get single user with group memberships (viewer roles only)
router.get('/:id', authenticate, isAdminViewer, (req, res) => {
  const user = db
    .prepare('SELECT id, email, display_name, role, avatar_color, home_desktop_view, preferred_language, preferred_timezone, preferred_color_scheme, app_order, app_order_updated_at, favorite_apps, favorite_apps_updated_at, home_tour_seen_at, is_active, entra_missing_since, last_login, last_activity_at, created_at FROM users WHERE id = ?')
    .get(req.params.id);

  if (!user) return res.status(404).json({ error: 'User not found', code: 'user_not_found' });

  // Same resolution as the access check, so the groups listed explain the visible apps
  // (direct memberships, linked groups and groups reached through Entra links).
  const effectiveGroupIds = getAccessibleGroupIdsForUser(req.params.id);
  const groups = effectiveGroupIds.length > 0
    ? db.prepare(`
      SELECT id, name, description, source, entra_display_name
      FROM user_groups
      WHERE id IN (${effectiveGroupIds.map(() => '?').join(', ')})
      ORDER BY name
    `).all(...effectiveGroupIds)
    : [];

  const entraGroups = db.prepare(`
    SELECT
      m.entra_group_id,
      COALESCE(c.display_name, m.entra_group_id) AS display_name,
      c.first_seen_at,
      c.last_seen_at,
      g.id AS local_group_id,
      g.name AS local_name,
      g.source AS local_source,
      g.entra_synced_at AS local_synced_at
    FROM entra_user_group_memberships m
    LEFT JOIN entra_group_cache c
      ON c.entra_group_id = m.entra_group_id
    LEFT JOIN user_groups g
      ON g.entra_group_id = m.entra_group_id
     AND g.source = 'entra'
    WHERE m.user_id = ?
    GROUP BY m.entra_group_id
    ORDER BY display_name
  `).all(req.params.id).map((row) => ({
    ...row,
    is_imported: Boolean(row.local_group_id),
  }));

  const accessibleGroupIds = getAccessibleGroupIdsForUser(req.params.id);
  const visibleApps = accessibleGroupIds.length > 0
    ? db.prepare(`
      SELECT DISTINCT a.id, a.name, a.slug, a.description, a.long_description, a.icon, a.icon_file_name, a.target_url, a.mode, a.sso_endpoint, a.sso_method, a.tags, a.updated_at
      FROM apps a
      JOIN app_permissions p ON a.id = p.app_id
      WHERE p.group_id IN (${accessibleGroupIds.map(() => '?').join(', ')})
      ORDER BY a.sort_order, a.name
    `).all(...accessibleGroupIds)
    : [];

  const visibleAppsWithUrls = visibleApps.map((app) => ({
    ...app,
    url: resolveAppUrl(app),
    iconUrl: iconUrlForApp(app),
  }));

  res.json({
    user: {
      ...user,
      is_compose_locked_admin: isComposeLockedAdmin(user.email),
    },
    groups,
    entraGroups,
    visibleAppCount: visibleAppsWithUrls.length,
    visibleApps: visibleAppsWithUrls,
  });
});

// Update user role (editor roles only)
router.put('/:id/role', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const normalizedRole = role === 'superadmin' ? 'owner' : role;

  if (!['owner', 'admin', 'admin_readonly', 'user'].includes(normalizedRole)) {
    return res.status(400).json({ error: 'role must be owner, admin, admin_readonly or user', code: 'invalid_role' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found', code: 'user_not_found' });
  }

  if (user.role === normalizedRole) {
    return res.json({ role: normalizedRole });
  }

  if (isComposeLockedAdmin(user.email) && normalizedRole !== ROLE_OWNER) {
    return res.status(400).json({ error: 'Compose owner cannot be changed from the webapp', code: 'compose_owner_change' });
  }

  if (normalizedRole === ROLE_OWNER && !isComposeLockedAdmin(user.email)) {
    return res.status(400).json({ error: 'Owner can only be assigned from compose/run', code: 'owner_assignment_forbidden' });
  }

  if (isEditorRole(user.role) && !isEditorRole(normalizedRole) && remainingEditorCountExcluding(id) === 0) {
    return res.status(400).json({ error: 'Cannot remove the last active admin editor', code: 'last_admin_editor_remove' });
  }

  db.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?').run(normalizedRole, id);
  logRbacAudit(req.user.id, 'update', 'role', id, {
    email: user.email,
    changes: [{ field: 'role', from: user.role, to: normalizedRole }],
  });
  res.json({ role: normalizedRole });
});

// Activate/deactivate user (editor roles only)
router.put('/:id/active', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (![0, 1, true, false].includes(is_active)) {
    return res.status(400).json({ error: 'is_active must be 0, 1, true, or false', code: 'invalid_is_active' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found', code: 'user_not_found' });
  }

  const activeValue = is_active ? 1 : 0;

  // Nothing to change: same status, and no "missing from Entra" mark left to clear on reactivation.
  if (user.is_active === activeValue && !(activeValue && user.entra_missing_since)) {
    return res.json({ is_active: activeValue });
  }

  if (isComposeLockedAdmin(user.email) && !activeValue) {
    return res.status(400).json({ error: 'Compose owner cannot be deactivated from the webapp', code: 'compose_owner_deactivate' });
  }

  // Prevent deactivating yourself
  if (id === req.user.id && !is_active) {
    return res.status(400).json({ error: 'Cannot deactivate yourself', code: 'cannot_deactivate_self' });
  }

  // Prevent deactivating the last active admin editor
  if (!activeValue && isEditorRole(user.role) && remainingEditorCountExcluding(id) === 0) {
    return res.status(400).json({ error: 'Cannot deactivate the last active admin editor', code: 'last_admin_editor_deactivate' });
  }

  // Reactivating clears the "not found in Entra" mark; the next force sync sets it again if the user is still missing.
  db.prepare(`
    UPDATE users
    SET is_active = ?, entra_missing_since = CASE WHEN ? = 1 THEN NULL ELSE entra_missing_since END, updated_at = datetime('now')
    WHERE id = ?
  `).run(activeValue, activeValue, id);
  logRbacAudit(req.user.id, activeValue ? 'activate' : 'deactivate', 'user_status', id, { email: user.email, role: user.role });
  if (activeValue) resolveNotifications(NOTIFICATION_TYPES.USER_DEACTIVATED_ENTRA, id, req.user.id);
  res.json({ is_active: activeValue });
});

// Delete user permanently (editor roles only) — cascades membership and access logs
router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found', code: 'user_not_found' });
  }

  // Prevent deleting yourself
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself', code: 'cannot_delete_self' });
  }

  if (isComposeLockedAdmin(user.email)) {
    return res.status(400).json({ error: 'Compose owner cannot be deleted from the webapp', code: 'compose_owner_delete' });
  }

  // Prevent deleting the last active admin editor
  if (isEditorRole(user.role) && remainingEditorCountExcluding(id) === 0) {
    return res.status(400).json({ error: 'Cannot delete the last active admin editor', code: 'last_admin_editor_delete' });
  }

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM user_group_members WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM entra_user_group_memberships WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM access_logs WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  deleteAll();
  logRbacAudit(req.user.id, 'delete', 'user_status', id, { name: user.display_name, email: user.email, role: user.role });
  resolveNotifications(NOTIFICATION_TYPES.USER_DEACTIVATED_ENTRA, id, req.user.id);
  resolveNotifications(NOTIFICATION_TYPES.USER_FIRST_SIGN_IN, id, req.user.id);

  res.json({ deleted: true });
});

export default router;
