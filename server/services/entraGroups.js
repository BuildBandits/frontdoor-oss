import { ConfidentialClientApplication } from '@azure/msal-node';
import db from '../db.js';
import { UserFacingError } from './errors.js';
import { NOTIFICATION_TYPES, raiseNotification, resolveNotifications } from './notifications.js';

const DEFAULT_SCOPES = ['User.Read', 'openid', 'profile', 'email'];
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_APP_SCOPES = ['https://graph.microsoft.com/.default'];
const GRAPH_TIMEOUT_MS = 20_000;
const GRAPH_MAX_ATTEMPTS = 4;
const GRAPH_MAX_RETRY_DELAY_MS = 30_000;
const GRAPH_RETRY_STATUSES = new Set([429, 503, 504]);

// Same format as SQLite's datetime('now'), used by every other timestamp column.
function sqliteNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number.parseInt(response?.headers?.get?.('retry-after') || '', 10);
  const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
  return Math.min(delay, GRAPH_MAX_RETRY_DELAY_MS);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function isTruthyEnv(value) {
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function isEntraGroupSyncEnabled() {
  return isTruthyEnv(process.env.ENTRA_GROUP_SYNC);
}

export function getAuthScopes() {
  return DEFAULT_SCOPES;
}

function sanitizeGroupName(name) {
  const clean = (name || '').toString().replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ');
  return clean || 'Entra group';
}

function sanitizeOptionalText(value) {
  return (value || '').toString().replace(/<[^>]*>/g, '').trim().replace(/\s+/g, ' ') || null;
}

function resolveUniqueEntraGroupName(displayName, entraGroupId, reservedNames = new Set(), currentGroupName = null) {
  const baseName = sanitizeGroupName(displayName);
  const candidates = [
    baseName,
    `${baseName} [Entra]`,
    `${baseName} [${entraGroupId.slice(0, 8)}]`,
    `${baseName} [Entra ${entraGroupId.slice(0, 8)}]`,
  ];

  for (const candidate of candidates) {
    if (candidate === currentGroupName) return candidate;
    if (reservedNames.has(candidate)) continue;
    const conflict = db.prepare('SELECT id FROM user_groups WHERE name = ?').get(candidate);
    if (!conflict) {
      reservedNames.add(candidate);
      return candidate;
    }
  }

  const fallback = `${baseName} [${entraGroupId}]`;
  reservedNames.add(fallback);
  return fallback;
}

function getGraphClient() {
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
    return null;
  }

  return new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    },
  });
}

async function acquireGraphAppToken() {
  const client = getGraphClient();
  if (!client) {
    throw new UserFacingError('Microsoft Graph app credentials are not configured', { statusCode: 400, code: 'graph_credentials_missing' });
  }

  const response = await client.acquireTokenByClientCredential({
    scopes: GRAPH_APP_SCOPES,
  });

  if (!response?.accessToken) {
    throw new UserFacingError('Microsoft Graph app token could not be acquired', { statusCode: 502, code: 'graph_token_failed' });
  }

  return response.accessToken;
}

function graphErrorCode(body) {
  try {
    const code = JSON.parse(body)?.error?.code;
    return typeof code === 'string' && /^[A-Za-z_.]{1,80}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

// Fetches one Graph page with a timeout, retrying throttling and temporary
// unavailability (429/503/504) as Graph asks via Retry-After, a few times at most.
async function fetchGraphPage(url, accessToken, { maxAttempts = GRAPH_MAX_ATTEMPTS, timeoutMs = GRAPH_TIMEOUT_MS } = {}) {
  let response;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ConsistencyLevel: 'eventual',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error?.name !== 'TimeoutError' || attempt === maxAttempts - 1) {
        const failure = new Error(error?.name === 'TimeoutError' ? 'Microsoft Graph request timed out' : 'Microsoft Graph request failed');
        failure.status = null;
        throw failure;
      }
      continue;
    }
    if (!GRAPH_RETRY_STATUSES.has(response.status) || attempt === maxAttempts - 1) break;
    await sleep(retryDelayMs(response, attempt));
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // The message reaches the UI and the audit log: no URL, so no object IDs.
    const code = graphErrorCode(body);
    const error = new Error(`Microsoft Graph request failed with status ${response.status}${code ? ` (${code})` : ''}`);
    error.status = response.status;
    error.graphCode = code;
    error.body = body;
    error.hint = formatGraphAccessHint(error, url.includes('/users/') ? 'force-sync' : 'login');
    throw error;
  }

  return response.json();
}

function normalizeGraphGroups(groups) {
  const seen = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!group?.id) continue;
    seen.set(group.id, {
      id: group.id,
      displayName: sanitizeGroupName(group.displayName || group.id),
      description: sanitizeOptionalText(group.description),
    });
  }
  return [...seen.values()];
}

