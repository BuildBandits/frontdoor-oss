import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_GROUP_ID, logRbacAudit } from '../db.js';
import { authenticate, isAdminViewer, isAdminEditor } from '../middleware/auth.js';
import { forceSyncAllEntraUsers, importEntraGroups, listDiscoveredEntraGroups } from '../services/entraGroups.js';
import { getDescendantGroupIds } from '../services/groupHierarchy.js';
import { transferGroupApps } from '../services/groupAppTransfer.js';
import { iconUrlForApp } from '../services/appIcons.js';
import { respondWithError } from '../services/errors.js';

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

function getLinkedEntraGroups(parentGroupId) {
  return db.prepare(`
    SELECT
      gm.entra_group_id,
      COALESCE(c.display_name, gm.entra_group_id) AS display_name,
      c.description,
      c.first_seen_at,
      c.last_seen_at
    FROM group_entra_group_memberships gm
    LEFT JOIN entra_group_cache c ON c.entra_group_id = gm.entra_group_id
    WHERE gm.parent_group_id = ?
    ORDER BY COALESCE(c.display_name, gm.entra_group_id)
  `).all(parentGroupId).map((row) => ({
    ...row,
    description: row.description || null,
  }));
}

// List all groups (viewer roles only)
router.get('/', authenticate, isAdminViewer, (req, res) => {
  const groups = db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM user_group_members WHERE group_id = g.id) AS member_count,
      (SELECT COUNT(*) FROM app_permissions WHERE group_id = g.id) AS app_count,
      (SELECT COUNT(*) FROM group_group_memberships WHERE parent_group_id = g.id) AS child_group_count,
      (SELECT COUNT(*) FROM group_entra_group_memberships WHERE parent_group_id = g.id) AS entra_child_group_count,
      (
        SELECT GROUP_CONCAT(a.name || ' ' || a.slug, ' ')
        FROM app_permissions p
        JOIN apps a ON a.id = p.app_id
        WHERE p.group_id = g.id
      ) AS app_search_text,
      (
        SELECT GROUP_CONCAT(value, ' ')
        FROM (
          SELECT cg.name || ' ' || COALESCE(cg.entra_display_name, '') AS value
          FROM group_group_memberships gm
          JOIN user_groups cg ON cg.id = gm.child_group_id
          WHERE gm.parent_group_id = g.id
          UNION ALL
          SELECT COALESCE(c.display_name, gem.entra_group_id) AS value
          FROM group_entra_group_memberships gem
          LEFT JOIN entra_group_cache c ON c.entra_group_id = gem.entra_group_id
          WHERE gem.parent_group_id = g.id
        ) AS linked_values
      ) AS group_search_text
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
    res.json(result);
  } catch (error) {
    console.error('Entra import failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_import_entra_groups' });
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
    res.json(result);
  } catch (error) {
    console.error('Entra force-sync failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_sync_entra_users' });
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
  if (uniqueGroupIds.length === 0) {
    return res.status(400).json({ error: 'groupIds must contain at least one valid group id' });
  }
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
      db.prepare('DELETE FROM group_group_memberships WHERE parent_group_id = ? OR child_group_id = ?').run(group.id, group.id);
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

  const childGroups = db.prepare(`
    SELECT g.id, g.name, g.description, g.source, g.entra_display_name,
      (SELECT COUNT(*) FROM user_group_members WHERE group_id = g.id) AS member_count,
      (SELECT COUNT(*) FROM app_permissions WHERE group_id = g.id) AS app_count
    FROM group_group_memberships gm
    JOIN user_groups g ON g.id = gm.child_group_id
    WHERE gm.parent_group_id = ?
    ORDER BY g.name
  `).all(req.params.id);

  const childEntraGroups = getLinkedEntraGroups(req.params.id);

  res.json({ group, members, apps, childGroups, childEntraGroups });
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
    db.prepare('DELETE FROM group_group_memberships WHERE parent_group_id = ? OR child_group_id = ?').run(req.params.id, req.params.id);
    db.prepare('DELETE FROM group_entra_group_memberships WHERE parent_group_id = ?').run(req.params.id);
    db.prepare('DELETE FROM user_groups WHERE id = ?').run(req.params.id);
  });
  deleteAll();
  logRbacAudit(req.user.id, 'delete', 'group', req.params.id, { name: group.name });

  res.json({ deleted: true });
});

