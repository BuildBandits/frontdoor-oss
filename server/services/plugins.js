import fs from 'fs/promises';
import path from 'path';
import db, { logRbacAudit } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { extractPluginPackageZip } from '../../shared/packageZip.js';
import { isPluginSystemEnabled } from './branding.js';
const PLUGIN_ASSET_DIR = path.resolve(process.env.PLUGIN_ASSET_DIR || path.join(process.cwd(), 'data', 'plugins'));

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeList(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const item of list) {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function pickList(primary, fallback) {
  if (Array.isArray(primary)) return primary;
  if (Array.isArray(fallback)) return fallback;
  return [];
}

function normalizePluginId(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!id) {
    throw new Error('Plugin id is required');
  }
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(id)) {
    throw new Error('Plugin id must use lowercase letters, numbers, hyphens, or underscores');
  }
  return id;
}

// Lookups by id (e.g. from a URL) treat a malformed id as "not found" instead of throwing.
function tryNormalizePluginId(value) {
  try {
    return normalizePluginId(value);
  } catch {
    return null;
  }
}

function validateExternalUrl(value, fieldName, { allowRelative = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (allowRelative && (/^[./]/.test(value) || value.startsWith('/'))) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return `${fieldName} must be a valid URL`;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return `${fieldName} must use http or https`;
  }

  if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|localhost|169\.254\.)/.test(parsed.hostname)) {
    return `${fieldName} cannot point to a private network`;
  }

  return null;
}

function parsePluginPackage(input = {}) {
  if (input.packageZipBase64) {
    let bytes;
    try {
      bytes = Uint8Array.from(Buffer.from(String(input.packageZipBase64), 'base64'));
    } catch {
      throw new Error('Plugin package ZIP must be valid base64');
    }
    const archive = extractPluginPackageZip(bytes);
    return {
      manifest: archive.manifest,
      entry: String(archive.manifest.entry || '').trim(),
      moduleSource: archive.moduleSource,
      source: 'zip',
    };
  }

  const rawPackage = input.packageSource ?? input.packageJson ?? input.packageText ?? input.package;
  if (rawPackage === undefined || rawPackage === null || rawPackage === '') {
    return null;
  }

  const packageObject = typeof rawPackage === 'string'
    ? (() => {
        try {
          return JSON.parse(rawPackage);
        } catch {
          throw new Error('Plugin package must be valid JSON');
        }
      })()
    : rawPackage;

  if (!packageObject || typeof packageObject !== 'object' || Array.isArray(packageObject)) {
    throw new Error('Plugin package must be a JSON object');
  }

  const manifest = packageObject.manifest && typeof packageObject.manifest === 'object'
    ? packageObject.manifest
    : packageObject;

  return {
    manifest,
    entry: String(packageObject.entry || manifest.entry || '').trim(),
    moduleSource: String(packageObject.moduleSource || packageObject.module || packageObject.code || '').trim(),
    source: String(packageObject.source || manifest.source || 'package').trim() || 'package',
  };
}

async function ensurePluginAssetDir() {
  await fs.mkdir(PLUGIN_ASSET_DIR, { recursive: true });
}

function normalizePathSegment(value, fallback = 'plugin') {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function isLocalPluginEntry(entry) {
  return typeof entry === 'string' && entry.startsWith('/api/plugins/files/');
}

function localEntryToFilePath(entry) {
  const relative = entry.replace('/api/plugins/files/', '');
  return path.join(PLUGIN_ASSET_DIR, ...relative.split('/'));
}

async function writeLocalPluginBundle({ id, version, moduleSource }) {
  await ensurePluginAssetDir();
  const pluginSegment = normalizePathSegment(id, 'plugin');
  const versionSegment = normalizePathSegment(version, '0.0.0');
  const releaseSegment = `${Date.now()}-${uuidv4().slice(0, 8)}`;
  const dir = path.join(PLUGIN_ASSET_DIR, pluginSegment, versionSegment, releaseSegment);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'index.mjs');
  await fs.writeFile(filePath, String(moduleSource || ''), 'utf8');
  return {
    entry: `/api/plugins/files/${encodeURIComponent(pluginSegment)}/${encodeURIComponent(versionSegment)}/${encodeURIComponent(releaseSegment)}/index.mjs`,
    filePath,
  };
}

