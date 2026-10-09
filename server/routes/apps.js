import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_GROUP_ID } from '../db.js';
import { logRbacAudit } from '../db.js';
import { diffAuditFields } from '../services/auditDetails.js';
import { authenticate, isAdminViewer, isAdminEditor } from '../middleware/auth.js';
import { getRequiredEnv } from '../config.js';
import { restoreDefaultDemoApps } from '../services/demoApps.js';
import { getAccessibleGroupIdsForUser } from '../services/groupHierarchy.js';
import { iconUrlForApp, parseAppIconPayload, readAppIconAssetDataUrl, removeAppIconAsset, saveAppIconAsset, serveAppIconForApp } from '../services/appIcons.js';
import { getBrandingSettings } from '../services/branding.js';
import { dispatchPluginEvent } from '../services/plugins.js';
import { respondWithError } from '../services/errors.js';
import { isValidEntraApplicationId, normalizeEntraApplicationId } from '../../shared/entra.js';
import { APP_SLUG_ERROR_CODES, normalizeAppSlug, validateAppSlug } from '../../shared/appSlug.js';
import { TARGET_URL_ERROR_CODES, validateTargetUrl } from '../../shared/targetUrl.js';

const router = express.Router();

function buildGroupFilterClause(groupIds) {
  const placeholders = groupIds.map(() => '?').join(', ');
  return {
    clause: `IN (${placeholders})`,
    params: groupIds,
  };
}

// List active apps visible to current user (RBAC applies to all, including admins)
router.get('/', authenticate, (req, res) => {
  const accessibleGroupIds = getAccessibleGroupIdsForUser(req.user.id);
  if (accessibleGroupIds.length === 0) {
    return res.json({ apps: [] });
  }

  const { clause, params } = buildGroupFilterClause(accessibleGroupIds);
  const apps = db.prepare(`
    SELECT DISTINCT a.id, a.name, a.slug, a.description, a.long_description, a.icon, a.icon_file_name, a.target_url,
      a.is_active, a.sort_order, a.mode, a.sso_endpoint, a.sso_method, a.tags, a.updated_at
    FROM apps a
    JOIN app_permissions p ON a.id = p.app_id
    WHERE a.is_active = 1 AND p.group_id ${clause}
    ORDER BY a.sort_order, a.name
  `).all(...params);

  const appsWithUrls = apps.map((app) => {
    const url = app.mode === 'redirect'
      ? `/api/apps/${app.slug}/sso-redirect`
      : app.mode === 'entra-app'
      ? `/api/apps/${app.slug}/entra-redirect`
      : app.target_url; // redirect-plain, internal-link, and shared-cookie link directly
    const tags = parseTags(app.tags);
    return { ...app, url, tags, iconUrl: iconUrlForApp(app) };
  });

  res.json({ apps: appsWithUrls });
});

