// Plugin webhooks must not reach private addresses through DNS rebinding: a
// host that resolves to a public address when checked and to a private one
// when the connection is made. Before the fix the check (isPublicDestination)
// and the connection (fetch) resolved DNS separately.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';

const { default: db } = await import('../server/db.js');
const { dispatchPluginEvent, upsertPluginRegistry, approvePluginRegistry } = await import('../server/services/plugins.js');

let internal;
let internalPort;
let internalHits = 0;

before(async () => {
  // Stands for an internal service only reachable from the Frontdoor host.
  internal = http.createServer((req, res) => {
    internalHits += 1;
    res.writeHead(200).end('ok');
  });
  await new Promise((resolve) => internal.listen(0, '127.0.0.1', resolve));
  internalPort = internal.address().port;
  db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();
});

after(() => new Promise((resolve) => internal.close(resolve)));

// Answers for rebind.test, in order; the last one repeats. Both DNS APIs are
// mocked because the old code checked with dns.promises and connected through
// fetch, which resolves with the callback API.
function mockDns(t, answers) {
  let calls = 0;
  const answer = () => answers[Math.min(calls++, answers.length - 1)];
  t.mock.method(dns.promises, 'lookup', async (hostname, options = {}) => {
    if (hostname !== 'rebind.test') throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    const record = answer();
    return options.all ? [record] : record;
  });
  t.mock.method(dns, 'lookup', (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options !== null ? options : {};
    if (hostname !== 'rebind.test') return done(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
    const record = answer();
    return opts.all ? done(null, [record]) : done(null, record.address, record.family);
  });
  return () => calls;
}

const PUBLIC = { address: '192.0.2.1', family: 4 }; // TEST-NET-1 (RFC 5737): public, never routed
const LOOPBACK = { address: '127.0.0.1', family: 4 };

function registerHook(id) {
  upsertPluginRegistry({
    id, name: id, version: '1.0.0', entry: 'https://plugins.example.com/r.mjs',
    backendEnabled: true, backendUrl: `http://rebind.test:${internalPort}/hook`, eventSubscriptions: ['auth.login'],
  });
  approvePluginRegistry(id, 'owner-1');
}

test('a host answering a private address when the connection is made is refused', async (t) => {
  mockDns(t, [LOOPBACK]);
  registerHook('loopback-hook');
  const summary = await dispatchPluginEvent('auth.login', {}, { targetPluginId: 'loopback-hook' });
  assert.equal(internalHits, 0);
  assert.equal(summary.failed, 1);
  assert.equal(summary.errors[0].message, 'Backend webhook destination is not allowed');
});

test('a host rebinding to a private address after the first answer is never reached', async (t) => {
  // Public for the first query, loopback afterwards, as an attacker-controlled
  // DNS server with a 0 s TTL would answer. The old code checked with the first
  // answer and connected with the second.
  const queries = mockDns(t, [PUBLIC, LOOPBACK]);
  registerHook('rebind-hook');
  const summary = await dispatchPluginEvent('auth.login', {}, { targetPluginId: 'rebind-hook' });
  assert.equal(internalHits, 0, 'the internal service must not receive the webhook');
  assert.equal(queries(), 1, 'the checked answer is the one connected to');
  assert.equal(summary.delivered, 0);
  assert.equal(summary.failed, 1);
});
