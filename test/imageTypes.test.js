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
