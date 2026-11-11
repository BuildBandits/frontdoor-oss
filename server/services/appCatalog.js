// Single source of truth for "which apps can this user reach". Every HTTP route
// and every MCP tool that answers that question goes through these functions,
// so there is no second authorization path to keep in sync.
import db from '../db.js';
import { getAccessibleGroupIdsForUser } from './groupHierarchy.js';

const LIST_COLUMNS = `a.id, a.name, a.slug, a.description, a.long_description, a.icon, a.icon_file_name, a.target_url,
      a.is_active, a.sort_order, a.mode, a.sso_endpoint, a.sso_method, a.tags, a.updated_at`;

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

// Active apps granted to the user through any group they reach (direct, nested,
// or Entra-linked). RBAC applies to every role, admins included.
export function listAccessibleAppsForUser(userId) {
  const groupIds = getAccessibleGroupIdsForUser(userId);
  if (groupIds.length === 0) return [];
  return db.prepare(`
    SELECT DISTINCT ${LIST_COLUMNS}
    FROM apps a
    JOIN app_permissions p ON a.id = p.app_id
    WHERE a.is_active = 1 AND p.group_id IN (${placeholders(groupIds)})
    ORDER BY a.sort_order, a.name, a.slug
  `).all(...groupIds);
}

// Whether any group the user reaches grants this app. Does not look at
// is_active: callers load the app first and decide what an inactive app means.
export function userCanAccessApp(userId, appId) {
  const groupIds = getAccessibleGroupIdsForUser(userId);
  if (groupIds.length === 0) return false;
  const row = db.prepare(`
    SELECT 1 FROM app_permissions
    WHERE app_id = ? AND group_id IN (${placeholders(groupIds)})
  `).get(appId, ...groupIds);
  return Boolean(row);
}

// Every app, active or not, with the groups it is granted to (admin views).
export function listAllAppsForAdmin() {
  const apps = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM app_permissions WHERE app_id = a.id) AS group_count
    FROM apps a
    ORDER BY sort_order, name, slug
  `).all();
  const groupIdsByAppId = new Map();
  for (const row of db.prepare('SELECT app_id, group_id FROM app_permissions ORDER BY app_id, group_id').all()) {
    if (!groupIdsByAppId.has(row.app_id)) groupIdsByAppId.set(row.app_id, []);
    groupIdsByAppId.get(row.app_id).push(row.group_id);
  }
  return apps.map((app) => ({ ...app, tags: parseTags(app.tags), groupIds: groupIdsByAppId.get(app.id) || [] }));
}

function normalizeTag(tag) {
  return (tag ?? '').toString().trim().toLowerCase();
}

export function normalizeTagList(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const normalized = [];
  for (const tag of list) {
    const value = normalizeTag(tag);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function parseTags(rawTags) {
  try {
    return normalizeTagList(JSON.parse(rawTags || '[]'));
  } catch {
    return [];
  }
}
