import { ConfidentialClientApplication } from '@azure/msal-node';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const DEFAULT_SCOPES = ['User.Read', 'openid', 'profile', 'email'];
const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const GRAPH_APP_SCOPES = ['https://graph.microsoft.com/.default'];

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
    throw new Error('Microsoft Graph app credentials are not configured');
  }

  const response = await client.acquireTokenByClientCredential({
    scopes: GRAPH_APP_SCOPES,
  });

  if (!response?.accessToken) {
    throw new Error('Microsoft Graph app token could not be acquired');
  }

  return response.accessToken;
}

async function fetchGraphPage(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`Graph API error ${response.status} for ${url}`);
    error.status = response.status;
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
    });
  }
  return [...seen.values()];
}

function formatGraphAccessHint(error, context) {
  if (!error || (error.status !== 401 && error.status !== 403)) return null;

  if (context === 'force-sync') {
    return 'Check Microsoft Graph application permission User.Read.All and grant admin consent for app-only membership reads.';
  }

  return 'Check Microsoft Graph delegated permissions for /me/transitiveMemberOf and grant admin consent if your tenant requires it.';
}

function upsertDiscoveredGroups(groups, seenAt) {
  const stmt = db.prepare(`
    INSERT INTO entra_group_cache (entra_group_id, display_name, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(entra_group_id) DO UPDATE SET
      display_name = excluded.display_name,
      last_seen_at = excluded.last_seen_at
  `);

  for (const group of groups) {
    stmt.run(group.id, group.displayName, seenAt, seenAt);
  }

  return groups.length;
}

function syncImportedMemberships(userId, groups, syncedAt) {
  const importedGroups = db.prepare(`
    SELECT id, name, entra_group_id
    FROM user_groups
    WHERE source = 'entra' AND entra_group_id IS NOT NULL
  `).all();
  const importedGroupIds = importedGroups.map((group) => group.id);
  const importedByEntraId = new Map(importedGroups.map((group) => [group.entra_group_id, group]));
  const reservedNames = new Set(db.prepare('SELECT name FROM user_groups').all().map((row) => row.name));
  const importedGroupUpdate = db.prepare(`
    UPDATE user_groups
    SET name = ?, description = ?, entra_display_name = ?, entra_synced_at = ?, source = 'entra'
    WHERE id = ?
  `);

  let membershipsRemoved = 0;
  if (importedGroupIds.length > 0) {
    const placeholders = importedGroupIds.map(() => '?').join(', ');
    const result = db.prepare(`DELETE FROM user_group_members WHERE user_id = ? AND group_id IN (${placeholders})`)
      .run(userId, ...importedGroupIds);
    membershipsRemoved = result.changes;
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
      importedGroupUpdate.run(
        resolvedName,
        'Imported from Microsoft Entra',
        group.displayName,
        syncedAt,
        importedGroup.id
      );
      const result = localMembershipInsert.run(userId, importedGroup.id);
      membershipsAdded += result.changes;
    }
  }

  return { membershipsAdded, membershipsRemoved };
}

