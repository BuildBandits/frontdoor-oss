import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.join(rootDir, '.tmp', 'e2e');

await fs.rm(runtimeDir, { recursive: true, force: true });
await fs.mkdir(runtimeDir, { recursive: true });

Object.assign(process.env, {
  NODE_ENV: 'test',
  DEV_LOGIN: 'true',
  PORT: '4173',
  DATABASE_PATH: path.join(runtimeDir, 'frontdoor.db'),
  AVATAR_CACHE_DIR: path.join(runtimeDir, 'avatar-cache'),
  APP_ICON_CACHE_DIR: path.join(runtimeDir, 'app-icon-cache'),
  BRANDING_ASSET_DIR: path.join(runtimeDir, 'branding'),
  PLUGIN_ASSET_DIR: path.join(runtimeDir, 'plugins'),
  BASE_DOMAIN: 'localhost',
  FRONTEND_URL: 'http://127.0.0.1:4173',
  JWT_SECRET: 'frontdoor-e2e-only-secret-with-more-than-thirty-two-characters',
  ENTRA_GROUP_SYNC: 'false',
});

await import('../server/index.js');
