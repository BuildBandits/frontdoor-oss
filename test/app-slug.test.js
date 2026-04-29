import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAppSlug, suggestAppSlug } from '../shared/appSlug.js';

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
