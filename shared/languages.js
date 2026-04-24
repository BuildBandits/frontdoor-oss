export const DEFAULT_LANGUAGE = 'en';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', labelKey: 'english' },
  { code: 'it', labelKey: 'italian' },
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((language) => language.code);

export function isSupportedLanguage(value) {
  return SUPPORTED_LANGUAGE_CODES.includes(value);
}
