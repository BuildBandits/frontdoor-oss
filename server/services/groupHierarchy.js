import db from '../db.js';

function rowsToIds(rows, column = 'group_id') {
  return rows.map((row) => row[column]);
}

export function getAccessibleGroupIdsForUser(userId) {
  const rows = db.prepare(`
    WITH RECURSIVE accessible_groups(group_type, group_id) AS (
      SELECT 'local', group_id
      FROM user_group_members
      WHERE user_id = ?
      UNION
      SELECT 'entra', entra_group_id
      FROM entra_user_group_memberships
      WHERE user_id = ?
      UNION
      SELECT 'local', gm.parent_group_id
      FROM group_group_memberships gm
      JOIN accessible_groups ag ON ag.group_type = 'local' AND ag.group_id = gm.child_group_id
      UNION
      SELECT 'local', gem.parent_group_id
      FROM group_entra_group_memberships gem
      JOIN accessible_groups ag ON ag.group_type = 'entra' AND ag.group_id = gem.entra_group_id
    )
    SELECT DISTINCT group_id
    FROM accessible_groups
    ORDER BY group_id
  `).all(userId, userId);

  return rowsToIds(rows);
}

export function getDescendantGroupIds(groupId) {
  const rows = db.prepare(`
    WITH RECURSIVE descendant_groups(group_id) AS (
      SELECT ?
      UNION
      SELECT gm.child_group_id
      FROM group_group_memberships gm
      JOIN descendant_groups dg ON dg.group_id = gm.parent_group_id
    )
    SELECT DISTINCT group_id
    FROM descendant_groups
    ORDER BY group_id
  `).all(groupId);

  return rowsToIds(rows);
}
