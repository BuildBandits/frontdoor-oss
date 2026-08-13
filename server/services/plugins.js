import fs from 'fs/promises';
import { readFileSync, rmSync } from 'node:fs';
import path from 'path';
import { createHash } from 'node:crypto';
import db, { logRbacAudit } from '../db.js';
import { v4 as uuidv4 } from 'uuid';
import { extractPluginPackageZip } from '../../shared/packageZip.js';
import {
  PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_EVENTS,
  validatePluginEventSubscriptions,
  validatePluginPermissions,
  validatePluginRoles,
} from '../../shared/pluginPolicy.js';
import { isPluginSystemEnabled } from './branding.js';
import { deliverPluginWebhook, validatePluginWebhookUrl } from './pluginNetwork.js';
import { decryptPluginSecret, encryptPluginSecret } from './pluginSecrets.js';
const PLUGIN_ASSET_DIR = path.resolve(process.env.PLUGIN_ASSET_DIR || path.join(process.cwd(), 'data', 'plugins'));
const MAX_PLUGIN_MODULE_BYTES = 1024 * 1024;

function boundedText(value, fieldName, maxLength, fallback = '') {
  const text = String(value ?? fallback).trim();
  if (text.length > maxLength) {
    throw new Error(`${fieldName} exceeds the ${maxLength} character limit`);
  }
  return text;
}

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
  if (id.length > 128) {
    throw new Error('Plugin id exceeds the 128 character limit');
  }
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(id)) {
    throw new Error('Plugin id must use lowercase letters, numbers, hyphens, or underscores');
  }
  return id;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSha256(value, fieldName) {
  const digest = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error(`${fieldName} must be a SHA-256 digest`);
  }
  return digest;
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
  return path.resolve(PLUGIN_ASSET_DIR, ...relative.split('/'));
}

