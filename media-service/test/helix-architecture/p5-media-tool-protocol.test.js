'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const protocol = require('../../src/helix/integrations/media-tool-protocol');
const operationCatalog = require('../../src/helix/contracts/ports/p5-media-tool-operation-contracts.json');

const ROOT = 'C:\\helix-controlled';
const SHA = 'a'.repeat(64);
const FACTORIES = {
  BoundedFingerprintPort: 'createBoundedFingerprintAdapter',
  FilesystemDestructiveCommitPort: 'createDestructiveCommitAdapter',
  FilesystemMaterialCommitPort: 'createMaterialCommitAdapter',
  FilesystemObservationPort: 'createFilesystemObservationAdapter',
  MediaProbePort: 'createMediaProbeAdapter',
  MediaTransformPort: 'createMediaTransformAdapter',
  WorkspaceFileEffectPort: 'createWorkspaceFileEffectAdapter'
};

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function profile(operation) {
  const values = {
    'identity-v1': {}, 'bounded-layout-v1': { maxDepth: 4, maxEntries: 100 }, 'middle-256k-sha256-v1': {}, 'media-summary-v1': {},
    'stage-copy-v1': { overwrite: false }, 'declared-cleanup-v1': { memberSetDigest: SHA },
    'frame-sampling-v1': { imageFormat: 'jpeg', timestampsMs: [1000] }, 'remux-v1': { container: 'mkv' },
    'care-remux-v1': { container: 'mkv' },
    'encode-intent-v1': { videoCodec: 'hevc', audioCodec: 'aac', width: 1920, height: 1080, bitrateKbps: 8000, rateControl: 'vbr', deviceHandleId: 'device-1' },
    'care-encode-v1': { videoCodec: 'h264', audioCodec: 'aac', width: 1280, height: 720, bitrateKbps: 4000, rateControl: 'crf', deviceHandleId: 'device-2' },
    'target-slot-v1': { decisionDigest: SHA }, 'inventory-stage-v1': { manifestDigest: SHA },
    'atomic-promote-v1': { manifestDigest: SHA }, 'artifact-materialize-v1': { manifestDigest: SHA },
    'input-settlement-approval-v1': { scopeDigest: SHA }, 'destructive-authorization-v1': { scopeDigest: SHA }
  };
  return values[operation.profile];
}
function request(operation, changes = {}) {
  const sourcePaths = operation.maxSourceCount === 0 ? [] : [`${ROOT}\\source-1.mkv`];
  const targetPaths = operation.maxTargetCount === 0 ? [] : [`${ROOT}\\target-1.mkv`];
  const value = {
    operationId: operation.operationId,
    capabilityRef: operation.capabilityRef,
    effectClass: operation.effectClass,
    eventId: 'event-1',
    effectBinding: operation.effectClass === 'pure_observation' ? null : { effectId: 'effect-1', idempotencyKey: 'idem-1', intentDigest: SHA },
    operationGrant: { grantId: 'grant-1', eventId: 'event-1', ownerDomain: 'libra', effectClass: operation.effectClass,
      operationId: operation.operationId, sourcePaths, targetPaths, controlledRoots: [ROOT], authorityDigest: SHA, expiresAtMs: 2000 },
    profile: profile(operation),
    ...changes
  };
  if (value.effectBinding && !Object.hasOwn(changes, 'effectBinding')) {
    value.effectBinding = { ...value.effectBinding, intentDigest: digest(canonical({
      operationId: operation.operationId, capabilityRef: operation.capabilityRef, effectClass: operation.effectClass,
      eventId: value.eventId, grantId: value.operationGrant.grantId, authorityDigest: value.operationGrant.authorityDigest,
      sourcePaths: value.operationGrant.sourcePaths, targetPaths: value.operationGrant.targetPaths, profile: value.profile
    })) };
  }
  return value;
}
function options(records = {}) {
  return {
    now: () => 1000,
    digest,
    pathAuthority: { contains: (root, candidate) => {
      const relative = path.win32.relative(path.win32.resolve(root), path.win32.resolve(candidate));
      return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
    } },
    grantVerifier: { verify: (input) => { records.grant = input; return records.rejectGrant !== true; } },
    filesystemAdapter: { execute: async (command) => {
      records.command = command;
      let evidence = { atomId: command.atomId };
      if (command.atomId === 'filesystem.stat.identity@1') evidence = { exists: true, endpointId: 'endpoint-1', mountScopeId: 'mount-1',
        inode: 'inode-1', sizeBytes: 10, mtimeNs: '100', ctimeNs: '90' };
      if (command.atomId === 'filesystem.layout.bounded@1') evidence = { entryCount: 1, truncated: false, layoutDigest: SHA };
      return { outputDigest: SHA, verificationEvidenceDigest: digest(canonical(evidence)), bytesAffected: 10, itemCount: 1, evidence };
    } },
    hashAdapter: { compute: async (command) => {
      records.command = command; const evidence = { algorithm:'middle-256k-sha256', digestHex:SHA, sizeBytes:10,
        sampleOffset:0, sampleLength:10, bytesSampled:10 };
      return { outputDigest: SHA, verificationEvidenceDigest: digest(canonical(evidence)), bytesAffected: 10, itemCount: 1, evidence };
    } },
    processAdapter: { execute: async (command) => {
      records.command = command;
      if (command.tool === 'ffprobe') {
        const evidence = { formatName: 'matroska,webm', durationMs: 1250, sizeBytes: 10,
          streams: [{ index: 0, codecType: 'video', codecName: 'hevc', width: 1920, height: 1080, channels: 0 }] };
        return { exitCode: 0, stdoutUtf8: JSON.stringify({ format: { format_name: 'matroska,webm', duration: '1.25', size: '10' },
          streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080 }] }), stderrUtf8: '',
          outputDigest: SHA, verificationEvidenceDigest: digest(canonical(evidence)), bytesAffected: 10 };
      }
      return { exitCode: 0, stdoutUtf8: '', stderrUtf8: '', outputDigest: SHA, verificationEvidenceDigest: SHA, bytesAffected: 10 };
    } }
  };
}
function adapterFor(operation, records = {}) { return protocol[FACTORIES[operation.portExport]](options(records)); }

