import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blockedAddresses = new BlockList();

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6');
}

function stripIpv6Brackets(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

export function isPublicPluginAddress(address) {
  const normalized = stripIpv6Brackets(String(address || '').trim().toLowerCase());
  if (!normalized || normalized.includes('%')) return false;
  if (normalized.startsWith('::')) {
    return false;
  }
  const family = isIP(normalized);
  if (family === 4) return !blockedAddresses.check(normalized, 'ipv4');
  if (family === 6) return !blockedAddresses.check(normalized, 'ipv6');
  return false;
}

export function validatePluginWebhookUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (String(value).length > 2048) return 'backendUrl exceeds the 2048 character limit';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'backendUrl must be a valid URL';
  }

  if (parsed.protocol !== 'https:') return 'backendUrl must use https';
  if (parsed.username || parsed.password) return 'backendUrl cannot include credentials';
  if (parsed.port && parsed.port !== '443') return 'backendUrl must use the standard HTTPS port';

  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase().replace(/\.+$/, '');
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.home.arpa')
  ) {
    return 'backendUrl cannot point to a private network';
  }
  if (isIP(hostname) && !isPublicPluginAddress(hostname)) {
    return 'backendUrl cannot point to a private network';
  }
  return null;
}

export async function resolvePublicPluginEndpoint(value, resolver = dnsLookup) {
  const validationError = validatePluginWebhookUrl(value);
  if (validationError) throw new Error(validationError);

  const url = new URL(value);
  const hostname = stripIpv6Brackets(url.hostname).replace(/\.+$/, '');
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolver(hostname, { all: true, verbatim: true });

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('backendUrl hostname did not resolve');
  }
  if (addresses.some(({ address }) => !isPublicPluginAddress(address))) {
    throw new Error('backendUrl resolved to a private or reserved network');
  }

  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function deliverPluginWebhook({
  url,
  headers,
  body,
  timeoutMs = 5_000,
  resolver = dnsLookup,
  requestImpl = httpsRequest,
}) {
  const payload = Buffer.from(String(body || ''), 'utf8');
  if (payload.length > 64 * 1024) {
    throw new Error('Plugin event payload exceeds 64 KiB');
  }
  const endpoint = await resolvePublicPluginEndpoint(url, resolver);

  return new Promise((resolve, reject) => {
    let settled = false;
    let totalTimeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeout);
      callback(value);
    };
    const request = requestImpl(endpoint.url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': String(payload.length),
      },
      servername: stripIpv6Brackets(endpoint.url.hostname).replace(/\.+$/, ''),
      lookup: (_hostname, options, callback) => {
        if (options?.all) {
          callback(null, [{ address: endpoint.address, family: endpoint.family }]);
        } else {
          callback(null, endpoint.address, endpoint.family);
        }
      },
    }, (response) => {
      let responseBytes = 0;
      response.on('data', (chunk) => {
        responseBytes += Buffer.byteLength(chunk);
        if (responseBytes > 64 * 1024) {
          request.destroy(new Error('Plugin backend response exceeds 64 KiB'));
        }
      });
      response.once('end', () => {
        const status = response.statusCode || 0;
        finish(resolve, { ok: status >= 200 && status < 300, status });
      });
      response.once('error', (error) => finish(reject, error));
      response.resume();
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error('Plugin backend request timed out')));
    totalTimeout = setTimeout(
      () => request.destroy(new Error('Plugin backend request timed out')),
      timeoutMs
    );
    request.once('error', (error) => finish(reject, error));
    request.end(payload);
  });
}
