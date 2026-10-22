'use strict';

// Diagnostics describe failed observations, never authorize a business effect.
const NETWORK_CODES = new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT',
  'ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID']);
function clean(value, limit) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit) : null;
}
function failureDiagnostics(error) {
  const details = error?.details || {}, result = {};
  for (const key of ['reasonCode','field']) {
    const value = clean(details[key], 96);
    if (value && /^[a-zA-Z0-9_.:-]+$/.test(value)) result[key] = value;
  }
  if (typeof details.sourceDirectory === 'string' && !details.sourceDirectory.includes('://')) {
    result.sourceDirectory = clean(details.sourceDirectory, 1024);
  }
  if (Array.isArray(details.unknownNames)) {
    const names = details.unknownNames.filter((name) => typeof name === 'string');
    result.unknownNames = names.slice(0, 16).map((name) => clean(name, 192));
    result.unknownMemberCount = names.length;
    result.truncated = names.length > 16 || names.some((name) => name.length > 192);
  }
  if (Array.isArray(details.conflicts)) {
    const conflicts = details.conflicts.filter((item) => item && typeof item.target === 'string').slice(0, 16)
      .map((item) => ({ target: clean(item.target, 512), name: clean(item.name, 192) }));
    if (conflicts.length) {
      result.conflicts = conflicts;
      result.conflictCount = Number.isSafeInteger(details.conflictCount) ? details.conflictCount : conflicts.length;
      result.truncated = result.truncated === true || result.conflictCount > conflicts.length;
    }
  }
  if (['json_request','image_request'].includes(details.stage)) result.stage = details.stage;
  if (error?.code === 'LIBRA_MEDIA_FFMPEG_TIMEOUT') {
    if (details.stage === 'playback_decode') result.stage = details.stage;
    for (const key of ['elapsedMs','timeoutMs','stallTimeoutMs','stderrBytes']) {
      if (Number.isSafeInteger(details[key]) && details[key] >= 0) result[key] = details[key];
    }
    if ([5,50,95].includes(details.samplePointPercent)) result.samplePointPercent = details.samplePointPercent;
  }
  const code = details.networkCode || error?.cause?.code || error?.code;
  if (NETWORK_CODES.has(code)) result.networkCode = code;
  if (details.timeout === true) result.timeout = true;
  return Object.freeze(result);
}
module.exports = Object.freeze({ failureDiagnostics });
