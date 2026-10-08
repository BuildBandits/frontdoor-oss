// Raster image types accepted for uploaded icons; SVG goes through the sanitizer instead.
export const RASTER_ICON_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif', 'image/x-icon']);

export function normalizeImageContentType(contentType) {
  const normalized = String(contentType || '').trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/vnd.microsoft.icon') return 'image/x-icon';
  return normalized;
}
