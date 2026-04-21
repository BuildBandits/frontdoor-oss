import express from 'express';
import db from '../db.js';
import { authenticate, isSuperAdmin } from '../middleware/auth.js';
import { iconUrlForApp } from '../services/appIcons.js';

const router = express.Router();
const PAGE_SIZES = [50, 100, 150, 200, 250];
const RETENTION_DAYS = [1, 7, 14, 30, 60, 90];
const APP_TIMEZONE = process.env.TIMEZONE || process.env.TZ || 'Europe/Rome';

function normalizePage(value) {
  const page = parseInt(value, 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function normalizeLimit(value) {
  const limit = parseInt(value, 10);
  if (!Number.isFinite(limit)) return 50;
  const rounded = Math.round(limit / 50) * 50;
  return Math.min(250, Math.max(50, rounded || 50));
}

function normalizeRetentionDays(value) {
  const days = parseInt(value, 10);
  return RETENTION_DAYS.includes(days) ? days : 30;
}

function parseSearch(value) {
  return (value || '').toString().trim();
}

function parseUtcTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return new Date(value);
  if (/[zZ]$/.test(value) || /[+-]\d\d:\d\d$/.test(value)) {
    return new Date(value);
  }
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function utcDaysAgo(days) {
  const normalizedDays = Number.isFinite(days) && days > 0 ? Math.max(1, Math.floor(days)) : 90;
  return `-${normalizedDays} days`;
}

function jsonOrText(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatTimestamp(value) {
  const parsed = parseUtcTimestamp(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return value || null;
  try {
    return new Intl.DateTimeFormat('it-IT', {
      timeZone: APP_TIMEZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(parsed);
  } catch {
    return value;
  }
}

export function purgeLogsOlderThan(days = 90) {
  const retentionDays = Number.isFinite(days) ? Math.min(90, Math.max(0, Math.floor(days))) : 90;
  const result = db.transaction(() => {
    if (retentionDays === 0) {
      const accessRemoved = db.prepare('DELETE FROM access_logs').run().changes || 0;
      const auditRemoved = db.prepare('DELETE FROM rbac_audit_logs').run().changes || 0;
      return { accessRemoved, auditRemoved };
    }

    const cutoff = utcDaysAgo(retentionDays);
    const accessRemoved = db.prepare('DELETE FROM access_logs WHERE created_at < datetime(\'now\', ?)').run(cutoff).changes || 0;
    const auditRemoved = db.prepare('DELETE FROM rbac_audit_logs WHERE created_at < datetime(\'now\', ?)').run(cutoff).changes || 0;
    return { accessRemoved, auditRemoved };
  })();
  return { retentionDays, ...result };
}

function buildLikeSearchClause(search, aliases) {
  if (!search) return { sql: '', params: [] };
  const like = `%${search.toLowerCase()}%`;
  const parts = aliases.map((alias) => `LOWER(COALESCE(${alias}, '')) LIKE ?`);
  return {
    sql: ` AND (${parts.join(' OR ')})`,
    params: aliases.map(() => like),
  };
}

function buildAccessWhere({ app_id, user_id, from, to, retentionDays, q }) {
  let where = `l.created_at >= datetime('now', ?)`;
  const params = [`-${retentionDays} days`];

  if (app_id) {
    where += ' AND l.app_id = ?';
    params.push(app_id);
  }
  if (user_id) {
    where += ' AND l.user_id = ?';
    params.push(user_id);
  }
  if (from) {
    where += ' AND l.created_at >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND l.created_at <= ?';
    params.push(to);
  }

  const searchClause = buildLikeSearchClause(q, [
    'u.display_name',
    'u.email',
    'a.name',
    'a.slug',
    'l.ip_address',
  ]);
  where += searchClause.sql;
  params.push(...searchClause.params);

  return { where, params };
}

function buildAuditWhere({ action, target_type, actor_id, from, to, retentionDays, q }) {
  let where = `a.created_at >= datetime('now', ?)`;
  const params = [`-${retentionDays} days`];

  if (action) {
    where += ' AND a.action = ?';
    params.push(action);
  }
  if (target_type) {
    where += ' AND a.target_type = ?';
    params.push(target_type);
  }
  if (actor_id) {
    where += ' AND a.actor_id = ?';
    params.push(actor_id);
  }
  if (from) {
    where += ' AND a.created_at >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND a.created_at <= ?';
    params.push(to);
  }

  const searchClause = buildLikeSearchClause(q, [
    'u.display_name',
    'u.email',
    'a.action',
    'a.target_type',
    'a.target_id',
    'a.details',
  ]);
  where += searchClause.sql;
  params.push(...searchClause.params);

  return { where, params };
}

function loadAccessLogs(req, res) {
  const page = normalizePage(req.query.page);
  const limit = normalizeLimit(req.query.limit);
  const retentionDays = normalizeRetentionDays(req.query.retention_days);
  const offset = (page - 1) * limit;
  const { app_id, user_id, from, to } = req.query;
  const q = parseSearch(req.query.q);

  const { where, params } = buildAccessWhere({ app_id, user_id, from, to, retentionDays, q });

  const total = db.prepare(`SELECT COUNT(*) AS count FROM access_logs l LEFT JOIN users u ON l.user_id = u.id LEFT JOIN apps a ON l.app_id = a.id WHERE ${where}`).get(...params).count;

  const logs = db.prepare(`
    SELECT l.id, l.created_at, l.ip_address,
      l.user_id, u.display_name AS user_name, u.email AS user_email, u.avatar_color,
      a.id AS app_id, a.name AS app_name, a.slug AS app_slug, a.icon AS app_icon, a.icon_file_name, a.updated_at
    FROM access_logs l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN apps a ON l.app_id = a.id
    WHERE ${where}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map((log) => ({
    ...log,
    created_at_local: formatTimestamp(log.created_at),
    app_icon_url: iconUrlForApp({
      id: log.app_id,
      icon_file_name: log.icon_file_name,
      updated_at: log.updated_at,
    }),
  }));

  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_accesses,
      COUNT(DISTINCT l.user_id) AS unique_users,
      COUNT(DISTINCT l.app_id) AS unique_apps
    FROM access_logs l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN apps a ON l.app_id = a.id
    WHERE ${where}
  `).get(...params);

  res.json({
    logs,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    stats,
    retentionDays,
    availablePageSizes: PAGE_SIZES,
  });
}

function loadAuditLogs(req, res) {
  const page = normalizePage(req.query.page);
  const limit = normalizeLimit(req.query.limit);
  const retentionDays = normalizeRetentionDays(req.query.retention_days);
  const offset = (page - 1) * limit;
  const { action, target_type, actor_id, from, to } = req.query;
  const q = parseSearch(req.query.q);

  const { where, params } = buildAuditWhere({ action, target_type, actor_id, from, to, retentionDays, q });

  const total = db.prepare(`SELECT COUNT(*) AS count FROM rbac_audit_logs a LEFT JOIN users u ON a.actor_id = u.id WHERE ${where}`).get(...params).count;

  const logs = db.prepare(`
    SELECT a.id, a.actor_id, a.action, a.target_type, a.target_id, a.details, a.created_at,
      u.display_name AS actor_name, u.email AS actor_email
    FROM rbac_audit_logs a
    LEFT JOIN users u ON a.actor_id = u.id
    WHERE ${where}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset).map((log) => ({
    ...log,
    created_at_local: formatTimestamp(log.created_at),
    details: jsonOrText(log.details),
  }));

  res.json({
    logs,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    retentionDays,
    availablePageSizes: PAGE_SIZES,
  });
}

// List access logs with pagination (superadmin only)
router.get('/', authenticate, isSuperAdmin, loadAccessLogs);

// Top apps by access count (superadmin only)
router.get('/top-apps', authenticate, isSuperAdmin, (req, res) => {
  const days = normalizeRetentionDays(req.query.days);
  const q = parseSearch(req.query.q);
  const searchClause = buildLikeSearchClause(q, ['a.name', 'a.slug']);

  const topApps = db.prepare(`
    SELECT a.id, a.name, a.slug, a.icon, a.icon_file_name, a.updated_at, COUNT(*) AS access_count,
      COUNT(DISTINCT l.user_id) AS unique_users
    FROM access_logs l
    JOIN apps a ON l.app_id = a.id
    WHERE l.created_at >= datetime('now', ?)${searchClause.sql}
    GROUP BY l.app_id
    ORDER BY access_count DESC
    LIMIT 10
  `).all(`-${days} days`, ...searchClause.params).map((app) => ({
    ...app,
    iconUrl: iconUrlForApp(app),
  }));

  res.json({ topApps, days, timeZone: APP_TIMEZONE });
});

// List audit logs with pagination (superadmin only)
router.get('/audit', authenticate, isSuperAdmin, loadAuditLogs);

// Backwards-compatible alias
router.get('/rbac-audit', authenticate, isSuperAdmin, loadAuditLogs);

export default router;