function formatGraphAccessHint(error, context) {
  if (!error || (error.status !== 401 && error.status !== 403)) return null;

  if (context === 'force-sync') {
    return 'Check Microsoft Graph application permission GroupMember.Read.All and grant admin consent for app-only group membership reads.';
  }

  if (context === 'login-discovery') {
    return 'Check Microsoft Graph application permission GroupMember.Read.All and grant admin consent so the app can read the signed-in user\'s group memberships via an app-only token.';
  }

  return 'Check Microsoft Graph delegated permissions for /me/transitiveMemberOf and grant admin consent if your tenant requires it.';
}

function upsertDiscoveredGroups(groups, seenAt) {
  // Existing rows are rewritten only when Entra reports a different name or
  // description, or to move last_seen_at forward at most once a day.
  const stmt = db.prepare(`
    INSERT INTO entra_group_cache (entra_group_id, display_name, description, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(entra_group_id) DO UPDATE SET
      display_name = excluded.display_name,
      description = excluded.description,
      last_seen_at = excluded.last_seen_at
    WHERE entra_group_cache.display_name IS NOT excluded.display_name
      OR entra_group_cache.description IS NOT excluded.description
      OR entra_group_cache.last_seen_at IS NULL
      OR datetime(entra_group_cache.last_seen_at) < datetime(excluded.last_seen_at, '-1 day')
  `);

  for (const group of groups) {
    stmt.run(group.id, group.displayName, group.description || null, seenAt, seenAt);
  }

  return groups.length;
}

// Imported groups and taken names, loaded once and shared by all users of a force sync.
function loadImportedGroupContext() {
  const importedGroups = db.prepare(`
    SELECT id, name, description, entra_display_name, entra_group_id
    FROM user_groups
    WHERE source = 'entra' AND entra_group_id IS NOT NULL
  `).all();
  return {
    importedGroups,
    reservedNames: new Set(db.prepare('SELECT name FROM user_groups').all().map((row) => row.name)),
  };
}

function syncImportedMemberships(userId, groups, syncedAt, context = loadImportedGroupContext()) {
  const { importedGroups, reservedNames } = context;
  const importedGroupIds = importedGroups.map((group) => group.id);
  const importedByEntraId = new Map(importedGroups.map((group) => [group.entra_group_id, group]));
  // Name and description are rewritten only when Entra reports different values;
  // entra_synced_at always records the sync.
  const importedGroupUpdate = db.prepare(`
    UPDATE user_groups
    SET name = ?, description = ?, entra_display_name = ?, entra_synced_at = ?, source = 'entra'
    WHERE id = ?
  `);
  const importedGroupTouch = db.prepare('UPDATE user_groups SET entra_synced_at = ? WHERE id = ?');

  // Apply only the membership changes: remove the imported groups the user left,
  // add the ones they joined, and leave the others untouched.
  const desiredGroupIds = new Set(
    groups.map((group) => importedByEntraId.get(group.id)?.id).filter(Boolean)
  );
  let currentGroupIds = [];
  if (importedGroupIds.length > 0) {
    const placeholders = importedGroupIds.map(() => '?').join(', ');
    currentGroupIds = db.prepare(`SELECT group_id FROM user_group_members WHERE user_id = ? AND group_id IN (${placeholders})`)
      .all(userId, ...importedGroupIds)
      .map((row) => row.group_id);
  }
  const removeMembership = db.prepare('DELETE FROM user_group_members WHERE user_id = ? AND group_id = ?');
  // Read fresh: a group can be flagged as deleted in Entra during the same force sync.
  const frozenGroupIds = new Set(frozenGroups().map((group) => group.id));
  let membershipsRemoved = 0;
  for (const groupId of currentGroupIds) {
    if (desiredGroupIds.has(groupId) || frozenGroupIds.has(groupId)) continue;
    membershipsRemoved += removeMembership.run(userId, groupId).changes;
  }

  const membershipCacheUpsert = db.prepare(`
    INSERT INTO entra_user_group_memberships (user_id, entra_group_id, synced_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, entra_group_id) DO UPDATE SET
      synced_at = excluded.synced_at
  `);
  const localMembershipInsert = db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)');

  let membershipsAdded = 0;
  for (const group of groups) {
    membershipCacheUpsert.run(userId, group.id, syncedAt);
    const importedGroup = importedByEntraId.get(group.id);
    if (importedGroup) {
      const resolvedName = resolveUniqueEntraGroupName(group.displayName, group.id, reservedNames, importedGroup.name);
      const description = group.description || 'No description available on Entra';
      if (
        resolvedName !== importedGroup.name
        || description !== importedGroup.description
        || group.displayName !== importedGroup.entra_display_name
      ) {
        importedGroupUpdate.run(resolvedName, description, group.displayName, syncedAt, importedGroup.id);
        importedGroup.name = resolvedName;
        importedGroup.description = description;
        importedGroup.entra_display_name = group.displayName;
      } else {
        importedGroupTouch.run(syncedAt, importedGroup.id);
      }
      const result = localMembershipInsert.run(userId, importedGroup.id);
      membershipsAdded += result.changes;
    }
  }

  return { membershipsAdded, membershipsRemoved };
}

