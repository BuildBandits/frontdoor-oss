import test from 'node:test';
import assert from 'node:assert/strict';

import { isSafeReturnPath, loginPathFor } from '../src/utils/returnPath.js';

test('only same-origin paths are accepted as sign-in return paths', () => {
  for (const path of ['/admin/users', '/admin/audit?page=2', '/apps#top']) {
    assert.equal(isSafeReturnPath(path), true, path);
  }
  for (const path of ['//evil.example', String.raw`/\evil.example`, 'https://evil.example', '/login', '/login?next=/x', '/', '', null, `/${'a'.repeat(600)}`]) {
    assert.equal(isSafeReturnPath(path), false, String(path));
  }
});

test('the login link carries the page to return to', () => {
  assert.equal(loginPathFor({ pathname: '/admin/users', search: '?q=ann' }), `/login?next=${encodeURIComponent('/admin/users?q=ann')}`);
  assert.equal(loginPathFor({ pathname: '/', search: '' }), '/login');
  assert.equal(loginPathFor({ pathname: '//evil.example', search: '' }), '/login');
});