// Link child groups to a parent group
router.post('/:id/groups', authenticate, isAdminEditor, (req, res) => {
  const parentGroup = db.prepare('SELECT id, name, source FROM user_groups WHERE id = ?').get(req.params.id);
  if (!parentGroup) return res.status(404).json({ error: 'Group not found' });
  if (parentGroup.source === 'entra') {
    return res.status(400).json({ error: 'Entra-synced groups cannot be edited locally' });
  }
  if (parentGroup.id === DEFAULT_GROUP_ID) {
    return res.status(400).json({ error: 'Cannot link groups to the default group' });
  }

  const { groupIds } = req.body;
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return res.status(400).json({ error: 'groupIds must be a non-empty array' });
  }

  const uniqueGroupIds = [...new Set(groupIds.filter(Boolean))];
  if (uniqueGroupIds.length === 0) {
    return res.status(400).json({ error: 'groupIds must contain at least one valid group id' });
  }
  if (uniqueGroupIds.includes(parentGroup.id) || uniqueGroupIds.includes(DEFAULT_GROUP_ID)) {
    return res.status(400).json({ error: 'Cannot link the selected group' });
  }

  const placeholders = uniqueGroupIds.map(() => '?').join(', ');
  const childGroups = db.prepare(`SELECT id, name, source FROM user_groups WHERE id IN (${placeholders})`).all(...uniqueGroupIds);
  if (childGroups.length !== uniqueGroupIds.length) {
    return res.status(404).json({ error: 'One or more groups were not found' });
  }

  for (const childGroup of childGroups) {
    const descendantIds = getDescendantGroupIds(childGroup.id);
    if (descendantIds.includes(parentGroup.id)) {
      return res.status(400).json({ error: 'Cannot create a circular group link' });
    }
    if (childGroup.source === 'entra' && childGroup.entra_group_id) {
      const alreadyLinkedAsEntra = db.prepare(`
        SELECT 1
        FROM group_entra_group_memberships
        WHERE parent_group_id = ? AND entra_group_id = ?
      `).get(parentGroup.id, childGroup.entra_group_id);
      if (alreadyLinkedAsEntra) {
        return res.status(409).json({ error: 'This Entra group is already linked to the container' });
      }
    }
  }

  const insert = db.prepare('INSERT OR IGNORE INTO group_group_memberships (parent_group_id, child_group_id) VALUES (?, ?)');
  const addAll = db.transaction(() => {
    let added = 0;
    for (const childGroupId of uniqueGroupIds) {
      const result = insert.run(parentGroup.id, childGroupId);
      added += result.changes;
    }
    return added;
  });
  const added = addAll();
  if (added > 0) {
    logRbacAudit(req.user.id, 'add_linked_groups', 'group', parentGroup.id, { childGroupIds: uniqueGroupIds, added });
  }

  res.json({ message: `${added} linked groups added` });
});

// Link Entra groups directly to a parent group without importing them
router.post('/:id/entra-groups', authenticate, isAdminEditor, (req, res) => {
  const parentGroup = db.prepare('SELECT id, source FROM user_groups WHERE id = ?').get(req.params.id);
  if (!parentGroup) return res.status(404).json({ error: 'Group not found' });
  if (parentGroup.source === 'entra') {
    return res.status(400).json({ error: 'Entra-synced groups cannot be edited locally' });
  }
  if (parentGroup.id === DEFAULT_GROUP_ID) {
    return res.status(400).json({ error: 'Cannot link groups to the default group' });
  }

  const { entraGroupIds } = req.body;
  if (!Array.isArray(entraGroupIds) || entraGroupIds.length === 0) {
    return res.status(400).json({ error: 'entraGroupIds must be a non-empty array' });
  }

  const uniqueEntraGroupIds = [...new Set(entraGroupIds.filter(Boolean))];
  if (uniqueEntraGroupIds.length === 0) {
    return res.status(400).json({ error: 'entraGroupIds must contain at least one valid group id' });
  }

  const placeholders = uniqueEntraGroupIds.map(() => '?').join(', ');
  const discoveredGroups = db.prepare(`SELECT entra_group_id FROM entra_group_cache WHERE entra_group_id IN (${placeholders})`).all(...uniqueEntraGroupIds);
  if (discoveredGroups.length !== uniqueEntraGroupIds.length) {
    return res.status(404).json({ error: 'One or more Entra groups were not found' });
  }

  for (const entraGroupId of uniqueEntraGroupIds) {
    const alreadyLinkedAsLocal = db.prepare(`
      SELECT 1
      FROM group_group_memberships gm
      JOIN user_groups ug ON ug.id = gm.child_group_id
      WHERE gm.parent_group_id = ? AND ug.entra_group_id = ?
    `).get(parentGroup.id, entraGroupId);
    if (alreadyLinkedAsLocal) {
      return res.status(409).json({ error: 'This Entra group is already linked to the container' });
    }
  }

  const insert = db.prepare('INSERT OR IGNORE INTO group_entra_group_memberships (parent_group_id, entra_group_id) VALUES (?, ?)');
  const addAll = db.transaction(() => {
    let added = 0;
    for (const entraGroupId of uniqueEntraGroupIds) {
      const result = insert.run(parentGroup.id, entraGroupId);
      added += result.changes;
    }
    return added;
  });
  const added = addAll();
  if (added > 0) {
    logRbacAudit(req.user.id, 'add_linked_entra_groups', 'group', parentGroup.id, { entraGroupIds: uniqueEntraGroupIds, added });
  }

  res.json({ message: `${added} linked Entra groups added` });
});

