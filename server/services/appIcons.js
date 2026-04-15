import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const DEFAULT_CACHE_DIR = process.env.APP_ICON_CACHE_DIR || path.join(process.cwd(), 'data', 'app-icon-cache');

function ensureCacheDir() {
  if (!fs.existsSync(DEFAULT_CACHE_DIR)) {
    fs.mkdirSync(DEFAULT_CACHE_DIR, { recursive: true });
  }
}

ensureCacheDir();

function iconPath(appId, extension) {
  return path.join(DEFAULT_CACHE_DIR, `${appId}.${extension}`);
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

export function iconUrlForApp(app) {
  if (!app?.icon_file_name || !app?.id) return null;
  const absolutePath = path.join(DEFAULT_CACHE_DIR, app.icon_file_name);
  if (!fs.existsSync(absolutePath)) return null;
  const version = app.updated_at ? `?v=${encodeURIComponent(app.updated_at)}` : '';
  return `/api/apps/${encodeURIComponent(app.id)}/icon${version}`;
}

export function isAppIconAsset(app) {
  return Boolean(app?.icon_file_name);
}

export async function saveAppIconAsset(appId, source) {
  if (!appId || !source?.buffer) return null;

  const extension = extensionFromContentType(source.contentType);
  const fileName = `${appId}.${extension}`;
  const absolutePath = iconPath(appId, extension);

  await fsp.writeFile(absolutePath, source.buffer);

  const entries = await fsp.readdir(DEFAULT_CACHE_DIR).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(`${appId}.`) && entry !== fileName)
      .map((entry) => fsp.rm(path.join(DEFAULT_CACHE_DIR, entry), { force: true }))
  );

  return { fileName };
}

export async function removeAppIconAsset(appId) {
  if (!appId) return;
  const entries = await fsp.readdir(DEFAULT_CACHE_DIR).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(`${appId}.`))
      .map((entry) => fsp.rm(path.join(DEFAULT_CACHE_DIR, entry), { force: true }))
  );
}

export function parseAppIconPayload({ iconDataUrl, iconSvgText }) {
  const svgText = typeof iconSvgText === 'string' ? iconSvgText.trim() : '';
  if (/<svg[\s>]/i.test(svgText)) {
    return {
      buffer: Buffer.from(svgText, 'utf8'),
      contentType: 'image/svg+xml',
    };
  }

  const parsed = parseDataUrl(iconDataUrl);
  if (parsed?.buffer) {
    return {
      buffer: parsed.buffer,
      contentType: parsed.contentType,
    };
  }

  return null;
}

export async function serveAppIconForApp(app, res) {
  if (!app?.icon_file_name) {
    return res.status(404).end();
  }

  const absolutePath = path.join(DEFAULT_CACHE_DIR, app.icon_file_name);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).end();
  }

  const extension = path.extname(app.icon_file_name).slice(1);
  res.type(contentTypeFromExtension(extension));
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(absolutePath);
}
