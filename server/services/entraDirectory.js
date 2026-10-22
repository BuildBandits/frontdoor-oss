import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_GROUP_ID } from '../../shared/groups.js';
import { UserFacingError } from './errors.js';
import { acquireGraphAppToken, fetchGraphPage } from './entraGroups.js';

// Pre-onboarding: admins pick a user that already exists in the Entra tenant and
// create the Frontdoor account before the first sign-in, linked by object ID.

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const USER_FIELDS = 'id,displayName,mail,userPrincipalName,accountEnabled,userType';
const OBJECT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 64;
const SEARCH_RESULTS = 20;
const DIRECTORY_HINT = 'Check Microsoft Graph application permission User.Read.All and grant admin consent for app-only directory reads.';

function directoryError(error, fallbackCode) {
  if (error instanceof UserFacingError) return error;
  if (error?.status === 401 || error?.status === 403) {
    return new UserFacingError('Microsoft Graph denied the directory read', { statusCode: 502, code: 'entra_directory_access_denied', hint: DIRECTORY_HINT });
  }
  return new UserFacingError('Microsoft Graph directory request failed', { statusCode: 502, code: fallbackCode });
}

function normalizeDirectoryUser(user) {
  const email = String(user.mail || user.userPrincipalName || '').trim().toLowerCase();
  return {
    id: user.id,
    displayName: user.displayName || email.split('@')[0] || user.id,
    email,
    accountEnabled: user.accountEnabled !== false,
    userType: user.userType || null,
  };
}

function withFrontdoorAccounts(users) {
  const byMicrosoftId = db.prepare('SELECT id, is_active FROM users WHERE microsoft_id = ?');
  const byEmail = db.prepare('SELECT id, is_active FROM users WHERE email = ?');
  return users.map((user) => {
    const account = byMicrosoftId.get(user.id) || (user.email ? byEmail.get(user.email) : null);
    return { ...user, frontdoorUserId: account?.id || null };
  });
}

// OData string literal: single quotes are doubled.
const odataString = (value) => `'${value.replace(/'/g, "''")}'`;

export async function searchDirectoryUsers(query, { acquireToken = acquireGraphAppToken } = {}) {
  const term = String(query || '').trim();
  if (term.length < SEARCH_MIN_LENGTH || term.length > SEARCH_MAX_LENGTH) {
    throw new UserFacingError('Search text must be 2 to 64 characters', { statusCode: 400, code: 'directory_search_length' });
  }

  const literal = odataString(term);
  const filter = ['displayName', 'givenName', 'surname', 'mail', 'userPrincipalName']
    .map((field) => `startswith(${field},${literal})`)
    .join(' or ');
  const url = `${GRAPH_BASE_URL}/users?$select=${USER_FIELDS}&$top=${SEARCH_RESULTS}&$filter=${encodeURIComponent(filter)}`;

  let payload;
  try {
    payload = await fetchGraphPage(url, await acquireToken());
  } catch (error) {
    throw directoryError(error, 'entra_directory_search_failed');
  }

  const users = (payload.value || []).filter((user) => user?.id).map(normalizeDirectoryUser);
  return withFrontdoorAccounts(users);
}

export async function getDirectoryUser(objectId, { acquireToken = acquireGraphAppToken } = {}) {
  if (!OBJECT_ID_RE.test(String(objectId || ''))) {
    throw new UserFacingError('A Microsoft Entra object ID is required', { statusCode: 400, code: 'entra_object_id_invalid' });
  }
  try {
    const user = await fetchGraphPage(`${GRAPH_BASE_URL}/users/${encodeURIComponent(objectId)}?$select=${USER_FIELDS}`, await acquireToken());
    return normalizeDirectoryUser(user);
  } catch (error) {
    if (error?.status === 404) {
      throw new UserFacingError('User not found in Microsoft Entra', { statusCode: 404, code: 'entra_user_not_found' });
    }
    throw directoryError(error, 'entra_directory_lookup_failed');
  }
}

export async function preonboardDirectoryUser(objectId, groupIds = [], options = {}) {
  if (!Array.isArray(groupIds) || groupIds.some((id) => typeof id !== 'string')) {
    throw new UserFacingError('groupIds must be an array of group IDs', { statusCode: 400, code: 'group_ids_invalid' });
  }
  const entraUser = await getDirectoryUser(objectId, options);
  if (!entraUser.email) {
    throw new UserFacingError('The Microsoft Entra user has no email or user principal name', { statusCode: 400, code: 'entra_user_without_email' });
  }

  const requestedGroupIds = [...new Set(groupIds.filter((id) => id !== DEFAULT_GROUP_ID))];
  const findLocalGroup = db.prepare("SELECT id FROM user_groups WHERE id = ? AND source = 'local'");
  const invalid = requestedGroupIds.filter((id) => !findLocalGroup.get(id));
  if (invalid.length > 0) {
    throw new UserFacingError('Only existing local groups can be assigned', { statusCode: 400, code: 'preonboard_groups_invalid', details: { count: invalid.length } });
  }

  const create = db.transaction(() => {
    // Checked inside the transaction so two admins cannot create the same account.
    const existing = db.prepare('SELECT id FROM users WHERE microsoft_id = ? OR email = ?').get(entraUser.id, entraUser.email);
    if (existing) {
      throw new UserFacingError('This user already has a Frontdoor account', { statusCode: 409, code: 'user_already_exists', details: { userId: existing.id } });
    }

    const userId = uuidv4();
    const avatarColor = `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
    db.prepare(`
      INSERT INTO users (id, email, display_name, microsoft_id, role, avatar_color, is_active)
      VALUES (?, ?, ?, ?, 'user', ?, 1)
    `).run(userId, entraUser.email, entraUser.displayName, entraUser.id, avatarColor);

    // Same starting point as a brand-new user signing in: the default group, plus the chosen local groups.
    const addMember = db.prepare('INSERT OR IGNORE INTO user_group_members (user_id, group_id) VALUES (?, ?)');
    for (const groupId of [DEFAULT_GROUP_ID, ...requestedGroupIds]) addMember.run(userId, groupId);

    return userId;
  });

  return { userId: create(), email: entraUser.email, groupIds: requestedGroupIds };
}