// Remove a linked child group
router.delete('/:id/groups/:childGroupId', authenticate, isAdminEditor, (req, res) => {
  const parentGroup = db.prepare('SELECT id, source FROM user_groups WHERE id = ?').get(req.params.id);
  if (!parentGroup) return res.status(404).json({ error: 'Group not found' });
  if (parentGroup.source === 'entra') {
    return res.status(400).json({ error: 'Entra-synced groups cannot be edited locally' });
  }

  const result = db.prepare(`
    DELETE FROM group_group_memberships
    WHERE parent_group_id = ? AND child_group_id = ?
  `).run(req.params.id, req.params.childGroupId);

  if (result.changes === 0) return res.status(404).json({ error: 'Linked group not found' });
  logRbacAudit(req.user.id, 'remove_linked_group', 'group', req.params.id, { childGroupId: req.params.childGroupId });
  res.json({ removed: true });
});

router.delete('/:id/entra-groups/:entraGroupId', authenticate, isAdminEditor, (req, res) => {
  const parentGroup = db.prepare('SELECT id, source FROM user_groups WHERE id = ?').get(req.params.id);
  if (!parentGroup) return res.status(404).json({ error: 'Group not found' });
  if (parentGroup.source === 'entra') {
    return res.status(400).json({ error: 'Entra-synced groups cannot be edited locally' });
  }

  const result = db.prepare(`
    DELETE FROM group_entra_group_memberships
    WHERE parent_group_id = ? AND entra_group_id = ?
  `).run(req.params.id, req.params.entraGroupId);

  if (result.changes === 0) return res.status(404).json({ error: 'Linked Entra group not found' });
  logRbacAudit(req.user.id, 'remove_linked_entra_group', 'group', req.params.id, { entraGroupId: req.params.entraGroupId });
  res.json({ removed: true });
});

// --- Membership ---

// Add members to group (by userIds only)
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

  if (hasEmails) {
    return res.status(400).json({ error: 'Email invitations are no longer supported' });
  }

  if (!hasUserIds) {
    return res.status(400).json({ error: 'userIds must be a non-empty array' });
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

  res.json({ message: `${added} members added` });
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
  res.json({ removed: true });
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

  res.json({ added });
});

// Remove app from group
router.delete('/:id/apps/:appId', authenticate, isAdminEditor, (req, res) => {
  const group = db.prepare('SELECT id FROM user_groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const result = db.prepare('DELETE FROM app_permissions WHERE group_id = ? AND app_id = ?')
    .run(req.params.id, req.params.appId);

  if (result.changes === 0) return res.status(404).json({ error: 'Permission not found' });
  logRbacAudit(req.user.id, 'remove_app', 'permission', req.params.id, { appId: req.params.appId });
  res.json({ removed: true });
});

// Copy or move all app permissions from one group to another
router.post('/:id/apps/transfer', authenticate, isAdminEditor, (req, res) => {
  const sourceGroup = db.prepare('SELECT id, name, source FROM user_groups WHERE id = ?').get(req.params.id);
  if (!sourceGroup) return res.status(404).json({ error: 'Source group not found' });

  const { targetGroupId, mode } = req.body;
  if (typeof targetGroupId !== 'string' || !targetGroupId.trim()) {
    return res.status(400).json({ error: 'targetGroupId is required' });
  }
  if (!['copy', 'move'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be copy or move' });
  }
  if (targetGroupId === sourceGroup.id) {
    return res.status(400).json({ error: 'Source and target groups must be different' });
  }

  const targetGroup = db.prepare('SELECT id, name, source FROM user_groups WHERE id = ?').get(targetGroupId);
  if (!targetGroup) return res.status(404).json({ error: 'Target group not found' });

  const result = transferGroupApps({
    dbHandle: db,
    sourceGroupId: sourceGroup.id,
    targetGroupId: targetGroup.id,
    mode,
  });

  logRbacAudit(req.user.id, mode === 'move' ? 'move_apps' : 'copy_apps', 'permission', sourceGroup.id, {
    sourceGroupId: sourceGroup.id,
    sourceGroupName: sourceGroup.name,
    targetGroupId: targetGroup.id,
    targetGroupName: targetGroup.name,
    mode: result.mode,
    appIds: result.appIds,
    sourceCount: result.sourceCount,
    addedCount: result.addedCount,
    removedCount: result.removedCount,
  });

  res.json({
    message: mode === 'move'
      ? `${result.removedCount} app permissions moved`
      : `${result.addedCount} app permissions copied`,
    ...result,
    sourceGroup,
    targetGroup,
  });
});

export default router;