export async function fetchUserEntraGroups(accessToken) {
  if (!isEntraGroupSyncEnabled()) return [];

  const groups = [];
  let nextUrl = `${GRAPH_BASE_URL}/me/transitiveMemberOf/microsoft.graph.group?$select=id,displayName`;

  while (nextUrl) {
    const payload = await fetchGraphPage(nextUrl, accessToken);
    for (const group of payload.value || []) {
      if (group?.id) {
        groups.push({
          id: group.id,
          displayName: group.displayName || group.id,
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
  let nextUrl = `${GRAPH_BASE_URL}/users/${encodeURIComponent(graphUserId)}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName`;

  while (nextUrl) {
    const payload = await fetchGraphPage(nextUrl, accessToken);
    for (const group of payload.value || []) {
      if (group?.id) {
        groups.push({
          id: group.id,
          displayName: group.displayName || group.id,
        });
      }
    }
    nextUrl = payload['@odata.nextLink'] || null;
  }

  return normalizeGraphGroups(groups);
}

export function syncUserEntraGroups(userId, entraGroups) {
  if (!isEntraGroupSyncEnabled()) {
    return { discoveredGroups: 0, membershipsAdded: 0, membershipsRemoved: 0 };
  }

  const syncAt = new Date().toISOString();
  const currentGroups = normalizeGraphGroups(entraGroups);

  const syncTransaction = db.transaction(() => {
    const discoveredGroups = upsertDiscoveredGroups(currentGroups, syncAt);
    db.prepare('DELETE FROM entra_user_group_memberships WHERE user_id = ?').run(userId);
    const { membershipsAdded, membershipsRemoved } = syncImportedMemberships(userId, currentGroups, syncAt);
    return { discoveredGroups, membershipsAdded, membershipsRemoved };
  });

  return syncTransaction();
}

export function listDiscoveredEntraGroups() {
  return db.prepare(`
    SELECT
      c.entra_group_id,
      c.display_name,
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
      ) AS synced_member_count
    FROM entra_group_cache c
    LEFT JOIN user_groups g
      ON g.entra_group_id = c.entra_group_id
     AND g.source = 'entra'
    ORDER BY c.display_name
  `).all().map((row) => ({
    ...row,
    is_imported: Boolean(row.is_imported),
    synced_member_count: Number(row.synced_member_count || 0),
  }));
}

export function importEntraGroups(groupIds) {
  if (!isEntraGroupSyncEnabled()) {
    return { importedGroups: 0, membershipsAdded: 0 };
  }

  const uniqueGroupIds = [...new Set((Array.isArray(groupIds) ? groupIds : []).filter(Boolean))];
  if (uniqueGroupIds.length === 0) {
    return { importedGroups: 0, membershipsAdded: 0 };
  }

  const now = new Date().toISOString();
  const cacheLookup = db.prepare('SELECT entra_group_id, display_name FROM entra_group_cache WHERE entra_group_id = ?');
  const existingGroups = db.prepare("SELECT id, name, entra_group_id FROM user_groups WHERE source = 'entra'").all();
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
    let membershipsAdded = 0;

    for (const entraGroupId of uniqueGroupIds) {
      const cacheRow = cacheLookup.get(entraGroupId);
      if (!cacheRow) {
        throw new Error(`Entra group ${entraGroupId} is not in the discovery cache`);
      }

      const existing = existingByEntraId.get(entraGroupId) || null;
      const name = resolveUniqueEntraGroupName(cacheRow.display_name, entraGroupId, reservedNames, existing?.name || null);

      importedGroupUpsert.run(
        entraGroupId,
        name,
        'Imported from Microsoft Entra',
        entraGroupId,
        cacheRow.display_name,
        now
      );
      importedGroups += 1;

      const result = membershipBackfill.run(entraGroupId, entraGroupId);
      membershipsAdded += result.changes;
    }

    return { importedGroups, membershipsAdded };
  });

  return syncTransaction();
}

export async function forceSyncAllEntraUsers() {
  if (!isEntraGroupSyncEnabled()) {
    return {
      usersConsidered: 0,
      usersSynced: 0,
      discoveredGroups: 0,
      membershipsAdded: 0,
      membershipsRemoved: 0,
      errors: [],
    };
  }

  const accessToken = await acquireGraphAppToken();
  const users = db.prepare(`
    SELECT id, email, microsoft_id
    FROM users
    WHERE microsoft_id IS NOT NULL
    ORDER BY email
  `).all();

  if (users.length === 0) {
    return {
      usersConsidered: 0,
      usersSynced: 0,
      discoveredGroups: 0,
      membershipsAdded: 0,
      membershipsRemoved: 0,
      errors: [{
        message: 'No users are linked to Microsoft Entra yet. Ask users to log in once first.',
      }],
    };
  }

  let usersSynced = 0;
  const discoveredGroupIds = new Set();
  let membershipsAdded = 0;
  let membershipsRemoved = 0;
  const errors = [];

  for (const user of users) {
    try {
      const groups = await fetchEntraGroupsForUserId(user.microsoft_id, accessToken);
      for (const group of groups) {
        discoveredGroupIds.add(group.id);
      }
      const result = syncUserEntraGroups(user.id, groups);
      usersSynced += 1;
      membershipsAdded += result.membershipsAdded;
      membershipsRemoved += result.membershipsRemoved;
    } catch (error) {
      const hint = formatGraphAccessHint(error, 'force-sync');
      errors.push({
        userId: user.id,
        email: user.email,
        message: error.message,
        ...(hint ? { hint } : {}),
      });
    }
  }

  return {
    usersConsidered: users.length,
    usersSynced,
    discoveredGroups: discoveredGroupIds.size,
    membershipsAdded,
    membershipsRemoved,
    errors,
  };
}
