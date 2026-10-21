import 'dotenv/config';
import './db.js';
import { createApp } from './app.js';
import { purgeLogsOlderThan } from './routes/logs.js';
import { getStartupConfig, validateStartupEnv } from './config.js';
import { getBrandingSettings } from './services/branding.js';
import { backfillMediaLibrary } from './services/mediaAssets.js';
import { findLargeAppIcons, LARGE_ICON_THRESHOLD_BYTES } from './services/appIcons.js';
import { sweepExpiredSessions } from './services/impersonation.js';

const PORT = process.env.PORT || 3001;

const startupConfig = getStartupConfig();
const { missing, warnings, errors } = validateStartupEnv();

console.log('Frontdoor startup configuration:');
for (const [key, value] of Object.entries(startupConfig)) {
  console.log(`  ${key}=${value}`);
}

for (const warning of warnings) {
  console.warn(`Frontdoor startup warning: ${warning}`);
}

const startupErrors = [...missing.map((name) => `${name} is missing`), ...errors];
if (startupErrors.length > 0) {
  console.error(`Frontdoor startup error: ${startupErrors.join('; ')}`);
  process.exit(1);
}

function logDatabaseBackedSettings() {
  try {
    const branding = getBrandingSettings();
    const databaseBackedSettings = {
      defaultLanguage: branding.defaultLanguage,
      defaultColorScheme: branding.defaultColorScheme,
      enableDarkModeBeta: branding.enableDarkModeBeta,
      defaultHomeDesktopView: branding.defaultHomeDesktopView,
      defaultCompactView: branding.defaultCompactView,
      showHomeHero: branding.showHomeHero,
      hideHomeHeroOnMobile: branding.hideHomeHeroOnMobile,
      showAppModeBadges: branding.showAppModeBadges,
      showSharedCookieMode: branding.showSharedCookieMode,
      showRedirectSsoMode: branding.showRedirectSsoMode,
      showEntraAppMode: branding.showEntraAppMode,
      pluginsEnabled: branding.pluginsEnabled,
      hideLoginPage: branding.hideLoginPage,
      useEuropeanDateFormat: branding.useEuropeanDateFormat,
      use24hTimeFormat: branding.use24hTimeFormat,
      logRetentionDays: branding.logRetentionDays,
      logoConfigured: Boolean(branding.logoUrl),
      brandingUpdatedAt: branding.updatedAt || 'never',
    };

    console.log('Frontdoor database-backed settings:');
    for (const [key, value] of Object.entries(databaseBackedSettings)) {
      console.log(`  ${key}=${value}`);
    }
  } catch (error) {
    console.error(`Frontdoor database-backed settings read failed: ${error.message}`);
  }
}

async function logLargeAppIcons() {
  try {
    const large = await findLargeAppIcons({ thresholdBytes: LARGE_ICON_THRESHOLD_BYTES });
    if (large.length === 0) {
      console.log(`[startup][icons] all app icons are under ${LARGE_ICON_THRESHOLD_BYTES / 1024} KB`);
      return;
    }
    console.warn(`[startup][icons] ${large.length} app icon(s) larger than ${LARGE_ICON_THRESHOLD_BYTES / 1024} KB; shrink them with Optimize icons in Admin > Media library:`);
    for (const icon of large.slice(0, 20)) {
      const size = icon.size ? `, ${icon.size.width}x${icon.size.height} px` : '';
      console.warn(`  ${icon.name}: ${(icon.bytes / 1024).toFixed(0)} KB${size}`);
    }
    if (large.length > 20) console.warn(`  ...and ${large.length - 20} more`);
  } catch (error) {
    console.error(`[startup][icons] icon size check failed: ${error.message}`);
  }
}

function runLogRetentionPurge() {
  try {
    const retentionDays = getBrandingSettings().logRetentionDays ?? 90;
    const { accessRemoved, auditRemoved } = purgeLogsOlderThan(retentionDays);
    if (accessRemoved > 0 || auditRemoved > 0) {
      console.log(`Frontdoor log retention purge: removed ${accessRemoved} access logs and ${auditRemoved} audit logs older than ${retentionDays} days`);
    }
  } catch (error) {
    console.error(`Frontdoor log retention purge failed: ${error.message}`);
  }
}

// Closes impersonation sessions that timed out while nobody was using them, so
// their end is always in the audit log.
function runImpersonationSweep() {
  try {
    sweepExpiredSessions();
  } catch (error) {
    console.error(`Frontdoor impersonation sweep failed: ${error.message}`);
  }
}

try {
  const result = await backfillMediaLibrary();
  if (result.totalImported > 0) {
    console.log(`Frontdoor media library index refresh: indexed ${result.totalImported} asset(s) (${result.appIconsImported} app icons, ${result.brandingImported} branding logos).`);
  }
} catch (error) {
  console.error(`Frontdoor media library backfill failed: ${error.message}`);
}

createApp().listen(PORT, () => {
  console.log(`Frontdoor running on port ${PORT}`);
  logDatabaseBackedSettings();
  void logLargeAppIcons();
  runLogRetentionPurge();
  const dailyRetentionTimer = setInterval(runLogRetentionPurge, 24 * 60 * 60 * 1000);
  dailyRetentionTimer.unref?.();
  runImpersonationSweep();
  const impersonationSweepTimer = setInterval(runImpersonationSweep, 60 * 1000);
  impersonationSweepTimer.unref?.();
});
