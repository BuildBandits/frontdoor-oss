import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT,
  HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT,
  HOME_TOUR_REPLAY_EVENT,
  requestHomeTourAccountMenuClose,
  requestHomeTourAccountMenuOpen,
  requestHomeTourReplay,
} from '../src/utils/homeTour.js';
import { detectBrowser, getBrowserHomepageDocs } from '../src/utils/browserHomeDocs.js';

describe('home tour helpers', () => {
  it('exposes the replay event name', () => {
    assert.equal(HOME_TOUR_REPLAY_EVENT, 'frontdoor:home-tour-replay');
  });

  it('does not throw when replay is requested without a browser window', () => {
    assert.doesNotThrow(() => requestHomeTourReplay());
  });

  it('does not throw when the tour requests the account menu to open or close', () => {
    assert.doesNotThrow(() => requestHomeTourAccountMenuOpen());
    assert.doesNotThrow(() => requestHomeTourAccountMenuClose());
    assert.equal(HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT, 'frontdoor:home-tour-account-menu-open');
    assert.equal(HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT, 'frontdoor:home-tour-account-menu-close');
  });

  it('detects the browser and prioritizes its homepage guide', () => {
    const docs = getBrowserHomepageDocs(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'it'
    );

    assert.equal(detectBrowser('Mozilla/5.0 Firefox/126.0'), 'firefox');
    assert.equal(docs[0].browser, 'chrome');
    assert.equal(docs[0].detected, true);
    assert.ok(docs.some((doc) => doc.browser === 'firefox'));
  });
});
