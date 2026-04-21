import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import db from '../db.js';

const BRANDING_ID = 'default';
const BRANDING_ASSET_DIR = process.env.BRANDING_ASSET_DIR || path.join(process.cwd(), 'data', 'branding');
const DEFAULT_BRANDING = {
  heroTitleLine1: 'Le tue applicazioni,',
  heroTitleLine2: 'tutte in un unico posto.',
  heroSubtitle: 'Accedi rapidamente a tutti gli strumenti e le piattaforme del tuo workspace.',
  showHomeHero: true,
  showAppModeBadges: true,
  defaultCompactView: false,
  logRetentionDays: 90,
  hideLoginPage: false,
  showSharedCookieMode: true,
  showRedirectSsoMode: true,
  showEntraAppMode: true,
  logoUrl: null,
};

function ensureAssetDir() {
  if (!fs.existsSync(BRANDING_ASSET_DIR)) {
    fs.mkdirSync(BRANDING_ASSET_DIR, { recursive: true });
  }
}

ensureAssetDir();

function normalizeText(value, fallback) {
  const text = (value ?? '').toString().trim();
  return text || fallback;
}

function normalizeRetentionDays(value, fallback = 90) {
  if (value === undefined || value === null || value === '') return fallback;
  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days)) return fallback;
  return Math.min(90, Math.max(0, days));
}

function getStoredBrandingRow() {
  return db.prepare('SELECT * FROM branding_settings WHERE id = ?').get(BRANDING_ID);
}

function toPublicBranding(row) {
  const logoVersion = row?.updated_at ? encodeURIComponent(row.updated_at) : null;
  return {
    heroTitleLine1: normalizeText(row?.hero_title_line1, DEFAULT_BRANDING.heroTitleLine1),
    heroTitleLine2: normalizeText(row?.hero_title_line2, DEFAULT_BRANDING.heroTitleLine2),
    heroSubtitle: normalizeText(row?.hero_subtitle, DEFAULT_BRANDING.heroSubtitle),
    showHomeHero: row?.show_home_hero !== 0,
    showAppModeBadges: row?.show_app_mode_badges !== 0,
    defaultCompactView: row?.default_compact_view !== 0,
    logRetentionDays: normalizeRetentionDays(row?.log_retention_days, DEFAULT_BRANDING.logRetentionDays),
    hideLoginPage: row?.hide_login_page !== 0,
    showSharedCookieMode: row?.show_shared_cookie_mode !== 0,
    showRedirectSsoMode: row?.show_redirect_sso_mode !== 0,
    showEntraAppMode: row?.show_entra_app_mode !== 0,
    logoUrl: row?.logo_file_name ? `/api/branding/logo?v=${logoVersion || Date.now()}` : null,
    updatedAt: row?.updated_at || null,
  };
}

function parseLogoDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('logo must be a base64 data URL');
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,(.+)$/i);
  if (!match) {
    throw new Error('logo must be a PNG, JPEG, WEBP, GIF, or SVG image');
  }

  const contentType = match[1].toLowerCase().replace('jpg', 'jpeg');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    throw new Error('logo image is empty');
  }

  return { contentType, buffer };
}

function extensionFromContentType(contentType) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('svg')) return 'svg';
  return 'jpg';
}

async function removeExistingLogoFiles(keepFileName = null) {
  const entries = await fsp.readdir(BRANDING_ASSET_DIR).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith('company-logo.'))
      .filter((entry) => entry !== keepFileName)
      .map((entry) => fsp.rm(path.join(BRANDING_ASSET_DIR, entry), { force: true }))
  );
}

async function saveLogo(dataUrl) {
  const { contentType, buffer } = parseLogoDataUrl(dataUrl);
  const extension = extensionFromContentType(contentType);
  const fileName = `company-logo.${extension}`;
  const filePath = path.join(BRANDING_ASSET_DIR, fileName);

  await fsp.writeFile(filePath, buffer);
  await removeExistingLogoFiles(fileName);

  return { fileName, contentType };
}

export function getBrandingSettings() {
  const row = getStoredBrandingRow();
  if (!row) {
    return { ...DEFAULT_BRANDING, logoUrl: null };
  }

  return toPublicBranding(row);
}