async function removeLocalPluginBundle(entry) {
  if (!isLocalPluginEntry(entry)) return;
  const filePath = localEntryToFilePath(entry);
  const dirPath = path.dirname(filePath);
  await fs.rm(dirPath, { recursive: true, force: true });
}

function normalizeManifest(input = {}, fallback = {}) {
  const source = input.manifest && typeof input.manifest === 'object' ? input.manifest : input;
  const manifest = source || {};
  const id = normalizePluginId(manifest.id || fallback.id);
  const entry = String(manifest.entry || fallback.entry || '').trim();
  const entryError = entry ? validateExternalUrl(entry, 'entry', { allowRelative: true }) : null;
  if (entryError) {
    throw new Error(entryError);
  }

  return {
    apiVersion: Number.isFinite(Number(manifest.apiVersion)) ? Number(manifest.apiVersion) : 1,
    id,
    name: String(manifest.name || fallback.name || id).trim() || id,
    version: String(manifest.version || fallback.version || '0.0.0').trim() || '0.0.0',
    description: String(manifest.description || fallback.description || '').trim(),
    author: String(manifest.author || fallback.author || '').trim(),
    homepage: String(manifest.homepage || fallback.homepage || '').trim(),
    entry,
    permissions: normalizeList(pickList(manifest.permissions, fallback.permissions)),
    roles: normalizeList(pickList(manifest.roles, fallback.roles)),
    source: String(manifest.source || fallback.source || 'local').trim() || 'local',
    backend: {
      enabled: Boolean(manifest.backend?.enabled ?? fallback.backend?.enabled),
      url: String(manifest.backend?.url || fallback.backend?.url || '').trim(),
      secret: String(manifest.backend?.secret || fallback.backend?.secret || ''),
      eventSubscriptions: normalizeList(manifest.backend?.eventSubscriptions || fallback.backend?.eventSubscriptions),
    },
  };
}

function rowToPluginRecord(row) {
  if (!row) return null;
  const manifestFromDb = safeJsonParse(row.manifest_json, {});
  const permissions = safeJsonParse(row.permissions_json, []);
  const roles = safeJsonParse(row.roles_json, null);
  const eventSubscriptions = safeJsonParse(row.event_subscriptions_json, []);
  const approved = row.approved === 1;
  const record = {
    id: row.id,
    name: row.name,
    description: row.description || '',
    version: row.version || '0.0.0',
    source: row.source || 'local',
    entry: row.entry || '',
    permissions: Array.isArray(permissions) ? permissions : [],
    roles: Array.isArray(roles) && roles.length > 0 ? roles : null,
    enabled: row.enabled !== 0,
    backendEnabled: row.backend_enabled === 1,
    backendUrl: row.backend_url || '',
    eventSubscriptions: Array.isArray(eventSubscriptions) ? eventSubscriptions : [],
    approved,
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    status: !row.enabled ? 'disabled' : approved ? 'approved' : 'pending',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };

  return {
    ...record,
    manifest: {
      ...manifestFromDb,
      apiVersion: manifestFromDb.apiVersion || 1,
      id: record.id,
      name: record.name,
      version: record.version,
      description: record.description,
      author: manifestFromDb.author || '',
      homepage: manifestFromDb.homepage || '',
      entry: record.entry,
      permissions: record.permissions,
      roles: record.roles || [],
      source: record.source,
    },
  };
}

function isBackendPluginEnabled(row, eventName) {
  if (
    !row ||
    row.enabled === 0 ||
    row.approved !== 1 ||
    row.backend_enabled !== 1 ||
    !row.backend_url
  ) {
    return false;
  }
  const subscriptions = safeJsonParse(row.event_subscriptions_json, []);
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return false;
  }
  return subscriptions.includes('*') || subscriptions.includes(eventName);
}

function makePluginSnapshotQuery(includeDisabled = false) {
  return db.prepare(`
    SELECT *
    FROM plugin_registry
    ${includeDisabled ? '' : 'WHERE enabled = 1'}
    ORDER BY name, id
  `);
}

export function getPluginRegistry(includeDisabled = true) {
  return makePluginSnapshotQuery(includeDisabled).all().map(rowToPluginRecord);
}

