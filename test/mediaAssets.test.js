import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { clearAvatarCache, getAvatarCacheStats } from '../server/services/avatars.js';
import { cleanupAppIconCache, getAppIconCacheStats, saveAppIconAsset } from '../server/services/appIcons.js';
import {
  backfillMediaLibrary,
  deleteMediaAssetById,
  getMediaAssetById,
  listMediaAssets,
  parseMediaAssetPayload,
  serveMediaAsset,
} from '../server/services/mediaAssets.js';

let db;

function initSchema(database) {
  database.exec(`
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT,
      slug TEXT,
      target_url TEXT,
      mode TEXT,
      icon_file_name TEXT
    );

    CREATE TABLE branding_settings (
      id TEXT PRIMARY KEY,
      logo_file_name TEXT,
      logo_content_type TEXT
    );

    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      source_ref TEXT,
      original_name TEXT,
      app_name TEXT,
      app_slug TEXT,
      app_target_url TEXT,
      app_mode TEXT,
      stored_file_name TEXT NOT NULL UNIQUE,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function resetTables() {
  db.exec('DELETE FROM apps; DELETE FROM branding_settings; DELETE FROM media_assets;');
}

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
    },
    sendFile(filePath) {
      this.sentFilePath = filePath;
    },
    send(body) {
      this.body = body;
    },
  };
}

function getAssetIdByStoredFileName(storedFileName) {
  return db.prepare('SELECT id FROM media_assets WHERE stored_file_name = ?').get(storedFileName)?.id || null;
}

describe('mediaAssets service', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
  });

  after(() => {
    db.close();
  });

  it('indexes current cache files and serves them directly', async () => {
    const appIconDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-app-icons-'));
    const brandingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-branding-'));

    try {
      resetTables();
      db.prepare('INSERT INTO apps (id, name, slug, target_url, mode, icon_file_name) VALUES (?, ?, ?, ?, ?, ?)').run(
        'app-1',
        'App One',
        'app-one',
        'https://app-one.example.com',
        'redirect',
        'app-1.svg'
      );
      db.prepare('INSERT INTO branding_settings (id, logo_file_name, logo_content_type) VALUES (?, ?, ?)').run(
        'default',
        'company-logo.svg',
        'image/svg+xml'
      );

      fs.writeFileSync(path.join(appIconDir, 'app-1.svg'), '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>', 'utf8');
      fs.writeFileSync(path.join(brandingDir, 'company-logo.svg'), '<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>', 'utf8');

      const result = await backfillMediaLibrary({ dbHandle: db, appIconDir, brandingDir });
      assert.equal(result.totalImported, 2);

      const mediaIndex = listMediaAssets({ dbHandle: db, appIconDir, brandingDir });
      const assets = mediaIndex.assets;
      assert.equal(assets.length, 2);
      assert.equal(assets.find((asset) => asset.kind === 'app-icon').fileExists, true);
      assert.equal(assets.find((asset) => asset.kind === 'branding-logo').fileExists, true);

      const appAsset = getMediaAssetById(assets.find((asset) => asset.kind === 'app-icon').id, { dbHandle: db, appIconDir, brandingDir });
      const res = createResponse();

      await serveMediaAsset(appAsset, res, { appIconDir, brandingDir });
      assert.equal(res.statusCode, 200);
      assert.equal(res.sentFilePath, path.join(appIconDir, 'app-1.svg'));
      assert.equal(res.headers['Content-Type'], 'image/svg+xml');
    } finally {
      fs.rmSync(appIconDir, { recursive: true, force: true });
      fs.rmSync(brandingDir, { recursive: true, force: true });
    }
  });

  it('keeps previous app icon versions visible in the media index', async () => {
    const appIconDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-app-icons-history-'));

    try {
      resetTables();
      db.prepare('INSERT INTO apps (id, name, slug, target_url, mode, icon_file_name) VALUES (?, ?, ?, ?, ?, ?)').run(
        'app-2',
        'App Two',
        'app-two',
        'https://app-two.example.com',
        'redirect',
        null
      );

      const first = await saveAppIconAsset('app-2', {
        buffer: Buffer.from('<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>', 'utf8'),
        contentType: 'image/svg+xml',
      }, {
        name: 'App Two',
        slug: 'app-two',
        target_url: 'https://app-two.example.com',
        mode: 'redirect',
      }, {
        cacheDir: appIconDir,
        dbHandle: db,
      });
      db.prepare('UPDATE apps SET icon_file_name = ? WHERE id = ?').run(first.fileName, 'app-2');

      const second = await saveAppIconAsset('app-2', {
        buffer: Buffer.from('<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>', 'utf8'),
        contentType: 'image/svg+xml',
      }, {
        name: 'App Two',
        slug: 'app-two',
        target_url: 'https://app-two.example.com',
        mode: 'redirect',
      }, {
        cacheDir: appIconDir,
        dbHandle: db,
      });
      db.prepare('UPDATE apps SET icon_file_name = ? WHERE id = ?').run(second.fileName, 'app-2');

      const result = listMediaAssets({ dbHandle: db, appIconDir });
      const assets = result.assets;
      assert.equal(assets.length, 2);
      assert.equal(fs.existsSync(path.join(appIconDir, first.fileName)), true);
      assert.equal(fs.existsSync(path.join(appIconDir, second.fileName)), true);

      const stats = await getAppIconCacheStats({ dbHandle: db, cacheDir: appIconDir });
      assert.equal(stats.totalFiles, 2);
      assert.equal(stats.currentFiles, 2);
      assert.equal(stats.orphanFiles, 0);
    } finally {
      fs.rmSync(appIconDir, { recursive: true, force: true });
    }
  });

  it('blocks deletion for assets still referenced by apps or branding, but allows orphan rows', async () => {
    const appIconDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-media-delete-'));
    const brandingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-media-branding-delete-'));

    try {
      resetTables();
      db.prepare('INSERT INTO apps (id, name, slug, target_url, mode, icon_file_name) VALUES (?, ?, ?, ?, ?, ?)').run(
        'app-3',
        'App Three',
        'app-three',
        'https://app-three.example.com',
        'redirect',
        null
      );
      db.prepare('INSERT INTO branding_settings (id, logo_file_name, logo_content_type) VALUES (?, ?, ?)').run(
        'default',
        null,
        null
      );

      const liveAppIcon = await saveAppIconAsset('app-3', {
        buffer: Buffer.from('<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>', 'utf8'),
        contentType: 'image/svg+xml',
      }, {
        name: 'App Three',
        slug: 'app-three',
        target_url: 'https://app-three.example.com',
        mode: 'redirect',
      }, {
        cacheDir: appIconDir,
        dbHandle: db,
      });
      db.prepare('UPDATE apps SET icon_file_name = ? WHERE id = ?').run(liveAppIcon.fileName, 'app-3');

      const liveAppIconId = getAssetIdByStoredFileName(liveAppIcon.fileName);
      assert.ok(liveAppIconId);
      assert.throws(() => deleteMediaAssetById(liveAppIconId, db), (error) => error?.statusCode === 409 && error?.code === 'MEDIA_ASSET_IN_USE');
      assert.equal(listMediaAssets({ dbHandle: db, appIconDir }).assets.length, 1);
      assert.equal(fs.existsSync(path.join(appIconDir, liveAppIcon.fileName)), true);

      const liveBrandingFileName = 'company-logo.svg';
      fs.writeFileSync(path.join(brandingDir, liveBrandingFileName), '<svg viewBox="0 0 24 24"><rect width="24" height="24"/></svg>', 'utf8');
      db.prepare('UPDATE branding_settings SET logo_file_name = ?, logo_content_type = ? WHERE id = ?').run(
        liveBrandingFileName,
        'image/svg+xml',
        'default'
      );
      const brandingImported = await backfillMediaLibrary({ dbHandle: db, appIconDir, brandingDir });
      assert.equal(brandingImported.totalImported >= 1, true);
      const brandingIndex = listMediaAssets({ dbHandle: db, appIconDir, brandingDir, kind: 'branding-logo' });
      const brandingLiveAsset = brandingIndex.assets[0];
      assert.ok(brandingLiveAsset);
      assert.throws(() => deleteMediaAssetById(brandingLiveAsset.id, db), (error) => error?.statusCode === 409 && error?.code === 'MEDIA_ASSET_IN_USE');

      db.prepare('UPDATE apps SET icon_file_name = NULL WHERE id = ?').run('app-3');
      const orphanDeleteId = getAssetIdByStoredFileName(liveAppIcon.fileName);
      assert.ok(orphanDeleteId);
      assert.equal(deleteMediaAssetById(orphanDeleteId, db), 1);
      assert.equal(listMediaAssets({ dbHandle: db, appIconDir, kind: 'app-icon' }).assets.length, 0);
      assert.equal(fs.existsSync(path.join(appIconDir, liveAppIcon.fileName)), true);

      const stats = await getAppIconCacheStats({ dbHandle: db, cacheDir: appIconDir });
      assert.equal(stats.totalFiles, 1);
      assert.equal(stats.orphanFiles, 1);

      const cleanup = await cleanupAppIconCache({ dbHandle: db, cacheDir: appIconDir });
      assert.equal(cleanup.removed, 1);
      assert.equal(fs.existsSync(path.join(appIconDir, liveAppIcon.fileName)), false);
    } finally {
      fs.rmSync(appIconDir, { recursive: true, force: true });
      fs.rmSync(brandingDir, { recursive: true, force: true });
    }
  });

  it('parses SVG and data URLs', () => {
    const svgPayload = parseMediaAssetPayload({ svgText: '<svg viewBox="0 0 24 24"></svg>' });
    assert.equal(svgPayload.contentType, 'image/svg+xml');
    assert.equal(svgPayload.buffer.toString('utf8').includes('<svg'), true);

    const dataPayload = parseMediaAssetPayload({ dataUrl: 'data:image/png;base64,AA==' });
    assert.equal(dataPayload.contentType, 'image/png');
    assert.equal(Buffer.isBuffer(dataPayload.buffer), true);
  });

  it('reports avatar cache stats and clears the avatar cache', async () => {
    const avatarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-avatar-cache-'));

    try {
      fs.writeFileSync(path.join(avatarDir, 'user.png'), Buffer.from([1, 2, 3, 4]));
      const statsBefore = await getAvatarCacheStats({ cacheDir: avatarDir });
      assert.equal(statsBefore.files, 1);
      assert.equal(statsBefore.bytes, 4);

      const cleared = await clearAvatarCache(avatarDir);
      assert.equal(cleared.removed >= 1, true);

      const statsAfter = await getAvatarCacheStats({ cacheDir: avatarDir });
      assert.equal(statsAfter.files, 0);
    } finally {
      fs.rmSync(avatarDir, { recursive: true, force: true });
    }
  });
});