export async function fetchUserEntraGroups(accessToken) {
  if (!isEntraGroupSyncEnabled()) return [];

  const groups = [];
  let nextUrl = `${GRAPH_BASE_URL}/me/transitiveMemberOf/microsoft.graph.group?$select=id,displayName,description`;

  while (nextUrl) {
    const payload = await fetchGraphPage(nextUrl, accessToken);
    for (const group of payload.value || []) {
      if (group?.id) {
        groups.push({
          id: group.id,
          displayName: group.displayName || group.id,
          description: group.description || null,
        });
      }
    }
    nextUrl = payload['@odata.nextLink'] || null;
  }

  return normalizeGraphGroups(groups);
}

export async function fetchEntraGroupsForUserId(graphUserId, accessToken) {
  if (!isEntraGroupSyncEnabled()) return [];

  const groups = [];
  let nextUrl = `${GRAPH_BASE_URL}/users/${encodeURIComponent(graphUserId)}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName,description`;

  while (nextUrl) {
    const payload = await fetchGraphPage(nextUrl, accessToken);
    for (const group of payload.value || []) {
      if (group?.id) {
        groups.push({
          id: group.id,
          displayName: group.displayName || group.id,
          description: group.description || null,
        });
      }
    }
    nextUrl = payload['@odata.nextLink'] || null;
  }

  return normalizeGraphGroups(groups);
}

/**
 * True only when Microsoft Graph reports that the directory object no longer exists
 * (404 Request_ResourceNotFound). Uses the same endpoint and permission as force sync.
 * Any other outcome, including errors, returns false.
 */
export async function isEntraUserDeleted(graphUserId, { acquireToken = acquireGraphAppToken } = {}) {
  if (!graphUserId) return false;
  try {
    const accessToken = await acquireToken();
    await fetchGraphPage(`${GRAPH_BASE_URL}/users/${encodeURIComponent(graphUserId)}/transitiveMemberOf/microsoft.graph.group?$select=id&$top=1`, accessToken);
    return false;
  } catch (error) {
    return error?.status === 404 && error?.graphCode === 'Request_ResourceNotFound';
  }
}

export async function discoverEntraGroupsForUser(graphUserId) {
  if (!isEntraGroupSyncEnabled()) return [];
  if (!graphUserId) return [];
  const appToken = await acquireGraphAppToken();
  return fetchEntraGroupsForUserId(graphUserId, appToken);
}

export async function fetchAllTenantGroups(accessToken) {
  if (!isEntraGroupSyncEnabled()) return [];

  const groups = [];
  let nextUrl = `${GRAPH_BASE_URL}/groups?$select=id,displayName,description&$top=999`;

  while (nextUrl) {
    const payload = await fetchGraphPage(nextUrl, accessToken);
    for (const group of payload.value || []) {
      if (group?.id) {
        groups.push({
          id: group.id,
          displayName: group.displayName || group.id,
          description: group.description || null,
        });
      }
    }
    nextUrl = payload['@odata.nextLink'] || null;
  }

  return normalizeGraphGroups(groups);
}

// The tenant-wide group catalog (used to pick groups to import) is refreshed at
// sign-in at most once per interval per process; force sync always refreshes it.
const TENANT_REFRESH_INTERVAL_MS = (() => {
  const minutes = Number.parseInt(process.env.ENTRA_TENANT_REFRESH_MINUTES || '', 10);
  return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 360) * 60 * 1000;
})();
let lastTenantRefreshAt = 0;
let tenantRefreshInFlight = null;

// --- Entra groups deleted in Microsoft Entra ---
// Frontdoor relies on an Entra group in two ways: imported (a Frontdoor copy in
// user_groups) or only linked into local groups (group_entra_group_memberships).
// Deleting it in Entra would otherwise remove its members' access user by user,
// silently. Instead the group is flagged with a snapshot of who had access, an
// admin is notified, and with the default "freeze" policy the memberships are kept
// until an admin converts it to a local group, moves its apps, unlinks or deletes it.
//
// Imported groups are flagged on user_groups; linked-only groups on entra_group_cache.

export function getDeletedGroupPolicy() {
  return process.env.ENTRA_DELETED_GROUP_POLICY === 'revoke' ? 'revoke' : 'freeze';
}

export const linkedEntraSubjectKey = (entraGroupId) => `entra:${entraGroupId}`;