// SSO redirect endpoint: generates JWT and redirects to target app
router.get('/:slug/sso-redirect', authenticate, (req, res) => {
  const app = db
    .prepare('SELECT * FROM apps WHERE slug = ? AND is_active = 1')
    .get(req.params.slug);

  if (!app) {
    return res.status(404).json({ error: 'App not found', code: 'app_not_found' });
  }

  // RBAC check: user must have group permission (applies to every mode)
  const accessibleGroupIds = getAccessibleGroupIdsForUser(req.user.id);
  const hasAccess = accessibleGroupIds.length > 0
    ? db.prepare(`
      SELECT 1 FROM app_permissions
      WHERE app_id = ? AND group_id IN (${accessibleGroupIds.map(() => '?').join(', ')})
    `).get(app.id, ...accessibleGroupIds)
    : null;
  if (!hasAccess) return res.status(403).json({ error: 'Access denied', code: 'access_denied' });

  // Log access (every mode)
  try {
    db.prepare(
      'INSERT INTO access_logs (user_id, app_id, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, app.id, req.ip, req.get('user-agent'));
  } catch (e) {
    console.error('Access log write failed:', e.message);
  }

  void dispatchPluginEvent('app.access', {
    app: {
      id: app.id,
      slug: app.slug,
      name: app.name,
      mode: app.mode,
    },
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
    channel: 'sso-redirect',
  }, {
    actorId: req.user.id,
    source: 'apps.sso-redirect',
    appId: app.id,
  });

  // Non-redirect apps (shared-cookie / redirect-plain) don't need an SSO POST:
  // the wildcard frontdoor_token cookie already authenticates them. Redirect
  // straight to the target_url — same destination the catalog home links to.
  // This makes the launcher universal so callers (e.g. the Login SPA deep-link
  // after SSO) can always route through /sso-redirect without 404-ing on
  // non-redirect apps.
  if (app.mode !== 'redirect') {
    return res.redirect(app.target_url);
  }

  // Generate a short-lived JWT with user info for the target app
  const jwtSecret = getRequiredEnv('JWT_SECRET', 'SSO redirect');
  // `issuer` is set via jsonwebtoken option (not a literal claim) so it stays
  // in sync with the cookie token issued by /auth/microsoft/callback. Both
  // tokens default to 'frontdoor' and honor JWT_ISSUER when set.
  const ssoToken = jwt.sign(
    {
      sub: req.user.id,
      email: req.user.email,
      name: req.user.display_name,
      role: req.user.role,
      aud: app.slug,
    },
    jwtSecret,
    {
      expiresIn: '5m',
      issuer: process.env.JWT_ISSUER || 'frontdoor',
    }
  );

  const endpoint = app.sso_endpoint || '/sso';
  const targetBase = app.target_url.replace(/\/+$/, '');
  const targetUrl = `${targetBase}${endpoint}`;

  if (app.sso_method === 'POST') {
    // Auto-submit form for POST method
    const safeUrl = targetUrl.replace(/"/g, '&quot;');
    const safeToken = ssoToken.replace(/"/g, '&quot;');
    // The global helmet CSP defaults form-action to 'self', which blocks the
    // cross-origin POST below. Scope a stricter CSP just to this response that
    // permits form submission only to the configured target app origin.
    const targetOrigin = new URL(targetUrl).origin;
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'unsafe-inline'; form-action ${targetOrigin}`
    );
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

// Entra App redirect endpoint: redirects to Microsoft MyApps launcher
router.get('/:slug/entra-redirect', authenticate, (req, res) => {
  const app = db
    .prepare('SELECT * FROM apps WHERE slug = ? AND is_active = 1')
    .get(req.params.slug);

  if (!app || app.mode !== 'entra-app') {
    return res.status(404).json({ error: 'Entra app not found', code: 'entra_app_not_found' });
  }

  // RBAC check: user must have group permission
  const accessibleGroupIds = getAccessibleGroupIdsForUser(req.user.id);
  const hasAccess = accessibleGroupIds.length > 0
    ? db.prepare(`
      SELECT 1 FROM app_permissions
      WHERE app_id = ? AND group_id IN (${accessibleGroupIds.map(() => '?').join(', ')})
    `).get(app.id, ...accessibleGroupIds)
    : null;
  if (!hasAccess) return res.status(403).json({ error: 'Access denied', code: 'access_denied' });

  // Log access
  try {
    db.prepare(
      'INSERT INTO access_logs (user_id, app_id, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, app.id, req.ip, req.get('user-agent'));
  } catch (e) {
    console.error('Access log write failed:', e.message);
  }

  void dispatchPluginEvent('app.access', {
    app: {
      id: app.id,
      slug: app.slug,
      name: app.name,
      mode: app.mode,
    },
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
    channel: 'entra-redirect',
  }, {
    actorId: req.user.id,
    source: 'apps.entra-redirect',
    appId: app.id,
  });

  const launcherUrl = `https://launcher.myapps.microsoft.com/api/signin/${app.sso_endpoint}?tenantId=${process.env.AZURE_TENANT_ID}`;
  res.redirect(launcherUrl);
});

// Track an access to an app. Frontend fires this fire-and-forget before opening
// the target URL in a new tab, so we can record access events for apps that
// don't go through the /sso-redirect (or /entra-redirect) server round-trip
// (i.e. redirect-plain, internal-link, and shared-cookie modes, which link directly to
// target_url from the browser).
router.post('/:slug/track-access', authenticate, (req, res) => {
  const app = db
    .prepare('SELECT id FROM apps WHERE slug = ? AND is_active = 1')
    .get(req.params.slug);

  if (!app) return res.status(404).json({ error: 'App not found', code: 'app_not_found' });

  // RBAC check: user must have group permission on this app
  const accessibleGroupIds = getAccessibleGroupIdsForUser(req.user.id);
  const hasAccess = accessibleGroupIds.length > 0
    ? db.prepare(`
      SELECT 1 FROM app_permissions
      WHERE app_id = ? AND group_id IN (${accessibleGroupIds.map(() => '?').join(', ')})
    `).get(app.id, ...accessibleGroupIds)
    : null;
  if (!hasAccess) return res.status(403).json({ error: 'Access denied', code: 'access_denied' });

  try {
    db.prepare(
      'INSERT INTO access_logs (user_id, app_id, ip_address, user_agent) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, app.id, req.ip, req.get('user-agent'));
  } catch (e) {
    console.error('Access log write failed:', e.message);
    return res.status(500).json({ error: 'Access log write failed', code: 'access_log_write_failed' });
  }

  void dispatchPluginEvent('app.access', {
    app: {
      id: app.id,
      slug: req.params.slug,
    },
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    },
    channel: 'track-access',
  }, {
    actorId: req.user.id,
    source: 'apps.track-access',
    appId: app.id,
  });

  res.status(204).end();
});

router.post('/:id/clone', authenticate, isAdminEditor, async (req, res) => {
  const existing = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'App not found', code: 'app_not_found' });
  }

  const groupIds = db.prepare('SELECT group_id FROM app_permissions WHERE app_id = ? ORDER BY group_id')
    .all(req.params.id)
    .map((row) => row.group_id);
  const iconDataUrl = await readAppIconAssetDataUrl(existing);

  res.json({
    app: {
      ...existing,
      id: null,
      name: buildCloneName(existing.name),
      slug: buildCloneSlug(existing.slug),
      iconDataUrl,
      groupIds,
      iconUrl: iconUrlForApp(existing),
      tags: parseTags(existing.tags),
    },
  });
});

// Serve app icon asset (public)
router.get('/:id/icon', (req, res) => {
  const app = db.prepare('SELECT id, icon_file_name FROM apps WHERE id = ?').get(req.params.id);
  if (!app) {
    return res.status(404).end();
  }
  return serveAppIconForApp(app, res);
});

// List ALL apps including inactive (viewer roles only)
router.get('/all', authenticate, isAdminViewer, (req, res) => {
  const apps = db
    .prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM app_permissions WHERE app_id = a.id) AS group_count
      FROM apps a
      ORDER BY sort_order, name
    `)
    .all();
  const appGroupRows = db.prepare(`
    SELECT app_id, group_id
    FROM app_permissions
    ORDER BY app_id, group_id
  `).all();
  const groupIdsByAppId = new Map();
  for (const row of appGroupRows) {
    if (!groupIdsByAppId.has(row.app_id)) {
      groupIdsByAppId.set(row.app_id, []);
    }
    groupIdsByAppId.get(row.app_id).push(row.group_id);
  }
  res.json({
    apps: apps.map((app) => ({
      ...app,
      tags: parseTags(app.tags),
      iconUrl: iconUrlForApp(app),
      groupIds: groupIdsByAppId.get(app.id) || [],
    })),
  });
});

// Restore the default demo apps (editor roles only)
router.post('/restore-defaults', authenticate, isAdminEditor, (req, res) => {
  try {
    const result = restoreDefaultDemoApps(db, DEFAULT_GROUP_ID);
    logRbacAudit(req.user.id, 'restore', 'app', null, result);
    res.json(result);
  } catch (error) {
    console.error('Restore default demo apps failed:', error.message);
    res.status(500).json({ error: 'Failed to restore default demo apps', code: 'failed_to_restore_demo_apps' });
  }
});

function normalizeEntraEndpoint(value) {
  return normalizeEntraApplicationId(value);
}

function normalizeTag(tag) {
  return (tag ?? '').toString().trim().toLowerCase();
}

function normalizeTagList(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const normalized = [];
  for (const tag of list) {
    const value = normalizeTag(tag);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function parseTags(rawTags) {
  try {
    return normalizeTagList(JSON.parse(rawTags || '[]'));
  } catch {
    return [];
  }
}

function isAppModeEnabled(mode, branding = getBrandingSettings()) {
  if (mode === 'redirect-plain') return true;
  if (mode === 'internal-link') return true;
  if (mode === 'shared-cookie') return branding.showSharedCookieMode !== false;
  if (mode === 'redirect') return branding.showRedirectSsoMode !== false;
  if (mode === 'entra-app') return branding.showEntraAppMode !== false;
  return false;
}

async function applyAppIconChange(appId, existingApp, { icon, iconDataUrl, iconSvgText, removeIconAsset, appMeta = null }) {
  const payload = parseAppIconPayload({ iconDataUrl, iconSvgText });

  if (removeIconAsset) {
    await removeAppIconAsset(appId);
    return {
      icon: icon || existingApp?.icon || '📦',
      icon_file_name: null,
    };
  }

  if (payload) {
    const saved = await saveAppIconAsset(appId, payload, appMeta, { currentFileName: existingApp?.icon_file_name || null });
    return {
      icon: icon || existingApp?.icon || '📦',
      icon_file_name: saved.fileName,
    };
  }

  return {
    icon: icon !== undefined ? icon : existingApp?.icon || '📦',
    icon_file_name: existingApp?.icon_file_name || null,
  };
}

function parseStoredTags(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Audit-friendly changes for an app update: tags as lists, and the uploaded
// icon image as a present/updated/removed marker instead of a file name.
function buildAppAuditChanges(before, after, changedColumns) {
  return changedColumns.map((field) => {
    if (field === 'tags') {
      return { field, from: parseStoredTags(before.tags), to: parseStoredTags(after.tags) };
    }
    if (field === 'icon_file_name') {
      return {
        field: 'iconImage',
        from: before.icon_file_name ? 'present' : 'not set',
        to: after.icon_file_name ? 'updated' : 'removed',
      };
    }
    return { field, from: before[field] ?? null, to: after[field] ?? null };
  });
}

function buildCloneName(originalName) {
  const base = (originalName || 'App').trim() || 'App';
  let candidate = `${base} (copia)`;
  let suffix = 2;
  while (db.prepare('SELECT id FROM apps WHERE name = ?').get(candidate)) {
    candidate = `${base} (copia ${suffix})`;
    suffix += 1;
  }
  return candidate;
}

function buildCloneSlug(originalSlug) {
  const base = normalizeAppSlug(originalSlug, 'app');

  const candidates = [`${base}-copy`, `${base}-copia`];
  for (const candidate of candidates) {
    if (!db.prepare('SELECT id FROM apps WHERE slug = ?').get(candidate)) {
      return candidate;
    }
  }

  let suffix = 2;
  let candidate = `${base}-copy-${suffix}`;
  while (db.prepare('SELECT id FROM apps WHERE slug = ?').get(candidate)) {
    suffix += 1;
    candidate = `${base}-copy-${suffix}`;
  }
  return candidate;
}

// Create app (editor roles only)
router.post('/', authenticate, isAdminEditor, async (req, res) => {
  let createdAppId = null;
  try {
    const { name, slug, description, long_description, icon, iconDataUrl, iconSvgText, target_url, sort_order, mode, sso_endpoint, sso_method, tags, removeIconAsset, groupIds } = req.body;
    const normalizedGroupIds = Array.isArray(groupIds)
      ? [...new Set(groupIds.filter((groupId) => typeof groupId === 'string' && groupId.trim()))]
      : [];

    if (!name || !slug || !target_url) {
      return res.status(400).json({ error: 'name, slug, and target_url are required', code: 'app_required_fields' });
    }

    const slugError = validateAppSlug(slug);
    if (slugError) return res.status(400).json({ error: slugError, code: APP_SLUG_ERROR_CODES[slugError] || 'slug_invalid' });

    if (mode && !['redirect', 'redirect-plain', 'internal-link', 'shared-cookie', 'entra-app'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be redirect, redirect-plain, internal-link, shared-cookie, or entra-app', code: 'invalid_app_mode' });
    }
    if (sso_method && !['GET', 'POST'].includes(sso_method)) {
      return res.status(400).json({ error: 'sso_method must be GET or POST', code: 'invalid_sso_method' });
    }

    const requestedMode = mode || 'redirect-plain';
    if (!isAppModeEnabled(requestedMode)) {
      return res.status(400).json({ error: 'Selected app mode is disabled by personalization settings', code: 'app_mode_disabled' });
    }

    const urlError = validateTargetUrl(target_url, requestedMode);
    if (urlError) return res.status(400).json({ error: urlError, code: TARGET_URL_ERROR_CODES[urlError] || 'target_url_invalid' });

    const normalizedSsoEndpoint = requestedMode === 'entra-app'
      ? normalizeEntraEndpoint(sso_endpoint)
      : (sso_endpoint || '/sso');
    if (requestedMode === 'entra-app' && !isValidEntraApplicationId(normalizedSsoEndpoint)) {
      return res.status(400).json({ error: 'Enter a valid MyApps Application ID or launcher URL', code: 'entra_application_id_invalid' });
    }

    if (normalizedGroupIds.length > 0) {
      const placeholders = normalizedGroupIds.map(() => '?').join(', ');
      const existingGroups = db.prepare(`SELECT id FROM user_groups WHERE id IN (${placeholders})`).all(...normalizedGroupIds);
      if (existingGroups.length !== normalizedGroupIds.length) {
        return res.status(400).json({ error: 'One or more selected groups were not found', code: 'groups_not_found' });
      }
    }

    const existing = db.prepare('SELECT id FROM apps WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({ error: 'An app with this slug already exists', code: 'app_slug_taken' });
    }

    const id = uuidv4();
    createdAppId = id;
    const iconChange = await applyAppIconChange(id, null, {
      icon,
      iconDataUrl,
      iconSvgText,
      removeIconAsset,
      appMeta: {
        name,
        slug,
        target_url,
        mode: requestedMode,
      },
    });
    const normalizedTags = normalizeTagList(tags);
    const insertApp = db.prepare(`
      INSERT INTO apps (id, name, slug, description, long_description, icon, icon_file_name, target_url, sort_order, mode, sso_endpoint, sso_method, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPermission = db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)');
    const createApp = db.transaction(() => {
      insertApp.run(id, name, slug, description || '', long_description || '', iconChange.icon || '📦', iconChange.icon_file_name, target_url, sort_order || 0, requestedMode, normalizedSsoEndpoint, sso_method || 'GET', JSON.stringify(normalizedTags));
      for (const groupId of normalizedGroupIds) {
        insertPermission.run(id, groupId);
      }
    });

    createApp();

    const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
    logRbacAudit(req.user.id, 'create', 'app', id, { name, slug, mode: requestedMode, groupIds: normalizedGroupIds });
    res.status(201).json({ app });
  } catch (error) {
    console.error('Create app failed:', error.message);
    if (createdAppId) {
      removeAppIconAsset(createdAppId).catch(() => {});
    }
    respondWithError(res, error, { status: 500, code: 'failed_to_create_app' });
  }
});

