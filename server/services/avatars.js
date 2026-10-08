import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';

// path.resolve() normalizes a relative env value to an absolute path so
// res.sendFile() in serveAvatarForUser accepts it without throwing.
const DEFAULT_CACHE_DIR = path.resolve(process.env.AVATAR_CACHE_DIR || path.join(process.cwd(), 'data', 'avatar-cache'));
const DEFAULT_TTL_DAYS = Number(process.env.AVATAR_CACHE_TTL_DAYS || 14);
const NONE_TTL_DAYS = Number(process.env.AVATAR_CACHE_MISS_TTL_DAYS || 30);
const GRAPH_APP_SCOPES = ['https://graph.microsoft.com/.default'];

let cachedGraphAppClient = null;
let cachedGraphAppToken = null;
let cachedGraphAppTokenExpiresAt = 0;

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

function escapeXml(value) {
  return (value || '').toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function gravatarHash(email) {
  return crypto.createHash('md5').update(normalizeEmail(email)).digest('hex');
}

function getInitials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

function buildFallbackAvatarSvg(user = {}) {
  const resolvedDisplayName = user.displayName || user.display_name || '';
  const resolvedEmail = user.email || '';
  const resolvedAvatarColor = user.avatarColor || user.avatar_color || '#666666';
  const accessibleLabel = resolvedDisplayName || resolvedEmail || 'User';
  const initials = escapeXml(getInitials(resolvedDisplayName || resolvedEmail));
  const background = escapeXml(resolvedAvatarColor);

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${escapeXml(accessibleLabel)} avatar">
  <rect width="256" height="256" rx="128" fill="${background}" />
  <text
    x="128"
    y="138"
    text-anchor="middle"
    dominant-baseline="middle"
    fill="#ffffff"
    font-family="Inter, Segoe UI, Arial, sans-serif"
    font-size="96"
    font-weight="700"
    letter-spacing="-2"
  >${initials}</text>
</svg>
`, 'utf8');
}

function extensionFromContentType(contentType) {
  const normalized = (contentType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('gif')) return 'gif';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  return 'jpg';
}

function getGraphAppClient() {
  if (cachedGraphAppClient) return cachedGraphAppClient;
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
    return null;
  }

  cachedGraphAppClient = new ConfidentialClientApplication({
    auth: {
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
      authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    },
  });

  return cachedGraphAppClient;
}

async function acquireGraphAppToken() {
  if (cachedGraphAppToken && Date.now() < cachedGraphAppTokenExpiresAt) {
    return cachedGraphAppToken;
  }

  const client = getGraphAppClient();
  if (!client) return null;

  const response = await client.acquireTokenByClientCredential({ scopes: GRAPH_APP_SCOPES });
  const accessToken = response?.accessToken || null;
  const expiresIn = Number(response?.expiresIn || 0);

  if (accessToken) {
    cachedGraphAppToken = accessToken;
    cachedGraphAppTokenExpiresAt = Date.now() + Math.max(60_000, (expiresIn || 0) * 1000 - 60_000);
  }

  return accessToken;
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

async function removeOldAvatarFiles(userId, keepFileName, cacheDir = DEFAULT_CACHE_DIR) {
  const entries = await fsp.readdir(cacheDir).catch(() => []);
  const keepBaseName = path.basename(keepFileName);
  const userPrefix = `${userId}.`;
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(userPrefix) && entry !== keepBaseName && !entry.endsWith('.json'))
      .map((entry) => fsp.rm(path.join(cacheDir, entry), { force: true }))
  );
}

async function clearAvatarCache(cacheDir = DEFAULT_CACHE_DIR) {
  const entries = await fsp.readdir(cacheDir).catch(() => []);
  const removed = entries.length;

  await Promise.all(entries.map((entry) => fsp.rm(path.join(cacheDir, entry), { force: true })));

  return { removed };
}

export async function getAvatarCacheStats({ cacheDir = DEFAULT_CACHE_DIR } = {}) {
  const entries = await fsp.readdir(cacheDir).catch(() => []);
  const files = entries.filter((entry) => !entry.endsWith('.json'));
  const details = await Promise.all(files.map(async (entry) => {
    const absolutePath = path.join(cacheDir, entry);
    try {
      const stats = await fsp.stat(absolutePath);
      return { size: stats.size };
    } catch {
      return { size: 0 };
    }
  }));
  return {
    files: files.length,
    bytes: details.reduce((sum, item) => sum + (item.size || 0), 0),
  };
}

async function saveAvatarBuffer(userId, buffer, contentType, source) {
  const extension = extensionFromContentType(contentType);
  const fileName = `${path.basename(userCachePrefix(userId))}.${extension}`;
  const absoluteFile = filePath(userId, extension);
  // An unchanged photo keeps its file (and modification time); only the check time is refreshed.
  const current = await fsp.readFile(absoluteFile).catch(() => null);
  if (!current || !current.equals(buffer)) {
    await fsp.writeFile(absoluteFile, buffer);
  }

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

const AVATAR_FETCH_TIMEOUT_MS = 10_000;

// Downloads an avatar image; a missing photo, an error or a slow host all mean "no photo",
// so avatar lookups can never hold up a sign-in or a page.
async function fetchAvatarImage(url, headers = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(AVATAR_FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function fetchGraphPhoto(accessToken) {
  return fetchAvatarImage('https://graph.microsoft.com/v1.0/me/photo/$value', { Authorization: `Bearer ${accessToken}` });
}

async function fetchGraphUserPhoto(userKey, accessToken) {
  return fetchAvatarImage(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userKey)}/photo/$value`,
    { Authorization: `Bearer ${accessToken}` },
  );
}

