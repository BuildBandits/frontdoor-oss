import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getUiStrings, isLanguageLoaded, loadLanguage } from '../src/i18n/index.js';
import { analyzeI18n, formatI18nReport } from '../scripts/check-i18n.mjs';

describe('i18n loading', () => {
  it('loads a dictionary only when asked, and falls back to a loaded one meanwhile', async () => {
    // This file loads nothing at import time, so the first test sees no dictionary.
    assert.equal(isLanguageLoaded('en'), false);
    assert.throws(() => getUiStrings('en'), /No UI language loaded/);
    await loadLanguage('en');
    assert.equal(isLanguageLoaded('it'), false);
    // Italian is requested and starts loading; English stands in until it arrives.
    assert.equal(getUiStrings('it'), getUiStrings('en'));
    await loadLanguage('it');
    assert.equal(isLanguageLoaded('it'), true);
    assert.notEqual(getUiStrings('it'), getUiStrings('en'));
  });
});

describe('i18n dictionaries', () => {
  it('have no duplicate keys', () => {
    const report = analyzeI18n();
    assert.equal(report.duplicates.length, 0, formatI18nReport(report));
  });

  it('stay aligned across locales', () => {
    const report = analyzeI18n();
    assert.equal(report.mismatches.length, 0, formatI18nReport(report));
  });

  it('return the same dictionary object for the same language', () => {
    // Components call getUiStrings during render and use the result in hook
    // dependencies; a fresh object per call re-runs those effects on every render.
    for (const language of ['en', 'it']) {
      assert.equal(getUiStrings(language), getUiStrings(language));
    }
    assert.equal(getUiStrings('not-a-language'), getUiStrings('en'));
    assert.notEqual(getUiStrings('it'), getUiStrings('en'));
  });

  it('expose the home tour strings in every locale', () => {
    for (const language of ['en', 'it']) {
      const ui = getUiStrings(language);
      assert.ok(ui.home.tour);
      assert.equal(typeof ui.home.tour.skip, 'string');
      assert.equal(typeof ui.home.tour.steps.welcome.title, 'string');
      assert.equal(typeof ui.home.tour.steps.welcome.body, 'string');
      assert.equal(typeof ui.home.tour.steps.reorder.body, 'string');
      assert.equal(typeof ui.home.tour.steps.menu.body, 'string');
      assert.equal(typeof ui.layout.takeTour, 'string');
    }
  });
});