// Update app (editor roles only)
router.put('/:id', authenticate, isAdminEditor, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, long_description, icon, iconDataUrl, iconSvgText, removeIconAsset, target_url, is_active, sort_order, mode, sso_endpoint, sso_method, tags } = req.body;

    const existing = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'App not found', code: 'app_not_found' });
    }

    if (slug !== undefined) {
      const slugError = validateAppSlug(slug);
      if (slugError) return res.status(400).json({ error: slugError, code: APP_SLUG_ERROR_CODES[slugError] || 'slug_invalid' });
    }

    if (slug && slug !== existing.slug) {
      const slugConflict = db.prepare('SELECT id FROM apps WHERE slug = ? AND id != ?').get(slug, id);
      if (slugConflict) {
        return res.status(409).json({ error: 'An app with this slug already exists', code: 'app_slug_taken' });
      }
    }

    const nextMode = mode !== undefined ? mode : existing.mode;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'name, slug, and target_url are required', code: 'app_required_fields' });
    }

    // The URL is checked against the resulting mode also when only the mode changes
    // (e.g. a private-network internal link switched to an external mode).
    const urlToValidate = target_url !== undefined ? target_url : (nextMode !== existing.mode ? existing.target_url : undefined);
    if (urlToValidate !== undefined) {
      const urlError = validateTargetUrl(urlToValidate, nextMode);
      if (urlError) return res.status(400).json({ error: urlError, code: TARGET_URL_ERROR_CODES[urlError] || 'target_url_invalid' });
    }

    if (mode !== undefined && !['redirect', 'redirect-plain', 'internal-link', 'shared-cookie', 'entra-app'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be redirect, redirect-plain, internal-link, shared-cookie, or entra-app', code: 'invalid_app_mode' });
    }
    if (sso_method !== undefined && !['GET', 'POST'].includes(sso_method)) {
      return res.status(400).json({ error: 'sso_method must be GET or POST', code: 'invalid_sso_method' });
    }

    if (mode !== undefined && mode !== existing.mode && !isAppModeEnabled(mode)) {
      return res.status(400).json({ error: 'Selected app mode is disabled by personalization settings', code: 'app_mode_disabled' });
    }

    const normalizedSsoEndpoint = nextMode === 'entra-app'
      ? normalizeEntraEndpoint(sso_endpoint !== undefined ? sso_endpoint : existing.sso_endpoint)
      : (sso_endpoint !== undefined ? sso_endpoint : existing.sso_endpoint);
    if (nextMode === 'entra-app' && !isValidEntraApplicationId(normalizedSsoEndpoint)) {
      return res.status(400).json({ error: 'Enter a valid MyApps Application ID or launcher URL', code: 'entra_application_id_invalid' });
    }

    const iconChange = await applyAppIconChange(id, existing, {
      icon,
      iconDataUrl,
      iconSvgText,
      removeIconAsset,
      appMeta: {
        name: name !== undefined ? name : existing.name,
        slug: slug !== undefined ? slug : existing.slug,
        target_url: target_url !== undefined ? target_url : existing.target_url,
        mode: mode !== undefined ? mode : existing.mode,
      },
    });
    const normalizedTags = tags !== undefined ? normalizeTagList(tags) : undefined;

    // Fields left out of the request (or sent as null) keep their current value;
    // icon_file_name always comes from the icon change.
    const requested = {
      name,
      slug,
      description,
      long_description,
      icon: iconChange.icon,
      icon_file_name: iconChange.icon_file_name,
      target_url,
      is_active: typeof is_active === 'boolean' ? Number(is_active) : is_active,
      sort_order,
      mode,
      sso_endpoint: normalizedSsoEndpoint,
      sso_method,
      tags: normalizedTags !== undefined ? JSON.stringify(normalizedTags) : undefined,
    };
    const next = { ...existing };
    for (const [column, value] of Object.entries(requested)) {
      if (column === 'icon_file_name' || (value !== undefined && value !== null)) next[column] = value;
    }

    // Write only the columns whose value actually changes.
    const changedColumns = diffAuditFields(existing, next, Object.keys(requested)).map((change) => change.field);
    if (changedColumns.length > 0) {
      db.prepare(`
        UPDATE apps SET ${changedColumns.map((column) => `${column} = ?`).join(', ')}, updated_at = datetime('now')
        WHERE id = ?
      `).run(...changedColumns.map((column) => next[column]), id);
      logRbacAudit(req.user.id, 'update', 'app', id, {
        name: next.name,
        changes: buildAppAuditChanges(existing, next, changedColumns),
      });
    }

    const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
    res.json({ app });
  } catch (error) {
    console.error('Update app failed:', error.message);
    respondWithError(res, error, { status: 500, code: 'failed_to_update_app' });
  }
});

