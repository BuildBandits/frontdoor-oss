// Linking a Media Library icon through the app routes (POST/PUT /api/apps).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET ||= 'icon-link-test-secret-0123456789abcdef';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

const OWNER_ID = 'icon-link-owner';
const svg = (shape) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${shape}</svg>`;

let server;
let baseUrl;
let token;

function request(pathname, { body, ...options } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const appBody = (slug, extra = {}) => ({
  name: slug, slug, target_url: `https://${slug}.example.com`, mode: 'redirect-plain', ...extra,
});
const appBySlug = (slug) => db.prepare('SELECT * FROM apps WHERE slug = ?').get(slug);
const mediaRowCount = () => db.prepare("SELECT COUNT(*) AS n FROM media_assets WHERE kind = 'app-icon'").get().n;

before(async () => {
  db.prepare('INSERT OR REPLACE INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(OWNER_ID, 'owner@icon-link.example.com', 'Icon Owner', 'owner');
  token = jwt.sign({ userId: OWNER_ID }, process.env.JWT_SECRET, { expiresIn: '5m', issuer: 'frontdoor' });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('apps link a library icon instead of copying it, and uploads or removal win over the link', async () => {
  let res = await request('/api/apps', { method: 'POST', body: appBody('icon-source', { iconSvgText: svg('<rect width="24" height="24"/>') }) });
  assert.equal(res.status, 201, await res.clone().text());
  const source = appBySlug('icon-source');
  assert.ok(source.icon_file_name);
  const asset = db.prepare('SELECT id FROM media_assets WHERE stored_file_name = ?').get(source.icon_file_name);
  const rowsBefore = mediaRowCount();

  // POST with a library icon: same file, no new media row.
  res = await request('/api/apps', { method: 'POST', body: appBody('icon-reuser', { iconAssetId: asset.id }) });
  assert.equal(res.status, 201);
  assert.equal(appBySlug('icon-reuser').icon_file_name, source.icon_file_name);
  assert.equal(mediaRowCount(), rowsBefore);

  // An unknown asset is refused before the app is created.
  res = await request('/api/apps', { method: 'POST', body: appBody('icon-bad', { iconAssetId: 'missing-asset' }) });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'media_asset_not_found');
  assert.equal(appBySlug('icon-bad'), undefined);

  const reuser = appBySlug('icon-reuser');
  // PUT with an unknown asset leaves the app as it was.
  res = await request(`/api/apps/${reuser.id}`, { method: 'PUT', body: appBody('icon-reuser', { name: 'Renamed', iconAssetId: 'missing-asset' }) });
  assert.equal(res.status, 400);
  assert.equal(appBySlug('icon-reuser').name, 'icon-reuser');
  assert.equal(appBySlug('icon-reuser').icon_file_name, source.icon_file_name);

  // An upload in the same request wins over the library icon.
  res = await request(`/api/apps/${reuser.id}`, { method: 'PUT', body: appBody('icon-reuser', { iconAssetId: asset.id, iconSvgText: svg('<circle cx="12" cy="12" r="10"/>') }) });
  assert.equal(res.status, 200);
  const uploaded = appBySlug('icon-reuser').icon_file_name;
  assert.ok(uploaded && uploaded !== source.icon_file_name);

  // Removing wins over both.
  res = await request(`/api/apps/${reuser.id}`, { method: 'PUT', body: appBody('icon-reuser', { iconAssetId: asset.id, removeIconAsset: true }) });
  assert.equal(res.status, 200);
  assert.equal(appBySlug('icon-reuser').icon_file_name, null);
  assert.equal(appBySlug('icon-source').icon_file_name, source.icon_file_name);
});
