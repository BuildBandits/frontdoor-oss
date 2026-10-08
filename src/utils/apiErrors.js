import { formatMessage } from '../i18n/index.js';

// Bare machine codes such as "failed_to_update_branding" are never shown to users.
const MACHINE_CODE_RE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Turn an API failure into a translated message.
 * Accepts an axios error, a fetch response payload ({ error, code, details }) or an Error
 * carrying a `code` (e.g. plugin archive errors). Lookup order: `ui.errors[code]`, then the
 * server `error` text when it is human readable, then the translated fallback.
 */
export function apiErrorMessage(error, ui, fallback) {
  const payload = isPlainObject(error?.response?.data)
    ? error.response.data
    : (error instanceof Error ? null : error);
  const code = payload?.code || error?.code;
  const dictionary = ui?.errors || {};
  const values = isPlainObject(payload?.details) ? payload.details : {};

  if (typeof code === 'string' && dictionary[code]) {
    return formatMessage(dictionary[code], values);
  }

  const serverText = typeof payload?.error === 'string' ? payload.error.trim() : '';
  if (serverText && dictionary[serverText]) {
    return formatMessage(dictionary[serverText], values);
  }
  if (serverText && !MACHINE_CODE_RE.test(serverText)) {
    return serverText;
  }

  return fallback || dictionary.generic || '';
}
