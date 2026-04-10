import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_GROUP_ID } from '../db.js';
import { authenticate, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// List active apps visible to current user (RBAC applies to all, including admins)
router.get('/', authenticate, (req, res) => {
  const apps = db.prepare(`
    SELECT DISTINCT a.id, a.name, a.slug, a.description, a.long_description, a.icon, a.target_url,
      a.is_active, a.sort_order, a.mode, a.sso_endpoint, a.sso_method, a.tags
    FROM apps a
    JOIN app_permissions p ON a.id = p.app_id
    JOIN user_group_members m ON p.group_id = m.group_id
    WHERE a.is_active = 1 AND m.user_id = ?
    ORDER BY a.sort_order, a.name
  `).all(req.user.id);

  const appsWithUrls = apps.map((app) => {
    const url = app.mode === 'redirect'
      ? `/api/apps/${app.slug}/sso-redirect`
      : app.target_url; // redirect-plain and shared-cookie both link directly
    let tags = [];
    try { tags = JSON.parse(app.tags || '[]'); } catch { /* ignore */ }
    return { ...app, url, tags };
  });

  res.json({ apps: appsWithUrls });
});

// SSO redirect endpoint: generates JWT and redirects to target app
router.get('/:slug/sso-redirect', authenticate, (req, res) => {
  const app = db
    .prepare('SELECT * FROM apps WHERE slug = ? AND is_active = 1')
    .get(req.params.slug);

  if (!app || app.mode !== 'redirect') {
    return res.status(404).json({ error: 'Redirect app not found' });
  }

  // RBAC check: user must have group permission
  const hasAccess = db.prepare(`
    SELECT 1 FROM app_permissions p
    JOIN user_group_members m ON p.group_id = m.group_id
    WHERE p.app_id = ? AND m.user_id = ?
  `).get(app.id, req.user.id);
  if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

  // Log access
  try {
    db.prepare(
      'INSERT INTO access_logs (user_id, app_id, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, app.id, req.ip, req.get('user-agent'));
  } catch (e) {
    console.error('Access log write failed:', e.message);
  }

  // Generate a short-lived JWT with user info for the target app
  const ssoToken = jwt.sign(
    {
      sub: req.user.id,
      email: req.user.email,
      name: req.user.display_name,
      role: req.user.role,
      iss: 'frontdoor',
      aud: app.slug,
    },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );

  const endpoint = app.sso_endpoint || '/sso';
  const targetBase = app.target_url.replace(/\/+$/, '');
  const targetUrl = `${targetBase}${endpoint}`;

  if (app.sso_method === 'POST') {
    // Auto-submit form for POST method
    const safeUrl = targetUrl.replace(/"/g, '&quot;');
    const safeToken = ssoToken.replace(/"/g, '&quot;');
    return res.send(`
      <!DOCTYPE html>
      <html><body>
        <form id="sso" method="POST" action="${safeUrl}">
          <input type="hidden" name="token" value="${safeToken}" />
        </form>
        <script>document.getElementById('sso').submit();</script>
      </body></html>
    `);
  }

  // GET method: append token as query param
  const separator = targetUrl.includes('?') ? '&' : '?';
  res.redirect(`${targetUrl}${separator}token=${ssoToken}`);
});

// List ALL apps including inactive (admin only)
router.get('/all', authenticate, isAdmin, (req, res) => {
  const apps = db
    .prepare('SELECT * FROM apps ORDER BY sort_order, name')
    .all();
  res.json({ apps });
});

// Validate target_url helper
function validateTargetUrl(target_url) {
  try {
    const parsed = new URL(target_url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'target_url must use http or https';
    }
    if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|localhost|169\.254\.)/.test(parsed.hostname)) {
      return 'target_url cannot point to private networks';
    }
    return null;
  } catch {
    return 'target_url must be a valid URL';
  }
}

// Create app (admin only)
router.post('/', authenticate, isAdmin, (req, res) => {
  const { name, slug, description, long_description, icon, target_url, sort_order, mode, sso_endpoint, sso_method, tags } = req.body;

  if (!name || !slug || !target_url) {
    return res.status(400).json({ error: 'name, slug, and target_url are required' });
  }

  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be lowercase alphanumeric with hyphens, 1-63 chars' });
  }

  const urlError = validateTargetUrl(target_url);
  if (urlError) return res.status(400).json({ error: urlError });

  if (mode && !['redirect', 'redirect-plain', 'shared-cookie'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be redirect, redirect-plain, or shared-cookie' });
  }
  if (sso_method && !['GET', 'POST'].includes(sso_method)) {
    return res.status(400).json({ error: 'sso_method must be GET or POST' });
  }

  const existing = db.prepare('SELECT id FROM apps WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ error: 'An app with this slug already exists' });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO apps (id, name, slug, description, long_description, icon, target_url, sort_order, mode, sso_endpoint, sso_method, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, slug, description || '', long_description || '', icon || '📦', target_url, sort_order || 0, mode || 'redirect-plain', sso_endpoint || '/sso', sso_method || 'GET', JSON.stringify(tags || []));

  // Auto-assign to "default" group
  db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)').run(id, DEFAULT_GROUP_ID);

  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  res.status(201).json({ app });
});

// Update app (admin only)
router.put('/:id', authenticate, isAdmin, (req, res) => {
  const { id } = req.params;
  const { name, slug, description, long_description, icon, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, tags } = req.body;

  const existing = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'App not found' });
  }

  if (slug && slug !== existing.slug) {
    const slugConflict = db.prepare('SELECT id FROM apps WHERE slug = ? AND id != ?').get(slug, id);
    if (slugConflict) {
      return res.status(409).json({ error: 'An app with this slug already exists' });
    }
  }

  if (target_url) {
    const urlError = validateTargetUrl(target_url);
    if (urlError) return res.status(400).json({ error: urlError });
  }

  if (mode !== undefined && !['redirect', 'redirect-plain', 'shared-cookie'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be redirect, redirect-plain, or shared-cookie' });
  }
  if (sso_method !== undefined && !['GET', 'POST'].includes(sso_method)) {
    return res.status(400).json({ error: 'sso_method must be GET or POST' });
  }

  db.prepare(`
    UPDATE apps SET
      name = COALESCE(?, name),
      slug = COALESCE(?, slug),
      description = COALESCE(?, description),
      icon = COALESCE(?, icon),
      target_url = COALESCE(?, target_url),
      is_active = COALESCE(?, is_active),
      sort_order = COALESCE(?, sort_order),
      mode = COALESCE(?, mode),
      sso_endpoint = COALESCE(?, sso_endpoint),
      sso_method = COALESCE(?, sso_method),
      long_description = COALESCE(?, long_description),
      tags = COALESCE(?, tags),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, slug, description, icon, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, long_description, tags !== undefined ? JSON.stringify(tags) : null, id);

  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  res.json({ app });
});

// Delete app (admin only)
router.delete('/:id', authenticate, isAdmin, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'App not found' });
  }

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM app_permissions WHERE app_id = ?').run(id);
    db.prepare('DELETE FROM access_logs WHERE app_id = ?').run(id);
    db.prepare('DELETE FROM apps WHERE id = ?').run(id);
  });
  deleteAll();
  res.json({ message: 'App deleted' });
});

// Bulk upsert apps — authenticated via API key (for CLI/automation)
// Upserts by slug: creates if not exists, updates if exists
router.post('/bulk', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }

  const { apps: appList } = req.body;
  if (!Array.isArray(appList)) {
    return res.status(400).json({ error: 'apps must be an array' });
  }

  const results = [];
  const upsert = db.transaction(() => {
    for (const app of appList) {
      if (!app.slug || !app.name || !app.target_url) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'missing slug, name, or target_url' });
        continue;
      }

      const urlError = validateTargetUrl(app.target_url);
      if (urlError) {
        results.push({ slug: app.slug, status: 'skipped', reason: urlError });
        continue;
      }
      if (app.mode && !['redirect', 'redirect-plain', 'shared-cookie'].includes(app.mode)) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'invalid mode' });
        continue;
      }
      if (app.sso_method && !['GET', 'POST'].includes(app.sso_method)) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'invalid sso_method' });
        continue;
      }

      const existing = db.prepare('SELECT id FROM apps WHERE slug = ?').get(app.slug);

      if (existing) {
        // Merge tags: combine existing + new, deduplicate
        let mergedTags = null;
        if (app.tags) {
          const existingRow = db.prepare('SELECT tags FROM apps WHERE id = ?').get(existing.id);
          let existingTags = [];
          try { existingTags = JSON.parse(existingRow?.tags || '[]'); } catch { /* ignore */ }
          const combined = [...new Set([...existingTags, ...app.tags])];
          mergedTags = JSON.stringify(combined);
        }

        db.prepare(`
          UPDATE apps SET
            name = COALESCE(?, name),
            description = COALESCE(?, description),
            long_description = COALESCE(?, long_description),
            icon = COALESCE(?, icon),
            target_url = COALESCE(?, target_url),
            mode = COALESCE(?, mode),
            sso_endpoint = COALESCE(?, sso_endpoint),
            sso_method = COALESCE(?, sso_method),
            tags = COALESCE(?, tags),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          app.name, app.description, app.long_description, app.icon, app.target_url,
          app.mode, app.sso_endpoint, app.sso_method,
          mergedTags,
          existing.id
        );
        results.push({ slug: app.slug, status: 'updated' });
      } else {
        const id = uuidv4();
        db.prepare(`
          INSERT INTO apps (id, name, slug, description, long_description, icon, target_url, sort_order, mode, sso_endpoint, sso_method, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, app.name, app.slug, app.description || '', app.long_description || '',
          app.icon || '📦', app.target_url,
          app.sort_order || 99, app.mode || 'redirect-plain',
          app.sso_endpoint || '/sso', app.sso_method || 'GET',
          JSON.stringify(app.tags || [])
        );
        // Auto-assign to "default" group
        db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)').run(id, DEFAULT_GROUP_ID);
        results.push({ slug: app.slug, status: 'created' });
      }
    }
  });

  upsert();
  res.json({ results });
});

export default router;
