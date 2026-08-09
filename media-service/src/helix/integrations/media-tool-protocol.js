'use strict';

const catalog = require('../contracts/ports/p5-media-tool-operation-contracts.json');

const SHA256 = /^[0-9a-f]{64}$/;
const TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]{0,255}$/;
const EFFECTS = new Set(['pure_observation', 'workspace_write', 'material_commit', 'destructive_commit']);
const FFPROBE_MAX_STDOUT_BYTES = 256 * 1024;
const FFPROBE_MAX_STDERR_BYTES = 16 * 1024;
const operations = new Map(catalog.operations.map((operation) => [operation.operationId, Object.freeze({ ...operation })]));

class MediaToolProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MediaToolProtocolError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new MediaToolProtocolError(code, message, details); }
function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) {
    fail(code, 'Media tool value must match the exact contract.');
  }
}
function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value)) fail('P5_MEDIA_TOOL_TOKEN', 'Media tool token is invalid.', { field });
  return value;
}
function digest(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('P5_MEDIA_TOOL_DIGEST', 'Media tool digest is invalid.', { field });
  return value;
}
function count(value, field, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail('P5_MEDIA_TOOL_COUNT', 'Media tool count is invalid.', { field });
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function safeError(error) {
  const code = error && typeof error.code === 'string' && /^P5_MEDIA_TOOL_/.test(error.code)
    ? error.code : 'P5_MEDIA_TOOL_EXECUTION_FAILED';
  return new MediaToolProtocolError(code, 'Media tool operation failed.', {});
}

function validateProfile(operation, profile) {
  const definitions = {
    'identity-v1': [[], () => true],
    'bounded-layout-v1': [['maxDepth', 'maxEntries'], (p) => count(p.maxDepth, 'maxDepth', 64) >= 0 && count(p.maxEntries, 'maxEntries', 100000) >= 0],
    'middle-256k-sha256-v1': [[], () => true],
    'media-summary-v1': [[], () => true],
    'stage-copy-v1': [['overwrite'], (p) => p.overwrite === false],
    'declared-cleanup-v1': [['memberSetDigest'], (p) => Boolean(digest(p.memberSetDigest, 'memberSetDigest'))],
    'frame-sampling-v1': [['imageFormat', 'timestampsMs'], (p) => ['jpeg', 'png'].includes(p.imageFormat) && Array.isArray(p.timestampsMs) && p.timestampsMs.length <= 256 && p.timestampsMs.every((v) => Number.isSafeInteger(v) && v >= 0)],
    'remux-v1': [['container'], (p) => ['mkv', 'mp4'].includes(p.container)],
    'care-remux-v1': [['container'], (p) => ['mkv', 'mp4'].includes(p.container)],
    'encode-intent-v1': [['audioCodec', 'bitrateKbps', 'deviceHandleId', 'height', 'rateControl', 'videoCodec', 'width'], validateEncode],
    'care-encode-v1': [['audioCodec', 'bitrateKbps', 'deviceHandleId', 'height', 'rateControl', 'videoCodec', 'width'], validateEncode],
    'target-slot-v1': [['decisionDigest'], (p) => Boolean(digest(p.decisionDigest, 'decisionDigest'))],
    'inventory-stage-v1': [['manifestDigest'], (p) => Boolean(digest(p.manifestDigest, 'manifestDigest'))],
    'atomic-promote-v1': [['manifestDigest'], (p) => Boolean(digest(p.manifestDigest, 'manifestDigest'))],
    'artifact-materialize-v1': [['manifestDigest'], (p) => Boolean(digest(p.manifestDigest, 'manifestDigest'))],
    'input-settlement-approval-v1': [['scopeDigest'], (p) => Boolean(digest(p.scopeDigest, 'scopeDigest'))],
    'destructive-authorization-v1': [['scopeDigest'], (p) => Boolean(digest(p.scopeDigest, 'scopeDigest'))]
  };
  const definition = definitions[operation.profile];
  if (!definition) fail('P5_MEDIA_TOOL_PROFILE_UNKNOWN', 'Media tool profile is not registered.');
  exact(profile, definition[0], 'P5_MEDIA_TOOL_PROFILE_SHAPE');
  if (Buffer.byteLength(canonical(profile), 'utf8') > 16384 || !definition[1](profile)) {
    fail('P5_MEDIA_TOOL_PROFILE_INVALID', 'Media tool profile is invalid.');
  }
  return freeze({ ...profile });
}

function validateEncode(profile) {
  return ['h264', 'hevc', 'av1'].includes(profile.videoCodec) && ['aac', 'ac3', 'copy'].includes(profile.audioCodec) &&
    ['cbr', 'vbr', 'crf'].includes(profile.rateControl) && Number.isSafeInteger(profile.width) && profile.width >= 16 && profile.width <= 8192 &&
    Number.isSafeInteger(profile.height) && profile.height >= 16 && profile.height <= 8192 &&
    Number.isSafeInteger(profile.bitrateKbps) && profile.bitrateKbps >= 128 && profile.bitrateKbps <= 200000 &&
    typeof profile.deviceHandleId === 'string' && TOKEN.test(profile.deviceHandleId);
}

function validateGrant(request, operation, options) {
  const grant = request.operationGrant;
  exact(grant, ['authorityDigest', 'controlledRoots', 'effectClass', 'eventId', 'expiresAtMs', 'grantId',
    'operationId', 'ownerDomain', 'sourcePaths', 'targetPaths'], 'P5_MEDIA_TOOL_GRANT_SHAPE');
  token(grant.grantId, 'grantId'); token(grant.ownerDomain, 'ownerDomain'); digest(grant.authorityDigest, 'authorityDigest');
  if (grant.eventId !== request.eventId || grant.operationId !== operation.operationId || grant.effectClass !== operation.effectClass ||
      !Number.isSafeInteger(grant.expiresAtMs) || grant.expiresAtMs <= options.now()) {
    fail('P5_MEDIA_TOOL_GRANT_STALE', 'Operation Grant is stale or bound to another operation.');
  }
  for (const [field, values, maximum] of [
    ['sourcePaths', grant.sourcePaths, operation.maxSourceCount],
    ['targetPaths', grant.targetPaths, operation.maxTargetCount],
    ['controlledRoots', grant.controlledRoots, 64]
  ]) {
    if (!Array.isArray(values) || values.length > maximum || values.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 4096 || value.includes('\0'))) {
      fail('P5_MEDIA_TOOL_GRANT_PATHS', 'Operation Grant paths exceed the exact bound.', { field });
    }
  }
  if (grant.sourcePaths.length > operation.maxSourceCount || grant.targetPaths.length > operation.maxTargetCount || grant.controlledRoots.length < 1) {
    fail('P5_MEDIA_TOOL_GRANT_CARDINALITY', 'Operation Grant path cardinality is invalid.');
  }
  if ((operation.maxSourceCount === 1 && grant.sourcePaths.length !== 1) ||
      (operation.maxSourceCount > 1 && grant.sourcePaths.length < 1) ||
      (operation.maxTargetCount === 0 && grant.targetPaths.length !== 0) ||
      (operation.effectClass !== 'pure_observation' && operation.maxTargetCount > 0 && grant.targetPaths.length < 1)) {
    fail('P5_MEDIA_TOOL_GRANT_CARDINALITY', 'Operation Grant does not provide the required exact locations.');
  }
  for (const candidate of [...grant.sourcePaths, ...grant.targetPaths]) {
    if (!grant.controlledRoots.some((root) => options.pathAuthority.contains(root, candidate))) {
      fail('P5_MEDIA_TOOL_PATH_ESCAPE', 'Operation Grant path escapes every controlled root.');
    }
  }
  if (grant.targetPaths.some((target) => grant.sourcePaths.includes(target))) {
    fail('P5_MEDIA_TOOL_UNDECLARED_OVERWRITE', 'A target cannot overwrite an input location.');
  }
  const verified = options.grantVerifier.verify(freeze({ request, operation, grant }));
  if (verified !== true) fail('P5_MEDIA_TOOL_GRANT_REJECTED', 'Operation Grant authority was rejected.');
  return freeze({ ...grant, sourcePaths: [...grant.sourcePaths], targetPaths: [...grant.targetPaths], controlledRoots: [...grant.controlledRoots] });
}

