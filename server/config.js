const REDACTED = '[set]';

function isSet(value) {
  return typeof value === 'string' && value.trim().length > 0;
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

export function getRequiredEnv(name, context = 'startup') {
  const value = process.env[name];
  if (!isSet(value)) {
    throw new Error(`${name} is required (${context})`);
  }
  return value;
}

export function getStartupConfig() {
  const baseDomain = process.env.BASE_DOMAIN || 'frontdoor.local';
  const frontendUrl = process.env.FRONTEND_URL || 'https://frontdoor.local';
  const timezone = process.env.TZ || 'Europe/Rome';
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
    TIMEZONE: timezone,
    AZURE_CLIENT_ID: isSet(azureClientId) ? REDACTED : '[missing]',
    AZURE_CLIENT_SECRET: isSet(azureClientSecret) ? REDACTED : '[missing]',
    AZURE_TENANT_ID: isSet(azureTenantId) ? REDACTED : '[missing]',
    AZURE_REDIRECT_URI: azureRedirectUri,
    JWT_SECRET: isSet(jwtSecret) ? REDACTED : '[missing]',
    ADMIN_EMAILS: adminEmails ? `${adminEmails.split(',').filter(Boolean).length} owner configured` : '[empty]',
  };
}

export function validateStartupEnv() {
  const missing = [
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TENANT_ID',
    'AZURE_REDIRECT_URI',
    'JWT_SECRET',
  ].filter((name) => !isSet(process.env[name]));

  const warnings = [];
  const errors = [];

  if (!isSet(process.env.BASE_DOMAIN)) {
    warnings.push('BASE_DOMAIN is not set, defaulting to frontdoor.local');
  }
  if (!isSet(process.env.FRONTEND_URL)) {
    warnings.push('FRONTEND_URL is not set, defaulting to https://frontdoor.local');
  }
  if (!isSet(process.env.TZ)) {
    warnings.push('TZ is not set, defaulting to Europe/Rome');
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
    warnings.push('JWT_SECRET is shorter than 32 characters; use a longer random secret in production');
  }
  if (!isSet(process.env.ADMIN_EMAILS)) {
    warnings.push('ADMIN_EMAILS is empty; no user will be auto-promoted to owner on first login');
  }

  return { missing, warnings, errors };
}