// Sync an existing app group assignment set (admin only)
router.post('/:id/groups', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;
  const { groupIds } = req.body;

  const app = db.prepare('SELECT id FROM apps WHERE id = ?').get(id);
  if (!app) {
    return res.status(404).json({ error: 'App not found', code: 'app_not_found' });
  }

  if (!Array.isArray(groupIds)) {
    return res.status(400).json({ error: 'groupIds must be an array', code: 'invalid_group_ids' });
  }

  const normalizedGroupIds = [...new Set(groupIds.filter((groupId) => typeof groupId === 'string' && groupId.trim()))];

  const placeholders = normalizedGroupIds.map(() => '?').join(', ');
  const existingGroups = normalizedGroupIds.length > 0
    ? db.prepare(`SELECT id FROM user_groups WHERE id IN (${placeholders})`).all(...normalizedGroupIds)
    : [];

  if (existingGroups.length !== normalizedGroupIds.length) {
    return res.status(400).json({ error: 'One or more selected groups were not found', code: 'groups_not_found' });
  }

  const currentGroupIds = db.prepare('SELECT group_id FROM app_permissions WHERE app_id = ? ORDER BY group_id')
    .all(id)
    .map((row) => row.group_id);
  const currentGroupIdSet = new Set(currentGroupIds);
  const requestedGroupIdSet = new Set(normalizedGroupIds);
  const insertPermission = db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)');
  const removePermission = db.prepare('DELETE FROM app_permissions WHERE app_id = ? AND group_id = ?');

  let added = 0;
  let removed = 0;
  const syncAppGroups = db.transaction(() => {
    for (const currentGroupId of currentGroupIds) {
      if (requestedGroupIdSet.has(currentGroupId)) continue;
      const result = removePermission.run(id, currentGroupId);
      removed += result.changes || 0;
    }

    for (const groupId of normalizedGroupIds) {
      if (currentGroupIdSet.has(groupId)) continue;
      const result = insertPermission.run(id, groupId);
      added += result.changes || 0;
    }
  });

  syncAppGroups();

  if (added > 0 || removed > 0) {
    logRbacAudit(req.user.id, 'sync_apps', 'permission', id, {
      appIds: [id],
      groupIds: normalizedGroupIds,
      added,
      removed,
    });
  }

  res.json({ added, removed });
});

