// Upload size limits for app icons and the branding logo, checked before any decoding
// or SVG parsing. SVG sanitizing builds a full DOM and grows faster than linearly
// with the file size, so SVGs get a lower limit than raster images.
export const MAX_SVG_ICON_BYTES = 512 * 1024;
export const MAX_RASTER_ICON_BYTES = 1024 * 1024;
export const MAX_RASTER_LOGO_BYTES = 2 * 1024 * 1024;

// Upper bound of the decoded size of a data URL, from its length, without decoding it.
export function estimateDataUrlBytes(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const comma = dataUrl.indexOf(',');
  const payloadLength = comma === -1 ? dataUrl.length : dataUrl.length - comma - 1;
  return /;base64,/i.test(dataUrl.slice(0, comma + 1)) ? Math.ceil((payloadLength * 3) / 4) : payloadLength;
}
