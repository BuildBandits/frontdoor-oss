import path from 'path';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

// DOMPurify needs a window; create one synchronous JSDOM instance and reuse.
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Strip script, on*-attributes, foreignObject, external use, and dangerous embed tags.
// USE_PROFILES.svg whitelists the core SVG element set; FORBID_* hardens edge cases.
const SVG_PURIFY_OPTIONS = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'use'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange'],
};

export function isSvgContentType(contentType) {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('svg');
}

export function isSvgBuffer(buffer) {
  if (!buffer?.length) return false;
  const head = buffer.subarray(0, 1024).toString('utf8');
  return /<svg[\s>]/i.test(head);
}

// Returns a sanitized SVG Buffer or null if the input is not parseable SVG.
export function sanitizeSvgBuffer(buffer) {
  if (!buffer?.length) return null;
  const svgText = buffer.toString('utf8');
  if (!/<svg[\s>]/i.test(svgText)) return null;
  const cleaned = DOMPurify.sanitize(svgText, SVG_PURIFY_OPTIONS);
  return Buffer.from(cleaned, 'utf8');
}

// Defense in depth: serve uploaded SVGs with a hardened CSP + sandbox so even
// if a script slips past DOMPurify it cannot execute or reach the parent origin.
// Icons still display normally when loaded via <img>, which never runs SVG scripts.
export function applySvgSafeHeaders(res, fileName) {
  // Match the historical Content-Type exactly (no charset) — SVG declares its
  // encoding in the XML prolog, and downstream tests/consumers compare strict.
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (fileName) {
    const safeName = path.basename(fileName).replace(/"/g, '');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  }
}
