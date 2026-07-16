import net from 'node:net';

function normalizeHostname(hostname) {
  return hostname.replace(/^\[(.*)\]$/, '$1');
}

function isPrivateIpv4(hostname) {
  const normalized = normalizeHostname(hostname);
  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const normalized = normalizeHostname(hostname).toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return net.isIP(mappedIpv4) === 4 && isPrivateIpv4(mappedIpv4);
  }

  const firstHextet = normalized.split(':', 1)[0];
  return /^f[c-d][0-9a-f]{2}$/i.test(firstHextet);
}

export function isPrivateIpLiteral(hostname) {
  const normalized = normalizeHostname(hostname);
  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalized);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(normalized);
  }

  return false;
}

function isBlockedExternalHostname(hostname) {
  if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::' || hostname === '::1') {
    return true;
  }

  return isPrivateIpLiteral(hostname) || hostname.startsWith('127.') || hostname.startsWith('169.254.');
}

export function validateTargetUrl(targetUrl, mode = 'redirect-plain') {
  try {
    const parsed = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return 'target_url must use http or https';
    }

    const hostname = normalizeHostname(parsed.hostname);

    if (mode === 'internal-link') {
      if (net.isIP(hostname) === 0 || !isPrivateIpLiteral(hostname)) {
        return 'internal-link target_url must use a private IP address';
      }
      return null;
    }

    if (isBlockedExternalHostname(hostname)) {
      return 'target_url cannot point to private networks';
    }

    return null;
  } catch {
    return 'target_url must be a valid URL';
  }
}
