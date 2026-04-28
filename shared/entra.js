const MYAPPS_LAUNCHER_HOST = 'launcher.myapps.microsoft.com';
const APPLICATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractMyAppsApplicationId(value) {
  const raw = (value ?? '').toString().trim();
  if (!raw) return null;

  if (APPLICATION_ID_PATTERN.test(raw)) {
    return raw.toLowerCase();
  }

  try {
    const parsed = new URL(raw);
    if (parsed.hostname.toLowerCase() !== MYAPPS_LAUNCHER_HOST) return null;
    const match = parsed.pathname.match(/^\/api\/signin\/([^/?#]+)/i);
    if (!match) return null;
    const candidate = decodeURIComponent(match[1]).trim();
    return APPLICATION_ID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
  } catch {
    const match = raw.match(/launcher\.myapps\.microsoft\.com\/api\/signin\/([^/?#]+)/i);
    if (!match) return null;
    const candidate = decodeURIComponent(match[1]).trim();
    return APPLICATION_ID_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
  }
}

export function normalizeEntraApplicationId(value) {
  const raw = (value ?? '').toString().trim();
  return extractMyAppsApplicationId(raw) || raw;
}

export function isValidEntraApplicationId(value) {
  return APPLICATION_ID_PATTERN.test((value ?? '').toString().trim());
}
