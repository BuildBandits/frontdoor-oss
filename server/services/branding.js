import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, isSupportedLanguage } from '../../shared/languages.js';
import { DEFAULT_COLOR_SCHEME, normalizeColorScheme } from '../../shared/colorSchemes.js';
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from '../../shared/timeZones.js';
import { archiveMediaAsset } from './mediaAssets.js';
import { applySvgSafeHeaders, isSvgContentType, sanitizeSvgBuffer } from './svgSanitize.js';
import { UserFacingError } from './errors.js';

const BRANDING_ID = 'default';
// path.resolve() normalizes a relative env value to an absolute path so
// res.sendFile() in serveBrandingLogo accepts it without throwing.
const BRANDING_ASSET_DIR = path.resolve(process.env.BRANDING_ASSET_DIR || path.join(process.cwd(), 'data', 'branding'));
const DEFAULT_BRANDING = {
  heroTitleLine1: 'Your apps,',
  heroTitleLine2: 'all in one place.',
  heroSubtitle: 'Quickly access all the tools and platforms in your workspace.',
  heroTitleLine1I18n: {},
  heroTitleLine2I18n: {},
  heroSubtitleI18n: {},
  showHomeHero: true,
  hideHomeHeroOnMobile: false,
  showAppModeBadges: true,
  defaultHomeDesktopView: 'cards',
  defaultCompactView: false,
  defaultLanguage: DEFAULT_LANGUAGE,
  defaultColorScheme: DEFAULT_COLOR_SCHEME,
  defaultTimeZone: DEFAULT_TIME_ZONE,
  enableDarkModeBeta: false,
  useEuropeanDateFormat: false,
  use24hTimeFormat: false,
  logRetentionDays: 90,
  hideLoginPage: false,
  showSharedCookieMode: true,
  showRedirectSsoMode: true,
  showEntraAppMode: true,
  pluginsEnabled: false,
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

function normalizeLanguage(value, fallback = DEFAULT_LANGUAGE) {
  return isSupportedLanguage(value) ? value : fallback;
}

// Sanitize an arbitrary object into a { [supportedLangCode]: trimmedNonEmptyString } map.
// Unsupported languages and empty strings are dropped.
function sanitizeI18nMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const code of SUPPORTED_LANGUAGE_CODES) {
    const text = (value[code] ?? '').toString().trim();
    if (text) out[code] = text;
  }
  return out;
}

function parseI18nMap(jsonText) {
  if (!jsonText) return {};
  try {
    return sanitizeI18nMap(JSON.parse(jsonText));
  } catch {
    return {};
  }
}

function serializeI18nMap(map) {
  return Object.keys(map).length ? JSON.stringify(map) : null;
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
    heroTitleLine1I18n: parseI18nMap(row?.hero_title_line1_i18n),
    heroTitleLine2I18n: parseI18nMap(row?.hero_title_line2_i18n),
    heroSubtitleI18n: parseI18nMap(row?.hero_subtitle_i18n),
    showHomeHero: row?.show_home_hero !== 0,
    hideHomeHeroOnMobile: row?.hide_home_hero_on_mobile === 1,
    showAppModeBadges: row?.show_app_mode_badges !== 0,
    defaultHomeDesktopView: row?.default_home_desktop_view === 'compact' ? 'compact' : 'cards',
    defaultCompactView: row?.default_compact_view !== 0,
    defaultLanguage: normalizeLanguage(row?.default_language || DEFAULT_BRANDING.defaultLanguage),
    defaultColorScheme: normalizeColorScheme(row?.default_color_scheme || DEFAULT_BRANDING.defaultColorScheme),
    defaultTimeZone: normalizeTimeZone(row?.default_timezone || DEFAULT_BRANDING.defaultTimeZone),
    enableDarkModeBeta: row?.enable_dark_mode_beta === 1,
    useEuropeanDateFormat: row?.use_european_date_format === 1,
    use24hTimeFormat: row?.use_24h_time_format === 1,
    logRetentionDays: normalizeRetentionDays(row?.log_retention_days, DEFAULT_BRANDING.logRetentionDays),
    hideLoginPage: row?.hide_login_page !== 0,
    showSharedCookieMode: row?.show_shared_cookie_mode !== 0,
    showRedirectSsoMode: row?.show_redirect_sso_mode !== 0,
    showEntraAppMode: row?.show_entra_app_mode !== 0,
    pluginsEnabled: row?.plugins_enabled === 1,
    logoUrl: row?.logo_file_name ? `/api/branding/logo?v=${logoVersion || Date.now()}` : null,
    updatedAt: row?.updated_at || null,
  };
}

