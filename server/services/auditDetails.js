// Helpers that make RBAC audit rows readable: entity names snapshotted next to
// the IDs (so they survive deletions) and field-level diffs for updates.
// Pure functions over a database handle, so db.js can use them without a cycle.

const REF_TYPES = ['users', 'groups', 'apps', 'entraGroups'];

// Details keys that hold entity IDs, by entity type.
const ID_KEYS = {
  userId: 'users',
  userIds: 'users',
  groupId: 'groups',
  groupIds: 'groups',
  childGroupId: 'groups',
  childGroupIds: 'groups',
  sourceGroupId: 'groups',
  targetGroupId: 'groups',
  appId: 'apps',
  appIds: 'apps',
  entraGroupId: 'entraGroups',
  entraGroupIds: 'entraGroups',
};

const LOOKUPS = {
  users: { table: 'users', id: 'id', name: 'display_name' },
  groups: { table: 'user_groups', id: 'id', name: 'name' },
  apps: { table: 'apps', id: 'id', name: 'name' },
  entraGroups: { table: 'entra_group_cache', id: 'entra_group_id', name: 'display_name' },
};

const MAX_IDS_PER_TYPE = 500;

function emptyIdSets() {
  return Object.fromEntries(REF_TYPES.map((type) => [type, new Set()]));
}

function addIds(set, value) {
  for (const id of Array.isArray(value) ? value : [value]) {
    if (typeof id === 'string' && id.trim()) set.add(id);
  }
}

function targetRefType({ action, targetType }) {
  switch (targetType) {
    case 'app':
      return 'apps';
    case 'group':
    case 'membership':
      return 'groups';
    case 'permission':
      // App-side sync stores the app as target; every other permission event the group.
      return action === 'sync_apps' ? 'apps' : 'groups';
    case 'role':
    case 'user_status':
    case 'auth':
    case 'impersonation':
      return 'users';
    default:
      return null;
  }
}

/** Collect the entity IDs an audit row refers to, grouped by entity type. */
export function collectAuditIds({ action, targetType, targetId, details }, into = emptyIdSets()) {
  const type = targetRefType({ action, targetType });
  if (type && targetId) addIds(into[type], targetId);

  if (details && typeof details === 'object' && !Array.isArray(details)) {
    for (const [key, value] of Object.entries(details)) {
      // Entra import lists Entra object IDs under groupIds.
      const refType = key === 'groupIds' && action === 'import' ? 'entraGroups' : ID_KEYS[key];
      if (refType) addIds(into[refType], value);
    }
  }
  return into;
}

/** Look up current names for the given IDs: { users: { id: name }, ... }, empty types omitted. */
export function lookupAuditNames(dbHandle, idSets) {
  const refs = {};
  for (const type of REF_TYPES) {
    const ids = [...(idSets[type] || [])].slice(0, MAX_IDS_PER_TYPE);
    if (ids.length === 0) continue;
    const { table, id, name } = LOOKUPS[type];
    const rows = dbHandle
      .prepare(`SELECT ${id} AS id, ${name} AS name FROM ${table} WHERE ${id} IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids);
    const names = Object.fromEntries(rows.filter((row) => row.name).map((row) => [row.id, row.name]));
    if (Object.keys(names).length > 0) refs[type] = names;
  }
  return refs;
}

/** Add a `refs` snapshot of entity names to an audit details payload. */
export function withAuditRefs(dbHandle, { action, targetType, targetId, details }) {
  const base = details && typeof details === 'object' && !Array.isArray(details) ? details : null;
  if (details && !base) return details;
  const refs = lookupAuditNames(dbHandle, collectAuditIds({ action, targetType, targetId, details: base }));
  if (Object.keys(refs).length === 0) return base;
  return { ...(base || {}), refs: { ...refs, ...(base?.refs || {}) } };
}

function normalizeForCompare(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Field-level diff between two records: [{ field, from, to }] for the fields
 * whose value changed. `null`, `undefined` and '' count as the same empty value,
 * and booleans compare equal to SQLite's 0/1.
 */
export function diffAuditFields(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const from = before?.[field];
    const to = after?.[field];
    if (JSON.stringify(normalizeForCompare(from)) === JSON.stringify(normalizeForCompare(to))) continue;
    changes.push({ field, from: from ?? null, to: to ?? null });
  }
  return changes;
}
