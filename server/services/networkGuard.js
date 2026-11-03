import dns from 'node:dns/promises';
import net from 'node:net';

// Addresses outbound requests chosen by admins (plugin webhooks) must never reach:
// loopback, private, link-local, carrier-grade NAT, unspecified and multicast ranges.
const blocked = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) {
  blocked.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  blocked.addSubnet(address, prefix, 'ipv6');
}

export function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true;
}

/**
 * Resolves the URL host and returns true only if every address it resolves to is public.
 * `lookup` can be replaced in tests.
 */
export async function isPublicDestination(url, { lookup = dns.lookup } = {}) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (!host) return false;
  if (net.isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

/**
 * A `lookup` for node:http(s) that refuses non-public addresses. Because the
 * check runs inside the connection's own DNS resolution, there is no window
 * between "checked" and "connected" for DNS rebinding to exploit.
 */
export function publicOnlyLookup(baseLookup = dns.lookup) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options !== null ? options : {};
    Promise.resolve(baseLookup(hostname, { ...opts, all: true, verbatim: true }))
      .then((addresses) => {
        const list = Array.isArray(addresses) ? addresses : [addresses];
        if (list.length === 0 || list.some(({ address }) => isPrivateAddress(address))) {
          const error = new Error('Destination address is not public');
          error.code = 'destination_not_public';
          return done(error);
        }
        if (opts.all) return done(null, list);
        return done(null, list[0].address, list[0].family);
      })
      .catch((error) => done(error));
  };
}

function guardError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * GET a small JSON document from a public HTTPS URL: no redirects, bounded
 * size and time, address checked at connect time. `request` is injectable for
 * tests; production uses node:https.
 */
export async function fetchPublicJson(url, { maxBytes = 64 * 1024, timeoutMs = 5000, lookup = dns.lookup, request } = {}) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw guardError('invalid_url', 'Invalid URL');
  }
  if (target.protocol !== 'https:') throw guardError('https_required', 'Only https URLs are fetched');
  if (target.username || target.password) throw guardError('invalid_url', 'Credentials in URL are not allowed');
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) throw guardError('destination_not_public', 'Destination address is not public');

  const doRequest = request || (await import('node:https')).request;
  return new Promise((resolve, reject) => {
    const req = doRequest(target, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'frontdoor-mcp/1.0' },
      lookup: publicOnlyLookup(lookup),
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(guardError('unexpected_status', `Unexpected status ${res.statusCode}`));
      }
      const declared = Number(res.headers?.['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.destroy();
        return reject(guardError('response_too_large', 'Response too large'));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          res.destroy();
          reject(guardError('response_too_large', 'Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (size > maxBytes) return;
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(guardError('invalid_json', 'Response is not JSON'));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(guardError('timeout', 'Request timed out')));
    req.on('error', reject);
    req.end();
  });
}
