import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { archiveMediaAsset } from './mediaAssets.js';
import { applySvgSafeHeaders, isSvgBuffer, isSvgContentType, sanitizeSvgBuffer } from './svgSanitize.js';
import { UserFacingError } from './errors.js';
import { RASTER_ICON_TYPES, normalizeImageContentType } from './imageTypes.js';

// path.resolve() normalizes a relative env value (e.g. "./data/app-icon-cache")
// to an absolute path so res.sendFile() in serveAppIconForApp does not reject it.
const DEFAULT_CACHE_DIR = path.resolve(process.env.APP_ICON_CACHE_DIR || path.join(process.cwd(), 'data', 'app-icon-cache'));

function ensureCacheDir() {
  if (!fs.existsSync(DEFAULT_CACHE_DIR)) {
    fs.mkdirSync(DEFAULT_CACHE_DIR, { recursive: true });
  }
}

ensureCacheDir();

function iconPath(cacheDir, fileName) {
  return path.join(cacheDir, fileName);
}

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
  return 'png';
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

export function iconUrlForApp(app, { cacheDir = DEFAULT_CACHE_DIR } = {}) {
  if (!app?.icon_file_name || !app?.id) return null;
  const absolutePath = path.join(cacheDir, app.icon_file_name);
  if (!fs.existsSync(absolutePath)) return null;
  const version = app.updated_at ? `?v=${encodeURIComponent(app.updated_at)}` : '';
  return `/api/apps/${encodeURIComponent(app.id)}/icon${version}`;
}

export function isAppIconAsset(app) {
  return Boolean(app?.icon_file_name);
}

export async function saveAppIconAsset(appId, source, appMeta = null, { cacheDir = DEFAULT_CACHE_DIR, dbHandle = db, currentFileName = null } = {}) {
  if (!appId || !source?.buffer) return null;

  // The same image sent again (e.g. a form saved with its current icon) keeps the stored file.
  if (currentFileName) {
    const current = await fsp.readFile(iconPath(cacheDir, currentFileName)).catch(() => null);
    if (current && current.equals(source.buffer)) return { fileName: currentFileName };
  }

  const extension = extensionFromContentType(source.contentType);
  const fileName = `${appId}.${Date.now()}.${uuidv4().slice(0, 8)}.${extension}`;
  const absolutePath = iconPath(cacheDir, fileName);

  await fsp.writeFile(absolutePath, source.buffer);
  await archiveMediaAsset({
    kind: 'app-icon',
    sourceRef: appId,
    originalName: fileName,
    appName: appMeta?.name || null,
    appSlug: appMeta?.slug || null,
    appTargetUrl: appMeta?.target_url || null,
    appMode: appMeta?.mode || null,
    storedFileName: fileName,
    contentType: source.contentType,
    buffer: source.buffer,
    dbHandle,
  });

  return { fileName };
}

export async function removeAppIconAsset(appId) {
  if (!appId) return;
  // Intentionally keep historical icon files as cache history.
  // The admin cache cleanup sweeps only unreferenced files later.
}

export async function duplicateAppIconAsset(sourceAppId, targetAppId, { cacheDir = DEFAULT_CACHE_DIR } = {}) {
  if (!sourceAppId || !targetAppId) return null;

  const entries = await fsp.readdir(cacheDir).catch(() => []);
  const sourceEntry = entries
    .filter((entry) => entry.startsWith(`${sourceAppId}.`))
    .sort()
    .at(-1);
  if (!sourceEntry) return null;

  const sourcePath = path.join(cacheDir, sourceEntry);
  const extension = path.extname(sourceEntry).slice(1).toLowerCase() || 'png';
  const targetFileName = `${targetAppId}.${Date.now()}.${uuidv4().slice(0, 8)}.${extension}`;
  const targetPath = path.join(cacheDir, targetFileName);

  await fsp.copyFile(sourcePath, targetPath);
  return { fileName: targetFileName };
}

export async function readAppIconAssetDataUrl(app, { cacheDir = DEFAULT_CACHE_DIR } = {}) {
  if (!app?.icon_file_name || !app?.id) return '';

  const absolutePath = path.join(cacheDir, app.icon_file_name);
  if (!fs.existsSync(absolutePath)) return '';

  const buffer = await fsp.readFile(absolutePath);
  const extension = path.extname(app.icon_file_name).slice(1).toLowerCase();
  const contentType = contentTypeFromExtension(extension);
  const base64 = buffer.toString('base64');
  return `data:${contentType};base64,${base64}`;
}

