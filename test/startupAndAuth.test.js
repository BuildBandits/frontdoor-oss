import test, { after, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { validateStartupEnv, isDevLoginEnabled } = await import('../server/config.js');
const { sanitizeSvgBuffer } = await import('../server/services/svgSanitize.js');
const { createApp } = await import('../server/app.js');

const ENV_KEYS = ['NODE_ENV', 'DEV_LOGIN', 'JWT_SECRET', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_REDIRECT_URI', 'FRONTEND_URL', 'BASE_DOMAIN'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function productionEnv(overrides = {}) {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DEV_LOGIN: 'false',
    JWT_SECRET: 'a-unique-production-secret-0123456789abcdef',
    AZURE_CLIENT_ID: 'client',
    AZURE_CLIENT_SECRET: 'secret',
    AZURE_TENANT_ID: 'tenant',
    AZURE_REDIRECT_URI: 'https://frontdoor.example.com/api/auth/microsoft/callback',
    FRONTEND_URL: 'https://frontdoor.example.com',
  }, overrides);
}

test('startup validation refuses missing, short and placeholder secrets in production', () => {
  productionEnv();
  assert.deepEqual(validateStartupEnv().errors, []);

  productionEnv({ JWT_SECRET: 'too-short' });
  assert.match(validateStartupEnv().errors.join('\n'), /at least 32 characters/);

  productionEnv({ JWT_SECRET: 'change-this-in-production' });
  assert.ok(validateStartupEnv().errors.length > 0);

  productionEnv();
  delete process.env.AZURE_CLIENT_ID;
  assert.deepEqual(validateStartupEnv().missing, ['AZURE_CLIENT_ID']);

  productionEnv({ FRONTEND_URL: 'not a url' });
  assert.match(validateStartupEnv().errors.join('\n'), /FRONTEND_URL/);
});

test('Dev Login is never enabled in production', () => {
  productionEnv({ DEV_LOGIN: 'true' });
  assert.equal(isDevLoginEnabled(), false);
  process.env.NODE_ENV = 'development';
  assert.equal(isDevLoginEnabled(), true);
});

let server;
let baseUrl;
before(async () => {
  process.env.JWT_SECRET ||= 'startup-auth-test-secret-0123456789abcdef';
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test('the dev-login endpoint answers 404 in production and logout clears the session cookie', async () => {
  productionEnv({ DEV_LOGIN: 'true', BASE_DOMAIN: 'example.com' });
  const dev = await fetch(`${baseUrl}/api/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"role":"owner"}' });
  assert.equal(dev.status, 404);
  assert.equal((await dev.json()).code, 'dev_login_disabled');

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
  assert.equal(logout.status, 200);
  const cookie = logout.headers.getSetCookie().find((value) => value.startsWith('frontdoor_token=;')) || '';
  assert.match(cookie, /^frontdoor_token=;/);
  assert.match(cookie, /Domain=\.example\.com/);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970/);
});

test('uploaded SVGs lose scripts, event handlers and external references', () => {
  const dirty = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <script>alert(1)</script>
    <circle r="10" onload="alert(2)" />
    <a href="javascript:alert(3)"><text>x</text></a>
    <image href="https://evil.example/track.png" />
    <foreignObject><div>html</div></foreignObject>
  </svg>`);
  const clean = sanitizeSvgBuffer(dirty).toString('utf8');
  assert.doesNotMatch(clean, /<script/i);
  assert.doesNotMatch(clean, /onload/i);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /foreignObject/i);
  assert.match(clean, /<circle/);
  assert.equal(sanitizeSvgBuffer(Buffer.from('<p>not svg</p>')), null);
});