const IMPORTED_ENTRA_IDS_SQL = "SELECT entra_group_id FROM user_groups WHERE source = 'entra' AND entra_group_id IS NOT NULL";

// Every Entra group Frontdoor relies on, with its deletion flag.
function trackedEntraGroups() {
  const imported = db.prepare(`
    SELECT id AS group_id, entra_group_id, entra_deleted_at AS deleted_at FROM user_groups
    WHERE source = 'entra' AND entra_group_id IS NOT NULL
  `).all().map((row) => ({ ...row, kind: 'imported' }));
  const linked = db.prepare(`
    SELECT DISTINCT gem.entra_group_id, c.deleted_at FROM group_entra_group_memberships gem
    LEFT JOIN entra_group_cache c ON c.entra_group_id = gem.entra_group_id
    WHERE gem.entra_group_id NOT IN (${IMPORTED_ENTRA_IDS_SQL})
  `).all().map((row) => ({ ...row, kind: 'linked' }));
  return [...imported, ...linked];
}

function frozenGroups() {
  if (getDeletedGroupPolicy() !== 'freeze') return [];
  return db.prepare("SELECT id, entra_group_id FROM user_groups WHERE source = 'entra' AND entra_deleted_at IS NOT NULL").all();
}

// Entra IDs whose cached memberships the sync must keep while frozen.
function frozenEntraGroupIds() {
  if (getDeletedGroupPolicy() !== 'freeze') return [];
  const linked = db.prepare(`
    SELECT c.entra_group_id FROM entra_group_cache c
    WHERE c.deleted_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM group_entra_group_memberships gem WHERE gem.entra_group_id = c.entra_group_id)
  `).all().map((row) => row.entra_group_id);
  return [...frozenGroups().map((group) => group.entra_group_id).filter(Boolean), ...linked];
}

function linkingGroups(entraGroupId) {
  return db.prepare(`
    SELECT g.id, g.name FROM group_entra_group_memberships gem JOIN user_groups g ON g.id = gem.parent_group_id
    WHERE gem.entra_group_id = ? ORDER BY g.name
  `).all(entraGroupId);
}

export function snapshotGroup(groupId) {
  const group = db.prepare('SELECT id, name, entra_group_id, entra_display_name FROM user_groups WHERE id = ?').get(groupId);
  if (!group) return null;
  const members = db.prepare(`
    SELECT u.id, COALESCE(u.display_name, u.email) AS name
    FROM user_group_members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? ORDER BY name
  `).all(groupId);
  const apps = db.prepare(`
    SELECT a.id, a.name FROM app_permissions p JOIN apps a ON a.id = p.app_id
    WHERE p.group_id = ? ORDER BY a.name
  `).all(groupId);
  return {
    groupId: group.id,
    groupName: group.name,
    entraGroupId: group.entra_group_id,
    entraDisplayName: group.entra_display_name,
    members,
    apps,
    linkedIn: group.entra_group_id ? linkingGroups(group.entra_group_id) : [],
  };
}

/** Snapshot of an Entra group linked into local groups without being imported. */
export function snapshotLinkedEntraGroup(entraGroupId) {
  const cached = db.prepare('SELECT display_name FROM entra_group_cache WHERE entra_group_id = ?').get(entraGroupId);
  const members = db.prepare(`
    SELECT u.id, COALESCE(u.display_name, u.email) AS name
    FROM entra_user_group_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.entra_group_id = ? ORDER BY name
  `).all(entraGroupId);
  const linkedIn = linkingGroups(entraGroupId);
  // Apps reached through the local groups that link it.
  const apps = linkedIn.length > 0
    ? db.prepare(`
      SELECT DISTINCT a.id, a.name FROM app_permissions p JOIN apps a ON a.id = p.app_id
      WHERE p.group_id IN (${linkedIn.map(() => '?').join(', ')}) ORDER BY a.name
    `).all(...linkedIn.map((group) => group.id))
    : [];
  return {
    groupId: null,
    groupName: cached?.display_name || entraGroupId,
    entraGroupId,
    entraDisplayName: cached?.display_name || null,
    members,
    apps,
    linkedIn,
  };
}

function notifyGroupDeleted(subjectKey, snapshot, policy) {
  raiseNotification({
    type: NOTIFICATION_TYPES.ENTRA_GROUP_DELETED,
    subjectKey,
    severity: policy === 'freeze' ? 'warning' : 'critical',
    payload: {
      groupId: snapshot.groupId,
      // Linked-only groups have no page of their own: the first linking group shows them.
      parentGroupId: snapshot.groupId ? null : snapshot.linkedIn[0]?.id || null,
      parentGroupName: snapshot.groupId ? null : snapshot.linkedIn[0]?.name || null,
      groupName: snapshot.groupName,
      linkedOnly: !snapshot.groupId,
      memberCount: snapshot.members.length,
      appCount: snapshot.apps.length,
      linkedInCount: snapshot.linkedIn.length,
      policy,
    },
  });
}

