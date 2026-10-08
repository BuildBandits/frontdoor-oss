// Turns an RBAC audit row into readable parts: a localized summary sentence,
// the changed fields and the remaining details, with entity IDs replaced by names.
// Names come from the snapshot stored in the row (`details.refs`) first, then
// from the current names the API resolves for the page (`refs`).

import { formatMessage } from '../i18n/index.js';

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

// Keys whose content is already shown elsewhere (summary, target, changes).
const ALWAYS_HIDDEN = new Set(['refs', 'changes', 'name', 'sourceGroupName', 'targetGroupName']);

const BRANDING_REFRESH_EVENTS = {
  'avatar-cache': 'refreshAvatars',
  'app-icon-cache': 'refreshAppIcons',
  'database-storage': 'compactDatabase',
};

const MAX_LIST_ITEMS = 10;
const MAX_TEXT_LENGTH = 160;

export function parseAuditDetails(details) {
  if (!details) return null;
  if (typeof details !== 'string') return details;
  try {
    return JSON.parse(details);
  } catch {
    return details;
  }
}

export function stringifyAuditDetails(details) {
  const parsed = parseAuditDetails(details);
  if (parsed === null || parsed === undefined) return '';
  if (typeof parsed === 'string') return parsed;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(parsed);
  }
}

