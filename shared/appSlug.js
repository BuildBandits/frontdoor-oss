function toAsciiSlugSource(value) {
  return (value ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeAppSlug(value, fallback = '') {
  const normalized = toAsciiSlugSource(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || fallback;
}

export function suggestAppSlug(name) {
  return normalizeAppSlug(name, '') || 'app';
}
