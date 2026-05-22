export const DEFAULT_COLOR_SCHEME = 'light';

export const SUPPORTED_COLOR_SCHEMES = ['light', 'dark', 'auto'];

export function isSupportedColorScheme(value) {
  return SUPPORTED_COLOR_SCHEMES.includes(value);
}

export function normalizeColorScheme(value, fallback = DEFAULT_COLOR_SCHEME) {
  return isSupportedColorScheme(value) ? value : fallback;
}

export function normalizeOptionalColorScheme(value) {
  return isSupportedColorScheme(value) ? value : null;
}

export function resolveAppColorScheme(preferred, fallback) {
  return normalizeOptionalColorScheme(preferred) || normalizeColorScheme(fallback);
}
