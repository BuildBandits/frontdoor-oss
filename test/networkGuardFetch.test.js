import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { fetchPublicJson, publicOnlyLookup } from '../server/services/networkGuard.js';

const lookupTo = (address) => async () => [{ address, family: address.includes(':') ? 6 : 4 }];
const lookupWith = (guard, host) => new Promise((resolve) => guard(host, { all: true }, (error, result) => resolve({ error, result })));

test('the connect-time lookup refuses private, loopback and link-local answers', async () => {
  for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fe80::1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:a00:1::1', 'fec0::1', '::a00:1']) {
    const { error } = await lookupWith(publicOnlyLookup(lookupTo(address)), 'rebind.example');
    assert.equal(error?.code, 'destination_not_public', address);
  }
  // One private answer among public ones is enough to refuse.
  const mixed = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }];
  assert.equal((await lookupWith(publicOnlyLookup(mixed), 'mixed.example')).error?.code, 'destination_not_public');
  const { error, result } = await lookupWith(publicOnlyLookup(lookupTo('93.184.216.34')), 'public.example');
  assert.equal(error, null);
  assert.deepEqual(result, [{ address: '93.184.216.34', family: 4 }]);
});

// A fake https.request: records options, answers with the given status, headers and body chunks.
function fakeRequest({ status = 200, headers = {}, chunks = [] } = {}) {
  const calls = [];
  const request = (url, options, onResponse) => {
    calls.push({ url: String(url), options });
    const req = new EventEmitter();
    req.end = () => setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = status;
      res.headers = headers;
      res.resume = () => {};
      res.destroy = () => res.emit('close');
      onResponse(res);
      for (const chunk of chunks) res.emit('data', Buffer.from(chunk));
      res.emit('end');
    });
    req.destroy = (error) => req.emit('error', error);
    return req;
  };
  return { request, calls };
}

test('only https URLs without credentials or private literals are fetched', async () => {
  for (const [url, code] of [
    ['http://client.example/meta.json', 'https_required'],
    ['https://user:pw@client.example/meta.json', 'invalid_url'],
    ['https://10.0.0.1/meta.json', 'destination_not_public'],
    ['https://[::1]/meta.json', 'destination_not_public'],
    ['not a url', 'invalid_url'],
  ]) {
    await assert.rejects(fetchPublicJson(url, { request: fakeRequest().request }), { code }, url);
  }
});

test('redirects, oversized bodies and non-JSON are refused; the guarded lookup is passed to the connection', async () => {
  await assert.rejects(fetchPublicJson('https://c.example/m', { request: fakeRequest({ status: 302, headers: { location: 'https://10.0.0.1/' } }).request }), { code: 'unexpected_status' });
  await assert.rejects(fetchPublicJson('https://c.example/m', { maxBytes: 10, request: fakeRequest({ headers: { 'content-length': '11' } }).request }), { code: 'response_too_large' });
  await assert.rejects(fetchPublicJson('https://c.example/m', { maxBytes: 10, request: fakeRequest({ chunks: ['{"a":', '"0123456789"}'] }).request }), { code: 'response_too_large' });
  await assert.rejects(fetchPublicJson('https://c.example/m', { request: fakeRequest({ chunks: ['<html>'] }).request }), { code: 'invalid_json' });

  const fake = fakeRequest({ chunks: ['{"client_id":"https://c.example/m"}'] });
  assert.deepEqual(await fetchPublicJson('https://c.example/m', { request: fake.request }), { client_id: 'https://c.example/m' });
  assert.equal(typeof fake.calls[0].options.lookup, 'function');
  assert.equal(fake.calls[0].options.timeout, 5000);
});

test('the deadline covers the whole exchange, not only idle time', async () => {
  const dripping = (url, options, onResponse) => {
    const req = new EventEmitter();
    let timer;
    req.end = () => setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      res.destroy = () => {};
      onResponse(res);
      timer = setInterval(() => res.emit('data', Buffer.from(' ')), 20); // a byte every 20 ms, never ends
    });
    req.destroy = (error) => { clearInterval(timer); req.emit('error', error); req.emit('close'); };
    return req;
  };
  const started = Date.now();
  await assert.rejects(fetchPublicJson('https://slow.example/m', { timeoutMs: 150, request: dripping }), { code: 'timeout' });
  assert.ok(Date.now() - started < 1000);
});
