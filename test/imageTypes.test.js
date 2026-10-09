import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseAppIconPayload } from '../server/services/appIcons.js';
import { parseMediaAssetPayload, serveMediaAsset } from '../server/services/mediaAssets.js';

const dataUrl = (type, text) => `data:${type};base64,${Buffer.from(text).toString('base64')}`;

function fakeResponse() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    sentFile: null,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    end() {},
    sendFile(file) { this.sentFile = file; },
  };
}

test('app icons accept image types only', () => {
  assert.throws(
    () => parseAppIconPayload({ iconDataUrl: dataUrl('text/html', '<p>hi</p>') }),
    (error) => error.code === 'icon_unsupported_type' && error.statusCode === 400,
  );
  assert.throws(
    () => parseAppIconPayload({ iconDataUrl: dataUrl('text/javascript', 'void 0') }),
    (error) => error.code === 'icon_unsupported_type',
  );
  assert.equal(parseAppIconPayload({ iconDataUrl: dataUrl('image/jpg', 'jpeg-bytes') }).contentType, 'image/jpeg');
  assert.equal(parseAppIconPayload({ iconDataUrl: dataUrl('image/vnd.microsoft.icon', 'ico') }).contentType, 'image/x-icon');
  assert.equal(parseAppIconPayload({ iconSvgText: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }).contentType, 'image/svg+xml');
});

test('media asset payloads accept image types only', () => {
  assert.equal(parseMediaAssetPayload({ dataUrl: dataUrl('text/html', '<p>hi</p>') }), null);
  assert.equal(parseMediaAssetPayload({ dataUrl: dataUrl('image/png', 'png-bytes') }).contentType, 'image/png');
});

test('media assets are served with a type derived from the stored file, never the recorded one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-media-types-'));
  fs.writeFileSync(path.join(dir, 'icon-a.png'), 'png-bytes');
  fs.writeFileSync(path.join(dir, 'icon-b.bin'), '<p>not an image</p>');

  const image = fakeResponse();
  await serveMediaAsset({ kind: 'app-icon', stored_file_name: 'icon-a.png', content_type: 'text/html' }, image, { appIconDir: dir });
  assert.equal(image.headers['content-type'], 'image/png');
  assert.equal(image.headers['x-content-type-options'], 'nosniff');
  assert.equal(image.headers['content-disposition'], undefined);

  const other = fakeResponse();
  await serveMediaAsset({ kind: 'app-icon', stored_file_name: 'icon-b.bin', content_type: 'text/html' }, other, { appIconDir: dir });
  assert.equal(other.headers['content-type'], 'application/octet-stream');
  assert.match(other.headers['content-disposition'], /^attachment; filename="icon-b\.bin"$/);
});

test('icons over the size limit are refused before decoding or parsing', async () => {
  const { MAX_RASTER_ICON_BYTES, MAX_SVG_ICON_BYTES, estimateDataUrlBytes } = await import('../shared/iconLimits.js');
  const tooLarge = (error) => error.code === 'icon_too_large' && error.statusCode === 413;

  const bigPng = `data:image/png;base64,${'A'.repeat(Math.ceil((MAX_RASTER_ICON_BYTES * 4) / 3) + 8)}`;
  assert.ok(estimateDataUrlBytes(bigPng) > MAX_RASTER_ICON_BYTES);
  assert.throws(() => parseAppIconPayload({ iconDataUrl: bigPng }), tooLarge);

  const bigSvg = `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(MAX_SVG_ICON_BYTES / 4)}</svg>`;
  assert.throws(() => parseAppIconPayload({ iconSvgText: bigSvg }), tooLarge);
  // An SVG data URL between the SVG and raster limits is still refused as SVG.
  assert.throws(() => parseAppIconPayload({ iconDataUrl: dataUrl('image/svg+xml', bigSvg) }), tooLarge);

  assert.equal(parseAppIconPayload({ iconDataUrl: dataUrl('image/png', 'x'.repeat(200 * 1024)) }).contentType, 'image/png');
});

test('branding logos over the size limit are refused', async () => {
  const { updateBrandingSettings } = await import('../server/services/branding.js');
  const { MAX_SVG_ICON_BYTES } = await import('../shared/iconLimits.js');
  const bigSvg = `<svg xmlns="http://www.w3.org/2000/svg">${'<g/>'.repeat(MAX_SVG_ICON_BYTES / 4)}</svg>`;
  await assert.rejects(
    updateBrandingSettings({ logoDataUrl: dataUrl('image/svg+xml', bigSvg) }),
    (error) => error.code === 'logo_too_large' && error.statusCode === 413,
  );
});

test('large app icons in use are found for the startup report, with PNG dimensions', async () => {
  const { findLargeAppIcons } = await import('../server/services/appIcons.js');
  const { default: db } = await import('../server/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontdoor-large-icons-'));
  // PNG header with IHDR 3000x2000, padded to 300 KB.
  const png = Buffer.alloc(300 * 1024);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(png, 0);
  png.writeUInt32BE(3000, 16);
  png.writeUInt32BE(2000, 20);
  fs.writeFileSync(path.join(dir, 'big.png'), png);
  fs.writeFileSync(path.join(dir, 'small.png'), Buffer.alloc(10 * 1024));
  db.prepare("INSERT INTO apps (id, name, slug, target_url, icon_file_name) VALUES ('icon-big', 'Big Icon App', 'big-icon-app', 'https://big.example.com', 'big.png')").run();
  db.prepare("INSERT INTO apps (id, name, slug, target_url, icon_file_name) VALUES ('icon-small', 'Small Icon App', 'small-icon-app', 'https://small.example.com', 'small.png')").run();

  const large = await findLargeAppIcons({ cacheDir: dir });
  assert.deepEqual(large, [{ id: 'icon-big', name: 'Big Icon App', bytes: 300 * 1024, size: { width: 3000, height: 2000 }, optimizable: true }]);
});