export function parseAppIconPayload({ iconDataUrl, iconSvgText }) {
  const svgText = typeof iconSvgText === 'string' ? iconSvgText.trim() : '';
  if (/<svg[\s>]/i.test(svgText)) {
    const sanitized = sanitizeSvgBuffer(Buffer.from(svgText, 'utf8'));
    if (!sanitized) return null;
    return {
      buffer: sanitized,
      contentType: 'image/svg+xml',
    };
  }

  const parsed = parseDataUrl(iconDataUrl);
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
    if (!RASTER_ICON_TYPES.has(contentType)) {
      throw new UserFacingError('icon must be a PNG, JPEG, GIF, WEBP, BMP, AVIF, ICO or SVG image', { code: 'icon_unsupported_type' });
    }
    return {
      buffer: parsed.buffer,
      contentType,
    };
  }

  return null;
}

export async function serveAppIconForApp(app, res, { cacheDir = DEFAULT_CACHE_DIR } = {}) {
  if (!app?.icon_file_name) {
    return res.status(404).end();
  }

  const absolutePath = path.join(cacheDir, app.icon_file_name);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).end();
  }

  const extension = path.extname(app.icon_file_name).slice(1);
  const contentType = contentTypeFromExtension(extension);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (isSvgContentType(contentType)) {
    applySvgSafeHeaders(res, app.icon_file_name);
  } else {
    res.type(contentType);
  }
  return res.sendFile(absolutePath);
}

async function readAppIconCacheEntries(dbHandle = db, { cacheDir = DEFAULT_CACHE_DIR } = {}) {
  const entries = await fsp.readdir(cacheDir).catch(() => []);
  const files = entries.filter((entry) => !entry.endsWith('.json'));
  const stats = await Promise.all(files.map(async (entry) => {
    const absolutePath = path.join(cacheDir, entry);
    try {
      const fileStats = await fsp.stat(absolutePath);
      return { entry, absolutePath, size: fileStats.size };
    } catch {
      return { entry, absolutePath, size: 0 };
    }
  }));

  const referencedFiles = new Set();
  if (dbHandle) {
    const currentIcons = dbHandle.prepare('SELECT icon_file_name FROM apps WHERE icon_file_name IS NOT NULL AND TRIM(icon_file_name) <> \'\'').all();
    for (const row of currentIcons) {
      referencedFiles.add(row.icon_file_name);
    }

    const indexedIcons = dbHandle.prepare("SELECT stored_file_name FROM media_assets WHERE kind = 'app-icon'").all();
    for (const row of indexedIcons) {
      if (row?.stored_file_name) referencedFiles.add(row.stored_file_name);
    }
  }

  return {
    files: stats,
    referencedFiles,
  };
}

export async function getAppIconCacheStats({ dbHandle = db, cacheDir = DEFAULT_CACHE_DIR } = {}) {
  const { files, referencedFiles } = await readAppIconCacheEntries(dbHandle, { cacheDir });
  const currentFiles = files.filter(({ entry }) => referencedFiles.has(entry));
  const orphanFiles = files.filter(({ entry }) => !referencedFiles.has(entry));

  const sumBytes = (list) => list.reduce((total, item) => total + (item.size || 0), 0);

  return {
    totalFiles: files.length,
    totalBytes: sumBytes(files),
    currentFiles: currentFiles.length,
    currentBytes: sumBytes(currentFiles),
    orphanFiles: orphanFiles.length,
    orphanBytes: sumBytes(orphanFiles),
  };
}

export async function cleanupAppIconCache({ dbHandle = db, cacheDir = DEFAULT_CACHE_DIR } = {}) {
  const { files, referencedFiles } = await readAppIconCacheEntries(dbHandle, { cacheDir });
  const orphanFiles = files.filter(({ entry }) => !referencedFiles.has(entry));
  await Promise.all(orphanFiles.map(({ absolutePath }) => fsp.rm(absolutePath, { force: true })));
  const removedBytes = orphanFiles.reduce((total, item) => total + (item.size || 0), 0);
  return {
    removed: orphanFiles.length,
    removedBytes,
  };
}

export { DEFAULT_CACHE_DIR as APP_ICON_CACHE_DIR };
