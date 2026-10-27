import { APP_DOCS_URL } from '../config/appInfo.js';

/** URL of a docs page (e.g. 'admins/backup') in the given language; null when docs links are off. */
export function docsUrl(page, language = 'en', baseUrl = APP_DOCS_URL) {
  if (!baseUrl) return null;
  // Every page has the same slug in both languages; English lives at the root.
  const prefix = language === 'it' ? '/it' : '';
  return `${baseUrl}${prefix}/docs/${page}/`;
}