export function getRuntimePlugins() {
  if (!isPluginSystemEnabled()) {
    return [];
  }
  return makePluginSnapshotQuery(false)
    .all()
    .map(rowToPluginRecord)
    .filter((plugin) => plugin.entry && plugin.approved);
}

export function getPluginRegistryById(id) {
  const normalizedId = tryNormalizePluginId(id);
  if (!normalizedId) return null;
  const row = db.prepare('SELECT * FROM plugin_registry WHERE id = ?').get(normalizedId);
  return rowToPluginRecord(row);
}

export function upsertPluginRegistry(input = {}) {
  const manifest = normalizeManifest(input);
  const backendUrl = String(input.backendUrl || input.backend?.url || manifest.backend.url || '').trim();
  const backendError = validateExternalUrl(backendUrl, 'backendUrl');
  if (backendError) {
    throw new Error(backendError);
  }

  if (manifest.backend.enabled && !backendUrl) {
    throw new Error('backendUrl is required when backend support is enabled');
  }

  const enabled = input.enabled === undefined ? true : Boolean(input.enabled);
  const backendEnabled = input.backendEnabled === undefined
    ? manifest.backend.enabled
    : Boolean(input.backendEnabled);
  const backendSecret = String(input.backendSecret || input.backend?.secret || manifest.backend.secret || '').trim();
  const eventSubscriptions = normalizeList(pickList(
    input.eventSubscriptions,
    pickList(input.backend?.eventSubscriptions, manifest.backend.eventSubscriptions)
  ));
  const permissions = normalizeList(pickList(input.permissions, manifest.permissions));
  const roles = normalizeList(pickList(input.roles, manifest.roles));
  const source = String(input.source || manifest.source || 'local').trim() || 'local';
  const entry = String(input.entry || manifest.entry || '').trim();
  const description = String(input.description || manifest.description || '').trim();
  const version = String(input.version || manifest.version || '0.0.0').trim() || '0.0.0';
  const author = String(input.author || manifest.author || '').trim();
  const homepage = String(input.homepage || manifest.homepage || '').trim();
  const name = String(input.name || manifest.name || manifest.id).trim() || manifest.id;
  const id = manifest.id;
  const approved = input.approved === undefined ? false : Boolean(input.approved);

  const manifestJson = JSON.stringify({
    ...manifest,
    name,
    version,
    description,
    author,
    homepage,
    entry,
    permissions,
    roles,
    source,
    backend: {
      enabled: backendEnabled,
      url: backendUrl || '',
      eventSubscriptions,
    },
  });

  db.prepare(`
    INSERT INTO plugin_registry (
      id, name, description, version, source, entry, manifest_json,
      permissions_json, roles_json, backend_enabled, backend_url, backend_secret,
      event_subscriptions_json, approved, enabled, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      version = excluded.version,
      source = excluded.source,
      entry = excluded.entry,
      manifest_json = excluded.manifest_json,
      permissions_json = excluded.permissions_json,
      roles_json = excluded.roles_json,
      backend_enabled = excluded.backend_enabled,
      backend_url = excluded.backend_url,
      backend_secret = excluded.backend_secret,
      event_subscriptions_json = excluded.event_subscriptions_json,
      approved = excluded.approved,
      approved_by = NULL,
      approved_at = NULL,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `).run(
    id,
    name,
    description,
    version,
    source,
    entry || null,
    manifestJson,
    JSON.stringify(permissions),
    roles.length > 0 ? JSON.stringify(roles) : null,
    backendEnabled ? 1 : 0,
    backendUrl || null,
    backendSecret || null,
    JSON.stringify(eventSubscriptions),
    approved ? 1 : 0,
    enabled ? 1 : 0,
  );

  return getPluginRegistryById(id);
}