test('P5 media-tool catalog reverse-traces exact Capability Effect Classes and typed ports', () => {
  assert.equal(operationCatalog.schemaVersion, 1);
  assert.equal(operationCatalog.operations.length, 19);
  assert.equal(new Set(operationCatalog.operations.map((item) => item.operationId)).size, 19);
  for (const operation of operationCatalog.operations) {
    const capabilityPath = path.resolve(__dirname, '../../src/helix/contracts/capabilities',
      ...operation.capabilityRef.replace(/@1$/, '').split('.'), 'v1', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
    assert.equal(manifest.capabilityRef, operation.capabilityRef);
    assert.equal(manifest.effectClass, operation.effectClass);
    assert.ok(FACTORIES[operation.portExport]);
    assert.match(operation.atomId, /@1$/);
  }
});

test('all registered operations execute only through their exact nominal port and atom', async () => {
  for (const operation of operationCatalog.operations) {
    const records = {};
    const result = await adapterFor(operation, records).execute(request(operation));
    assert.equal(records.grant.operation.operationId, operation.operationId);
    assert.equal(records.command.atomId, operation.atomId);
    if (operation.effectClass === 'pure_observation') {
      assert.equal(result.operationId, operation.operationId);
      assert.equal(result.atomId, operation.atomId);
      assert.equal(result.observedAtMs, 1000);
    } else {
      assert.equal(result.effectId, 'effect-1');
      assert.equal(result.effectClass, operation.effectClass);
      assert.equal(result.idempotencyKey, 'idem-1');
      assert.equal(Object.isFrozen(result), true);
    }
  }
});

test('FFprobe and FFmpeg commands are argv-only, bounded, and caller cannot supply shell syntax', async () => {
  const probe = operationCatalog.operations.find((item) => item.tool === 'ffprobe');
  const probeRecords = {};
  const probeResult = await adapterFor(probe, probeRecords).execute(request(probe));
  assert.equal(probeRecords.command.tool, 'ffprobe');
  assert.ok(Array.isArray(probeRecords.command.argv));
  assert.equal(probeRecords.command.argv.includes('-show_streams'), true);
  assert.equal(probeResult.evidence.streams[0].codecName, 'hevc');

  const transcode = operationCatalog.operations.find((item) => item.operationId === 'libra.media.transcode@1');
  const transformRecords = {};
  await adapterFor(transcode, transformRecords).execute(request(transcode));
  assert.equal(transformRecords.command.tool, 'ffmpeg');
  assert.equal(transformRecords.command.argv.includes('libx265'), true);
  assert.equal(transformRecords.command.argv.includes('-n'), true);
  assert.equal(Object.hasOwn(transformRecords.command, 'shell'), false);
  await assert.rejects(adapterFor(transcode).execute(request(transcode, { profile: { ...profile(transcode), argv: ['--escape'] } })),
    (error) => error.code === 'P5_MEDIA_TOOL_PROFILE_SHAPE');
});

test('compact FFprobe projection accepts raw JSON above 64 KiB when typed evidence remains bounded', async () => {
  const operation = operationCatalog.operations.find((item) => item.tool === 'ffprobe');
  const custom = options();
  const streams = [{ index:0, codec_type:'video', codec_name:'hevc', width:1920, height:1080, tags:{ title:'x'.repeat(80 * 1024) } }];
  const normalized = { formatName:'matroska,webm', durationMs:1250, sizeBytes:10,
    streams:[{ index:0, codecType:'video', codecName:'hevc', width:1920, height:1080, channels:0 }] };
  custom.processAdapter.execute = async () => ({ exitCode:0, stdoutUtf8:JSON.stringify({ format:{ format_name:'matroska,webm', duration:'1.25', size:'10' }, streams }),
    stderrUtf8:'', outputDigest:SHA, verificationEvidenceDigest:digest(canonical(normalized)), bytesAffected:10 });
  const result = await protocol.createMediaProbeAdapter(custom).execute(request(operation));
  assert.equal(result.evidence.streams.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify({ format:{ format_name:'matroska,webm', duration:'1.25', size:'10' }, streams }), 'utf8') > 65536);
});

