export const DEFAULT_TIME_ZONE = 'UTC';

function buildSupportedTimeZones() {
  try {
    const zones = typeof Intl?.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
    return [...new Set(zones.concat('UTC'))].sort((a, b) => a.localeCompare(b));
  } catch {
    return [DEFAULT_TIME_ZONE, 'Europe/Berlin'];
  }
}

export const SUPPORTED_TIME_ZONES = buildSupportedTimeZones();

export function isSupportedTimeZone(value) {
  return typeof value === 'string' && SUPPORTED_TIME_ZONES.includes(value);
}

export function normalizeTimeZone(value, fallback = DEFAULT_TIME_ZONE) {
  return isSupportedTimeZone(value) ? value : fallback;
}

export function normalizeOptionalTimeZone(value) {
  return isSupportedTimeZone(value) ? value : null;
}

export function resolveAppTimeZone(preferredTimeZone, defaultTimeZone = DEFAULT_TIME_ZONE) {
  return normalizeOptionalTimeZone(preferredTimeZone) || normalizeTimeZone(defaultTimeZone);
}

export function getSupportedTimeZoneOptions() {
  return SUPPORTED_TIME_ZONES.map((code) => ({ code, label: code }));
}
