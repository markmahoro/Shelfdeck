'use strict';

const crypto = require('node:crypto');

class CanonicalJsonError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CanonicalJsonError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new CanonicalJsonError(code, message, details); }

function assertUnicode(value, location) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('P3_JCS_INVALID_UNICODE', 'JCS input contains an unpaired high surrogate.', { path: location });
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      fail('P3_JCS_INVALID_UNICODE', 'JCS input contains an unpaired low surrogate.', { path: location });
    }
  }
}

function serialize(value, location) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicode(value, location);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('P3_JCS_NON_FINITE_NUMBER', 'JCS input numbers must be finite.', { path: location });
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map((item, index) => serialize(item, location + '/' + index)).join(',') + ']';
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('P3_JCS_NON_JSON_VALUE', 'JCS input must contain only plain JSON values.', { path: location });
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => {
    assertUnicode(key, location + '/<key>');
    const item = value[key];
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') {
      fail('P3_JCS_NON_JSON_VALUE', 'JCS input contains a non-JSON member.', { path: location + '/' + key });
    }
    return JSON.stringify(key) + ':' + serialize(item, location + '/' + key);
  }).join(',') + '}';
}

function canonicalJson(value) { return serialize(value, '#'); }
function canonicalDigest(value) { return crypto.createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex'); }

module.exports = Object.freeze({ CanonicalJsonError, canonicalDigest, canonicalJson });