function buildBrandingAuditDetails(currentRow, nextBranding, input = {}) {
  const currentBranding = toPublicBranding(currentRow);
  const changedKeys = [
    'heroTitleLine1',
    'heroTitleLine2',
    'heroSubtitle',
    'heroTitleLine1I18n',
    'heroTitleLine2I18n',
    'heroSubtitleI18n',
    'showHomeHero',
    'hideHomeHeroOnMobile',
    'showAppModeBadges',
    'defaultHomeDesktopView',
    'defaultCompactView',
    'defaultLanguage',
    'defaultColorScheme',
    'defaultTimeZone',
    'enableDarkModeBeta',
    'useEuropeanDateFormat',
    'use24hTimeFormat',
    'logRetentionDays',
    'hideLoginPage',
    'showSharedCookieMode',
    'showRedirectSsoMode',
    'showEntraAppMode',
    'pluginsEnabled',
  ];

  const changes = changedKeys
    .filter((key) => JSON.stringify(currentBranding[key]) !== JSON.stringify(nextBranding[key]))
    .map((key) => ({
      field: key,
      from: currentBranding[key],
      to: nextBranding[key],
    }));

  if (input.logoDataUrl || input.removeLogo) {
    changes.push({
      field: 'logo',
      from: currentRow?.logo_file_name ? 'present' : 'not set',
      to: input.removeLogo ? 'removed' : 'updated',
    });
  }

  return changes.length > 0 ? { changes } : null;
}

function parseLogoDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new UserFacingError('logo must be a base64 data URL');
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,(.+)$/i);
  if (!match) {
    throw new UserFacingError('logo must be a PNG, JPEG, WEBP, GIF, or SVG image');
  }

  const contentType = match[1].toLowerCase().replace('jpg', 'jpeg');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    throw new UserFacingError('logo image is empty');
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