function validateBinding(request, operation) {
  if (operation.effectClass === 'pure_observation') {
    if (request.effectBinding !== null) fail('P5_MEDIA_TOOL_PURE_EFFECT_BINDING', 'Pure observation cannot carry an Effect binding.');
    return null;
  }
  exact(request.effectBinding, ['effectId', 'idempotencyKey', 'intentDigest'], 'P5_MEDIA_TOOL_EFFECT_BINDING_SHAPE');
  token(request.effectBinding.effectId, 'effectId'); token(request.effectBinding.idempotencyKey, 'idempotencyKey');
  digest(request.effectBinding.intentDigest, 'intentDigest');
  return freeze({ ...request.effectBinding });
}

function assertIntentDigest(request, operation, grant, profile, binding, options) {
  if (!binding) return;
  const expected = options.digest(canonical({
    operationId: operation.operationId, capabilityRef: operation.capabilityRef, effectClass: operation.effectClass,
    eventId: request.eventId, grantId: grant.grantId, authorityDigest: grant.authorityDigest,
    sourcePaths: grant.sourcePaths, targetPaths: grant.targetPaths, profile
  }));
  if (expected !== binding.intentDigest) fail('P5_MEDIA_TOOL_INTENT_DIGEST', 'Effect binding does not match the exact typed operation intent.');
}

