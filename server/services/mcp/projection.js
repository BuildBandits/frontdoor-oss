// The fail-closed mediation layer (spec §6): a tool result is built only from
// fields explicitly listed for its entity. A field nobody listed never leaves.
import crypto from 'node:crypto';

// Field lists per entity, the only shapes tool results may contain.
export const PROJECTIONS = Object.freeze({
  myApp: Object.freeze(['name', 'slug', 'description', 'tags', 'launchUrl', 'favorite']),
  preferences: Object.freeze(['favorites', 'colorScheme', 'language']),
  adminApp: Object.freeze(['name', 'slug', 'tags', 'mode', 'active', 'groupCount']),
  appAccessGroup: Object.freeze(['name', 'source', 'via', 'userCount']),
  group: Object.freeze(['name', 'source', 'memberCount', 'appCount']),
});

// What the consent page lists as leaving Frontdoor (i18n keys on the client).
export const MCP_EXPOSED_FIELDS = Object.freeze([
  'appNames', 'appDescriptions', 'appTags', 'launchLinks', 'ownPreferences', 'groupNames', 'counts', 'pseudonymousUsers',
]);

export function project(record, fields) {
  const out = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(record, field) && record[field] !== undefined) out[field] = record[field];
  }
  return out;
}

export function projectAll(records, fields) {
  return records.map((record) => project(record, fields));
}

// Stable within one grant (one user + one assistant), meaningless outside it
// and after the kill switch rotates the key.
export function pseudonymFor(key, grantId, userId) {
  if (!key) throw new Error('Pseudonym key missing');
  const digest = crypto.createHmac('sha256', key).update(`${grantId}\u0000${userId}`).digest('hex');
  return `U-${digest.slice(0, 8)}`;
}