export async function importPluginBundle(input = {}) {
  const packagePayload = parsePluginPackage(input);
  const manifestInput = packagePayload?.manifest || input.manifest || input;
  const manifest = normalizeManifest({
    ...input,
    manifest: manifestInput,
  });
  const existing = getPluginRegistryById(manifest.id);
  let entry = String(input.entry || manifest.entry || packagePayload?.entry || '').trim();
  let source = String(input.source || manifest.source || packagePayload?.source || 'local').trim() || 'local';
  const moduleSource = String(input.moduleSource || packagePayload?.moduleSource || '').trim();

  if (moduleSource) {
    const stored = await writeLocalPluginBundle({
      id: manifest.id,
      version: manifest.version,
      moduleSource,
    });
    entry = stored.entry;
    source = packagePayload ? 'package' : 'uploaded';
  }

  if (!entry) {
    throw new Error('Plugin entry is required. Provide an entry URL or upload a module source.');
  }

  const plugin = upsertPluginRegistry({
    ...input,
    manifest,
    entry,
    source,
    approved: false,
  });

  if (existing?.entry && existing.entry !== entry && isLocalPluginEntry(existing.entry)) {
    await removeLocalPluginBundle(existing.entry).catch(() => {});
  }

  return plugin;
}

export function approvePluginRegistry(id, actorId = null) {
  const existing = getPluginRegistryById(id);
  if (!existing) {
    return null;
  }
  const normalizedId = existing.id;
  db.prepare(`
    UPDATE plugin_registry
    SET approved = 1,
        approved_by = ?,
        approved_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(actorId || null, normalizedId);
  logRbacAudit(actorId || 'system', 'approve', 'plugin', normalizedId, {
    name: existing.name,
    version: existing.version,
    source: existing.source,
    approved: true,
  });
  return getPluginRegistryById(normalizedId);
}

export function revokePluginApproval(id, actorId = null) {
  const existing = getPluginRegistryById(id);
  if (!existing) {
    return null;
  }
  const normalizedId = existing.id;
  db.prepare(`
    UPDATE plugin_registry
    SET approved = 0,
        approved_by = NULL,
        approved_at = NULL,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(normalizedId);
  logRbacAudit(actorId || 'system', 'revoke', 'plugin', normalizedId, {
    name: existing.name,
    version: existing.version,
    source: existing.source,
    approved: false,
  });
  return getPluginRegistryById(normalizedId);
}

export function deletePluginRegistry(id) {
  const existing = getPluginRegistryById(id);
  if (!existing) return false;
  const normalizedId = existing.id;
  if (existing.entry && isLocalPluginEntry(existing.entry)) {
    void removeLocalPluginBundle(existing.entry).catch(() => {});
  }
  db.prepare('DELETE FROM plugin_registry WHERE id = ?').run(normalizedId);
  return true;
}

export async function dispatchPluginEvent(eventName, payload = {}, context = {}) {
  if (!isPluginSystemEnabled()) {
    return {
      event: eventName,
      deliveryId: uuidv4(),
      attempted: 0,
      delivered: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }

  const deliveryId = uuidv4();
  const rows = db.prepare(`
    SELECT *
    FROM plugin_registry
    WHERE enabled = 1
      AND approved = 1
      AND backend_enabled = 1
      AND backend_url IS NOT NULL
      AND TRIM(backend_url) <> ''
  `).all();

  const summary = {
    event: eventName,
    deliveryId,
    attempted: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const row of rows) {
    if (context.targetPluginId && row.id !== context.targetPluginId) {
      summary.skipped += 1;
      continue;
    }
    if (!isBackendPluginEnabled(row, eventName)) {
      summary.skipped += 1;
      continue;
    }

    summary.attempted += 1;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(row.backend_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'frontdoor-plugin-dispatch/1.0',
          'X-Frontdoor-Plugin-Id': row.id,
          'X-Frontdoor-Plugin-Event': eventName,
          'X-Frontdoor-Delivery-Id': deliveryId,
          ...(row.backend_secret ? { 'X-Frontdoor-Plugin-Secret': row.backend_secret } : {}),
        },
        body: JSON.stringify({
          event: eventName,
          deliveryId,
          plugin: {
            id: row.id,
            name: row.name,
            version: row.version,
            source: row.source,
          },
          payload,
          context,
          timestamp: new Date().toISOString(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        summary.failed += 1;
        summary.errors.push({
          pluginId: row.id,
          message: `Backend webhook returned ${response.status}`,
        });
        continue;
      }

      summary.delivered += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        pluginId: row.id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return summary;
}

export function buildRuntimePluginPayload() {
  if (!isPluginSystemEnabled()) {
    return [];
  }
  return getRuntimePlugins().map((plugin) => ({
    manifest: plugin.manifest,
    source: plugin.source,
    entry: plugin.entry,
  }));
}

export { PLUGIN_ASSET_DIR };
