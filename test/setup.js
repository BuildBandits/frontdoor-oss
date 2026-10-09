// Preloaded into every test process (see the "test" script) before any server
// module is imported, so each test file gets its own SQLite database and data
// directories instead of sharing the repo's frontdoor.db and ./data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREFIX = 'frontdoor-test-';
const STALE_AFTER_MS = 60 * 60 * 1000;

// On Windows the SQLite file is still locked when the exit hook runs, so
// directories from earlier runs are swept here once they are old enough.
for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith(PREFIX)) continue;
  const dir = path.join(os.tmpdir(), entry.name);
  try {
    if (Date.now() - fs.statSync(dir).mtimeMs > STALE_AFTER_MS) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Another test process may own or be removing it.
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));

// Settings from the developer's shell or .env must not change test results:
// tests that need one of these set it themselves.
for (const name of [
  'ADMIN_EMAILS', 'ADMIN_API_KEY', 'DEV_LOGIN', 'ENTRA_GROUP_SYNC', 'ENTRA_TENANT_REFRESH_MINUTES',
  'JWT_SECRET', 'JWT_ISSUER', 'JWT_EXPIRES_IN', 'CORS_ALLOWED_ORIGINS', 'FRONTEND_URL', 'BASE_DOMAIN',
  'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_REDIRECT_URI', 'TIMEZONE', 'TZ',
]) {
  delete process.env[name];
}

const defaults = {
  DATABASE_PATH: path.join(root, 'frontdoor.db'),
  APP_ICON_CACHE_DIR: path.join(root, 'app-icon-cache'),
  AVATAR_CACHE_DIR: path.join(root, 'avatar-cache'),
  BRANDING_ASSET_DIR: path.join(root, 'branding'),
  PLUGIN_ASSET_DIR: path.join(root, 'plugins'),
};

for (const [name, value] of Object.entries(defaults)) {
  process.env[name] = value;
}

process.on('exit', () => {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows can keep the SQLite file locked until the handle is released.
  }
});
