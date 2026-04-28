import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const APP_ICON_CACHE_DIR = process.env.APP_ICON_CACHE_DIR || path.join(process.cwd(), 'data', 'app-icon-cache');
const BRANDING_ASSET_DIR = process.env.BRANDING_ASSET_DIR || path.join(process.cwd(), 'data', 'branding');

function extensionFromContentType(contentType) {
  const normalized = (contentType || '').toLowerCase();
  if (normalized.includes('svg')) return 'svg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('avif')) return 'avif';
  return 'bin';
}

function contentTypeFromExtension(extension) {
  switch ((extension || '').toLowerCase()) {
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'bmp':
      return 'image/bmp';
    case 'avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}

function contentTypeFromFilename(fileName, fallback = 'application/octet-stream') {
  const extension = path.extname(fileName || '').slice(1).toLowerCase();
  return contentTypeFromExtension(extension) || fallback;
}

function getAssetDirForKind(kind, { appIconDir = APP_ICON_CACHE_DIR, brandingDir = BRANDING_ASSET_DIR } = {}) {
  if (kind === 'app-icon') return appIconDir;
  if (kind === 'branding-logo') return brandingDir;
  return null;
}

function resolveStoredMediaAssetPath(row, {
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
} = {}) {
  if (!row?.kind || !row?.stored_file_name) return null;
  const assetDir = getAssetDirForKind(row.kind, { appIconDir, brandingDir });
  if (!assetDir) return null;
  const absolutePath = path.join(assetDir, row.stored_file_name);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

function toPublicMediaAsset(row, assetDirs = {}) {
  if (!row) return null;
  return {
    ...row,
    assetUrl: `/api/media-assets/${encodeURIComponent(row.id)}/file`,
    fileExists: Boolean(resolveStoredMediaAssetPath(row, assetDirs)),
  };
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!match) return null;

  const contentType = (match[1] || 'application/octet-stream').toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3];
  const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { buffer, contentType };
}

export function parseMediaAssetPayload({ dataUrl, svgText }) {
  const svg = typeof svgText === 'string' ? svgText.trim() : '';
  if (/<svg[\s>]/i.test(svg)) {
    return {
      buffer: Buffer.from(svg, 'utf8'),
      contentType: 'image/svg+xml',
    };
  }

  const parsed = parseDataUrl(dataUrl);
  if (parsed?.buffer) {
    return {
      buffer: parsed.buffer,
      contentType: parsed.contentType,
    };
  }

  return null;
}

function findMediaAssetByStoredFileName(dbHandle, kind, storedFileName) {
  if (!kind || !storedFileName) return null;
  return dbHandle.prepare('SELECT * FROM media_assets WHERE kind = ? AND stored_file_name = ? LIMIT 1').get(kind, storedFileName) || null;
}

function insertMediaAssetIndex({
  kind,
  sourceRef = null,
  originalName = null,
  appName = null,
  appSlug = null,
  appTargetUrl = null,
  appMode = null,
  storedFileName = null,
  contentType,
  buffer,
  dbHandle = db,
} = {}) {
  if (!kind || !buffer?.length) return null;

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const nextStoredFileName = storedFileName || `${kind}-${sourceRef || uuidv4()}.${extensionFromContentType(contentType)}`;
  const normalizedContentType = contentType || contentTypeFromFilename(nextStoredFileName);
  const assetId = uuidv4();
  const now = new Date().toISOString();

  dbHandle.prepare(`
    INSERT INTO media_assets (
      id, kind, source_ref, original_name, app_name, app_slug, app_target_url, app_mode,
      stored_file_name, content_type, size_bytes, sha256, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    assetId,
    kind,
    sourceRef,
    originalName,
    appName,
    appSlug,
    appTargetUrl,
    appMode,
    nextStoredFileName,
    normalizedContentType,
    buffer.length,
    sha256,
  );

  return {
    id: assetId,
    kind,
    source_ref: sourceRef,
    original_name: originalName,
    app_name: appName,
    app_slug: appSlug,
    app_target_url: appTargetUrl,
    app_mode: appMode,
    stored_file_name: nextStoredFileName,
    content_type: normalizedContentType,
    size_bytes: buffer.length,
    sha256,
    created_at: now,
    updated_at: now,
  };
}

export async function archiveMediaAsset(options = {}) {
  const asset = insertMediaAssetIndex(options);
  return asset ? toPublicMediaAsset(asset, {
    appIconDir: options.appIconDir,
    brandingDir: options.brandingDir,
  }) : null;
}

export function deleteMediaAssetById(assetId, dbHandle = db) {
  if (!assetId) return 0;
  const result = dbHandle.prepare('DELETE FROM media_assets WHERE id = ?').run(assetId);
  return result.changes || 0;
}

function buildLinkedApp(asset) {
  if (asset.kind !== 'app-icon') return null;
  if (!asset.app_slug && !asset.app_name && !asset.source_ref) return null;
  return {
    id: asset.source_ref || asset.id,
    name: asset.app_name || asset.original_name || asset.app_slug || asset.source_ref || asset.id,
    slug: asset.app_slug || null,
    target_url: asset.app_target_url || null,
    mode: asset.app_mode || null,
  };
}

function mergeLinkedApps(existing, next) {
  const items = Array.isArray(existing) ? [...existing] : [];
  const key = next?.slug || next?.id || next?.name;
  if (!key) return items;
  if (!items.some((item) => (item.slug || item.id || item.name) === key)) {
    items.push(next);
  }
  return items;
}

async function backfillAppIconAssets({
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
} = {}) {
  const apps = dbHandle.prepare(
    'SELECT id, name, slug, target_url, mode, icon_file_name FROM apps WHERE icon_file_name IS NOT NULL AND TRIM(icon_file_name) <> \'\''
  ).all();

  let touched = 0;

  for (const app of apps) {
    const sourcePath = path.join(appIconDir, app.icon_file_name);
    if (!fs.existsSync(sourcePath)) continue;

    const buffer = await fsp.readFile(sourcePath);
    if (!buffer.length) continue;

    const existing = findMediaAssetByStoredFileName(dbHandle, 'app-icon', app.icon_file_name);
    if (existing) continue;

    insertMediaAssetIndex({
      kind: 'app-icon',
      sourceRef: app.id,
      originalName: app.icon_file_name,
      appName: app.name,
      appSlug: app.slug,
      appTargetUrl: app.target_url,
      appMode: app.mode,
      storedFileName: app.icon_file_name,
      contentType: contentTypeFromFilename(app.icon_file_name, 'image/png'),
      buffer,
      dbHandle,
    });
    touched += 1;
  }

  return touched;
}

async function backfillBrandingLogoAssets({
  dbHandle = db,
  brandingDir = BRANDING_ASSET_DIR,
} = {}) {
  const branding = dbHandle.prepare(
    'SELECT logo_file_name, logo_content_type FROM branding_settings WHERE id = ?'
  ).get('default');

  if (!branding?.logo_file_name) {
    return 0;
  }

  const sourcePath = path.join(brandingDir, branding.logo_file_name);
  if (!fs.existsSync(sourcePath)) {
    return 0;
  }

  const buffer = await fsp.readFile(sourcePath);
  if (!buffer.length) {
    return 0;
  }

  const existing = findMediaAssetByStoredFileName(dbHandle, 'branding-logo', branding.logo_file_name);
  if (existing) {
    return 0;
  }

  insertMediaAssetIndex({
    kind: 'branding-logo',
    sourceRef: 'default',
    originalName: branding.logo_file_name,
    storedFileName: branding.logo_file_name,
    contentType: branding.logo_content_type || contentTypeFromFilename(branding.logo_file_name, 'image/png'),
    buffer,
    dbHandle,
  });
  return 1;
}

export async function backfillMediaLibrary(options = {}) {
  const appIconsImported = await backfillAppIconAssets(options);
  const brandingImported = await backfillBrandingLogoAssets(options);

  return {
    appIconsImported,
    brandingImported,
    legacyMediaFilesCopied: 0,
    totalImported: appIconsImported + brandingImported,
  };
}

export function listMediaAssets({
  dbHandle = db,
  kind = null,
  query = null,
  limit = 200,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
} = {}) {
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 200));
  const hasKindFilter = typeof kind === 'string' && kind.trim() !== '';
  const hasQuery = typeof query === 'string' && query.trim() !== '';
  const whereClauses = [];
  const params = [];

  if (hasKindFilter) {
    whereClauses.push('kind = ?');
    params.push(kind.trim());
  }

  if (hasQuery) {
    const like = `%${query.trim().toLowerCase()}%`;
    whereClauses.push(`(
      lower(coalesce(original_name, '')) LIKE ?
      OR lower(coalesce(source_ref, '')) LIKE ?
      OR lower(coalesce(app_name, '')) LIKE ?
      OR lower(coalesce(app_slug, '')) LIKE ?
      OR lower(coalesce(app_target_url, '')) LIKE ?
      OR lower(coalesce(app_mode, '')) LIKE ?
      OR lower(coalesce(content_type, '')) LIKE ?
      OR lower(coalesce(stored_file_name, '')) LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const rows = dbHandle.prepare(`
    SELECT *
    FROM media_assets
    ${whereSql}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params, safeLimit);

  const grouped = new Map();
  for (const row of rows) {
    const asset = toPublicMediaAsset(row, { appIconDir, brandingDir });
    const groupKey = asset.sha256 ? `${asset.kind}:${asset.sha256}` : `${asset.kind}:${asset.id}`;
    const existing = grouped.get(groupKey);
    const linkedApp = buildLinkedApp(asset);

    if (!existing) {
      grouped.set(groupKey, {
        ...asset,
        duplicateCount: 1,
        duplicateAssetIds: [asset.id],
        linkedApps: linkedApp ? [linkedApp] : [],
      });
      continue;
    }

    existing.duplicateCount += 1;
    existing.duplicateAssetIds.push(asset.id);
    existing.linkedApps = mergeLinkedApps(existing.linkedApps, linkedApp);
  }

  return [...grouped.values()];
}

export function getMediaAssetById(assetId, {
  dbHandle = db,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
} = {}) {
  if (!assetId) return null;
  const row = dbHandle.prepare('SELECT * FROM media_assets WHERE id = ?').get(assetId);
  return toPublicMediaAsset(row, { appIconDir, brandingDir });
}

export async function serveMediaAsset(asset, res, {
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
} = {}) {
  if (!asset?.stored_file_name) {
    res.status(404).end();
    return;
  }

  const absolutePath = resolveStoredMediaAssetPath(asset, { appIconDir, brandingDir });
  if (!absolutePath) {
    res.status(404).end();
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Type', asset.content_type || contentTypeFromFilename(asset.stored_file_name));
  res.sendFile(absolutePath);
}