function shortId(id) {
  const value = String(id);
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function truncate(value, max = MAX_TEXT_LENGTH) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function targetRefType(action, targetType) {
  switch (targetType) {
    case 'app':
      return 'apps';
    case 'group':
    case 'membership':
      return 'groups';
    case 'permission':
      return action === 'sync_apps' ? 'apps' : 'groups';
    case 'role':
    case 'user_status':
    case 'auth':
      return 'users';
    default:
      return null;
  }
}

function idRefType(key, action) {
  if (key === 'groupIds' && action === 'import') return 'entraGroups';
  return ID_KEYS[key] || null;
}

/**
 * @param {object} log audit row from GET /logs/audit
 * @param {object} options { ui, refs } — ui strings and the page-level name map
 */
export function describeAuditLog(log, { ui, refs = {} } = {}) {
  const t = ui.admin.audit;
  const details = parseAuditDetails(log.details);
  const objectDetails = details && typeof details === 'object' && !Array.isArray(details) ? details : null;
  const storedRefs = objectDetails?.refs || {};

  const nameFor = (type, id) => {
    if (!type || id === undefined || id === null) return null;
    return storedRefs[type]?.[id] || refs[type]?.[id] || null;
  };
  const labelFor = (type, id) => nameFor(type, id) || formatMessage(t.unknownEntity, { id: shortId(id) });

  const formatValue = (field, value) => {
    if (value === undefined || value === null || value === '') return t.emptyValue;
    const mapped = t.values?.[field]?.[String(value)];
    if (mapped) return mapped;
    if (typeof value === 'boolean') return value ? ui.common.yes : ui.common.no;
    if (typeof value === 'number') return value.toLocaleString(ui.common.dateLocale);
    if (Array.isArray(value)) {
      if (value.length === 0) return t.emptyValue;
      if (value.every((item) => item === null || typeof item !== 'object')) {
        return joinList(value.map((item) => formatValue(field, item)));
      }
    }
    if (typeof value === 'object') return truncate(JSON.stringify(value));
    return truncate(String(value));
  };

  const joinList = (items) => {
    const visible = items.slice(0, MAX_LIST_ITEMS).join(', ');
    const hidden = items.length - MAX_LIST_ITEMS;
    return hidden > 0 ? `${visible} ${formatMessage(t.andMore, { count: hidden })}` : visible;
  };

  const fieldLabel = (field) => t.fields?.[field] || field;

  // Target: the entity the row is about, by name when known.
  const targetType = targetRefType(log.action, log.target_type);
  const targetName = nameFor(targetType, log.target_id)
    || objectDetails?.name
    || objectDetails?.sourceGroupName
    || (log.target_type === 'user_status' || log.target_type === 'role' ? objectDetails?.email : null)
    || null;

  // Changes: new rows store { changes: [...] }; older role rows store { from, to }.
  const hidden = new Set(ALWAYS_HIDDEN);
  let rawChanges = Array.isArray(objectDetails?.changes) ? objectDetails.changes : [];
  if (rawChanges.length === 0 && objectDetails && 'from' in objectDetails && 'to' in objectDetails) {
    rawChanges = [{ field: log.target_type === 'role' ? 'role' : 'value', from: objectDetails.from, to: objectDetails.to }];
    hidden.add('from');
    hidden.add('to');
  }
  const changes = rawChanges.map((change) => ({
    field: change.field,
    label: fieldLabel(change.field),
    from: formatValue(change.field, change.from),
    to: formatValue(change.field, change.to),
    fullFrom: change.from,
    fullTo: change.to,
  }));

  // Summary values.
  const single = (key, type) => {
    if (!objectDetails || objectDetails[key] === undefined) return null;
    hidden.add(key);
    return labelFor(type, objectDetails[key]);
  };
  // The count shown in the summary; a numeric counter used there is not repeated below.
  const countOf = () => {
    if (!objectDetails) return null;
    for (const key of ['added', 'addedCount', 'importedGroups']) {
      if (typeof objectDetails[key] === 'number') {
        hidden.add(key);
        return objectDetails[key];
      }
    }
    for (const key of ['userIds', 'appIds', 'childGroupIds', 'entraGroupIds', 'groupIds']) {
      if (Array.isArray(objectDetails[key])) return objectDetails[key].length;
    }
    return null;
  };

  const item = single('userId', 'users')
    || single('appId', 'apps')
    || single('childGroupId', 'groups')
    || single('entraGroupId', 'entraGroups')
    || (objectDetails?.targetGroupId ? single('targetGroupId', 'groups') : null)
    || objectDetails?.targetGroupName
    || null;
  if (log.action === 'move_apps' || log.action === 'copy_apps') hidden.add('sourceGroupId');

  const eventKey = log.target_type === 'branding' && log.action === 'refresh'
    ? BRANDING_REFRESH_EVENTS[log.target_id]
    : log.action;
  const count = countOf() ?? 0;
  const events = t.events?.[log.target_type] || {};
  // `<event>_one` holds the singular wording where the count can be 1.
  const template = (count === 1 && events[`${eventKey}_one`]) || events[eventKey] || t.events.fallback;
  const actionLabel = t.actionLabels?.[log.action] || log.action;
  const targetTypeLabel = t.targetLabels?.[log.target_type] || log.target_type;

  const summaryValues = {
    target: targetName || (log.target_id ? shortId(log.target_id) : t.emptyValue),
    item: item || t.emptyValue,
    count,
    action: actionLabel,
    targetType: targetTypeLabel,
  };

  // Facts: every other key, with ID lists turned into names.
  const facts = [];
  if (objectDetails) {
    for (const [key, value] of Object.entries(objectDetails)) {
      if (hidden.has(key) || value === undefined) continue;
      const refType = idRefType(key, log.action);
      if (refType) {
        const ids = (Array.isArray(value) ? value : [value]).filter((id) => id !== null && id !== undefined);
        // Lists that only repeat the target (e.g. appIds: [target]) add nothing.
        if (ids.length === 0 || (ids.length === 1 && ids[0] === log.target_id)) continue;
        facts.push({ key, label: fieldLabel(key), value: joinList(ids.map((id) => labelFor(refType, id))) });
        continue;
      }
      facts.push({ key, label: fieldLabel(key), value: formatValue(key, value) });
    }
  }

  return {
    actionLabel,
    targetTypeLabel,
    targetName,
    summary: { template, values: summaryValues },
    changes,
    facts,
    // Rows whose details are a plain string (not JSON) are shown as they are.
    text: typeof details === 'string' ? details : null,
    raw: stringifyAuditDetails(log.details),
  };
}
