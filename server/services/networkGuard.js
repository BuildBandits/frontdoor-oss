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

function guardError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * A `lookup` for node:http(s) that refuses non-public addresses. The check runs
 * inside the connection's own DNS resolution, so there is no window between
 * "checked" and "connected" for DNS rebinding to exploit.
 */
export function publicOnlyLookup(baseLookup = dns.lookup) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options !== null ? options : {};
    Promise.resolve(baseLookup(hostname, { ...opts, all: true, verbatim: true }))
      .then((addresses) => {
        const list = Array.isArray(addresses) ? addresses : [addresses];
        if (list.length === 0 || list.some(({ address }) => isPrivateAddress(address))) {
          return done(guardError('destination_not_public', 'Destination address is not public'));
        }
        if (opts.all) return done(null, list);
        return done(null, list[0].address, list[0].family);
      })
      .catch((error) => done(error));
  };
}

/**
 * Sends one request to a public http(s) destination and resolves with its
 * status. The address is checked at connect time (and up front for IP
 * literals), redirects are never followed, and `timeoutMs` bounds the whole
 * exchange. Rejects with code `destination_not_public` for private targets.
 * `request` is injectable for tests; production uses node:http / node:https.
 */
export async function requestPublic(url, { method = 'POST', headers = {}, body, timeoutMs = 5000, lookup = dns.lookup, request } = {}) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw guardError('protocol_not_allowed', 'Only http and https are allowed');
  }
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) {
    throw guardError('destination_not_public', 'Destination address is not public');
  }
  const transport = (await import(target.protocol === 'https:' ? 'node:https' : 'node:http')).default;
  const doRequest = request || transport.request.bind(transport);
  return new Promise((resolve, reject) => {
    const req = doRequest(target, { method, headers, lookup: publicOnlyLookup(lookup) }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
      res.on('error', reject);
    });
    const deadline = setTimeout(() => req.destroy(guardError('timeout', 'Request timed out')), timeoutMs);
    deadline.unref?.();
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
