import express from 'express';
import db from '../db.js';
import { authenticate, isAdmin } from '../middleware/auth.js';
import { iconUrlForApp } from '../services/appIcons.js';

const router = express.Router();

// List access logs with pagination (admin only)
router.get('/', authenticate, isAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  // Optional filters
  const { app_id, user_id, from, to } = req.query;

  let where = '1=1';
  const params = [];

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

  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM access_logs l WHERE ${where}
  `).get(...params).count;

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
    app_icon_url: iconUrlForApp({
      id: log.app_id,
      icon_file_name: log.icon_file_name,
      updated_at: log.updated_at,
    }),
  }));

  // Summary stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_accesses,
      COUNT(DISTINCT l.user_id) AS unique_users,
      COUNT(DISTINCT l.app_id) AS unique_apps
    FROM access_logs l WHERE ${where}
  `).get(...params);

  res.json({
    logs,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    stats,
  });
});

// Top apps by access count (admin only)
router.get('/top-apps', authenticate, isAdmin, (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  const topApps = db.prepare(`
    SELECT a.id, a.name, a.slug, a.icon, a.icon_file_name, a.updated_at, COUNT(*) AS access_count,
      COUNT(DISTINCT l.user_id) AS unique_users
    FROM access_logs l
    JOIN apps a ON l.app_id = a.id
    WHERE l.created_at >= ?
    GROUP BY l.app_id
    ORDER BY access_count DESC
    LIMIT 10
  `).all(cutoff).map((app) => ({
    ...app,
    iconUrl: iconUrlForApp(app),
  }));

  res.json({ topApps, days });
});

// --- RBAC Audit Logs ---

// List RBAC audit logs with pagination (admin only)
router.get('/rbac-audit', authenticate, isAdmin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const { action, target_type, actor_id, from, to } = req.query;

  let where = '1=1';
  const params = [];

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

  const total = db.prepare(`SELECT COUNT(*) AS count FROM rbac_audit_logs a WHERE ${where}`).get(...params).count;

  const logs = db.prepare(`
    SELECT a.id, a.action, a.target_type, a.target_id, a.details, a.created_at,
      u.display_name AS actor_name, u.email AS actor_email
    FROM rbac_audit_logs a
    LEFT JOIN users u ON a.actor_id = u.id
    WHERE ${where}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // Parse details JSON for convenience
  const parsed = logs.map(l => {
    let details = null;
    if (l.details) {
      try { details = JSON.parse(l.details); } catch { details = l.details; }
    }
    return { ...l, details };
  });

  res.json({
    logs: parsed,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export default router;