function ffmpegArgs(operation, grant, profile) {
  const source = grant.sourcePaths[0];
  if (operation.atomId === 'ffmpeg.frames.extract@1') {
    return ['-nostdin', '-n', '-v', 'error', '-i', source, '-frames:v', String(profile.timestampsMs.length),
      '-f', 'image2', grant.targetPaths[0]];
  }
  if (operation.atomId === 'ffmpeg.media.remux@1') {
    return ['-nostdin', '-n', '-v', 'error', '-i', source, '-map', '0', '-c', 'copy', '-f', profile.container, grant.targetPaths[0]];
  }
  const videoCodec = { h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1' }[profile.videoCodec];
  return ['-nostdin', '-n', '-v', 'error', '-i', source, '-c:v', videoCodec, '-c:a', profile.audioCodec,
    '-b:v', String(profile.bitrateKbps) + 'k', '-s', String(profile.width) + 'x' + String(profile.height), grant.targetPaths[0]];
}

function commandFor(operation, grant, profile) {
  if (operation.tool === 'ffprobe') return freeze({ tool: 'ffprobe', atomId: operation.atomId,
    argv: ['-v', 'fatal', '-of', 'json=compact=1', '-show_streams', '-show_entries',
      'format=format_name,duration,size:stream=index,codec_type,codec_name,profile,width,height,channels,channel_layout,disposition:stream_tags=language,title',
      grant.sourcePaths[0]], timeoutMs: operation.timeoutMs,
    maxStdoutBytes: FFPROBE_MAX_STDOUT_BYTES, maxStderrBytes: FFPROBE_MAX_STDERR_BYTES });
  if (operation.tool === 'ffmpeg') return freeze({ tool: 'ffmpeg', atomId: operation.atomId,
    argv: ffmpegArgs(operation, grant, profile), timeoutMs: operation.timeoutMs, maxStdoutBytes: 16384, maxStderrBytes: 65536 });
  return null;
}

function validateAdapterResult(result, operation, options) {
  if (operation.tool === 'ffprobe' || operation.tool === 'ffmpeg') {
    exact(result, ['bytesAffected', 'exitCode', 'outputDigest', 'stderrUtf8', 'stdoutUtf8', 'verificationEvidenceDigest'], 'P5_MEDIA_TOOL_PROCESS_RESULT_SHAPE');
    if (typeof result.stdoutUtf8 !== 'string' || typeof result.stderrUtf8 !== 'string' ||
        Buffer.byteLength(result.stdoutUtf8, 'utf8') > (operation.tool === 'ffprobe' ? FFPROBE_MAX_STDOUT_BYTES : 16384) ||
        Buffer.byteLength(result.stderrUtf8, 'utf8') > (operation.tool === 'ffprobe' ? FFPROBE_MAX_STDERR_BYTES : 65536)) {
      fail('P5_MEDIA_TOOL_PROCESS_RESULT_INVALID', 'Typed process result is invalid or failed.');
    }
    digest(result.outputDigest, 'outputDigest'); digest(result.verificationEvidenceDigest, 'verificationEvidenceDigest');
    count(result.bytesAffected, 'bytesAffected', Number.MAX_SAFE_INTEGER);
    if (operation.tool === 'ffprobe') {
      if (result.exitCode !== 0) return normalizeProbeFailure(result, options);
      return normalizeProbe(result, options);
    }
    if (result.exitCode !== 0) fail('P5_MEDIA_TOOL_PROCESS_RESULT_INVALID', 'Media transform process failed.');
    return freeze({ ...result, evidence: { bytesAffected: result.bytesAffected } });
  }
  exact(result, ['bytesAffected', 'evidence', 'itemCount', 'outputDigest', 'verificationEvidenceDigest'], 'P5_MEDIA_TOOL_ADAPTER_RESULT_SHAPE');
  digest(result.outputDigest, 'outputDigest'); digest(result.verificationEvidenceDigest, 'verificationEvidenceDigest');
  count(result.bytesAffected, 'bytesAffected', Number.MAX_SAFE_INTEGER); count(result.itemCount, 'itemCount', 100000);
  if (!result.evidence || typeof result.evidence !== 'object' || Array.isArray(result.evidence) ||
      Buffer.byteLength(canonical(result.evidence), 'utf8') > 65536 || options.digest(canonical(result.evidence)) !== result.verificationEvidenceDigest) {
    fail('P5_MEDIA_TOOL_EVIDENCE_INVALID', 'Adapter evidence is invalid or has the wrong digest.');
  }
  validateTypedEvidence(operation, result.evidence);
  return freeze({ ...result, evidence: { ...result.evidence } });
}

function validateTypedEvidence(operation, evidence) {
  if (operation.atomId === 'filesystem.stat.identity@1') {
    exact(evidence, ['ctimeNs', 'endpointId', 'exists', 'inode', 'mountScopeId', 'mtimeNs', 'sizeBytes'], 'P5_MEDIA_TOOL_IDENTITY_EVIDENCE_SHAPE');
    if (evidence.exists !== true || !Number.isSafeInteger(evidence.sizeBytes) || evidence.sizeBytes < 0 ||
        !/^\d+$/.test(evidence.mtimeNs) || !/^\d+$/.test(evidence.ctimeNs)) fail('P5_MEDIA_TOOL_IDENTITY_EVIDENCE', 'Filesystem identity evidence is invalid.');
    token(evidence.endpointId, 'endpointId'); token(evidence.mountScopeId, 'mountScopeId'); token(evidence.inode, 'inode');
  } else if (operation.atomId === 'filesystem.layout.bounded@1') {
    exact(evidence, ['entryCount', 'layoutDigest', 'truncated'], 'P5_MEDIA_TOOL_LAYOUT_EVIDENCE_SHAPE');
    count(evidence.entryCount, 'entryCount', 100000); digest(evidence.layoutDigest, 'layoutDigest');
    if (typeof evidence.truncated !== 'boolean') fail('P5_MEDIA_TOOL_LAYOUT_EVIDENCE', 'Layout evidence truncation marker is invalid.');
  } else if (operation.atomId === 'material.middle-256k-sha256@1') {
    exact(evidence, ['algorithm', 'bytesSampled', 'digestHex', 'sampleLength', 'sampleOffset', 'sizeBytes'], 'P5_MEDIA_TOOL_FINGERPRINT_EVIDENCE_SHAPE');
    if (evidence.algorithm !== 'middle-256k-sha256' || !Number.isSafeInteger(evidence.sizeBytes) || evidence.sizeBytes < 0 ||
        !Number.isSafeInteger(evidence.sampleOffset) || !Number.isSafeInteger(evidence.sampleLength) ||
        evidence.sampleLength !== Math.min(evidence.sizeBytes, 262144) || evidence.bytesSampled !== evidence.sampleLength ||
        evidence.sampleOffset !== Math.floor((evidence.sizeBytes - evidence.sampleLength) / 2)) {
      fail('P5_MEDIA_TOOL_FINGERPRINT_EVIDENCE', 'Bounded middle-sample fingerprint evidence is invalid.');
    }
    digest(evidence.digestHex, 'digestHex');
  }
}

function normalizeProbe(result, options) {
  let parsed;
  try { parsed = JSON.parse(result.stdoutUtf8); } catch (_) { fail('P5_MEDIA_TOOL_PROBE_JSON', 'Probe output is not valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || !parsed.format || !Array.isArray(parsed.streams) || parsed.streams.length > 256) {
    fail('P5_MEDIA_TOOL_PROBE_SHAPE', 'Probe output does not match the bounded media contract.');
  }
  const evidence = {
    formatName: String(parsed.format.format_name || '').slice(0, 128),
    durationMs: Math.max(0, Math.round(Number(parsed.format.duration || 0) * 1000)),
    sizeBytes: Math.max(0, Number.parseInt(parsed.format.size || '0', 10) || 0),
    streams: parsed.streams.map((stream) => ({ index: Number(stream.index), codecType: String(stream.codec_type || '').slice(0, 32),
      codecName: String(stream.codec_name || '').slice(0, 64), width: Number(stream.width || 0), height: Number(stream.height || 0), channels: Number(stream.channels || 0) }))
  };
  if (Buffer.byteLength(canonical(evidence), 'utf8') > 65536) {
    fail('P5_MEDIA_TOOL_EVIDENCE_INVALID', 'Normalized Media Probe evidence exceeds the typed 64 KiB bound.');
  }
  const evidenceDigest = options.digest(canonical(evidence));
  if (evidenceDigest !== result.verificationEvidenceDigest) fail('P5_MEDIA_TOOL_PROBE_DIGEST', 'Probe evidence digest does not match normalized output.');
  return freeze({ ...result, evidence });
}

function normalizeProbeFailure(result, options) {
  const evidence = { formatName: '', durationMs: 0, sizeBytes: 0, streams: [], resultKind: 'not_media', reasonCode: 'probe_not_media' };
  return freeze({ ...result, evidence, exitCode: Number(result.exitCode) });
}

function createAdapter(portExport, effectClass, options) {
  if (!EFFECTS.has(effectClass) || !options || typeof options.now !== 'function' || typeof options.digest !== 'function' ||
      !options.pathAuthority || typeof options.pathAuthority.contains !== 'function' || !options.grantVerifier || typeof options.grantVerifier.verify !== 'function') {
    fail('P5_MEDIA_TOOL_DEPENDENCIES', 'Media tool adapter dependencies are incomplete.');
  }
  async function execute(request) {
    try {
      exact(request, ['capabilityRef', 'effectBinding', 'effectClass', 'eventId', 'operationGrant', 'operationId', 'profile'], 'P5_MEDIA_TOOL_REQUEST_SHAPE');
      const operation = operations.get(request.operationId);
      if (!operation || operation.portExport !== portExport || operation.effectClass !== effectClass || request.effectClass !== effectClass ||
          request.capabilityRef !== operation.capabilityRef) fail('P5_MEDIA_TOOL_OPERATION_MISMATCH', 'Operation is not allowed through this nominal port.');
      token(request.eventId, 'eventId');
      const profile = validateProfile(operation, request.profile);
      const binding = validateBinding(request, operation);
      const grant = validateGrant(request, operation, options);
      assertIntentDigest(request, operation, grant, profile, binding, options);
      let raw;
      if (operation.tool === 'ffprobe' || operation.tool === 'ffmpeg') {
        if (!options.processAdapter || typeof options.processAdapter.execute !== 'function') fail('P5_MEDIA_TOOL_PROCESS_ADAPTER', 'Typed process adapter is required.');
        raw = await options.processAdapter.execute(commandFor(operation, grant, profile));
      } else if (operation.tool === 'hash') {
        if (!options.hashAdapter || typeof options.hashAdapter.compute !== 'function') fail('P5_MEDIA_TOOL_HASH_ADAPTER', 'Typed hash adapter is required.');
        raw = await options.hashAdapter.compute(freeze({ atomId: operation.atomId, sourcePath: grant.sourcePaths[0], timeoutMs: operation.timeoutMs }));
      } else {
        if (!options.filesystemAdapter || typeof options.filesystemAdapter.execute !== 'function') fail('P5_MEDIA_TOOL_FILESYSTEM_ADAPTER', 'Typed filesystem adapter is required.');
        raw = await options.filesystemAdapter.execute(freeze({ atomId: operation.atomId, sourcePaths: grant.sourcePaths,
          targetPaths: grant.targetPaths, profile, timeoutMs: operation.timeoutMs }));
      }
      const result = validateAdapterResult(raw, operation, options);
      if (effectClass === 'pure_observation') return freeze({
        schemaRef: 'helix://contracts/ports/integration.media-tool-observation/v1/output', schemaVersion: 1,
        operationId: operation.operationId, capabilityRef: operation.capabilityRef, atomId: operation.atomId,
        observedAtMs: options.now(), evidence: result.evidence, evidenceDigest: result.verificationEvidenceDigest
      });
      return freeze({
        effectId: binding.effectId, effectClass, idempotencyKey: binding.idempotencyKey,
        outputDigest: result.outputDigest, verificationEvidenceDigest: result.verificationEvidenceDigest,
        commitMarker: operation.atomId + ':' + binding.effectId, committedAtMs: options.now(), externalReceiptRef: null
      });
    } catch (error) { throw safeError(error); }
  }
  return Object.freeze({ execute });
}

module.exports = Object.freeze({
  MediaToolProtocolError,
  FFPROBE_MAX_STDOUT_BYTES,
  FFPROBE_MAX_STDERR_BYTES,
  createBoundedFingerprintAdapter: (options) => createAdapter('BoundedFingerprintPort', 'pure_observation', options),
  createDestructiveCommitAdapter: (options) => createAdapter('FilesystemDestructiveCommitPort', 'destructive_commit', options),
  createFilesystemObservationAdapter: (options) => createAdapter('FilesystemObservationPort', 'pure_observation', options),
  createMaterialCommitAdapter: (options) => createAdapter('FilesystemMaterialCommitPort', 'material_commit', options),
  createMediaProbeAdapter: (options) => createAdapter('MediaProbePort', 'pure_observation', options),
  createMediaTransformAdapter: (options) => createAdapter('MediaTransformPort', 'workspace_write', options),
  createWorkspaceFileEffectAdapter: (options) => createAdapter('WorkspaceFileEffectPort', 'workspace_write', options)
});
