import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { applySvgSafeHeaders, isSvgBuffer, isSvgContentType, sanitizeSvgBuffer } from './svgSanitize.js';
import { RASTER_ICON_TYPES, normalizeImageContentType } from './imageTypes.js';
import { resolveFileInDir } from './textSanitize.js';

// path.resolve() ensures the configured dir is absolute even when the env var
// uses a relative form like "./data/branding" — required by res.sendFile().
const APP_ICON_CACHE_DIR = path.resolve(process.env.APP_ICON_CACHE_DIR || path.join(process.cwd(), 'data', 'app-icon-cache'));
const BRANDING_ASSET_DIR = path.resolve(process.env.BRANDING_ASSET_DIR || path.join(process.cwd(), 'data', 'branding'));

function extensionFromContentType(contentType) {
  const normalized = (contentType || '').toLowerCase();
  if (normalized.includes('svg')) return 'svg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('bmp')) return 'bmp';
  if (normalized.includes('avif')) return 'avif';
  if (normalized.includes('icon')) return 'ico';
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
    case 'ico':
      return 'image/x-icon';
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
  // A stored name that is not a plain file name (e.g. from a crafted backup) never leaves the asset directory.
  const absolutePath = resolveFileInDir(assetDir, row.stored_file_name);
  return absolutePath && fs.existsSync(absolutePath) ? absolutePath : null;
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
    const sanitized = sanitizeSvgBuffer(Buffer.from(svg, 'utf8'));
    if (!sanitized) return null;
    return {
      buffer: sanitized,
      contentType: 'image/svg+xml',
    };
  }

  const parsed = parseDataUrl(dataUrl);
  if (parsed?.buffer) {
    if (isSvgContentType(parsed.contentType) || isSvgBuffer(parsed.buffer)) {
      const sanitized = sanitizeSvgBuffer(parsed.buffer);
      if (!sanitized) return null;
      return {
        buffer: sanitized,
        contentType: 'image/svg+xml',
      };
    }
    const contentType = normalizeImageContentType(parsed.contentType);
    if (!RASTER_ICON_TYPES.has(contentType)) return null;
    return {
      buffer: parsed.buffer,
      contentType,
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
  const asset = dbHandle.prepare('SELECT * FROM media_assets WHERE id = ?').get(assetId);
  if (!asset) return 0;

  const appUsageCount = asset.kind === 'app-icon' && asset.stored_file_name
    ? (dbHandle.prepare('SELECT COUNT(*) AS count FROM apps WHERE icon_file_name = ?').get(asset.stored_file_name)?.count || 0)
    : 0;
  const brandingUsageCount = asset.kind === 'branding-logo' && asset.stored_file_name
    ? (dbHandle.prepare('SELECT COUNT(*) AS count FROM branding_settings WHERE logo_file_name = ?').get(asset.stored_file_name)?.count || 0)
    : 0;
  const usageCount = appUsageCount + brandingUsageCount;

  if (usageCount > 0) {
    const error = new Error('This asset is still referenced by an app or branding setting');
    error.statusCode = 409;
    error.code = 'MEDIA_ASSET_IN_USE';
    error.usageCount = usageCount;
    throw error;
  }

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
  limit = 25,
  page = 1,
  appIconDir = APP_ICON_CACHE_DIR,
  brandingDir = BRANDING_ASSET_DIR,
} = {}) {
  const safeLimit = Math.min(100, Math.max(25, Number.parseInt(limit, 10) || 25));
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const normalizedKind = typeof kind === 'string' ? kind.trim() : '';
  const isOrphanFilter = normalizedKind === 'orphan';
  const hasKindFilter = normalizedKind !== '' && normalizedKind !== 'all' && !isOrphanFilter;
  const hasQuery = typeof query === 'string' && query.trim() !== '';
  const whereClauses = [];
  const params = [];

  if (hasKindFilter) {
    whereClauses.push('kind = ?');
    params.push(normalizedKind);
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
  `).all(...params);
  const referencedAppFiles = new Set(
    dbHandle.prepare("SELECT icon_file_name FROM apps WHERE icon_file_name IS NOT NULL AND TRIM(icon_file_name) <> ''").all()
      .map((row) => row.icon_file_name)
  );
  const referencedBrandingFiles = new Set(
    dbHandle.prepare("SELECT logo_file_name FROM branding_settings WHERE logo_file_name IS NOT NULL AND TRIM(logo_file_name) <> ''").all()
      .map((row) => row.logo_file_name)
  );

  const grouped = new Map();
  for (const row of rows) {
    const asset = toPublicMediaAsset(row, { appIconDir, brandingDir });
    const groupKey = asset.sha256 ? `${asset.kind}:${asset.sha256}` : `${asset.kind}:${asset.id}`;
    const existing = grouped.get(groupKey);
    const linkedApp = buildLinkedApp(asset);
    const fileExists = asset.fileExists !== false;
    const currentUsage = asset.kind === 'app-icon'
      ? referencedAppFiles.has(asset.stored_file_name)
      : asset.kind === 'branding-logo'
        ? referencedBrandingFiles.has(asset.stored_file_name)
        : false;

    if (!existing) {
      grouped.set(groupKey, {
        ...asset,
        duplicateCount: 1,
        duplicateAssetIds: [asset.id],
        duplicateAssets: [asset],
        linkedApps: linkedApp ? [linkedApp] : [],
        inUse: currentUsage,
        liveCount: fileExists ? 1 : 0,
        orphanCount: fileExists ? 0 : 1,
        hasLiveMembers: fileExists,
        hasOrphanMembers: !fileExists,
        groupSortCreatedAt: asset.created_at || null,
      });
      continue;
    }

    existing.duplicateCount += 1;
    existing.duplicateAssetIds.push(asset.id);
    existing.duplicateAssets.push(asset);
    existing.linkedApps = mergeLinkedApps(existing.linkedApps, linkedApp);
    if (fileExists) {
      existing.liveCount = (existing.liveCount || 0) + 1;
      existing.hasLiveMembers = true;
      if (existing.fileExists === false) {
        const preserved = {
          duplicateCount: existing.duplicateCount,
          duplicateAssetIds: existing.duplicateAssetIds,
          duplicateAssets: existing.duplicateAssets,
          linkedApps: existing.linkedApps,
          inUse: Boolean(existing.inUse || currentUsage),
          liveCount: existing.liveCount,
          orphanCount: existing.orphanCount || 0,
          hasLiveMembers: true,
          hasOrphanMembers: Boolean(existing.orphanCount),
          groupSortCreatedAt: existing.groupSortCreatedAt || asset.created_at || null,
        };
        Object.assign(existing, asset, preserved);
      }
    } else {
      existing.orphanCount = (existing.orphanCount || 0) + 1;
      existing.hasOrphanMembers = true;
      existing.inUse = Boolean(existing.inUse || currentUsage);
    }
  }

  const groupedAssets = [...grouped.values()];
  const visibleAssets = isOrphanFilter
    ? groupedAssets.filter((asset) => asset.hasOrphanMembers)
    : groupedAssets.filter((asset) => (asset.liveCount || 0) > 0);

  visibleAssets.sort((a, b) => {
    const kindA = ['app-icon', 'branding-logo'].indexOf(a.kind);
    const kindB = ['app-icon', 'branding-logo'].indexOf(b.kind);
    if (kindA !== kindB) return kindA - kindB;
    return String(b.groupSortCreatedAt || b.created_at || '').localeCompare(String(a.groupSortCreatedAt || a.created_at || ''));
  });

  const total = visibleAssets.length;
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(safePage, pages);
  const start = (currentPage - 1) * safeLimit;
  const assets = visibleAssets.slice(start, start + safeLimit);

  return {
    assets,
    summary: {
      total,
      appIcon: visibleAssets.filter((asset) => asset.kind === 'app-icon').length,
      brandingLogo: visibleAssets.filter((asset) => asset.kind === 'branding-logo').length,
      orphanAssets: groupedAssets.filter((asset) => asset.hasOrphanMembers).length,
    },
    pagination: {
      page: currentPage,
      pages,
      total,
      limit: safeLimit,
    },
  };
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
  // The type comes from the stored file's extension (always set by Frontdoor),
  // never from the recorded upload type; anything that is not an image is a download.
  const contentType = contentTypeFromFilename(asset.stored_file_name);
  if (isSvgContentType(contentType)) {
    applySvgSafeHeaders(res, asset.stored_file_name);
  } else if (contentType.startsWith('image/')) {
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(asset.stored_file_name).replace(/"/g, '')}"`);
  }
  res.sendFile(absolutePath);
}
