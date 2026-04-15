import express from 'express';
import db from '../db.js';
import { authenticate, isAdmin } from '../middleware/auth.js';
import { ensureAvatarCached, serveAvatarForUser } from '../services/avatars.js';

const router = express.Router();
const composeAdminEmails = new Set(
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

const isComposeLockedAdmin = (email) => composeAdminEmails.has((email || '').trim().toLowerCase());

// List users with group membership counts (admin only)
router.get('/', authenticate, isAdmin, (req, res) => {
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

// Get single user with group memberships (admin only)
router.get('/:id', authenticate, isAdmin, (req, res) => {
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

  // Count visible apps (distinct apps from all user's groups)
  const visibleApps = db.prepare(`
    SELECT COUNT(DISTINCT p.app_id) AS count
    FROM app_permissions p
    JOIN user_group_members m ON p.group_id = m.group_id
    WHERE m.user_id = ?
  `).get(req.params.id);

  res.json({
    user: {
      ...user,
      is_compose_locked_admin: isComposeLockedAdmin(user.email),
    },
    groups,
    entraGroups,
    visibleAppCount: visibleApps.count,
  });
});

// Update user role (admin only)
router.put('/:id/role', authenticate, isAdmin, (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin or user' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.role === 'admin' && isComposeLockedAdmin(user.email) && role !== 'admin') {
    return res.status(400).json({ error: 'Compose admin cannot be demoted from the webapp' });
  }

  // Prevent last admin from demoting themselves
  if (role === 'user' && user.role === 'admin' && id === req.user.id) {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot demote the last active admin' });
    }
  }

  db.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?').run(role, id);
  res.json({ message: 'Role updated' });
});

// Activate/deactivate user (admin only)
router.put('/:id/active', authenticate, isAdmin, (req, res) => {
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
    return res.status(400).json({ error: 'Compose admin cannot be deactivated from the webapp' });
  }

  // Prevent deactivating yourself
  if (id === req.user.id && !is_active) {
    return res.status(400).json({ error: 'Cannot deactivate yourself' });
  }

  // Prevent deactivating last admin
  if (!activeValue && user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot deactivate the last active admin' });
    }
  }

  db.prepare('UPDATE users SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(activeValue, id);
  res.json({ message: is_active ? 'User activated' : 'User deactivated' });
});

// Delete user permanently (admin only) — cascades membership and access logs
router.delete('/:id', authenticate, isAdmin, (req, res) => {
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
    return res.status(400).json({ error: 'Compose admin cannot be deleted from the webapp' });
  }

  // Prevent deleting last admin
  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last active admin' });
    }
  }

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM user_group_members WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM access_logs WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  });
  deleteAll();

  res.json({ message: 'User deleted' });
});

export default router;
