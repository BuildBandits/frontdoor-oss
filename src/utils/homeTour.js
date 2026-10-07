export const HOME_TOUR_REPLAY_EVENT = 'frontdoor:home-tour-replay';
export const HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT = 'frontdoor:home-tour-account-menu-open';
export const HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT = 'frontdoor:home-tour-account-menu-close';
export const HOME_TOUR_HOMEPAGE_DOCS_EVENT = 'frontdoor:home-tour-homepage-docs';

export function requestHomeTourReplay() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(HOME_TOUR_REPLAY_EVENT));
}

export function requestHomeTourAccountMenuOpen() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT));
}

export function requestHomeTourAccountMenuClose() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT));
}

export function requestHomeTourHomepageDocs() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(HOME_TOUR_HOMEPAGE_DOCS_EVENT));
}

// Steps of the Home tour, in order. Desktop shows the drag-to-reorder step and
// opens the account dropdown; mobile has no reordering and shows the hamburger
// button first, since the menu lives behind it.
export function getHomeTourStepKeys({ mobile = false } = {}) {
  return [
    'welcome',
    'search',
    'catalog',
    'appCards',
    ...(mobile ? ['menuButton'] : ['reorder']),
    'menu',
    'homepage',
  ];
}