function flagGroupDeletedInEntra(tracked) {
  const policy = getDeletedGroupPolicy();
  let snapshot;
  let flagged;
  if (tracked.kind === 'imported') {
    snapshot = snapshotGroup(tracked.group_id);
    flagged = db.prepare(`
      UPDATE user_groups SET entra_deleted_at = datetime('now'), entra_deleted_snapshot = ?
      WHERE id = ? AND entra_deleted_at IS NULL
    `).run(JSON.stringify(snapshot), tracked.group_id).changes;
  } else {
    snapshot = snapshotLinkedEntraGroup(tracked.entra_group_id);
    flagged = db.prepare(`
      INSERT INTO entra_group_cache (entra_group_id, display_name, deleted_at, deleted_snapshot)
      VALUES (?, ?, datetime('now'), ?)
      ON CONFLICT(entra_group_id) DO UPDATE SET deleted_at = excluded.deleted_at, deleted_snapshot = excluded.deleted_snapshot
      WHERE entra_group_cache.deleted_at IS NULL
    `).run(tracked.entra_group_id, snapshot.groupName, JSON.stringify(snapshot)).changes;
  }
  if (!flagged) return null;
  notifyGroupDeleted(tracked.kind === 'imported' ? tracked.group_id : linkedEntraSubjectKey(tracked.entra_group_id), snapshot, policy);
  console.warn(`Entra group deleted in Entra [${tracked.kind} ${tracked.group_id || tracked.entra_group_id}]: ${snapshot.members.length} members, ${snapshot.apps.length} apps, policy=${policy}`);
  return snapshot;
}

function clearGroupDeletedInEntra(tracked) {
  if (tracked.kind === 'imported') {
    db.prepare('UPDATE user_groups SET entra_deleted_at = NULL, entra_deleted_snapshot = NULL WHERE id = ?').run(tracked.group_id);
    resolveNotifications(NOTIFICATION_TYPES.ENTRA_GROUP_DELETED, tracked.group_id);
  } else {
    clearLinkedEntraGroupDeleted(tracked.entra_group_id);
  }
  console.log(`Entra group restored in Entra [${tracked.kind} ${tracked.group_id || tracked.entra_group_id}]`);
}

/** Clears the deletion flag of a linked-only Entra group and resolves its notification. */
export function clearLinkedEntraGroupDeleted(entraGroupId, resolvedBy = null) {
  db.prepare('UPDATE entra_group_cache SET deleted_at = NULL, deleted_snapshot = NULL WHERE entra_group_id = ?').run(entraGroupId);
  resolveNotifications(NOTIFICATION_TYPES.ENTRA_GROUP_DELETED, linkedEntraSubjectKey(entraGroupId), resolvedBy);
}

/**
 * After links are removed: a flagged linked-only Entra group that no local group links
 * any more has nothing left to protect. Its frozen memberships are dropped and the
 * flag and notification are cleared.
 */
export function releaseUnlinkedDeletedEntraGroups(resolvedBy = null) {
  const orphans = db.prepare(`
    SELECT entra_group_id FROM entra_group_cache c
    WHERE c.deleted_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM group_entra_group_memberships gem WHERE gem.entra_group_id = c.entra_group_id)
      AND c.entra_group_id NOT IN (${IMPORTED_ENTRA_IDS_SQL})
  `).all().map((row) => row.entra_group_id);
  for (const entraGroupId of orphans) {
    db.prepare('DELETE FROM entra_user_group_memberships WHERE entra_group_id = ?').run(entraGroupId);
    clearLinkedEntraGroupDeleted(entraGroupId, resolvedBy);
  }
  return orphans;
}

// True only for Graph's "resource not found", as for users: errors never count as a deletion.
async function isEntraGroupDeleted(entraGroupId, accessToken) {
  try {
    await fetchGraphPage(`${GRAPH_BASE_URL}/groups/${encodeURIComponent(entraGroupId)}?$select=id`, accessToken);
    return false;
  } catch (error) {
    return error?.status === 404 && error?.graphCode === 'Request_ResourceNotFound';
  }
}

/**
 * Checks the Entra groups Frontdoor relies on. With `catalogIds` (a complete tenant
 * catalog), groups listed there are restored if flagged, the others are confirmed one
 * by one. With `candidateEntraIds`, only those groups are confirmed. `checked` caches
 * Graph answers within one run.
 */
