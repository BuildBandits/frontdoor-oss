import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

// Admin notification center. A notification is the "to do" side of an event
// (the audit log keeps the history): at most one is open per type and subject,
// a repeated event refreshes it, and it is resolved by an admin or on its own
// when the condition is gone.

export const NOTIFICATION_TYPES = Object.freeze({
  ENTRA_GROUP_DELETED: 'entra_group_deleted',
  ENTRA_SYNC_FAILED: 'entra_sync_failed',
  USER_DEACTIVATED_ENTRA: 'user_deactivated_entra',
  USER_FIRST_SIGN_IN: 'user_first_sign_in',
});

const KNOWN_TYPES = new Set(Object.values(NOTIFICATION_TYPES));
const SEVERITIES = new Set(['info', 'warning', 'critical']);
const DEFAULT_RETENTION_DAYS = 30;
const LIST_LIMIT = 100;
const RECENTLY_RESOLVED_DAYS = 7;

function parsePayload(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

/** Opens a notification, or refreshes the open one for the same subject (shown as unread again). */
export function raiseNotification({ type, subjectKey, severity = 'warning', payload = {} }) {
  if (!KNOWN_TYPES.has(type)) throw new Error(`Unknown notification type: ${type}`);
  const level = SEVERITIES.has(severity) ? severity : 'warning';
  const body = JSON.stringify(payload ?? {});
  return db.transaction(() => {
    const open = db.prepare('SELECT id FROM notifications WHERE type = ? AND subject_key = ? AND resolved_at IS NULL').get(type, subjectKey);
    if (open) {
      db.prepare("UPDATE notifications SET severity = ?, payload = ?, updated_at = datetime('now') WHERE id = ?").run(level, body, open.id);
      db.prepare('DELETE FROM notification_reads WHERE notification_id = ?').run(open.id);
      return open.id;
    }
    const id = uuidv4();
    db.prepare('INSERT INTO notifications (id, type, severity, subject_key, payload) VALUES (?, ?, ?, ?, ?)')
      .run(id, type, level, subjectKey, body);
    return id;
  })();
}

/** Resolves the open notification of a subject, if any. `resolvedBy` is null when the condition cleared on its own. */
export function resolveNotifications(type, subjectKey, resolvedBy = null) {
  return db.prepare(`
    UPDATE notifications SET resolved_at = datetime('now'), resolved_by = ?, updated_at = datetime('now')
    WHERE type = ? AND subject_key = ? AND resolved_at IS NULL
  `).run(resolvedBy, type, subjectKey).changes;
}

export function resolveNotificationById(id, resolvedBy) {
  return db.prepare(`
    UPDATE notifications SET resolved_at = datetime('now'), resolved_by = ?, updated_at = datetime('now')
    WHERE id = ? AND resolved_at IS NULL
  `).run(resolvedBy, id).changes;
}

export function getOpenNotification(type, subjectKey) {
  const row = db.prepare('SELECT * FROM notifications WHERE type = ? AND subject_key = ? AND resolved_at IS NULL').get(type, subjectKey);
  return row ? { ...row, payload: parsePayload(row.payload) } : null;
}

/**
 * Open notifications, plus (with `includeResolved`) the ones resolved in the last
 * `resolvedWithinDays` days, so a notification that resolved on its own stays visible.
 */
export function listNotifications(userId, { includeResolved = false, resolvedWithinDays = RECENTLY_RESOLVED_DAYS } = {}) {
  return db.prepare(`
    SELECT n.id, n.type, n.severity, n.subject_key, n.payload, n.created_at, n.updated_at, n.resolved_at, n.resolved_by,
      CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS is_read
    FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
    WHERE n.resolved_at IS NULL OR (? = 1 AND datetime(n.resolved_at) >= datetime('now', ?))
    ORDER BY n.resolved_at IS NOT NULL, COALESCE(n.resolved_at, n.updated_at) DESC
    LIMIT ${LIST_LIMIT}
  `).all(userId, includeResolved ? 1 : 0, `-${resolvedWithinDays} days`).map((row) => ({ ...row, is_read: Boolean(row.is_read), payload: parsePayload(row.payload) }));
}

export function countUnreadNotifications(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM notifications n
    WHERE n.resolved_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ?)
  `).get(userId).count;
}

/** Marks the given open notifications (or all of them) as read for one admin. */
export function markNotificationsRead(userId, ids = null) {
  const targets = Array.isArray(ids)
    ? ids.filter((id) => typeof id === 'string')
    : db.prepare('SELECT id FROM notifications WHERE resolved_at IS NULL').all().map((row) => row.id);
  const insert = db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) SELECT id, ? FROM notifications WHERE id = ?');
  return db.transaction(() => targets.reduce((count, id) => count + insert.run(userId, id).changes, 0))();
}

export function purgeResolvedNotifications(days = Number.parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '', 10)) {
  const keepDays = Number.isFinite(days) && days >= 1 ? days : DEFAULT_RETENTION_DAYS;
  return db.prepare("DELETE FROM notifications WHERE resolved_at IS NOT NULL AND datetime(resolved_at) < datetime('now', ?)")
    .run(`-${keepDays} days`).changes;
}
