import en from './en.json' with { type: 'json' };
import it from './it.json' with { type: 'json' };
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
} from '../../shared/languages.js';

export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };

const DICTIONARIES = {
  en,
  it,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  const output = { ...target };
  Object.entries(source || {}).forEach(([key, value]) => {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
      return;
    }
    output[key] = value;
  });
  return output;
}

export function normalizeLanguage(value) {
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function normalizeOptionalLanguage(value) {
  return isSupportedLanguage(value) ? value : null;
}

export function resolveAppLanguage(preferredLanguage, defaultLanguage) {
  return normalizeOptionalLanguage(preferredLanguage) || normalizeLanguage(defaultLanguage);
}

export function getSupportedLanguageOptions(ui) {
  return SUPPORTED_LANGUAGES.map((language) => ({
    code: language.code,
    label: ui?.common?.[language.labelKey] || language.code,
  }));
}

// Cached per language so callers get a stable object: components call this during
// render and pass the result (or values derived from it) to hook dependency lists.
const uiStringsCache = new Map();

export function getUiStrings(language) {
  const normalized = normalizeLanguage(language);
  if (!uiStringsCache.has(normalized)) {
    uiStringsCache.set(normalized, deepMerge(en, DICTIONARIES[normalized] || {}));
  }
  return uiStringsCache.get(normalized);
}


/** Replace `{name}` placeholders in a UI string; unknown placeholders are left as is. */
export function formatMessage(template, values = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (
    values[key] === undefined || values[key] === null ? match : String(values[key])
  ));
}
