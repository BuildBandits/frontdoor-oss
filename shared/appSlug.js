function toAsciiSlugSource(value) {
  return (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

const APP_SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeAppSlug(value, fallback = '') {
  const normalized = toAsciiSlugSource(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}

export function isValidAppSlug(value) {
  return APP_SLUG_RE.test((value ?? '').toString().trim());
}

export function validateAppSlug(value) {
  const slug = (value ?? '').toString().trim();
  if (!slug) {
    return 'slug is required';
  }

  if (!isValidAppSlug(slug)) {
    return 'slug must be lowercase alphanumeric with hyphens, 1-63 chars';
  }

  return null;
}

export function suggestAppSlug(name) {
  return normalizeAppSlug(name, '') || 'app';
}
