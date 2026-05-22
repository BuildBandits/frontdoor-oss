export const HOME_TOUR_REPLAY_EVENT = 'frontdoor:home-tour-replay';
export const HOME_TOUR_ACCOUNT_MENU_OPEN_EVENT = 'frontdoor:home-tour-account-menu-open';
export const HOME_TOUR_ACCOUNT_MENU_CLOSE_EVENT = 'frontdoor:home-tour-account-menu-close';

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