// Delete app (admin only)
router.delete('/:id', authenticate, isAdminEditor, (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'App not found', code: 'app_not_found' });
  }

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM app_permissions WHERE app_id = ?').run(id);
    db.prepare('DELETE FROM access_logs WHERE app_id = ?').run(id);
    db.prepare('DELETE FROM apps WHERE id = ?').run(id);
  });
  deleteAll();
  removeAppIconAsset(id).catch((error) => console.error('App icon cleanup failed:', error.message));
  logRbacAudit(req.user.id, 'delete', 'app', id, { name: existing.name, slug: existing.slug, mode: existing.mode });
  res.json({ deleted: true });
});

// Shared API-key guard for bulk endpoints (CLI/automation/server-to-server sync)
// Actor recorded in the audit log for changes made through the bulk API key.
const BULK_API_ACTOR = 'api-key';

function requireBulkApiKey(req, res) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    res.status(503).json({ error: 'ADMIN_API_KEY not configured on server', code: 'admin_api_key_not_configured' });
    return false;
  }
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== expected) {
    res.status(401).json({ error: 'Invalid or missing API key', code: 'api_key_invalid' });
    return false;
  }
  return true;
}

// Bulk export apps — authenticated via API key. Returns full metadata for all
// apps (active + inactive), including description, tags, target_url, mode.
// Intended for server-to-server sync with external catalogs/audit systems.
router.get('/bulk', (req, res) => {
  if (!requireBulkApiKey(req, res)) return;

  const rows = db.prepare(`
    SELECT id, name, slug, description, long_description, icon, target_url,
           is_active, sort_order, mode, sso_endpoint, sso_method, tags,
           created_at, updated_at
    FROM apps
    ORDER BY sort_order, name
  `).all();

  const apps = rows.map((a) => {
    let tags = [];
    try { tags = JSON.parse(a.tags || '[]'); } catch { /* ignore */ }
    return { ...a, tags, is_active: !!a.is_active };
  });

  res.json({ apps, count: apps.length });
});