test('port, Capability, Effect Class, and pure/non-pure binding mismatches fail closed before side effects', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'inventory.placement.switch@1');
  let calls = 0;
  const custom = options(); custom.filesystemAdapter.execute = async () => { calls += 1; throw new Error('must not run'); };
  const adapter = protocol.createMaterialCommitAdapter(custom);
  for (const changes of [
    { capabilityRef: 'libra.media.transcode@1' }, { effectClass: 'workspace_write' }, { effectBinding: null },
    { operationId: 'libra.media.transcode@1' }
  ]) await assert.rejects(adapter.execute(request(operation, changes)), (error) => /^P5_MEDIA_TOOL_/.test(error.code));
  assert.equal(calls, 0);
});

test('expired, rejected, escaped, and overwrite grants fail closed before adapters', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'workspace.material.import@1');
  const cases = [
    { operationGrant: { ...request(operation).operationGrant, expiresAtMs: 1000 } },
    { operationGrant: { ...request(operation).operationGrant, targetPaths: ['C:\\escape\\out.mkv'] } },
    { operationGrant: { ...request(operation).operationGrant, targetPaths: request(operation).operationGrant.sourcePaths } }
  ];
  for (const changes of cases) await assert.rejects(adapterFor(operation).execute(request(operation, changes)),
    (error) => /^P5_MEDIA_TOOL_/.test(error.code));
  const records = { rejectGrant: true };
  await assert.rejects(adapterFor(operation, records).execute(request(operation)), (error) => error.code === 'P5_MEDIA_TOOL_GRANT_REJECTED');
  assert.equal(records.command, undefined);
});

test('destructive operations require their exact immutable scope profile and never use workspace port', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'offdeck.primary.delete@1');
  await assert.rejects(protocol.createWorkspaceFileEffectAdapter(options()).execute(request(operation)),
    (error) => error.code === 'P5_MEDIA_TOOL_OPERATION_MISMATCH');
  await assert.rejects(adapterFor(operation).execute(request(operation, { profile: { scopeDigest: 'bad' } })),
    (error) => error.code === 'P5_MEDIA_TOOL_DIGEST');
  const result = await adapterFor(operation).execute(request(operation));
  assert.equal(result.effectClass, 'destructive_commit');
});

test('non-pure operation intent digest binds paths, authority, profile, and Effect identity', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'inventory.product.stage@1');
  const valid = request(operation);
  const stale = { ...valid, profile: { manifestDigest: 'b'.repeat(64) } };
  await assert.rejects(adapterFor(operation).execute(stale), (error) => error.code === 'P5_MEDIA_TOOL_INTENT_DIGEST');
  const result = await adapterFor(operation).execute(valid);
  assert.equal(result.effectId, valid.effectBinding.effectId);
});

test('typed bounded fingerprint and probe results reject malformed or digest-drifting evidence', async () => {
  const hashOperation = operationCatalog.operations.find((item) => item.tool === 'hash');
  const badHash = options(); badHash.hashAdapter.compute = async () => {
    const evidence = { algorithm:'sha1', digestHex:SHA, sizeBytes:10, sampleOffset:0, sampleLength:10, bytesSampled:10 };
    return { outputDigest: SHA, verificationEvidenceDigest: digest(canonical(evidence)), bytesAffected: 10, itemCount: 1, evidence };
  };
  await assert.rejects(protocol.createBoundedFingerprintAdapter(badHash).execute(request(hashOperation)),
    (error) => error.code === 'P5_MEDIA_TOOL_FINGERPRINT_EVIDENCE');

  const probeOperation = operationCatalog.operations.find((item) => item.tool === 'ffprobe');
  const badProbe = options(); badProbe.processAdapter.execute = async () => ({ exitCode: 0, stdoutUtf8: '{bad', stderrUtf8: '',
    outputDigest: SHA, verificationEvidenceDigest: SHA, bytesAffected: 0 });
  await assert.rejects(protocol.createMediaProbeAdapter(badProbe).execute(request(probeOperation)),
    (error) => error.code === 'P5_MEDIA_TOOL_PROBE_JSON');
});

test('adapter errors are redacted and clean integration protocol imports no direct side-effect modules', async () => {
  const operation = operationCatalog.operations.find((item) => item.operationId === 'libra.workspace.reclaim@1');
  const custom = options(); custom.filesystemAdapter.execute = async () => { throw new Error(`${ROOT} secret child_process`); };
  await assert.rejects(protocol.createWorkspaceFileEffectAdapter(custom).execute(request(operation)), (error) =>
    error.code === 'P5_MEDIA_TOOL_EXECUTION_FAILED' && !error.message.includes(ROOT) && Object.keys(error.details).length === 0);
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/integrations/media-tool-protocol.js'), 'utf8').toLowerCase();
  for (const fragment of ['node:child_process', "require('fs')", 'process.env', 'transcodeservice', 'shell: true']) {
    assert.equal(source.includes(fragment), false, fragment);
  }
});