export async function detectDeletedEntraGroups(accessToken, { catalogIds = null, candidateEntraIds = null, checked = new Map() } = {}) {
  const flagged = [];
  const restored = [];
  for (const tracked of trackedEntraGroups()) {
    const id = tracked.entra_group_id;
    if (candidateEntraIds && !candidateEntraIds.has(id)) continue;
    if (catalogIds?.has(id)) {
      if (tracked.deleted_at) {
        clearGroupDeletedInEntra(tracked);
        restored.push(id);
      }
      continue;
    }
    if (tracked.deleted_at) continue;
    if (!checked.has(id)) checked.set(id, await isEntraGroupDeleted(id, accessToken));
    if (checked.get(id) && flagGroupDeletedInEntra(tracked)) flagged.push(id);
  }
  return { flagged, restored };
}

/**
 * Before a user's memberships are synced: Entra groups the user is about to leave
 * (imported, or linked into local groups) may have been deleted in Entra rather than
 * left. Confirm those first, so a deletion is flagged (and frozen) before any
 * membership is removed.
 */
export async function protectDeletedGroupsBeforeUserSync(userId, entraGroups, { acquireToken = acquireGraphAppToken, accessToken = null, checked } = {}) {
  const reported = new Set((entraGroups || []).map((group) => group?.id).filter(Boolean));
  const imported = db.prepare(`
    SELECT g.entra_group_id FROM user_group_members m JOIN user_groups g ON g.id = m.group_id
    WHERE m.user_id = ? AND g.source = 'entra' AND g.entra_group_id IS NOT NULL AND g.entra_deleted_at IS NULL
  `).all(userId);
  const linked = db.prepare(`
    SELECT m.entra_group_id FROM entra_user_group_memberships m
    LEFT JOIN entra_group_cache c ON c.entra_group_id = m.entra_group_id
    WHERE m.user_id = ? AND c.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM group_entra_group_memberships gem WHERE gem.entra_group_id = m.entra_group_id)
  `).all(userId);
  const leaving = [...imported, ...linked].map((row) => row.entra_group_id).filter((id) => !reported.has(id));
  if (leaving.length === 0) return { flagged: [], restored: [] };
  return detectDeletedEntraGroups(accessToken || await acquireToken(), { candidateEntraIds: new Set(leaving), checked });
}

function storeTenantGroups(groups) {
  const syncAt = sqliteNow();
  const discoveredGroups = db.transaction(() => upsertDiscoveredGroups(groups, syncAt))();
  lastTenantRefreshAt = Date.now();
  return discoveredGroups;
}

export async function refreshGroupCacheFromTenant({ force = false } = {}) {
  if (!isEntraGroupSyncEnabled()) {
    return { discoveredGroups: 0, skipped: true };
  }
  if (!force && lastTenantRefreshAt && Date.now() - lastTenantRefreshAt < TENANT_REFRESH_INTERVAL_MS) {
    return { discoveredGroups: 0, skipped: true };
  }
  // Concurrent sign-ins share one refresh instead of each paging through the tenant.
  if (!tenantRefreshInFlight) {
    tenantRefreshInFlight = (async () => {
      const appToken = await acquireGraphAppToken();
      const tenantGroups = await fetchAllTenantGroups(appToken);
      const discovered = storeTenantGroups(tenantGroups);
      await detectDeletedEntraGroups(appToken, { catalogIds: new Set(tenantGroups.map((group) => group.id)) });
      return discovered;
    })().finally(() => { tenantRefreshInFlight = null; });
  }
  return { discoveredGroups: await tenantRefreshInFlight, skipped: false };
}

/** Test helper: forget when the tenant catalog was last refreshed. */
export function resetTenantRefreshTimer() {
  lastTenantRefreshAt = 0;
}

export async function fetchTransitiveMembersForGroupId(graphGroupId, accessToken) {
  if (!isEntraGroupSyncEnabled()) return [];

  const users = [];
  let nextUrl = `${GRAPH_BASE_URL}/groups/${encodeURIComponent(graphGroupId)}/transitiveMembers/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName`;

  while (nextUrl) {
    const payload = await fetchGraphPage(nextUrl, accessToken);
    for (const user of payload.value || []) {
      if (user?.id) {
        users.push({
          id: user.id,
          displayName: user.displayName || user.mail || user.userPrincipalName || user.id,
        });
      }
    }
    nextUrl = payload['@odata.nextLink'] || null;
  }

  return [...new Map(users.map((user) => [user.id, user])).values()];
}