export async function updateBrandingSettings(input = {}) {
  const current = getStoredBrandingRow();
  const heroTitleLine1 = normalizeText(input.heroTitleLine1, current?.hero_title_line1 || DEFAULT_BRANDING.heroTitleLine1);
  const heroTitleLine2 = normalizeText(input.heroTitleLine2, current?.hero_title_line2 || DEFAULT_BRANDING.heroTitleLine2);
  const heroSubtitle = normalizeText(input.heroSubtitle, current?.hero_subtitle || DEFAULT_BRANDING.heroSubtitle);
  const showHomeHero = input.showHomeHero === undefined
    ? (current?.show_home_hero ?? 1)
    : (input.showHomeHero ? 1 : 0);
  const showAppModeBadges = input.showAppModeBadges === undefined
    ? (current?.show_app_mode_badges ?? 1)
    : (input.showAppModeBadges ? 1 : 0);
  const defaultCompactView = input.defaultCompactView === undefined
    ? (current?.default_compact_view ?? 0)
    : (input.defaultCompactView ? 1 : 0);
  const logRetentionDays = input.logRetentionDays === undefined
    ? (current?.log_retention_days ?? DEFAULT_BRANDING.logRetentionDays)
    : normalizeRetentionDays(input.logRetentionDays, DEFAULT_BRANDING.logRetentionDays);
  const hideLoginPage = input.hideLoginPage === undefined
    ? (current?.hide_login_page ?? 0)
    : (input.hideLoginPage ? 1 : 0);
  const showSharedCookieMode = input.showSharedCookieMode === undefined
    ? (current?.show_shared_cookie_mode ?? 1)
    : (input.showSharedCookieMode ? 1 : 0);
  const showRedirectSsoMode = input.showRedirectSsoMode === undefined
    ? (current?.show_redirect_sso_mode ?? 1)
    : (input.showRedirectSsoMode ? 1 : 0);
  const showEntraAppMode = input.showEntraAppMode === undefined
    ? (current?.show_entra_app_mode ?? 1)
    : (input.showEntraAppMode ? 1 : 0);

  let logoFileName = current?.logo_file_name || null;
  let logoContentType = current?.logo_content_type || null;

  if (input.removeLogo) {
    await removeExistingLogoFiles();
    logoFileName = null;
    logoContentType = null;
  } else if (input.logoDataUrl) {
    const logo = await saveLogo(input.logoDataUrl);
    logoFileName = logo.fileName;
    logoContentType = logo.contentType;
  }

  db.prepare(`
    INSERT INTO branding_settings (
      id, hero_title_line1, hero_title_line2, hero_subtitle, show_home_hero, show_app_mode_badges, default_compact_view, log_retention_days, hide_login_page, show_shared_cookie_mode, show_redirect_sso_mode, show_entra_app_mode, logo_file_name, logo_content_type, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      hero_title_line1 = excluded.hero_title_line1,
      hero_title_line2 = excluded.hero_title_line2,
      hero_subtitle = excluded.hero_subtitle,
      show_home_hero = excluded.show_home_hero,
      show_app_mode_badges = excluded.show_app_mode_badges,
      default_compact_view = excluded.default_compact_view,
      log_retention_days = excluded.log_retention_days,
      hide_login_page = excluded.hide_login_page,
      show_shared_cookie_mode = excluded.show_shared_cookie_mode,
      show_redirect_sso_mode = excluded.show_redirect_sso_mode,
      show_entra_app_mode = excluded.show_entra_app_mode,
      logo_file_name = excluded.logo_file_name,
      logo_content_type = excluded.logo_content_type,
      updated_at = datetime('now')
  `).run(
    BRANDING_ID,
    heroTitleLine1,
    heroTitleLine2,
    heroSubtitle,
    showHomeHero,
    showAppModeBadges,
    defaultCompactView,
    logRetentionDays,
    hideLoginPage,
    showSharedCookieMode,
    showRedirectSsoMode,
    showEntraAppMode,
    logoFileName,
    logoContentType
  );

  return getBrandingSettings();
}

export function getBrandingLogoPath() {
  const row = getStoredBrandingRow();
  if (!row?.logo_file_name) return null;
  return path.join(BRANDING_ASSET_DIR, row.logo_file_name);
}

export function getBrandingLogoContentType() {
  const row = getStoredBrandingRow();
  return row?.logo_content_type || null;
}

export function brandingLogoExists() {
  const logoPath = getBrandingLogoPath();
  return logoPath ? fs.existsSync(logoPath) : false;
}

export async function serveBrandingLogo(res) {
  const logoPath = getBrandingLogoPath();
  if (!logoPath || !fs.existsSync(logoPath)) {
    res.status(404).end();
    return;
  }

  const contentType = getBrandingLogoContentType() || 'image/png';
  res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
  res.setHeader('Content-Type', contentType);
  res.sendFile(logoPath);
}

export { BRANDING_ASSET_DIR, DEFAULT_BRANDING };
