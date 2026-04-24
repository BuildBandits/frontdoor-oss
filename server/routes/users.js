import express from 'express';
import db from '../db.js';
import { logRbacAudit } from '../db.js';
import { authenticate, isAdminViewer, isAdminEditor, ROLE_OWNER } from '../middleware/auth.js';
import { ensureAvatarCached, serveAvatarForUser } from '../services/avatars.js';
import { iconUrlForApp } from '../services/appIcons.js';

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
      SELECT u.id, u.email, u.display_name, u.role, u.avatar_color, u.is_active, u.last_login, u.created_at,
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
  const user = db.prepare('SELECT id, email, microsoft_id, display_name FROM users WHERE id = ?').get(req.params.id);

  if (!user) {
    return res.status(404).end();
  }

  try {
    await ensureAvatarCached(user);
    await serveAvatarForUser(user, res);
  } catch (error) {
    console.error(`Avatar serve failed for ${user.email}:`, error.message);
    res.status(404).end();
  }
});

// Get single user with group memberships (viewer roles only)
router.get('/:id', authenticate, isAdminViewer, (req, res) => {
  const user = db
    .prepare('SELECT id, email, display_name, role, avatar_color, is_active, last_login, created_at FROM users WHERE id = ?')
    .get(req.params.id);

  if (!user) return res.status(404).json({ error: 'User not found' });

  const groups = db.prepare(`
    SELECT g.id, g.name, g.description, g.source, g.entra_display_name
    FROM user_groups g JOIN user_group_members m ON g.id = m.group_id
    WHERE m.user_id = ? ORDER BY g.name
  `).all(req.params.id);

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

  const visibleApps = db.prepare(`
    SELECT DISTINCT a.id, a.name, a.slug, a.description, a.long_description, a.icon, a.icon_file_name, a.target_url, a.mode, a.sso_endpoint, a.sso_method, a.tags, a.updated_at
    FROM apps a
    JOIN app_permissions p ON a.id = p.app_id
    JOIN user_group_members m ON p.group_id = m.group_id
    WHERE m.user_id = ?
    ORDER BY a.sort_order, a.name
  `).all(req.params.id);

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
    return res.status(400).json({ error: 'role must be owner, admin, admin_readonly or user' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (isComposeLockedAdmin(user.email) && normalizedRole !== ROLE_OWNER) {
    return res.status(400).json({ error: 'Compose owner cannot be changed from the webapp' });
  }

  if (normalizedRole === ROLE_OWNER && !isComposeLockedAdmin(user.email)) {
    return res.status(400).json({ error: 'Owner can only be assigned from compose/run' });
  }

  if (isEditorRole(user.role) && !isEditorRole(normalizedRole) && remainingEditorCountExcluding(id) === 0) {
    return res.status(400).json({ error: 'Cannot remove the last active admin editor' });
  }

  db.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?').run(normalizedRole, id);
  logRbacAudit(req.user.id, 'update', 'role', id, { email: user.email, from: user.role, to: normalizedRole });
  res.json({ message: 'Role updated' });
});

// Activate/deactivate user (editor roles only)
router.put('/:id/active', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (![0, 1, true, false].includes(is_active)) {
    return res.status(400).json({ error: 'is_active must be 0, 1, true, or false' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const activeValue = is_active ? 1 : 0;

  if (isComposeLockedAdmin(user.email) && !activeValue) {
    return res.status(400).json({ error: 'Compose owner cannot be deactivated from the webapp' });
  }

  // Prevent deactivating yourself
  if (id === req.user.id && !is_active) {
    return res.status(400).json({ error: 'Cannot deactivate yourself' });
  }

  // Prevent deactivating the last active admin editor
  if (!activeValue && isEditorRole(user.role) && remainingEditorCountExcluding(id) === 0) {
    return res.status(400).json({ error: 'Cannot deactivate the last active admin editor' });
  }

  db.prepare('UPDATE users SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(activeValue, id);
  logRbacAudit(req.user.id, activeValue ? 'activate' : 'deactivate', 'user_status', id, { email: user.email, role: user.role });
  res.json({ message: is_active ? 'User activated' : 'User deactivated' });
});

// Delete user permanently (editor roles only) — cascades membership and access logs
router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent deleting yourself
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  if (isComposeLockedAdmin(user.email)) {
    return res.status(400).json({ error: 'Compose owner cannot be deleted from the webapp' });
  }

  // Prevent deleting the last active admin editor
  if (isEditorRole(user.role) && remainingEditorCountExcluding(id) === 0) {
    return res.status(400).json({ error: 'Cannot delete the last active admin editor' });
  }

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM user_group_members WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM access_logs WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  deleteAll();
  logRbacAudit(req.user.id, 'delete', 'user_status', id, { email: user.email, role: user.role });

  res.json({ message: 'User deleted' });
});

export default router;
