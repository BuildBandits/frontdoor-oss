import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { constantTimeEqual, isValidS256Challenge, randomToken, sha256, verifyPkceS256 } from '../server/services/mcp/crypto.js';

test('random tokens carry 256 bits and never repeat', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
  assert.equal(tokens.size, 200);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
});

test('sha256 is hex and stable', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(constantTimeEqual('same', 'same'), true);
  assert.equal(constantTimeEqual('same', 'sama'), false);
  assert.equal(constantTimeEqual('short', 'longer'), false);
});

test('PKCE S256 accepts the RFC 7636 appendix B example and rejects everything else', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.equal(verifyPkceS256(verifier, challenge), true);
  assert.equal(verifyPkceS256(`${verifier.slice(0, -1)}l`, challenge), false);
  assert.equal(verifyPkceS256(verifier, verifier), false); // "plain" is not S256
  assert.equal(verifyPkceS256('too-short', challenge), false);
  assert.equal(verifyPkceS256('a'.repeat(129), challenge), false);
  assert.equal(verifyPkceS256(undefined, challenge), false);
  assert.equal(isValidS256Challenge(challenge), true);
  assert.equal(isValidS256Challenge(`${challenge}=`), false);
  assert.equal(isValidS256Challenge(crypto.randomBytes(16).toString('hex')), false);
});
