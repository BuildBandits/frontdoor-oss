import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_CACHE_DIR = process.env.AVATAR_CACHE_DIR || path.join(process.cwd(), 'data', 'avatar-cache');
const DEFAULT_TTL_DAYS = Number(process.env.AVATAR_CACHE_TTL_DAYS || 14);
const NONE_TTL_DAYS = Number(process.env.AVATAR_CACHE_MISS_TTL_DAYS || 30);

function ensureCacheDir() {
  if (!fs.existsSync(DEFAULT_CACHE_DIR)) {
    fs.mkdirSync(DEFAULT_CACHE_DIR, { recursive: true });
  }
}

ensureCacheDir();

function userCachePrefix(userId) {
  return path.join(DEFAULT_CACHE_DIR, userId);
}

function metaPath(userId) {
  return `${userCachePrefix(userId)}.json`;
}

function filePath(userId, extension) {
  return `${userCachePrefix(userId)}.${extension}`;
}

function ttlMsForSource(source) {
  if (source === 'none') return NONE_TTL_DAYS * 24 * 60 * 60 * 1000;
  return DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
}

function normalizeEmail(email) {
  return (email || '').toString().trim().toLowerCase();
}

function gravatarHash(email) {
  return crypto.createHash('md5').update(normalizeEmail(email)).digest('hex');
}

function extensionFromContentType(contentType) {
  const normalized = (contentType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  return 'jpg';
}

async function readMeta(userId) {
  try {
    const raw = await fsp.readFile(metaPath(userId), 'utf8');
    const meta = JSON.parse(raw);
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

async function writeMeta(userId, meta) {
  await fsp.writeFile(metaPath(userId), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

async function removeOldAvatarFiles(userId, keepFileName) {
  const entries = await fsp.readdir(DEFAULT_CACHE_DIR).catch(() => []);
  const keepBaseName = path.basename(keepFileName);
  const userPrefix = `${userId}.`;
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(userPrefix) && entry !== keepBaseName && !entry.endsWith('.json'))
      .map((entry) => fsp.rm(path.join(DEFAULT_CACHE_DIR, entry), { force: true }))
  );
}

async function saveAvatarBuffer(userId, buffer, contentType, source) {
  const extension = extensionFromContentType(contentType);
  const fileName = `${path.basename(userCachePrefix(userId))}.${extension}`;
  const absoluteFile = filePath(userId, extension);
  await fsp.writeFile(absoluteFile, buffer);

  const meta = {
    source,
    fileName,
    contentType: contentType || (extension === 'png' ? 'image/png' : 'image/jpeg'),
    checkedAt: new Date().toISOString(),
  };

  await writeMeta(userId, meta);
  await removeOldAvatarFiles(userId, fileName);
  return meta;
}

function isMetaFresh(meta) {
  if (!meta?.checkedAt) return false;
  const checkedAt = new Date(meta.checkedAt).getTime();
  if (Number.isNaN(checkedAt)) return false;
  return Date.now() - checkedAt < ttlMsForSource(meta.source);
}

async function getAvatarFileInfo(userId) {
  const meta = await readMeta(userId);
  if (!meta?.fileName) return { meta: meta || null, fileExists: false, absolutePath: null };

  const absolutePath = path.join(DEFAULT_CACHE_DIR, meta.fileName);
  const fileExists = fs.existsSync(absolutePath);
  return { meta, fileExists, absolutePath };
}

async function fetchGraphPhoto(accessToken) {
  const response = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

async function fetchGraphUserPhoto(userKey, accessToken) {
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userKey)}/photo/$value`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

async function fetchGravatar(email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return null;

  const hash = gravatarHash(cleanEmail);
  const url = `https://www.gravatar.com/avatar/${hash}?s=256&d=404&r=g`;
  const response = await fetch(url);

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

export function getAvatarRoute(userId) {
  return `/api/users/${encodeURIComponent(userId)}/avatar`;
}

export async function getAvatarStatus(userId) {
  const { meta, fileExists, absolutePath } = await getAvatarFileInfo(userId);
  if (!meta || !fileExists || meta.source === 'none') {
    return null;
  }

  const stats = await fsp.stat(absolutePath);
  return {
    source: meta.source,
    contentType: meta.contentType,
    checkedAt: meta.checkedAt,
    updatedAt: stats.mtime.toISOString(),
    fileName: meta.fileName,
  };
}

export async function ensureAvatarCached(user, accessToken = null) {
  if (!user?.id) return null;

  const { meta, fileExists } = await getAvatarFileInfo(user.id);
  if (meta) {
    if (!fileExists) {
      if (meta.source === 'm365' && !accessToken) {
        return null;
      }
      if (meta.source === 'none' && isMetaFresh(meta)) {
        return null;
      }
    }

    if (fileExists) {
      if (meta.source === 'none' && isMetaFresh(meta)) {
        return null;
      }
      if (meta.source === 'm365') {
        if (accessToken && !isMetaFresh(meta)) {
          const microsoftPhoto = await fetchGraphPhoto(accessToken);
          if (microsoftPhoto?.buffer) {
            return saveAvatarBuffer(user.id, microsoftPhoto.buffer, microsoftPhoto.contentType, 'm365');
          }
        }
        return meta;
      }
      if (meta.source === 'gravatar' && isMetaFresh(meta)) {
        return meta;
      }
    }
  }

  if (accessToken) {
    const microsoftPhoto = await fetchGraphPhoto(accessToken);
    if (microsoftPhoto?.buffer) {
      return saveAvatarBuffer(user.id, microsoftPhoto.buffer, microsoftPhoto.contentType, 'm365');
    }
  }

  const gravatarPhoto = await fetchGravatar(user.email);
  if (gravatarPhoto?.buffer) {
    return saveAvatarBuffer(user.id, gravatarPhoto.buffer, gravatarPhoto.contentType, 'gravatar');
  }

  const missMeta = {
    source: 'none',
    checkedAt: new Date().toISOString(),
  };
  await writeMeta(user.id, missMeta);
  return null;
}

export async function prewarmAvatarCacheForUser(user, accessToken = null) {
  if (!user?.id) return null;

  const { meta, fileExists } = await getAvatarFileInfo(user.id);
  if (meta && fileExists && isMetaFresh(meta)) {
    return meta.source === 'none' ? null : meta;
  }

  if (accessToken) {
    const userKey = user.microsoft_id || user.email;
    if (userKey) {
      const microsoftPhoto = await fetchGraphUserPhoto(userKey, accessToken);
      if (microsoftPhoto?.buffer) {
        return saveAvatarBuffer(user.id, microsoftPhoto.buffer, microsoftPhoto.contentType, 'm365');
      }
    }
  }

  const gravatarPhoto = await fetchGravatar(user.email);
  if (gravatarPhoto?.buffer) {
    return saveAvatarBuffer(user.id, gravatarPhoto.buffer, gravatarPhoto.contentType, 'gravatar');
  }

  const missMeta = {
    source: 'none',
    checkedAt: new Date().toISOString(),
  };
  await writeMeta(user.id, missMeta);
  return null;
}

export async function serveAvatarForUser(user, res) {
  const status = await getAvatarStatus(user.id);
  if (!status) {
    res.status(404).end();
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
  res.setHeader('Content-Type', status.contentType || 'image/jpeg');
  res.sendFile(path.join(DEFAULT_CACHE_DIR, status.fileName));
}

export { DEFAULT_CACHE_DIR as AVATAR_CACHE_DIR };
