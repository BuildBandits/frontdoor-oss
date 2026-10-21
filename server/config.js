import { DEFAULT_TIME_ZONE, normalizeTimeZone } from '../shared/timeZones.js';
import { getBrandingSettings } from './services/branding.js';

const REDACTED = '[set]';

// Secrets that ship as placeholders in .env.example files and MUST NOT be used
// in a real deployment. If startup detects one of these we fail fast instead of
// signing tokens with a publicly known value.
const JWT_SECRET_PLACEHOLDERS = new Set([
  'change-this-in-production',
  'your-jwt-secret',
  'changeme',
  'frontdoor-dev-secret-do-not-use-in-production',
]);

function isSet(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlaceholderJwtSecret(value) {
  if (!isSet(value)) return false;
  return JWT_SECRET_PLACEHOLDERS.has(value.trim().toLowerCase());
}

function isValidHttpUrl(value) {
  if (!isSet(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getAppTimeZone() {
  const brandingTimeZone = getBrandingSettings()?.defaultTimeZone;
  return normalizeTimeZone(brandingTimeZone || process.env.TIMEZONE || process.env.TZ, DEFAULT_TIME_ZONE);
}

export function getRequiredEnv(name, context = 'startup') {
  const value = process.env[name];
  if (!isSet(value)) {
    throw new Error(`${name} is required (${context})`);
  }
  return value;
}

const IMPERSONATION_TIMEOUT_DEFAULT_MINUTES = 30;
const IMPERSONATION_TIMEOUT_MIN_MINUTES = 5;
const IMPERSONATION_TIMEOUT_MAX_MINUTES = 240;

// How long an admin may act as a user before the session ends on its own.
export function getImpersonationTimeoutMinutes() {
  const minutes = Number.parseInt(process.env.IMPERSONATION_TIMEOUT_MINUTES ?? '', 10);
  if (!Number.isFinite(minutes)) return IMPERSONATION_TIMEOUT_DEFAULT_MINUTES;
  return Math.min(IMPERSONATION_TIMEOUT_MAX_MINUTES, Math.max(IMPERSONATION_TIMEOUT_MIN_MINUTES, minutes));
}

export function getStartupConfig() {
  const baseDomain = process.env.BASE_DOMAIN || 'frontdoor.local';
  const frontendUrl = process.env.FRONTEND_URL || 'https://frontdoor.local';
  const timezone = getAppTimeZone();
  const corsAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const azureClientId = process.env.AZURE_CLIENT_ID || '';
  const azureClientSecret = process.env.AZURE_CLIENT_SECRET || '';
  const azureTenantId = process.env.AZURE_TENANT_ID || '';
  const azureRedirectUri = process.env.AZURE_REDIRECT_URI || 'https://frontdoor.local/api/auth/microsoft/callback';
  const jwtSecret = process.env.JWT_SECRET || '';
  const adminEmails = process.env.ADMIN_EMAILS || '';
  const brandingAssetDir = process.env.BRANDING_ASSET_DIR || './data/branding';

  return {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || '3001',
    DATABASE_PATH: process.env.DATABASE_PATH || './frontdoor.db',
    BRANDING_ASSET_DIR: brandingAssetDir,
    BASE_DOMAIN: baseDomain,
    FRONTEND_URL: frontendUrl,
    CORS_ALLOWED_ORIGINS: corsAllowedOrigins.length > 0 ? corsAllowedOrigins.join(', ') : '[empty]',
    TIMEZONE: timezone,
    DEV_LOGIN: isDevLoginEnabled() ? 'enabled' : 'disabled',
    AZURE_CLIENT_ID: isSet(azureClientId) ? REDACTED : '[missing]',
    AZURE_CLIENT_SECRET: isSet(azureClientSecret) ? REDACTED : '[missing]',
    AZURE_TENANT_ID: isSet(azureTenantId) ? REDACTED : '[missing]',
    AZURE_REDIRECT_URI: azureRedirectUri,
    JWT_SECRET: isSet(jwtSecret) ? REDACTED : '[missing]',
    ADMIN_EMAILS: adminEmails ? `${adminEmails.split(',').filter(Boolean).length} owner configured` : '[empty]',
  };
}

export function isDevLoginEnabled() {
  return process.env.DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
}

export function validateStartupEnv() {
  const devLogin = isDevLoginEnabled();

  // In dev-login mode Azure credentials are not required; a local JWT_SECRET
  // fallback is generated automatically so the only hard requirement disappears.
  const requiredKeys = devLogin
    ? []
    : ['AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_REDIRECT_URI', 'JWT_SECRET'];

  const missing = requiredKeys.filter((name) => !isSet(process.env[name]));

  const warnings = [];
  const errors = [];

  if (devLogin) {
    warnings.push('DEV_LOGIN is enabled — using local dev auth, no Azure SSO required. Do NOT use in production.');
    // Provide a fallback JWT_SECRET so the server can sign tokens without .env config
    if (!isSet(process.env.JWT_SECRET)) {
      process.env.JWT_SECRET = 'frontdoor-dev-secret-do-not-use-in-production';
      warnings.push('JWT_SECRET not set, using insecure dev fallback');
    }
  }
  if (!isSet(process.env.BASE_DOMAIN)) {
    warnings.push('BASE_DOMAIN is not set, defaulting to frontdoor.local');
  }
  if (!isSet(process.env.FRONTEND_URL)) {
    warnings.push('FRONTEND_URL is not set, defaulting to https://frontdoor.local');
  }
  if (!isSet(process.env.BRANDING_ASSET_DIR)) {
    warnings.push('BRANDING_ASSET_DIR is not set, defaulting to ./data/branding');
  }
  if (isSet(process.env.FRONTEND_URL) && !isValidHttpUrl(process.env.FRONTEND_URL)) {
    errors.push('FRONTEND_URL must be a valid http or https URL');
  }
  if (isSet(process.env.AZURE_REDIRECT_URI) && !isValidHttpUrl(process.env.AZURE_REDIRECT_URI)) {
    errors.push('AZURE_REDIRECT_URI must be a valid http or https URL');
  }
  if (isSet(process.env.JWT_SECRET) && process.env.JWT_SECRET.trim().length < 32) {
    if (devLogin) {
      warnings.push('JWT_SECRET is shorter than 32 characters; use a longer random secret in production');
    } else {
      errors.push('JWT_SECRET must be at least 32 characters in production (set DEV_LOGIN=true for local development)');
    }
  }
  if (isPlaceholderJwtSecret(process.env.JWT_SECRET) && !devLogin) {
    errors.push('JWT_SECRET is set to a known placeholder value; generate a unique secret before starting the server');
  }
  if (!isSet(process.env.ADMIN_EMAILS)) {
    warnings.push('ADMIN_EMAILS is empty; no user will be auto-promoted to owner on first login');
  }

  return { missing, warnings, errors };
}