export function syncUserEntraGroups(userId, entraGroups, context = undefined) {
  if (!isEntraGroupSyncEnabled()) {
    return { discoveredGroups: 0, membershipsAdded: 0, membershipsRemoved: 0 };
  }

  const syncAt = sqliteNow();
  const currentGroups = normalizeGraphGroups(entraGroups);

  const syncTransaction = db.transaction(() => {
    const discoveredGroups = upsertDiscoveredGroups(currentGroups, syncAt);
    // Drop only the cached memberships Graph no longer reports; the rest are refreshed by the upsert.
    // Imported groups deleted in Entra keep their cached memberships while frozen.
    const currentIds = [...currentGroups.map((group) => group.id), ...frozenEntraGroupIds()];
    if (currentIds.length > 0) {
      db.prepare(`DELETE FROM entra_user_group_memberships WHERE user_id = ? AND entra_group_id NOT IN (${currentIds.map(() => '?').join(', ')})`)
        .run(userId, ...currentIds);
    } else {
      db.prepare('DELETE FROM entra_user_group_memberships WHERE user_id = ?').run(userId);
    }
    const { membershipsAdded, membershipsRemoved } = syncImportedMemberships(userId, currentGroups, syncAt, context);
    return { discoveredGroups, membershipsAdded, membershipsRemoved };
  });

  return syncTransaction();
}

export function listDiscoveredEntraGroups() {
  return db.prepare(`
    SELECT
      c.entra_group_id,
      c.display_name,
      c.description,
      c.first_seen_at,
      c.last_seen_at,
      g.id AS local_group_id,
      g.name AS local_name,
      g.entra_synced_at AS imported_at,
      EXISTS (
        SELECT 1
        FROM user_groups ug
        WHERE ug.entra_group_id = c.entra_group_id AND ug.source = 'entra'
      ) AS is_imported,
      (
        SELECT COUNT(*)
        FROM entra_user_group_memberships m
        WHERE m.entra_group_id = c.entra_group_id
      ) AS synced_member_count,
      (
        SELECT COUNT(*)
        FROM group_entra_group_memberships gm
        WHERE gm.entra_group_id = c.entra_group_id
      ) AS linked_parent_count
    FROM entra_group_cache c
    LEFT JOIN user_groups g
      ON g.entra_group_id = c.entra_group_id
     AND g.source = 'entra'
    ORDER BY c.display_name
  `).all().map((row) => ({
    ...row,
    description: row.description || null,
    is_imported: Boolean(row.is_imported),
    synced_member_count: Number(row.synced_member_count || 0),
    linked_parent_count: Number(row.linked_parent_count || 0),
  }));
}

export function importEntraGroups(groupIds) {
  if (!isEntraGroupSyncEnabled()) {
    return { importedGroups: 0, skippedGroups: 0, membershipsAdded: 0 };
  }

  const uniqueGroupIds = [...new Set((Array.isArray(groupIds) ? groupIds : []).filter(Boolean))];
  if (uniqueGroupIds.length === 0) {
    return { importedGroups: 0, skippedGroups: 0, membershipsAdded: 0 };
  }

  const now = sqliteNow();
  const cacheLookup = db.prepare('SELECT entra_group_id, display_name, description FROM entra_group_cache WHERE entra_group_id = ?');
  const existingGroups = db.prepare("SELECT id, name, description, entra_group_id, entra_display_name FROM user_groups WHERE source = 'entra'").all();
  const reservedNames = new Set(db.prepare('SELECT name FROM user_groups').all().map((row) => row.name));
  const membershipBackfill = db.prepare(`
    INSERT OR IGNORE INTO user_group_members (user_id, group_id)
    SELECT user_id, ?
    FROM entra_user_group_memberships
    WHERE entra_group_id = ?
  `);
  const importedGroupUpsert = db.prepare(`
    INSERT INTO user_groups (id, name, description, source, entra_group_id, entra_display_name, entra_synced_at)
    VALUES (?, ?, ?, 'entra', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      source = 'entra',
      entra_group_id = excluded.entra_group_id,
      entra_display_name = excluded.entra_display_name,
      entra_synced_at = excluded.entra_synced_at
  `);

  const existingByEntraId = new Map(existingGroups.map((group) => [group.entra_group_id, group]));

  const syncTransaction = db.transaction(() => {
    let importedGroups = 0;
    let skippedGroups = 0;
    let membershipsAdded = 0;

    for (const entraGroupId of uniqueGroupIds) {
      const cacheRow = cacheLookup.get(entraGroupId);
      if (!cacheRow) {
        throw new UserFacingError(`Entra group ${entraGroupId} is not in the discovery cache`, { statusCode: 400, code: 'entra_group_not_discovered' });
      }

      const existing = existingByEntraId.get(entraGroupId) || null;
      const name = resolveUniqueEntraGroupName(cacheRow.display_name, entraGroupId, reservedNames, existing?.name || null);
      const description = cacheRow.description || 'No description available on Entra';

      // Already imported with the same data: nothing to rewrite.
      if (
        existing
        && existing.name === name
        && existing.description === description
        && existing.entra_display_name === cacheRow.display_name
      ) {
        skippedGroups += 1;
      } else {
        importedGroupUpsert.run(entraGroupId, name, description, entraGroupId, cacheRow.display_name, now);
        importedGroups += 1;
      }

      const result = membershipBackfill.run(entraGroupId, entraGroupId);
      membershipsAdded += result.changes;
    }

    return { importedGroups, skippedGroups, membershipsAdded };
  });

  return syncTransaction();
}

