'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');

test('implements the RFC 8785 ordering and ECMAScript number serialization basis', () => {
  const value = { z: 4.50, a: [333333333.33333329, 1E30, 2e-3, 0.000000000000000000000000001], middle: '€' };
  const encoded = '{"a":[333333333.3333333,1e+30,0.002,1e-27],"middle":"€","z":4.5}';
  assert.equal(canonicalJson(value), encoded);
  assert.equal(canonicalDigest(value), crypto.createHash('sha256').update(encoded, 'utf8').digest('hex'));
});

test('rejects non-I-JSON values instead of silently changing the digest basis', () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), (error) => error.code === 'P3_JCS_NON_FINITE_NUMBER');
  assert.throws(() => canonicalJson({ value: undefined }), (error) => error.code === 'P3_JCS_NON_JSON_VALUE');
  assert.throws(() => canonicalJson({ value: '\ud800' }), (error) => error.code === 'P3_JCS_INVALID_UNICODE');
  assert.throws(() => canonicalJson(new Date()), (error) => error.code === 'P3_JCS_NON_JSON_VALUE');
});
