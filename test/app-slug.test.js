import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidAppSlug, normalizeAppSlug, suggestAppSlug, validateAppSlug } from '../shared/appSlug.js';

test('normalizeAppSlug converts names into safe slugs', () => {
  assert.equal(normalizeAppSlug('  My New App  '), 'my-new-app');
  assert.equal(normalizeAppSlug('Outlook (WebMail)'), 'outlook-webmail');
  assert.equal(normalizeAppSlug('Crème Brûlée Pro'), 'creme-brulee-pro');
});

test('normalizeAppSlug keeps custom slugs tidy', () => {
  assert.equal(normalizeAppSlug('  already--custom_slug  '), 'already-custom-slug');
  assert.equal(normalizeAppSlug('###'), '');
});

test('suggestAppSlug falls back to app when the name has no sluggable characters', () => {
  assert.equal(suggestAppSlug(''), 'app');
  assert.equal(suggestAppSlug('🚀'), 'app');
});

test('validateAppSlug accepts legal slugs and rejects invalid ones', () => {
  assert.equal(isValidAppSlug('valid-slug-123'), true);
  assert.equal(isValidAppSlug('invalid_slug'), false);
  assert.equal(isValidAppSlug('a'.repeat(63)), true);
  assert.equal(isValidAppSlug('a'.repeat(64)), false);

  assert.equal(validateAppSlug('valid-slug-123'), null);
  assert.equal(validateAppSlug(''), 'slug is required');
  assert.equal(validateAppSlug('a'.repeat(64)), 'slug must be lowercase alphanumeric with hyphens, 1-63 chars');
});
