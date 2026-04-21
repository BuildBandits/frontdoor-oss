import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_GROUP_ID, logRbacAudit } from '../db.js';
import { authenticate, isAdminViewer, isAdminEditor } from '../middleware/auth.js';
import { forceSyncAllEntraUsers, importEntraGroups, listDiscoveredEntraGroups } from '../services/entraGroups.js';
import { iconUrlForApp } from '../services/appIcons.js';

const router = express.Router();

// Sanitize group name: strip HTML tags, limit length
function sanitizeName(name) {
  if (!name) return null;
  return name.replace(/<[^>]*>/g, '').trim().slice(0, 100);
}

function validateGroupName(name) {
  if (!name || !name.trim()) return 'name is required';
  const clean = sanitizeName(name);
  if (clean.length < 2) return 'name must be at least 2 characters';
  if (clean.length > 100) return 'name must be 100 characters or less';
  if (/[<>"'&]/.test(clean)) return 'name contains invalid characters';
  return null;
}

// List all groups (viewer roles only)
router.get('/', authenticate, isAdminViewer, (req, res) => {
  const groups = db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM user_group_members WHERE group_id = g.id) AS member_count,
      (SELECT COUNT(*) FROM app_permissions WHERE group_id = g.id) AS app_count,
      (
        SELECT GROUP_CONCAT(a.name || ' ' || a.slug, ' ')
        FROM app_permissions p
        JOIN apps a ON a.id = p.app_id
        WHERE p.group_id = g.id
      ) AS app_search_text
    FROM user_groups g ORDER BY g.name
  `).all();
  res.json({ groups });
});

router.get('/entra/candidates', authenticate, isAdminViewer, (req, res) => {
  const groups = listDiscoveredEntraGroups();
  res.json({ groups });
});

router.post('/entra/import', authenticate, isAdminEditor, (req, res) => {
  const { groupIds } = req.body;
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return res.status(400).json({ error: 'groupIds must be a non-empty array' });
  }

  try {
    const result = importEntraGroups(groupIds);
    logRbacAudit(req.user.id, 'import', 'group', null, {
      groupIds,
      importedGroups: result.importedGroups,
      skippedGroups: result.skippedGroups,
    });
    res.json({
      message: `${result.importedGroups} Entra groups imported`,
      ...result,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/entra/force-sync', authenticate, isAdminEditor, async (req, res) => {
  try {
    const result = await forceSyncAllEntraUsers();
    logRbacAudit(req.user.id, 'sync', 'group', null, {
      usersSynced: result.usersSynced,
      usersConsidered: result.usersConsidered,
      discoveredGroups: result.discoveredGroups,
      errors: result.errors,
    });
    res.json({
      message: `Synced ${result.usersSynced} users from Microsoft Entra`,
      ...result,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    });
  }
});

router.post('/bulk-delete', authenticate, isAdminEditor, (req, res) => {
  const { groupIds } = req.body;
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return res.status(400).json({ error: 'groupIds must be a non-empty array' });
  }

  if (groupIds.includes(DEFAULT_GROUP_ID)) {
    return res.status(400).json({ error: 'Cannot delete the default group' });
  }

  const uniqueGroupIds = [...new Set(groupIds.filter(Boolean))];
  const placeholders = uniqueGroupIds.map(() => '?').join(', ');
  const groups = db.prepare(`SELECT id, name FROM user_groups WHERE id IN (${placeholders})`).all(...uniqueGroupIds);

  if (groups.length !== uniqueGroupIds.length) {
    return res.status(404).json({ error: 'One or more groups were not found' });
  }

  const deletedGroups = groups.map((group) => ({
    id: group.id,
    name: group.name,
    source: group.source || 'local',
  }));
  const deleteAll = db.transaction(() => {
    for (const group of groups) {
      db.prepare('DELETE FROM user_group_members WHERE group_id = ?').run(group.id);
      db.prepare('DELETE FROM app_permissions WHERE group_id = ?').run(group.id);
      db.prepare('DELETE FROM user_groups WHERE id = ?').run(group.id);
      logRbacAudit(req.user.id, 'delete', 'group', group.id, { name: group.name, bulk: true });
    }
  });
  deleteAll();

  res.json({
    message: `${groups.length} groups deleted`,
    deletedCount: groups.length,
    deletedGroups,
  });
});

// Get single group with members and apps (viewer roles only)
router.get('/:id', authenticate, isAdminViewer, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const members = db.prepare(`
    SELECT u.id, u.email, u.display_name, u.role, u.avatar_color, u.last_login
    FROM users u JOIN user_group_members m ON u.id = m.user_id
    WHERE m.group_id = ? ORDER BY u.display_name
  `).all(req.params.id);

  const apps = db.prepare(`
    SELECT a.id, a.name, a.slug, a.icon, a.icon_file_name, a.updated_at
    FROM apps a JOIN app_permissions p ON a.id = p.app_id
    WHERE p.group_id = ? ORDER BY a.name
  `).all(req.params.id).map((app) => ({
    ...app,
    iconUrl: iconUrlForApp(app),
  }));

  res.json({ group, members, apps });
});

// Create group (editor roles only)
router.post('/', authenticate, isAdminEditor, (req, res) => {
  const { name, description } = req.body;
  const nameError = validateGroupName(name);
  if (nameError) return res.status(400).json({ error: nameError });

  const cleanName = sanitizeName(name);
  const cleanDesc = description ? description.replace(/<[^>]*>/g, '').trim().slice(0, 500) : '';

  const existing = db.prepare('SELECT id FROM user_groups WHERE name = ?').get(cleanName);
  if (existing) return res.status(409).json({ error: 'A group with this name already exists' });

  const id = uuidv4();
  db.prepare('INSERT INTO user_groups (id, name, description) VALUES (?, ?, ?)').run(id, cleanName, cleanDesc);
  logRbacAudit(req.user.id, 'create', 'group', id, { name: cleanName });

  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(id);
  res.status(201).json({ group });
});

// Update group (editor roles only, cannot rename "default")
router.put('/:id', authenticate, isAdminEditor, (req, res) => {
  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.source === 'entra') {
    return res.status(400).json({ error: 'Entra-synced groups cannot be edited locally' });
  }

  const { name, description } = req.body;

  if (name) {
    const nameError = validateGroupName(name);
    if (nameError) return res.status(400).json({ error: nameError });
  }

  const cleanName = name ? sanitizeName(name) : null;
  const cleanDesc = description !== undefined ? description.replace(/<[^>]*>/g, '').trim().slice(0, 500) : null;

  if (group.id === DEFAULT_GROUP_ID && cleanName && cleanName !== 'default') {
    return res.status(400).json({ error: 'Cannot rename the default group' });
  }

  if (cleanName) {
    const conflict = db.prepare('SELECT id FROM user_groups WHERE name = ? AND id != ?').get(cleanName, req.params.id);
    if (conflict) return res.status(409).json({ error: 'A group with this name already exists' });
  }

  db.prepare('UPDATE user_groups SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?')
    .run(cleanName, cleanDesc, req.params.id);
  logRbacAudit(req.user.id, 'update', 'group', req.params.id, { name: cleanName, description: cleanDesc });

  const updated = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(req.params.id);
  res.json({ group: updated });
});

// Delete group (editor roles only, cannot delete "default")
router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  if (req.params.id === DEFAULT_GROUP_ID) {
    return res.status(400).json({ error: 'Cannot delete the default group' });
  }

  const group = db.prepare('SELECT * FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM user_group_members WHERE group_id = ?').run(req.params.id);
    db.prepare('DELETE FROM app_permissions WHERE group_id = ?').run(req.params.id);
    db.prepare('DELETE FROM user_groups WHERE id = ?').run(req.params.id);
  });
  deleteAll();
  logRbacAudit(req.user.id, 'delete', 'group', req.params.id, { name: group.name });

  res.json({ message: 'Group deleted' });
});

// --- Membership ---

// Add members to group (by userIds and/or emails)
router.post('/:id/members', authenticate, isAdminEditor, (req, res) => {
  const group = db.prepare('SELECT id FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const fullGroup = db.prepare('SELECT source FROM user_groups WHERE id = ?').get(req.params.id);
  if (fullGroup?.source === 'entra') {
    return res.status(400).json({ error: 'Entra-synced group memberships are managed in Microsoft Entra' });
  }

  const { userIds, emails } = req.body;
  const hasUserIds = Array.isArray(userIds) && userIds.length > 0;
  const hasEmails = Array.isArray(emails) && emails.length > 0;

  if (!hasUserIds && !hasEmails) {
    return res.status(400).json({ error: 'userIds or emails must be a non-empty array' });
  }

  // Collect all user IDs to add
  const resolvedUserIds = [];

  // Validate existing user IDs
  if (hasUserIds) {
    const checkUser = db.prepare('SELECT id FROM users WHERE id = ?');
    const invalid = userIds.filter(uid => !checkUser.get(uid));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `Users not found: ${invalid.join(', ')}` });
    }
    resolvedUserIds.push(...userIds);
  }

  // Resolve emails: find existing or create pre-registered users
  const createdUsers = [];
  if (hasEmails) {
    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: `Invalid email: ${email}` });
      }

      let user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (!user) {
        // Create pre-registered user
        const userId = uuidv4();
        const avatarColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
        db.prepare(`
          INSERT INTO users (id, email, display_name, microsoft_id, role, avatar_color, last_login)
          VALUES (?, ?, NULL, NULL, 'user', ?, NULL)
        `).run(userId, email, avatarColor);
        logRbacAudit(req.user.id, 'create', 'user_status', userId, { email, pre_registered: true });
        createdUsers.push({ id: userId, email });
        user = { id: userId };
      }
      resolvedUserIds.push(user.id);
    }
  }

  const insert = db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)');
  const addAll = db.transaction(() => {
    let added = 0;
    for (const userId of resolvedUserIds) {
      const result = insert.run(userId, req.params.id);
      added += result.changes;
    }
    return added;
  });
  const added = addAll();
  if (added > 0) logRbacAudit(req.user.id, 'add_members', 'membership', req.params.id, { userIds: resolvedUserIds, added });

  res.json({ message: `${added} members added`, createdUsers });
});

// Remove member from group
router.delete('/:id/members/:userId', authenticate, isAdminEditor, (req, res) => {
  const group = db.prepare('SELECT id FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const fullGroup = db.prepare('SELECT source FROM user_groups WHERE id = ?').get(req.params.id);
  if (fullGroup?.source === 'entra') {
    return res.status(400).json({ error: 'Entra-synced group memberships are managed in Microsoft Entra' });
  }

  const result = db.prepare('DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?')
    .run(req.params.id, req.params.userId);

  if (result.changes === 0) return res.status(404).json({ error: 'Membership not found' });
  logRbacAudit(req.user.id, 'remove_member', 'membership', req.params.id, { userId: req.params.userId });
  res.json({ message: 'Member removed' });
});

// --- App permissions ---

// Assign apps to group
router.post('/:id/apps', authenticate, isAdminEditor, (req, res) => {
  const group = db.prepare('SELECT id FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const { appIds } = req.body;
  if (!Array.isArray(appIds) || appIds.length === 0) {
    return res.status(400).json({ error: 'appIds must be a non-empty array' });
  }

  // Validate all app IDs exist before inserting
  const checkApp = db.prepare('SELECT id FROM apps WHERE id = ?');
  const invalid = appIds.filter(aid => !checkApp.get(aid));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Apps not found: ${invalid.join(', ')}` });
  }

  const insert = db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)');
  const addAll = db.transaction(() => {
    let added = 0;
    for (const appId of appIds) {
      const result = insert.run(appId, req.params.id);
      added += result.changes;
    }
    return added;
  });
  const added = addAll();
  if (added > 0) logRbacAudit(req.user.id, 'add_apps', 'permission', req.params.id, { appIds, added });

  res.json({ message: `${added} app permissions added` });
});

// Remove app from group
router.delete('/:id/apps/:appId', authenticate, isAdminEditor, (req, res) => {
  const group = db.prepare('SELECT id FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const result = db.prepare('DELETE FROM app_permissions WHERE group_id = ? AND app_id = ?')
    .run(req.params.id, req.params.appId);

  if (result.changes === 0) return res.status(404).json({ error: 'Permission not found' });
  logRbacAudit(req.user.id, 'remove_app', 'permission', req.params.id, { appId: req.params.appId });
  res.json({ message: 'App permission removed' });
});

export default router;
