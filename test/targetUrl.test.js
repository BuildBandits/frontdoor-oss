import assert from 'node:assert/strict';
import test from 'node:test';

import { isPrivateIpLiteral, validateTargetUrl } from '../shared/targetUrl.js';

test('validateTargetUrl allows public URLs for redirect-plain mode', () => {
  assert.equal(validateTargetUrl('https://example.com', 'redirect-plain'), null);
});

test('validateTargetUrl blocks private IPs for redirect-plain mode', () => {
  assert.equal(validateTargetUrl('http://10.10.10.10:8082/Example/', 'redirect-plain'), 'target_url cannot point to private networks');
});

test('validateTargetUrl allows private IP literals for internal-link mode', () => {
  assert.equal(validateTargetUrl('http://10.10.10.10:8082/Example/', 'internal-link'), null);
  assert.equal(validateTargetUrl('https://[fd12:3456::1]/portal', 'internal-link'), null);
});

test('validateTargetUrl rejects hostnames for internal-link mode', () => {
  assert.equal(validateTargetUrl('http://intranet.example.local', 'internal-link'), 'internal-link target_url must use a private IP address');
});

test('isPrivateIpLiteral detects RFC1918 and ULA addresses', () => {
  assert.equal(isPrivateIpLiteral('10.1.2.3'), true);
  assert.equal(isPrivateIpLiteral('172.16.0.1'), true);
  assert.equal(isPrivateIpLiteral('192.168.1.1'), true);
  assert.equal(isPrivateIpLiteral('fd12:3456::1'), true);
  assert.equal(isPrivateIpLiteral('8.8.8.8'), false);
});
