// Shrinks raster app icons in the browser before upload. Icons are shown at a few
// dozen pixels, but every image is decoded at its full size: a 2000×2000 PNG costs
// about 16 MB of memory per card, and Home shows every app at once.

export const MAX_ICON_DIMENSION = 256;
const RESIZABLE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
// Upper bound for files read into the page for resizing.
export const MAX_ICON_SOURCE_BYTES = 20 * 1024 * 1024;

export function isResizableIconType(type) {
  return RESIZABLE_TYPES.has(String(type || '').toLowerCase());
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('icon image could not be read'));
    image.src = src;
  });
}

/** Returns the data URL unchanged when it is small enough or not resizable, otherwise a downscaled copy. */
export async function downscaleIconDataUrl(dataUrl, type) {
  if (!isResizableIconType(type)) return dataUrl;
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height || Math.max(width, height) <= MAX_ICON_DIMENSION) return dataUrl;

  const scale = MAX_ICON_DIMENSION / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92);
}
