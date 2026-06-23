import { DEFAULT_TIME_ZONE, normalizeTimeZone } from '../../shared/timeZones.js';

export function parseServerTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return new Date(value);
  if (/[zZ]$/.test(value) || /[+-]\d\d:\d\d$/.test(value)) {
    return new Date(value);
  }
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function formatWithTimeZoneFallback(parsed, locale, options, fallbackTimeZone) {
  try {
    return new Intl.DateTimeFormat(locale, options).format(parsed);
  } catch (error) {
    if (!fallbackTimeZone || options?.timeZone === fallbackTimeZone) {
      return null;
    }
    const { timeZone, ...rest } = options || {};
    try {
      return new Intl.DateTimeFormat(locale, {
        ...rest,
        timeZone: fallbackTimeZone,
      }).format(parsed);
    } catch {
      return null;
    }
  }
}

export function formatDateTimeWithTimeZone(value, {
  locale,
  timeZone,
  dateOptions,
  timeOptions,
} = {}) {
  const parsed = parseServerTimestamp(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;

  const fallbackTimeZone = DEFAULT_TIME_ZONE;
  const resolvedTimeZone = normalizeTimeZone(timeZone, fallbackTimeZone);
  const formattedDate = formatWithTimeZoneFallback(parsed, locale, {
    ...(dateOptions || {}),
    timeZone: resolvedTimeZone,
  }, fallbackTimeZone);

  const formattedTime = formatWithTimeZoneFallback(parsed, locale, {
    ...(timeOptions || {}),
    timeZone: resolvedTimeZone,
  }, fallbackTimeZone);

  return { parsed, formattedDate, formattedTime };
}
