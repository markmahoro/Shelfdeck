'use strict';

// Diagnostics describe failed observations, never authorize a business effect.
const NETWORK_CODES = new Set(['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT',
  'ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID']);
// Do not copy arbitrary error.code strings across the Secret boundary. These
// literals identify known failures without exposing messages, URLs or bodies.
const INVOCATION_CAUSE_CODES = new Set([
  'PLATFORM_INTEGRATION_CREDENTIAL_INVALID', 'PLATFORM_INTEGRATION_CREDENTIAL_KIND_INVALID',
  'PLATFORM_INTEGRATION_CREDENTIAL_REJECTED', 'PLATFORM_INTEGRATION_HTTP_FAILED',
  'PLATFORM_INTEGRATION_NETWORK_FAILED', 'PLATFORM_INTEGRATION_RESPONSE_BOUND',
  'PLATFORM_INTEGRATION_RESPONSE_INVALID', 'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID',
  'PLATFORM_INTEGRATION_TIMEOUT', 'PLATFORM_INTEGRATION_UNAVAILABLE',
  'PLATFORM_TMDB_ARTIFACT_INVALID', 'PLATFORM_TMDB_ARTIFACT_SCOPE_INVALID',
  'PLATFORM_TMDB_ARTIFACT_SHAPE', 'PLATFORM_TMDB_EFFECT_CLASS_MISMATCH',
  'PLATFORM_TMDB_HANDLE_FENCE_MISMATCH', 'PLATFORM_TMDB_IDENTITY_INVALID',
  'PLATFORM_TMDB_IDENTITY_MISMATCH', 'PLATFORM_TMDB_IDENTITY_NOT_FOUND',
  'PLATFORM_TMDB_METADATA_SHAPE', 'PLATFORM_TMDB_OPERATION_DENIED',
  'PLATFORM_TMDB_SERIES_PRESENTATION_STALE', 'P5_PROVIDER_TRANSPORT_FAILED',
]);
function clean(value, limit) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, limit) : null;
}
function failureDiagnostics(error) {
  const details = error?.details || {}, result = {};
  const javSource = error?.name === 'JavSourceError' &&
    typeof error?.code === 'string' && /^JAV_SOURCE_[A-Z0-9_]+$/.test(error.code);
  if (INVOCATION_CAUSE_CODES.has(details.causeCode)) result.causeCode = details.causeCode;
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
  if (['json_request','image_request'].includes(details.stage) ||
      (javSource && ['page','cover'].includes(details.stage))) result.stage = details.stage;
  const statusCode = details.statusCode === undefined && javSource ? details.status : details.statusCode;
  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599)
    result.statusCode = statusCode;
  if (error?.code === 'LIBRA_MEDIA_FFMPEG_TIMEOUT') {
    if (details.stage === 'playback_decode') result.stage = details.stage;
    for (const key of ['elapsedMs','timeoutMs','stallTimeoutMs','stderrBytes']) {
      if (Number.isSafeInteger(details[key]) && details[key] >= 0) result[key] = details[key];
    }
    if ([5,50,95].includes(details.samplePointPercent)) result.samplePointPercent = details.samplePointPercent;
  }
  const code = details.networkCode || error?.cause?.code || error?.code;
  if (NETWORK_CODES.has(code)) result.networkCode = code;
  if (details.timeout === true || (javSource && error.code === 'JAV_SOURCE_TIMEOUT')) result.timeout = true;
  return Object.freeze(result);
}
module.exports = Object.freeze({ failureDiagnostics });