async function writeLocalPluginBundle({ id, version, moduleSource }) {
  await ensurePluginAssetDir();
  const pluginSegment = normalizePathSegment(id, 'plugin');
  const versionSegment = normalizePathSegment(version, '0.0.0');
  const source = String(moduleSource || '');
  if (Buffer.byteLength(source, 'utf8') > MAX_PLUGIN_MODULE_BYTES) {
    throw new Error('Plugin module exceeds the 1 MiB size limit');
  }
  const artifactSha256 = sha256(source);
  const dir = path.join(PLUGIN_ASSET_DIR, pluginSegment, versionSegment, artifactSha256);
  await fs.mkdir(dir, { recursive: true, mode: 0o750 });
  const filePath = path.join(dir, 'index.mjs');
  try {
    await fs.writeFile(filePath, source, { encoding: 'utf8', flag: 'wx', mode: 0o440 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingSource = await fs.readFile(filePath, 'utf8');
    if (sha256(existingSource) !== artifactSha256) {
      throw new Error('Stored plugin artifact does not match its content address');
    }
  }
  await fs.chmod(filePath, 0o440);
  return {
    entry: `/api/plugins/files/${encodeURIComponent(pluginSegment)}/${encodeURIComponent(versionSegment)}/${artifactSha256}/index.mjs`,
    filePath,
    artifactSha256,
  };
}

function removeLocalPluginBundle(entry) {
  if (!isLocalPluginEntry(entry)) return;
  const filePath = localEntryToFilePath(entry);
  const assetRoot = `${path.resolve(PLUGIN_ASSET_DIR)}${path.sep}`;
  if (!filePath.startsWith(assetRoot)) {
    throw new Error('Refusing to remove a plugin artifact outside plugin storage');
  }
  const dirPath = path.dirname(filePath);
  rmSync(dirPath, { recursive: true, force: true });
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

  const apiVersion = Number.isFinite(Number(manifest.apiVersion)) ? Number(manifest.apiVersion) : PLUGIN_API_VERSION;
  if (apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`Unsupported plugin API version: ${apiVersion}`);
  }

  return {
    apiVersion,
    id,
    name: boundedText(manifest.name || fallback.name || id, 'Plugin name', 200) || id,
    version: boundedText(manifest.version || fallback.version || '0.0.0', 'Plugin version', 64) || '0.0.0',
    description: boundedText(manifest.description || fallback.description || '', 'Plugin description', 4000),
    author: boundedText(manifest.author || fallback.author || '', 'Plugin author', 200),
    homepage: boundedText(manifest.homepage || fallback.homepage || '', 'Plugin homepage', 2048),
    entry,
    permissions: validatePluginPermissions(normalizeList(pickList(manifest.permissions, fallback.permissions))),
    roles: validatePluginRoles(normalizeList(pickList(manifest.roles, fallback.roles))),
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
  const contentDigest = row.content_digest || null;
  const approvedDigest = row.approved_digest || null;
  const approved = row.approved === 1
    && Boolean(contentDigest)
    && approvedDigest === contentDigest;
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
    artifactSha256: row.artifact_sha256 || null,
    contentDigest,
    approvedDigest,
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

function isPluginRoleAllowed(plugin, user) {
  if (!user) return false;
  if (!Array.isArray(plugin?.roles) || plugin.roles.length === 0) return true;
  return plugin.roles.includes(user.role);
}

function isBackendPluginEnabled(row, eventName) {
  if (
    !row ||
    row.enabled === 0 ||
    row.approved !== 1 ||
    !row.content_digest ||
    row.approved_digest !== row.content_digest ||
    row.backend_enabled !== 1 ||
    !row.backend_url
  ) {
    return false;
  }
  const subscriptions = safeJsonParse(row.event_subscriptions_json, []);
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return false;
  }
  return subscriptions.includes(eventName);
}

function sanitizePluginEventPayload(eventName, payload = {}) {
  const user = payload?.user && typeof payload.user === 'object' ? payload.user : {};
  const safeUser = {
    id: payload.userId || user.id || null,
    role: payload.userRole || user.role || null,
  };

  if (eventName === 'auth.login' || eventName === 'auth.devLogin') {
    return {
      user: safeUser,
      auth: {
        via: payload.auth?.via || payload.via || (eventName === 'auth.devLogin' ? 'development' : null),
        isNewUser: Boolean(payload.auth?.isNewUser ?? payload.isNewUser),
      },
    };
  }

  if (eventName === 'app.access') {
    const app = payload?.app && typeof payload.app === 'object' ? payload.app : {};
    return {
      app: {
        id: payload.appId || app.id || null,
        slug: payload.appSlug || app.slug || null,
        mode: payload.mode || app.mode || null,
      },
      user: safeUser,
      channel: payload.channel || null,
    };
  }

  throw new Error(`Unsupported plugin event: ${eventName}`);
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

export function getRuntimePlugins(user = null) {
  if (!isPluginSystemEnabled()) {
    return [];
  }
  return makePluginSnapshotQuery(false)
    .all()
    .map(rowToPluginRecord)
    .filter((plugin) => plugin.entry && plugin.approved && isPluginRoleAllowed(plugin, user));
}

export function canUserLoadPluginArtifact(pluginId, user) {
  if (!isPluginSystemEnabled() || !user) return false;
  let plugin;
  try {
    plugin = getPluginRegistryById(pluginId);
  } catch {
    return false;
  }
  return Boolean(
    plugin
    && plugin.enabled
    && plugin.approved
    && plugin.entry
    && isPluginRoleAllowed(plugin, user)
  );
}

export async function readVerifiedPluginArtifact(requestPath, user) {
  const segments = String(requestPath || '').split('/').filter(Boolean);
  if (segments.length !== 4 || segments[3] !== 'index.mjs') {
    return null;
  }
  const [pluginId, versionSegment, artifactSha256] = segments;
  if (!canUserLoadPluginArtifact(pluginId, user)) return null;
  if (!/^[a-f0-9]{64}$/.test(artifactSha256)) return null;

  const plugin = getPluginRegistryById(pluginId);
  if (plugin?.artifactSha256 !== artifactSha256) return null;
  if (normalizePathSegment(plugin.version, '0.0.0') !== versionSegment) return null;

  const filePath = path.resolve(PLUGIN_ASSET_DIR, pluginId, versionSegment, artifactSha256, 'index.mjs');
  const assetRoot = `${path.resolve(PLUGIN_ASSET_DIR)}${path.sep}`;
  if (!filePath.startsWith(assetRoot)) return null;

  try {
    const bytes = await fs.readFile(filePath);
    if (sha256(bytes) !== artifactSha256) return null;
    return bytes;
  } catch {
    return null;
  }
}

export function getPluginRegistryById(id) {
  const row = db.prepare('SELECT * FROM plugin_registry WHERE id = ?').get(normalizePluginId(id));
  return rowToPluginRecord(row);
}

export function upsertPluginRegistry(input = {}) {
  const manifest = normalizeManifest(input);
  const existingRow = db.prepare('SELECT * FROM plugin_registry WHERE id = ?').get(manifest.id);
  const backendUrl = String(input.backendUrl || input.backend?.url || manifest.backend.url || '').trim();
  const backendError = validatePluginWebhookUrl(backendUrl);
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
  const hasExplicitBackendSecret = Object.prototype.hasOwnProperty.call(input, 'backendSecret')
    || Object.prototype.hasOwnProperty.call(input.backend || {}, 'secret')
    || Boolean(manifest.backend.secret);
  const backendSecret = hasExplicitBackendSecret
    ? String(input.backendSecret ?? input.backend?.secret ?? manifest.backend.secret ?? '').trim()
    : decryptPluginSecret(existingRow?.backend_secret || '');
  if (backendSecret.length > 1024) {
    throw new Error('Plugin backend secret exceeds the 1024 character limit');
  }
  const storedBackendSecret = hasExplicitBackendSecret
    ? encryptPluginSecret(backendSecret)
    : existingRow?.backend_secret || null;
  const eventSubscriptions = validatePluginEventSubscriptions(normalizeList(pickList(
    input.eventSubscriptions,
    pickList(input.backend?.eventSubscriptions, manifest.backend.eventSubscriptions)
  )));
  const permissions = validatePluginPermissions(normalizeList(pickList(input.permissions, manifest.permissions)));
  const roles = validatePluginRoles(normalizeList(pickList(input.roles, manifest.roles)));
  const source = String(input.source || manifest.source || 'local').trim() || 'local';
  const entry = String(input.entry || manifest.entry || '').trim();
  const description = boundedText(input.description || manifest.description || '', 'Plugin description', 4000);
  const version = boundedText(input.version || manifest.version || '0.0.0', 'Plugin version', 64) || '0.0.0';
  const author = boundedText(input.author || manifest.author || '', 'Plugin author', 200);
  const homepage = boundedText(input.homepage || manifest.homepage || '', 'Plugin homepage', 2048);
  const name = boundedText(input.name || manifest.name || manifest.id, 'Plugin name', 200) || manifest.id;
  const id = manifest.id;
  if (!isLocalPluginEntry(entry)) {
    throw new Error('Production plugins must use an immutable local package artifact');
  }
  const artifactSha256 = normalizeSha256(input.artifactSha256, 'artifactSha256');

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
  const contentDigest = sha256(JSON.stringify({
    apiVersion: manifest.apiVersion,
    id,
    name,
    version,
    description,
    author,
    homepage,
    entry,
    source,
    permissions,
    roles,
    artifactSha256,
    backend: {
      enabled: backendEnabled,
      url: backendUrl || '',
      secretEnvelopeSha256: storedBackendSecret ? sha256(storedBackendSecret) : null,
      eventSubscriptions,
    },
  }));

  db.prepare(`
    INSERT INTO plugin_registry (
      id, name, description, version, source, entry, manifest_json,
      permissions_json, roles_json, backend_enabled, backend_url, backend_secret,
      event_subscriptions_json, artifact_sha256, content_digest,
      approved, approved_digest, enabled, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, datetime('now'))
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
      artifact_sha256 = excluded.artifact_sha256,
      content_digest = excluded.content_digest,
      approved = 0,
      approved_digest = NULL,
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
    storedBackendSecret,
    JSON.stringify(eventSubscriptions),
    artifactSha256,
    contentDigest,
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
  const requestedEntry = String(input.entry || manifest.entry || packagePayload?.entry || '').trim();
  let entry = '';
  let artifactSha256 = '';
  let source = String(input.source || manifest.source || packagePayload?.source || 'package').trim() || 'package';
  const moduleSource = String(input.moduleSource || packagePayload?.moduleSource || '');

  if (moduleSource.trim()) {
    const stored = await writeLocalPluginBundle({
      id: manifest.id,
      version: manifest.version,
      moduleSource,
    });
    entry = stored.entry;
    artifactSha256 = stored.artifactSha256;
    source = packagePayload ? 'package' : 'uploaded';
  } else if (existing?.entry && existing?.artifactSha256 && isLocalPluginEntry(existing.entry)) {
    entry = existing.entry;
    artifactSha256 = existing.artifactSha256;
    source = existing.source || source;
  } else if (requestedEntry) {
    throw new Error('Remote plugin entries are not supported. Upload a packaged module source.');
  }

  if (!entry) {
    throw new Error('Plugin module source is required for a new installation');
  }

  const plugin = upsertPluginRegistry({
    ...input,
    manifest,
    entry,
    source,
    artifactSha256,
  });

  logRbacAudit(input.actorId || 'system', existing ? 'update' : 'import', 'plugin', plugin.id, {
    name: plugin.name,
    version: plugin.version,
    source: plugin.source,
    contentDigest: plugin.contentDigest,
    approvalInvalidated: true,
  });

  if (existing?.entry && existing.entry !== entry && isLocalPluginEntry(existing.entry)) {
    try {
      removeLocalPluginBundle(existing.entry);
    } catch {
      // Registry update remains authoritative; stale immutable bytes are inert.
    }
  }

  return plugin;
}

export function approvePluginRegistry(id, actorId = null) {
  const normalizedId = normalizePluginId(id);
  const existing = getPluginRegistryById(normalizedId);
  if (!existing) {
    return null;
  }
  if (!existing.contentDigest || !existing.artifactSha256 || !isLocalPluginEntry(existing.entry)) {
    throw new Error('Plugin approval requires a verified immutable local artifact');
  }
  const artifactPath = path.resolve(localEntryToFilePath(existing.entry));
  const assetRoot = `${path.resolve(PLUGIN_ASSET_DIR)}${path.sep}`;
  if (!artifactPath.startsWith(assetRoot)) {
    throw new Error('Plugin approval rejected an artifact outside plugin storage');
  }
  let artifactBytes;
  try {
    artifactBytes = readFileSync(artifactPath);
  } catch {
    throw new Error('Plugin approval requires the immutable artifact to be present');
  }
  if (sha256(artifactBytes) !== existing.artifactSha256) {
    throw new Error('Plugin approval rejected a tampered artifact');
  }
  db.prepare(`
    UPDATE plugin_registry
    SET approved = 1,
        approved_digest = content_digest,
        approved_by = ?,
        approved_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(actorId || null, normalizedId);
  logRbacAudit(actorId || 'system', 'approve', 'plugin', normalizedId, {
    name: existing.name,
    version: existing.version,
    source: existing.source,
    contentDigest: existing.contentDigest,
    approved: true,
  });
  return getPluginRegistryById(normalizedId);
}

export function revokePluginApproval(id, actorId = null) {
  const normalizedId = normalizePluginId(id);
  const existing = getPluginRegistryById(normalizedId);
  if (!existing) {
    return null;
  }
  db.prepare(`
    UPDATE plugin_registry
    SET approved = 0,
        approved_digest = NULL,
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

export function deletePluginRegistry(id, actorId = null) {
  const normalizedId = normalizePluginId(id);
  const existing = getPluginRegistryById(normalizedId);
  if (!existing) return false;
  if (existing.entry && isLocalPluginEntry(existing.entry)) {
    removeLocalPluginBundle(existing.entry);
  }
  db.prepare('DELETE FROM plugin_registry WHERE id = ?').run(normalizedId);
  logRbacAudit(actorId || 'system', 'delete', 'plugin', normalizedId, {
    name: existing.name,
    version: existing.version,
    contentDigest: existing.contentDigest,
  });
  return true;
}

export async function dispatchPluginEvent(eventName, payload = {}, context = {}) {
  if (!SUPPORTED_PLUGIN_EVENTS.includes(eventName)) {
    throw new Error(`Unsupported plugin event: ${eventName}`);
  }
  const safePayload = sanitizePluginEventPayload(eventName, payload);

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
      AND content_digest IS NOT NULL
      AND approved_digest = content_digest
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

    try {
      const deliveryTransport = context.deliveryTransport || deliverPluginWebhook;
      const backendSecret = decryptPluginSecret(row.backend_secret || '');
      const response = await deliveryTransport({
        url: row.backend_url,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'frontdoor-plugin-dispatch/1.0',
          'X-Frontdoor-Plugin-Id': row.id,
          'X-Frontdoor-Plugin-Event': eventName,
          'X-Frontdoor-Delivery-Id': deliveryId,
          ...(backendSecret ? { 'X-Frontdoor-Plugin-Secret': backendSecret } : {}),
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
          payload: safePayload,
          context: {
            testMode: context.testMode === true,
          },
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        summary.failed += 1;
        summary.errors.push({
          pluginId: row.id,
          message: `Backend webhook returned ${response.status}`,
        });
        logRbacAudit(context.actorId || 'system', 'delivery_failed', 'plugin', row.id, {
          event: eventName,
          deliveryId,
          status: response.status,
          testMode: context.testMode === true,
        });
        continue;
      }

      summary.delivered += 1;
      logRbacAudit(context.actorId || 'system', 'deliver', 'plugin', row.id, {
        event: eventName,
        deliveryId,
        status: response.status,
        testMode: context.testMode === true,
      });
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        pluginId: row.id,
        message: 'Plugin backend delivery failed',
      });
      logRbacAudit(context.actorId || 'system', 'delivery_failed', 'plugin', row.id, {
        event: eventName,
        deliveryId,
        errorType: error instanceof Error ? error.name : 'Error',
        testMode: context.testMode === true,
      });
    }
  }

  return summary;
}

export function buildRuntimePluginPayload(user = null) {
  if (!isPluginSystemEnabled()) {
    return [];
  }
  return getRuntimePlugins(user).map((plugin) => ({
    manifest: plugin.manifest,
    source: plugin.source,
    entry: plugin.entry,
    contentDigest: plugin.contentDigest,
  }));
}

export { PLUGIN_ASSET_DIR };
