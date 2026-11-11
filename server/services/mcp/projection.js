// The fail-closed mediation layer (spec §6): a tool result is built only from
// fields explicitly listed for its entity. A field nobody listed never leaves.

// Field lists per entity, the only shapes tool results may contain.
export const PROJECTIONS = Object.freeze({
  myApp: Object.freeze(['name', 'slug', 'description', 'tags', 'launchUrl', 'favorite']),
  preferences: Object.freeze(['favorites', 'colorScheme', 'language']),
  adminApp: Object.freeze(['name', 'slug', 'tags', 'mode', 'active', 'groupCount']),
  appAccessGroup: Object.freeze(['name', 'source', 'nestedGroups', 'unnamedNestedGroups', 'userCount']),
  group: Object.freeze(['name', 'source', 'memberCount', 'appCount']),
});

// Envelope fields of a paged list (pagination.js): counts and an opaque offset
// cursor, never catalogue data or personal data.
export const PAGING_FIELDS = Object.freeze(['total', 'hasMore', 'nextCursor']);

// What the consent page lists as leaving Frontdoor (i18n keys on the client).
export const MCP_EXPOSED_FIELDS = Object.freeze([
  'appNames', 'appDescriptions', 'appTags', 'launchLinks', 'ownPreferences', 'groupNames', 'counts',
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
