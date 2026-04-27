import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import jwt from 'jsonwebtoken';

import { verifySsoTokenChain } from '../server/services/verifySsoToken.js';

/**
 * Unit tests for the SSO token introspection chain. Mirrors the schema
 * subset that the real handler queries, so the function is exercised
 * end-to-end against a real (in-memory) sqlite without booting Express.
 *
 * Rate limiting is not covered here — express-rate-limit lives at the
 * route level, not in this pure function. It is verified by hand against
 * a running instance and documented in the PR test plan.
 *
 * Run: npm test
 */

const SECRET = 'test-secret-do-not-use-in-prod';
const ISSUER = 'frontdoor';
const USER_ID = 'user-1';
const APP_SLUG = 'autoprompter';

let db;

function initSchema(database) {
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT,
      display_name TEXT,
      role TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE,
      is_active INTEGER DEFAULT 1
    );
  `);
}

function seed() {
  db.prepare('INSERT INTO users (id, email, display_name, role, is_active) VALUES (?, ?, ?, ?, 1)')
    .run(USER_ID, 'fabio@example.com', 'Fabio Lombardo', 'admin');
  db.prepare('INSERT INTO apps (id, slug, is_active) VALUES (?, ?, 1)')
    .run('app-1', APP_SLUG);
}

function makeToken(overrides = {}) {
  const { signWith = SECRET, expiresIn = '5m', ...claims } = overrides;
  return jwt.sign(
    { sub: USER_ID, aud: APP_SLUG, ...claims },
    signWith,
    { expiresIn, issuer: ISSUER }
  );
}

// Helper kept thin on purpose: a JS default like `expectedAud = APP_SLUG`
// would silently rewrite explicit `undefined` callers, hiding the
// "missing field" branch. Read-and-pass-through avoids that footgun.
function call(args) {
  const { token, expectedAud } = args.expectedAud === undefined && !('expectedAud' in args)
    ? { token: args.token, expectedAud: APP_SLUG }
    : args;
  return verifySsoTokenChain({
    token,
    expectedAud,
    jwtSecret: SECRET,
    expectedIssuer: ISSUER,
    dbHandle: db,
  });
}

describe('verifySsoTokenChain', () => {
  before(() => {
    db = new DatabaseSync(':memory:');
    initSchema(db);
  });

  beforeEach(() => {
    db.exec('DELETE FROM users; DELETE FROM apps;');
    seed();
  });

  it('returns 200 with minimal user payload on a valid token + matching aud', () => {
    const res = call({ token: makeToken() });
    assert.equal(res.status, 200);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.aud, APP_SLUG);
    assert.equal(typeof res.body.exp, 'number');
    assert.deepEqual(
      Object.keys(res.body.user).sort(),
      ['email', 'id', 'name', 'role'],
      'user payload must expose only id/email/name/role — no extra PII fields'
    );
    assert.equal(res.body.user.id, USER_ID);
    assert.equal(res.body.user.name, 'Fabio Lombardo');
  });

  it('returns 401 invalid_token on a broken signature', () => {
    const res = call({ token: makeToken({ signWith: 'wrong-secret' }) });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'invalid_token' });
  });

  it('returns 401 invalid_token on an expired token (no leak vs broken sig)', () => {
    const res = call({ token: makeToken({ expiresIn: '-1s' }) });
    assert.equal(res.status, 401);
    // Same error code as broken signature on purpose: callers cannot tell
    // expiration from signature failure.
    assert.deepEqual(res.body, { error: 'invalid_token' });
  });

  it('returns 401 invalid_issuer on a token signed by a different issuer', () => {
    const token = jwt.sign(
      { sub: USER_ID, aud: APP_SLUG },
      SECRET,
      { expiresIn: '5m', issuer: 'someone-else' }
    );
    const res = call({ token });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'invalid_issuer' });
  });

  it('returns 403 audience_mismatch when token aud != expected_aud', () => {
    const token = makeToken({ aud: 'translator' });
    const res = call({ token, expectedAud: APP_SLUG });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'audience_mismatch' });
  });

  it('returns 401 user_not_found_or_inactive when sub does not match any user', () => {
    const res = call({ token: makeToken({ sub: 'ghost-user' }) });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'user_not_found_or_inactive' });
  });

  it('returns 401 user_not_found_or_inactive when user is deactivated', () => {
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(USER_ID);
    const res = call({ token: makeToken() });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'user_not_found_or_inactive' });
  });

  it('returns 403 app_inactive when the requested app has been deactivated', () => {
    db.prepare('UPDATE apps SET is_active = 0 WHERE slug = ?').run(APP_SLUG);
    const res = call({ token: makeToken() });
    assert.equal(res.status, 403);
    assert.deepEqual(res.body, { error: 'app_inactive' });
  });

  it('returns 400 bad_request when token is missing', () => {
    const res = call({ token: undefined });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'bad_request' });
  });

  it('returns 400 bad_request when expected_aud is missing', () => {
    const res = call({ token: makeToken(), expectedAud: undefined });
    assert.equal(res.status, 400);
  });

  it('returns 400 bad_request when expected_aud has illegal characters', () => {
    for (const bad of ['foo bar', '../etc', 'UPPER', '-leading', 'trailing-', 'a'.repeat(64)]) {
      const res = call({ token: makeToken({ aud: bad }), expectedAud: bad });
      assert.equal(res.status, 400, `slug ${JSON.stringify(bad)} should be rejected`);
    }
  });

  it('accepts a valid single-character slug at the regex boundary', () => {
    db.prepare('INSERT INTO apps (id, slug, is_active) VALUES (?, ?, 1)').run('app-x', 'a');
    const token = makeToken({ aud: 'a' });
    const res = call({ token, expectedAud: 'a' });
    assert.equal(res.status, 200);
  });
});
