import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
}

test('Docker example is a loopback-only Dev Login profile with no Azure requirement', () => {
  const env = parseEnv(fs.readFileSync('.env.example.docker', 'utf8'));

  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.DEV_LOGIN, 'true');
  assert.equal(env.FRONTDOOR_BIND_ADDRESS, '127.0.0.1');
  assert.equal(env.AZURE_CLIENT_ID, '');
  assert.equal(env.AZURE_CLIENT_SECRET, '');
  assert.equal(env.AZURE_TENANT_ID, '');
  assert.equal(env.JWT_SECRET, '');
  assert.equal(env.ENTRA_GROUP_SYNC, 'false');
});

test('Compose forwards demo settings while retaining production-safe defaults', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');

  assert.match(compose, /NODE_ENV=\$\{NODE_ENV:-production\}/);
  assert.match(compose, /DEV_LOGIN=\$\{DEV_LOGIN:-false\}/);
  assert.match(compose, /\$\{FRONTDOOR_BIND_ADDRESS:-0\.0\.0\.0\}:3001:3001/);
});