// Bulk upsert apps — authenticated via API key (for CLI/automation)
// Upserts by slug: creates if not exists, updates if exists
router.post('/bulk', (req, res) => {
  if (!requireBulkApiKey(req, res)) return;

  const { apps: appList } = req.body;
  if (!Array.isArray(appList)) {
    return res.status(400).json({ error: 'apps must be an array', code: 'invalid_apps_payload' });
  }

  const results = [];
  // Audit rows for the apps actually created or updated, written after the import.
  const auditEntries = [];
  const upsert = db.transaction(() => {
    for (const app of appList) {
      if (!app.slug || !app.name || !app.target_url) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'missing slug, name, or target_url' });
        continue;
      }

      const slugError = validateAppSlug(app.slug);
      if (slugError) {
        results.push({ slug: app.slug, status: 'skipped', reason: slugError });
        continue;
      }
      if (app.tags !== undefined && app.tags !== null && !Array.isArray(app.tags)) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'tags must be an array' });
        continue;
      }

      if (app.mode && !['redirect', 'redirect-plain', 'internal-link', 'shared-cookie', 'entra-app'].includes(app.mode)) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'invalid mode' });
        continue;
      }
      if (app.sso_method && !['GET', 'POST'].includes(app.sso_method)) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'invalid sso_method' });
        continue;
      }

      const existing = db.prepare('SELECT * FROM apps WHERE slug = ?').get(app.slug);
      const requestedMode = app.mode || existing?.mode || 'redirect-plain';
      if (!isAppModeEnabled(requestedMode)) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'selected mode is disabled by personalization settings' });
        continue;
      }

      const urlError = validateTargetUrl(app.target_url, requestedMode);
      if (urlError) {
        results.push({ slug: app.slug, status: 'skipped', reason: urlError });
        continue;
      }

      const normalizedSsoEndpoint = requestedMode === 'entra-app'
        ? normalizeEntraEndpoint(app.sso_endpoint || existing?.sso_endpoint)
        : (app.sso_endpoint || existing?.sso_endpoint || '/sso');
      if (requestedMode === 'entra-app' && !isValidEntraApplicationId(normalizedSsoEndpoint)) {
        results.push({ slug: app.slug, status: 'skipped', reason: 'invalid MyApps Application ID or launcher URL' });
        continue;
      }

      if (existing) {
        // Merge tags: combine existing + new, deduplicate
        let mergedTags = null;
        if (app.tags) {
          const existingRow = db.prepare('SELECT tags FROM apps WHERE id = ?').get(existing.id);
          const existingTags = parseTags(existingRow?.tags || '[]');
          mergedTags = JSON.stringify(normalizeTagList([...existingTags, ...app.tags]));
        }

        // Omitted fields keep their value; only the columns that actually change are written.
        const requested = {
          name: app.name,
          description: app.description,
          long_description: app.long_description,
          icon: app.icon,
          target_url: app.target_url,
          mode: app.mode,
          sso_endpoint: normalizedSsoEndpoint,
          sso_method: app.sso_method,
          tags: mergedTags,
        };
        const changedColumns = Object.keys(requested)
          .filter((column) => requested[column] !== undefined && requested[column] !== null && requested[column] !== existing[column]);

        if (changedColumns.length === 0) {
          results.push({ slug: app.slug, status: 'unchanged' });
          continue;
        }

        db.prepare(`
          UPDATE apps SET ${changedColumns.map((column) => `${column} = ?`).join(', ')}, updated_at = datetime('now')
          WHERE id = ?
        `).run(...changedColumns.map((column) => requested[column]), existing.id);
        results.push({ slug: app.slug, status: 'updated' });
        auditEntries.push({
          action: 'update',
          id: existing.id,
          details: {
            name: requested.name || existing.name,
            source: 'bulk',
            changes: changedColumns.map((field) => ({
              field,
              from: field === 'tags' ? parseTags(existing.tags) : existing[field] ?? null,
              to: field === 'tags' ? parseTags(requested.tags) : requested[field],
            })),
          },
        });
      } else {
        const id = uuidv4();
        const normalizedGroupIds = Array.isArray(app.groupIds)
          ? [...new Set(app.groupIds.filter((groupId) => typeof groupId === 'string' && groupId.trim()))]
          : [];
        if (normalizedGroupIds.length > 0) {
          const placeholders = normalizedGroupIds.map(() => '?').join(', ');
          const existingGroups = db.prepare(`SELECT id FROM user_groups WHERE id IN (${placeholders})`).all(...normalizedGroupIds);
          if (existingGroups.length !== normalizedGroupIds.length) {
            results.push({ slug: app.slug, status: 'skipped', reason: 'one or more selected groups were not found' });
            continue;
          }
        }
        db.prepare(`
          INSERT INTO apps (id, name, slug, description, long_description, icon, icon_file_name, target_url, sort_order, mode, sso_endpoint, sso_method, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, app.name, app.slug, app.description || '', app.long_description || '',
          app.icon || '📦', null, app.target_url,
          app.sort_order || 99, app.mode || 'redirect-plain',
          normalizedSsoEndpoint,
          app.sso_method || 'GET',
          JSON.stringify(normalizeTagList(app.tags))
        );
        const insertPermission = db.prepare('INSERT OR IGNORE INTO app_permissions (app_id, group_id) VALUES (?, ?)');
        for (const groupId of normalizedGroupIds) {
          insertPermission.run(id, groupId);
        }
        results.push({ slug: app.slug, status: 'created' });
        auditEntries.push({ action: 'create', id, details: { name: app.name, slug: app.slug, source: 'bulk', groupIds: normalizedGroupIds } });
      }
    }
  });

  upsert();
  // Bulk changes are made with the API key, not by a user.
  for (const entry of auditEntries) {
    logRbacAudit(BULK_API_ACTOR, entry.action, 'app', entry.id, entry.details);
  }
  res.json({ results });
});

export default router;
