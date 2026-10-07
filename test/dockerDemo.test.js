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
      }),
  );
}

test('the demo Compose file enables Dev Login only on the loopback interface', () => {
  const compose = fs.readFileSync('docker-compose.demo.yml', 'utf8');

  assert.match(compose, /^\s*- "127\.0\.0\.1:3001:3001"$/m);
  assert.equal(compose.match(/:3001:3001"/g).length, 1, 'no other published port');
  assert.match(compose, /- NODE_ENV=development$/m);
  assert.match(compose, /- DEV_LOGIN=true$/m);
  assert.match(compose, /- ENTRA_GROUP_SYNC=false$/m);
  assert.match(compose, /frontdoor-demo-data:\/data/, 'separate data volume');
  assert.doesNotMatch(compose, /env_file|\$\{/, 'nothing is read from .env');
});

test('the deployment Compose file and its example stay production-only', () => {
  const compose = fs.readFileSync('docker-compose.yml', 'utf8');
  assert.match(compose, /- NODE_ENV=production$/m);
  assert.doesNotMatch(compose, /DEV_LOGIN/);

  const env = parseEnv(fs.readFileSync('.env.example.docker', 'utf8'));
  assert.equal(env.NODE_ENV, 'production');
  assert.notEqual(env.DEV_LOGIN, 'true');
});
