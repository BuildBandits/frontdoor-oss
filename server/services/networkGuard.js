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
