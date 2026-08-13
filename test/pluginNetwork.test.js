import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  isPublicPluginAddress,
  deliverPluginWebhook,
  resolvePublicPluginEndpoint,
  validatePluginWebhookUrl,
} from '../server/services/pluginNetwork.js';

test('plugin webhook URL policy only accepts public standard-port HTTPS endpoints', () => {
  assert.equal(validatePluginWebhookUrl('https://plugins.example.com/hook'), null);

  for (const value of [
    'http://plugins.example.com/hook',
    'https://user:pass@plugins.example.com/hook',
    'https://plugins.example.com:8443/hook',
    'https://localhost/hook',
    'https://localhost./hook',
    'https://service.internal/hook',
    'https://service.internal./hook',
    'https://127.0.0.1/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[fc00::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://[::127.0.0.1]/hook',
  ]) {
    assert.match(validatePluginWebhookUrl(value) || '', /must use|cannot include|cannot point/);
  }
});

function createRequestHarness({ statusCode = 204, responseBody = '' } = {}) {
  const captured = {};
  const requestImpl = (url, options, onResponse) => {
    captured.url = url;
    captured.options = options;
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = (error) => request.emit('error', error);
    request.end = (body) => {
      captured.body = body;
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.resume = () => {
          if (responseBody) response.emit('data', Buffer.from(responseBody));
          response.emit('end');
        };
        onResponse(response);
      });
    };
    return request;
  };
  return { captured, requestImpl };
}

test('plugin webhook delivery pins the validated address and does not follow redirects', async () => {
  const harness = createRequestHarness({ statusCode: 302, responseBody: 'redirect-not-followed' });
  const result = await deliverPluginWebhook({
    url: 'https://plugins.example.com/hook',
    headers: { 'Content-Type': 'application/json' },
    body: '{"event":"auth.login"}',
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    requestImpl: harness.requestImpl,
  });

  assert.deepEqual(result, { ok: false, status: 302 });
  assert.equal(harness.captured.body.toString(), '{"event":"auth.login"}');
  const pinned = await new Promise((resolve, reject) => {
    harness.captured.options.lookup('plugins.example.com', {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 });
});

test('plugin webhook delivery bounds request and response bodies', async () => {
  await assert.rejects(
    deliverPluginWebhook({
      url: 'https://plugins.example.com/hook',
      headers: {},
      body: 'x'.repeat((64 * 1024) + 1),
    }),
    /payload exceeds 64 KiB/
  );

  const harness = createRequestHarness({ responseBody: 'x'.repeat((64 * 1024) + 1) });
  await assert.rejects(
    deliverPluginWebhook({
      url: 'https://plugins.example.com/hook',
      headers: {},
      body: '{}',
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      requestImpl: harness.requestImpl,
    }),
    /response exceeds 64 KiB/
  );
});

test('plugin webhook resolution rejects private and mixed DNS answers', async () => {
  const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const endpoint = await resolvePublicPluginEndpoint('https://plugins.example.com/hook', publicResolver);
  assert.equal(endpoint.address, '93.184.216.34');

  await assert.rejects(
    resolvePublicPluginEndpoint('https://plugins.example.com/hook', async () => [
      { address: '127.0.0.1', family: 4 },
    ]),
    /private or reserved/
  );

  await assert.rejects(
    resolvePublicPluginEndpoint('https://plugins.example.com/hook', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ]),
    /private or reserved/
  );
});

test('plugin network address policy covers IPv4 and IPv6 special ranges', () => {
  assert.equal(isPublicPluginAddress('93.184.216.34'), true);
  assert.equal(isPublicPluginAddress('2606:4700:4700::1111'), true);
  assert.equal(isPublicPluginAddress('10.0.0.1'), false);
  assert.equal(isPublicPluginAddress('127.0.0.1'), false);
  assert.equal(isPublicPluginAddress('::1'), false);
  assert.equal(isPublicPluginAddress('fe80::1'), false);
  assert.equal(isPublicPluginAddress('::ffff:127.0.0.1'), false);
});
