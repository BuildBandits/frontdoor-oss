// Admin views of groups and of who reaches an app. Shared by the HTTP routes
// and the MCP tools so both answer from the same queries.
import db from '../db.js';
import { getDescendantGroupIds } from './groupHierarchy.js';

export function listGroupsWithCounts() {
  return db.prepare(`
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
}

const placeholders = (values) => values.map(() => '?').join(', ');

// Active users who reach any of these local groups: as direct members, or
// through an Entra group linked into one of them. Mirrors, in reverse,
// getAccessibleGroupIdsForUser (groupHierarchy.js).
function activeUsersReaching(groupIds) {
  if (groupIds.length === 0) return [];
  return db.prepare(`
    SELECT DISTINCT u.id FROM users u
    WHERE u.is_active = 1 AND u.id IN (
      SELECT user_id FROM user_group_members WHERE group_id IN (${placeholders(groupIds)})
      UNION
      SELECT eu.user_id
      FROM entra_user_group_memberships eu
      JOIN group_entra_group_memberships gem ON gem.entra_group_id = eu.entra_group_id
      WHERE gem.parent_group_id IN (${placeholders(groupIds)})
    )
  `).all(...groupIds, ...groupIds).map((row) => row.id);
}

/**
 * The groups that grant an app, each with the groups nested under it (local
 * and Entra-linked) and how many active users reach the app through it.
 */
export function describeAppAccess(appId) {
  const granting = db.prepare(`
    SELECT g.id, g.name, g.source FROM app_permissions p JOIN user_groups g ON g.id = p.group_id
    WHERE p.app_id = ? ORDER BY g.name
  `).all(appId);
  const everyone = new Set();
  const groups = granting.map((group) => {
    const descendants = getDescendantGroupIds(group.id);
    const nestedLocal = descendants.length > 1
      ? db.prepare(`SELECT name FROM user_groups WHERE id IN (${placeholders(descendants)}) AND id <> ? ORDER BY name`).all(...descendants, group.id).map((row) => row.name)
      : [];
    const nestedEntra = db.prepare(`
      SELECT DISTINCT COALESCE(c.display_name, gem.entra_group_id) AS name
      FROM group_entra_group_memberships gem
      LEFT JOIN entra_group_cache c ON c.entra_group_id = gem.entra_group_id
      WHERE gem.parent_group_id IN (${placeholders(descendants)}) ORDER BY name
    `).all(...descendants).map((row) => row.name);
    const users = activeUsersReaching(descendants);
    for (const userId of users) everyone.add(userId);
    return { name: group.name, source: group.source || 'local', nestedGroups: [...nestedLocal, ...nestedEntra], userCount: users.length };
  });
  return { groups, totalUsers: everyone.size };
}