async function fetchGravatar(email) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) return null;

  const hash = gravatarHash(cleanEmail);
  return fetchAvatarImage(`https://www.gravatar.com/avatar/${hash}?s=256&d=404&r=g`);
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
  const graphUserKey = user.microsoft_id || user.email;
  if (meta) {
    if (!fileExists) {
      if (meta.source === 'm365' && !accessToken && !graphUserKey) {
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
      // A fresh Gravatar is kept; only a sign-in (which brings a user token) tries
      // to replace it with the Microsoft 365 photo. Stale ones are refreshed below.
      if (meta.source === 'gravatar' && isMetaFresh(meta)) {
        if (accessToken) {
          const graphToken = accessToken;
          if (graphToken && graphUserKey) {
            const microsoftPhoto = await fetchGraphUserPhoto(graphUserKey, graphToken);
            if (microsoftPhoto?.buffer) {
              return saveAvatarBuffer(user.id, microsoftPhoto.buffer, microsoftPhoto.contentType, 'm365');
            }
          }
        }
        return meta;
      }
    }
  }

  const graphToken = accessToken || await acquireGraphAppToken().catch(() => null);
  if (graphToken && graphUserKey) {
    const microsoftPhoto = await fetchGraphUserPhoto(graphUserKey, graphToken);
    if (microsoftPhoto?.buffer) {
      return saveAvatarBuffer(user.id, microsoftPhoto.buffer, microsoftPhoto.contentType, 'm365');
    }
  } else if (accessToken) {
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

  const userKey = user.microsoft_id || user.email;
  const graphToken = accessToken || await acquireGraphAppToken().catch(() => null);
  if (graphToken && userKey) {
    const microsoftPhoto = await fetchGraphUserPhoto(userKey, graphToken);
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

export async function serveAvatarForUser(user, res) {
  const status = await getAvatarStatus(user.id);
  if (!status) {
    const fallbackAvatar = buildFallbackAvatarSvg(user);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.status(200).send(fallbackAvatar);
    return;
  }

  res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
  res.setHeader('Content-Type', status.contentType || 'image/jpeg');
  res.sendFile(path.join(DEFAULT_CACHE_DIR, status.fileName));
}

export { DEFAULT_CACHE_DIR as AVATAR_CACHE_DIR };
export { clearAvatarCache };