async function saveLogo(dataUrl, { dbHandle = db } = {}) {
  let { contentType, buffer } = parseLogoDataUrl(dataUrl);
  if (isSvgContentType(contentType)) {
    const sanitized = sanitizeSvgBuffer(buffer);
    if (!sanitized) {
      throw new UserFacingError('logo SVG is not valid');
    }
    buffer = sanitized;
  }
  const extension = extensionFromContentType(contentType);
  const fileName = `company-logo.${Date.now()}.${uuidv4().slice(0, 8)}.${extension}`;
  const filePath = path.join(BRANDING_ASSET_DIR, fileName);

  await fsp.writeFile(filePath, buffer);
  await archiveMediaAsset({
    kind: 'branding-logo',
    sourceRef: 'default',
    originalName: 'company-logo',
    storedFileName: fileName,
    contentType,
    buffer,
    dbHandle,
  });

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
  // Language whose hero variant seeds the scalar (backward-compatible) columns.
  const heroDefaultLanguage = input.defaultLanguage === undefined
    ? normalizeLanguage(current?.default_language || DEFAULT_BRANDING.defaultLanguage)
    : normalizeLanguage(input.defaultLanguage);

  const heroTitleLine1I18n = input.heroTitleLine1I18n === undefined
    ? parseI18nMap(current?.hero_title_line1_i18n)
    : sanitizeI18nMap(input.heroTitleLine1I18n);
  const heroTitleLine2I18n = input.heroTitleLine2I18n === undefined
    ? parseI18nMap(current?.hero_title_line2_i18n)
    : sanitizeI18nMap(input.heroTitleLine2I18n);
  const heroSubtitleI18n = input.heroSubtitleI18n === undefined
    ? parseI18nMap(current?.hero_subtitle_i18n)
    : sanitizeI18nMap(input.heroSubtitleI18n);

  // Keep the scalar columns as a sensible representative value (default language, else
  // any provided variant, else the previous/default text) so legacy consumers keep working.
  const firstValue = (map) => map[heroDefaultLanguage] || Object.values(map)[0] || '';
  const heroTitleLine1 = firstValue(heroTitleLine1I18n)
    || normalizeText(input.heroTitleLine1, current?.hero_title_line1 || DEFAULT_BRANDING.heroTitleLine1);
  const heroTitleLine2 = firstValue(heroTitleLine2I18n)
    || normalizeText(input.heroTitleLine2, current?.hero_title_line2 || DEFAULT_BRANDING.heroTitleLine2);
  const heroSubtitle = firstValue(heroSubtitleI18n)
    || normalizeText(input.heroSubtitle, current?.hero_subtitle || DEFAULT_BRANDING.heroSubtitle);
  const heroTitleLine1I18nJson = serializeI18nMap(heroTitleLine1I18n);
  const heroTitleLine2I18nJson = serializeI18nMap(heroTitleLine2I18n);
  const heroSubtitleI18nJson = serializeI18nMap(heroSubtitleI18n);
  const showHomeHero = input.showHomeHero === undefined
    ? (current?.show_home_hero ?? 1)
    : (input.showHomeHero ? 1 : 0);
  const hideHomeHeroOnMobile = input.hideHomeHeroOnMobile === undefined
    ? (current?.hide_home_hero_on_mobile ?? 0)
    : (input.hideHomeHeroOnMobile ? 1 : 0);
  const showAppModeBadges = input.showAppModeBadges === undefined
    ? (current?.show_app_mode_badges ?? 1)
    : (input.showAppModeBadges ? 1 : 0);
  const defaultHomeDesktopView = input.defaultHomeDesktopView === undefined
    ? (current?.default_home_desktop_view === 'compact' ? 'compact' : 'cards')
    : (input.defaultHomeDesktopView === 'compact' ? 'compact' : 'cards');
  const defaultCompactView = input.defaultCompactView === undefined
    ? (current?.default_compact_view ?? 0)
    : (input.defaultCompactView ? 1 : 0);
  const defaultLanguage = input.defaultLanguage === undefined
    ? normalizeLanguage(current?.default_language || DEFAULT_BRANDING.defaultLanguage)
    : normalizeLanguage(input.defaultLanguage);
  const defaultColorScheme = input.defaultColorScheme === undefined
    ? normalizeColorScheme(current?.default_color_scheme || DEFAULT_BRANDING.defaultColorScheme)
    : normalizeColorScheme(input.defaultColorScheme);
  const defaultTimeZone = input.defaultTimeZone === undefined
    ? normalizeTimeZone(current?.default_timezone || DEFAULT_BRANDING.defaultTimeZone)
    : normalizeTimeZone(input.defaultTimeZone);
  const enableDarkModeBeta = input.enableDarkModeBeta === undefined
    ? (current?.enable_dark_mode_beta ?? 0)
    : (input.enableDarkModeBeta ? 1 : 0);
  const useEuropeanDateFormat = input.useEuropeanDateFormat === undefined
    ? (current?.use_european_date_format ?? 0)
    : (input.useEuropeanDateFormat ? 1 : 0);
  const use24hTimeFormat = input.use24hTimeFormat === undefined
    ? (current?.use_24h_time_format ?? 0)
    : (input.use24hTimeFormat ? 1 : 0);
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
  const pluginsEnabled = 0;

  let logoFileName = current?.logo_file_name || null;
  let logoContentType = current?.logo_content_type || null;

  if (input.removeLogo) {
    logoFileName = null;
    logoContentType = null;
  } else if (input.logoDataUrl) {
    const logo = await saveLogo(input.logoDataUrl, { dbHandle: db });
    logoFileName = logo.fileName;
    logoContentType = logo.contentType;
  }

  // Column values in INSERT order (after id). Saving unchanged settings writes nothing.
  const columnValues = {
    hero_title_line1: heroTitleLine1,
    hero_title_line2: heroTitleLine2,
    hero_subtitle: heroSubtitle,
    hero_title_line1_i18n: heroTitleLine1I18nJson,
    hero_title_line2_i18n: heroTitleLine2I18nJson,
    hero_subtitle_i18n: heroSubtitleI18nJson,
    show_home_hero: showHomeHero,
    hide_home_hero_on_mobile: hideHomeHeroOnMobile,
    show_app_mode_badges: showAppModeBadges,
    default_home_desktop_view: defaultHomeDesktopView,
    default_compact_view: defaultCompactView,
    default_language: defaultLanguage,
    default_timezone: defaultTimeZone,
    default_color_scheme: defaultColorScheme,
    enable_dark_mode_beta: enableDarkModeBeta,
    use_european_date_format: useEuropeanDateFormat,
    use_24h_time_format: use24hTimeFormat,
    log_retention_days: logRetentionDays,
    hide_login_page: hideLoginPage,
    show_shared_cookie_mode: showSharedCookieMode,
    show_redirect_sso_mode: showRedirectSsoMode,
    show_entra_app_mode: showEntraAppMode,
    plugins_enabled: pluginsEnabled,
    logo_file_name: logoFileName,
    logo_content_type: logoContentType,
  };
  if (current && Object.entries(columnValues).every(([column, value]) => current[column] === value)) {
    return { branding: getBrandingSettings(), auditDetails: null };
  }

  db.prepare(`
    INSERT INTO branding_settings (
      id, hero_title_line1, hero_title_line2, hero_subtitle, hero_title_line1_i18n, hero_title_line2_i18n, hero_subtitle_i18n, show_home_hero, hide_home_hero_on_mobile, show_app_mode_badges, default_home_desktop_view, default_compact_view, default_language, default_timezone, default_color_scheme, enable_dark_mode_beta, use_european_date_format, use_24h_time_format, log_retention_days, hide_login_page, show_shared_cookie_mode, show_redirect_sso_mode, show_entra_app_mode, plugins_enabled, logo_file_name, logo_content_type, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      hero_title_line1 = excluded.hero_title_line1,
      hero_title_line2 = excluded.hero_title_line2,
      hero_subtitle = excluded.hero_subtitle,
      hero_title_line1_i18n = excluded.hero_title_line1_i18n,
      hero_title_line2_i18n = excluded.hero_title_line2_i18n,
      hero_subtitle_i18n = excluded.hero_subtitle_i18n,
      show_home_hero = excluded.show_home_hero,
      hide_home_hero_on_mobile = excluded.hide_home_hero_on_mobile,
      show_app_mode_badges = excluded.show_app_mode_badges,
      default_home_desktop_view = excluded.default_home_desktop_view,
      default_compact_view = excluded.default_compact_view,
      default_language = excluded.default_language,
      default_timezone = excluded.default_timezone,
      default_color_scheme = excluded.default_color_scheme,
      enable_dark_mode_beta = excluded.enable_dark_mode_beta,
      use_european_date_format = excluded.use_european_date_format,
      use_24h_time_format = excluded.use_24h_time_format,
      log_retention_days = excluded.log_retention_days,
      hide_login_page = excluded.hide_login_page,
      show_shared_cookie_mode = excluded.show_shared_cookie_mode,
      show_redirect_sso_mode = excluded.show_redirect_sso_mode,
      show_entra_app_mode = excluded.show_entra_app_mode,
      plugins_enabled = excluded.plugins_enabled,
      logo_file_name = excluded.logo_file_name,
      logo_content_type = excluded.logo_content_type,
      updated_at = datetime('now')
  `).run(BRANDING_ID, ...Object.values(columnValues));

  const branding = getBrandingSettings();
  const auditDetails = buildBrandingAuditDetails(current, branding, input);

  return { branding, auditDetails };
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
  if (isSvgContentType(contentType)) {
    applySvgSafeHeaders(res, path.basename(logoPath));
  } else {
    res.setHeader('Content-Type', contentType);
  }
  res.sendFile(logoPath);
}

export { BRANDING_ASSET_DIR, DEFAULT_BRANDING };

export function isPluginSystemEnabled() {
  return getBrandingSettings().pluginsEnabled === true;
}
