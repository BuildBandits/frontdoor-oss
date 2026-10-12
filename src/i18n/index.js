import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
} from '../../shared/languages.js';

export { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE };

// Dictionaries are loaded on demand, so a page only downloads the language it shows
// (each one is a separate chunk of about 90 kB). No `with { type: 'json' }` here: the
// Vite dev server serves JSON as a JavaScript module, which the browser then refuses
// as a JSON module (blank page). Tests add the attribute in test/setup.js.
const DICTIONARY_LOADERS = {
  en: () => import('./en.json'),
  it: () => import('./it.json'),
};

const dictionaries = new Map();
const pendingLoads = new Map();
const listeners = new Set();
let loadedVersion = 0;

/** Loads a language's dictionary (once); resolves when getUiStrings can return it. */
export function loadLanguage(language) {
  const normalized = normalizeLanguage(language);
  if (dictionaries.has(normalized)) return Promise.resolve();
  if (!pendingLoads.has(normalized)) {
    const load = DICTIONARY_LOADERS[normalized]()
      .then((module) => {
        dictionaries.set(normalized, module.default);
        loadedVersion += 1;
        listeners.forEach((listener) => listener());
      })
      .finally(() => pendingLoads.delete(normalized));
    pendingLoads.set(normalized, load);
  }
  return pendingLoads.get(normalized);
}

export function isLanguageLoaded(language) {
  return dictionaries.has(normalizeLanguage(language));
}

/** For useSyncExternalStore: re-render when a dictionary finishes loading. */
export function subscribeToLanguages(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLoadedLanguagesVersion() {
  return loadedVersion;
}

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

/**
 * UI strings for a language. When its dictionary is not loaded yet, loading starts
 * and the strings of a loaded language are returned meanwhile (the app renders only
 * after the first dictionary is loaded and re-renders when the next one arrives).
 */
export function getUiStrings(language) {
  const normalized = normalizeLanguage(language);
  if (!dictionaries.has(normalized)) {
    void loadLanguage(normalized).catch(() => {});
    const fallback = dictionaries.has(DEFAULT_LANGUAGE) ? DEFAULT_LANGUAGE : dictionaries.keys().next().value;
    if (!fallback) throw new Error('No UI language loaded yet: await loadLanguage() first');
    return getUiStrings(fallback);
  }
  if (!uiStringsCache.has(normalized)) {
    // English fills any key a translation lacks, when it is loaded.
    const base = dictionaries.get(DEFAULT_LANGUAGE) || {};
    uiStringsCache.set(normalized, deepMerge(base, dictionaries.get(normalized)));
  }
  return uiStringsCache.get(normalized);
}

/** Replace `{name}` placeholders in a UI string; unknown placeholders are left as is. */
export function formatMessage(template, values = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) => (
    values[key] === undefined || values[key] === null ? match : String(values[key])
  ));
}