function isProtectedFromAutoDeactivation(user) {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.includes((user.email || '').trim().toLowerCase())) return true;
  if (!['owner', 'admin'].includes(user.role)) return false;
  const otherEditors = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role IN ('owner', 'admin') AND is_active = 1 AND id != ?").get(user.id).count;
  return otherEditors === 0;
}

// A user Graph no longer finds is deactivated (history kept), unless that would
// lock out the compose owner or the last active admin editor.
function handleUserMissingFromEntra(user) {
  if (isProtectedFromAutoDeactivation(user)) {
    db.prepare("UPDATE users SET entra_missing_since = datetime('now') WHERE id = ? AND entra_missing_since IS NULL").run(user.id);
    return false;
  }
  db.prepare(`
    UPDATE users
    SET is_active = 0, entra_missing_since = COALESCE(entra_missing_since, datetime('now')), updated_at = datetime('now')
    WHERE id = ?
  `).run(user.id);
  return true;
}

export async function forceSyncAllEntraUsers({ acquireToken = acquireGraphAppToken } = {}) {
  if (!isEntraGroupSyncEnabled()) {
    return {
      usersConsidered: 0,
      usersSynced: 0,
      usersNotFound: 0,
      usersDeactivated: 0,
      deactivatedUsers: [],
      discoveredGroups: 0,
      membershipsAdded: 0,
      membershipsRemoved: 0,
      errors: [],
    };
  }

  const users = db.prepare(`
    SELECT id, email, display_name, role, microsoft_id, entra_missing_since
    FROM users
    WHERE microsoft_id IS NOT NULL AND is_active = 1
    ORDER BY email
  `).all();

  const errors = [];
  const accessToken = await acquireToken();

  let tenantGroupsDiscovered = 0;
  try {
    const tenantGroups = await fetchAllTenantGroups(accessToken);
    tenantGroupsDiscovered = storeTenantGroups(tenantGroups);
    await detectDeletedEntraGroups(accessToken, { catalogIds: new Set(tenantGroups.map((group) => group.id)) });
  } catch (error) {
    const hint = formatGraphAccessHint(error, 'force-sync');
    errors.push({
      scope: 'tenant-groups',
      message: error.message,
      ...(hint ? { hint, hintCode: 'graph_group_member_read' } : {}),
    });
  }

  if (users.length === 0) {
    return {
      usersConsidered: 0,
      usersSynced: 0,
      usersNotFound: 0,
      usersDeactivated: 0,
      deactivatedUsers: [],
      discoveredGroups: tenantGroupsDiscovered,
      membershipsAdded: 0,
      membershipsRemoved: 0,
      errors: errors.length > 0 ? errors : [{
        message: 'No users are linked to Microsoft Entra yet. Ask users to log in once first.',
      }],
    };
  }

  let usersSynced = 0;
  let usersNotFound = 0;
  const deactivatedUsers = [];
  let membershipsAdded = 0;
  let membershipsRemoved = 0;

  const importedGroupContext = loadImportedGroupContext();
  const deletionChecks = new Map();
  for (const user of users) {
    try {
      const groups = await fetchEntraGroupsForUserId(user.microsoft_id, accessToken);
      await protectDeletedGroupsBeforeUserSync(user.id, groups, { accessToken, checked: deletionChecks });
      const result = syncUserEntraGroups(user.id, groups, importedGroupContext);
      if (user.entra_missing_since) {
        db.prepare('UPDATE users SET entra_missing_since = NULL WHERE id = ?').run(user.id);
      }
      usersSynced += 1;
      membershipsAdded += result.membershipsAdded;
      membershipsRemoved += result.membershipsRemoved;
    } catch (error) {
      // Deleted from the directory: not a sync failure. The user is deactivated,
      // memberships and history are kept so an admin can still review or delete them.
      // Only Graph's "resource not found" counts: any other 404 is a real error.
      if (error.status === 404 && error.graphCode === 'Request_ResourceNotFound') {
        usersNotFound += 1;
        if (handleUserMissingFromEntra(user)) deactivatedUsers.push({ id: user.id, email: user.email, display_name: user.display_name, role: user.role });
        continue;
      }
      const hint = formatGraphAccessHint(error, 'force-sync');
      errors.push({
        userId: user.id,
        message: error.message,
        ...(hint ? { hint, hintCode: 'graph_group_member_read' } : {}),
      });
    }
  }

  return {
    usersConsidered: users.length,
    usersSynced,
    usersNotFound,
    usersDeactivated: deactivatedUsers.length,
    deactivatedUsers,
    discoveredGroups: tenantGroupsDiscovered,
    membershipsAdded,
    membershipsRemoved,
    errors,
  };
}
