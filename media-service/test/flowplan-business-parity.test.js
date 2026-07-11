'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const builtIns = require('../src/builtInCapabilities');
const catalog = require('../src/capabilityCatalog');
const registry = require('../src/capabilityRegistry');
const planner = require('../src/workflowPlanner');
const graph = require('../src/workflowGraph');
const transcodeService = require('../src/services/transcodeService');

builtIns.registerBuiltIns();

const METADATA_EFFECTS = ['metadata.sidecar.render', 'metadata.image.acquire'];
const OPTIMIZE_EFFECTS = ['source.upgrade.request', 'media.transcode', 'container.remux', 'media.replace', 'source.organize', 'metadata.artifacts.materialize'];

function fixture(id, gate, item = {}, library = {}, descriptor = {}) {
  const uuid = library.uuid || 'library';
  return {
    task: {
      id, itemId: `${id}-item`, targetGate: gate,
      taskTarget: { targetGate: gate, gateObjective: item.objective || {} },
      objectiveRevisionSnapshot: `${id}-objective`, capabilityPolicyRevision: '1',
      itemInfo: { subLibraryId: uuid, ...item },
      helixAdmission: { admissionGeneration: 1, sourceRevision: 'source-1', sourceAccessDescriptor: { sourceType: 'folder', subLibraryId: uuid, ...descriptor } },
    },
    config: {
      subLibraries: [{ uuid, allowedCapabilities: { metadata: METADATA_EFFECTS, optimize: OPTIMIZE_EFFECTS }, ...library }],
      transcodeEncodingDevices: [{ stableKey: 'qsv:0', inPool: true }, { stableKey: 'cpu:libx265', inPool: true }],
      transcodeCpuParticipationStrategy: 'normal',
    },
  };
}

function plan(value) {
  const result = planner.planTask(value.task, value.config);
  assert.strictEqual(graph.validateGraph(result, registry), result);
  return result;
}

function capabilities(value) { return value.nodes.map((node) => node.capability); }
function node(value, capability) { return value.nodes.find((entry) => entry.capability === capability); }

test('representative FlowPlans make every business Capability reachable from the Planner', () => {
  const cases = [
    fixture('basedata-emby', 'basedata', {}, {}, { sourceType: 'emby' }),
    fixture('basedata-folder', 'basedata'),
    fixture('metadata-emby', 'metadata', {}, {}, { sourceType: 'emby' }),
    fixture('metadata-jav', 'metadata', {}, { mediaType: 'adult', adultRegion: 'japanese_jav', capabilityParameters: { 'metadata.image.acquire': { kinds: ['poster', 'fanart'] } } }),
    fixture('metadata-western-local', 'metadata', {}, { mediaType: 'adult', adultRegion: 'western_adult', western: { computeMode: 'local' } }),
    fixture('metadata-western-worker', 'metadata', {}, { mediaType: 'adult', adultRegion: 'western_adult', western: { computeMode: 'worker' } }),
    fixture('transcode', 'optimize', { codec: 'h264', bitrate: 30, resolution: '1080p', objective: { targetMediaFacts: { targetCodec: 'h265' } } }),
    fixture('disc', 'optimize', { codec: 'h264', bitrate: 30, resolution: '1080p', isDiscLike: true, objective: { targetMediaFacts: { targetCodec: 'h265' } } }),
    fixture('upgrade', 'optimize', { codec: 'h265', resolution: '720p', objective: { targetMediaFacts: { minResolution: '2160p' } } }),
    fixture('organize', 'optimize', { layoutFacts: { compliant: false }, objective: { targetMediaFacts: { storageLayout: 'organized' } } }),
    fixture('materialize', 'optimize', { metadataArtifactsReady: true, metadataArtifactsMaterialized: false, objective: { targetMediaFacts: { metadataArtifacts: 'materialized' } } }),
    fixture('noop', 'optimize', { codec: 'h265', resolution: '1080p', objective: { kind: 'keep_current' } }),
  ];
  const reachable = new Set(cases.flatMap((entry) => capabilities(plan(entry))));
  const missing = catalog.list().map((entry) => entry.capability).filter((name) => name !== 'workflow.blocked' && !reachable.has(name));
  assert.deepStrictEqual(missing, []);
});

test('Basedata reproduces Emby and Folder observation without container Tasks or cross-gate chaining', () => {
  const emby = plan(fixture('be', 'basedata', {}, {}, { sourceType: 'emby' }));
  const folder = plan(fixture('bf', 'basedata'));
  assert.deepStrictEqual(capabilities(emby), ['emby.item.observe', 'filesystem.layout.observe', 'basedata.verify', 'basedata.publish']);
  assert.deepStrictEqual(capabilities(folder), ['filesystem.media.probe', 'filesystem.layout.observe', 'basedata.verify', 'basedata.publish']);
  assert.strictEqual(node(emby, 'filesystem.layout.observe').when, false);
  for (const value of [emby, folder]) assert.ok(value.nodes.every((entry) => registry.get(entry.capability).allowedTargetGates.includes('basedata')));
});

test('Metadata reproduces Emby, JAV, western-local and western-worker paths before common publication', () => {
  const emby = plan(fixture('me', 'metadata', {}, {}, { sourceType: 'emby' }));
  const jav = plan(fixture('mj', 'metadata', {}, { mediaType: 'adult', adultRegion: 'japanese_jav', capabilityParameters: { 'metadata.image.acquire': { kinds: ['poster', 'fanart'] } } }));
  const local = plan(fixture('ml', 'metadata', {}, { mediaType: 'adult', adultRegion: 'western_adult', western: { computeMode: 'local' } }));
  const worker = plan(fixture('mw', 'metadata', {}, { mediaType: 'adult', adultRegion: 'western_adult', western: { computeMode: 'worker' } }));
  assert.ok(capabilities(emby).includes('metadata.provider.fetch'));
  assert.ok(capabilities(jav).includes('metadata.provider.fetch'));
  assert.deepStrictEqual(capabilities(local).slice(1, 7), ['media.frames.extract', 'person.faces.embed', 'person.faces.cluster', 'person.faces.match', 'metadata.poster.compose', 'adult.metadata.compose']);
  assert.deepStrictEqual(capabilities(worker).slice(1, 6), ['compute.asset.register', 'compute.asset.upload', 'adult.analysis.request', 'adult.analysis.observe', 'adult.metadata.normalize']);
  for (const value of [emby, jav, local, worker]) {
    assert.ok(capabilities(value).includes('person.relations.resolve'));
    assert.ok(capabilities(value).includes('metadata.artifacts.verify'));
    assert.strictEqual(capabilities(value).at(-1), 'metadata.publish');
    assert.ok(node(value, 'metadata.publish').dependsOn.includes(node(value, 'metadata.artifacts.verify').eventId));
  }
  assert.strictEqual(node(worker, 'adult.analysis.observe').retryPolicy.maxAttempts, 3600);
});

test('Transcode predeclares retry attempts, conditional approvals, disposition and shared commit effects', () => {
  const value = plan(fixture('tr', 'optimize', { codec: 'h264', bitrate: 30, resolution: '1080p', objective: { targetMediaFacts: { targetCodec: 'h265' } } }));
  const names = capabilities(value);
  assert.ok(names.indexOf('media.transcode.precheck') < names.indexOf('media.transcode'));
  assert.ok(names.indexOf('output.media.select') > names.lastIndexOf('output.media.verify'));
  for (const required of ['transcode.tonemap.accept', 'output.media.disposition', 'output.preview.generate', 'media.replace', 'staged.asset.discard', 'workspace.cleanup', 'optimization.outcome.select', 'filesystem.layout.verify', 'optimization.result.publish']) assert.ok(names.includes(required), required);
  assert.deepStrictEqual(node(value, 'transcode.tonemap.accept').approvalRequirement.whenInput, { port: 'precheck', path: 'isDolbyVision', equals: true });
  assert.strictEqual(node(value, 'media.replace').approvalRequirement.gateId, 'transcode.beforeReplace');
  assert.ok(value.nodes.filter((entry) => entry.capability === 'media.transcode').length >= 2);
});

test('Upgrade reproduces selection, durable observations, identity verification and shared replacement', () => {
  const value = plan(fixture('up', 'optimize', { codec: 'h265', resolution: '720p', objective: { targetMediaFacts: { minResolution: '2160p' } } }));
  assert.deepStrictEqual(capabilities(value).slice(0, 10), ['integration.moviepilot.check', 'media.upgrade.identity.resolve', 'source.upgrade.search', 'source.upgrade.request', 'source.upgrade.observe-download', 'source.upgrade.observe-transfer', 'source.upgrade.output.resolve', 'source.upgrade.output.settle', 'media.identity.inspect', 'media.identity.accept']);
  assert.strictEqual(node(value, 'source.upgrade.request').approvalRequirement.gateId, 'upgrade.candidateSelect');
  assert.strictEqual(node(value, 'source.upgrade.observe-download').retryPolicy.maxAttempts, 2160);
  assert.strictEqual(node(value, 'source.upgrade.observe-transfer').retryPolicy.maxAttempts, 2160);
  assert.strictEqual(node(value, 'media.identity.accept').approvalRequirement.whenInput.equals, false);
  assert.ok(capabilities(value).includes('media.replace'));
});

test('Episode Upgrade is explicitly blocked until the Helix series-scope mutation owner is resolved', () => {
  const value = plan(fixture('episode-upgrade', 'optimize', { type: 'episode', codec: 'h265', resolution: '720p', objective: { targetMediaFacts: { minResolution: '2160p' } } }));
  assert.deepStrictEqual(capabilities(value), ['workflow.blocked']);
  assert.deepStrictEqual(value.explanation.rejected, [{ capability: 'source.upgrade.request', reason: 'series_scope_upgrade_architecture_unresolved' }]);
});

test('a composite upgrade plus transcode objective validates only the upgrade-owned gap before transcode', () => {
  const value = plan(fixture('composite', 'optimize', { codec: 'h264', resolution: '720p', objective: { targetMediaFacts: { minResolution: '2160p', targetCodec: 'h265' } } }));
  assert.strictEqual(value.classification, 'composite_maintenance');
  const upgradeVerify = value.nodes.find((entry) => entry.eventId.endsWith(':upgrade-media-verify'));
  const transcodePrecheck = node(value, 'media.transcode.precheck');
  const upgradeOutcome = value.nodes.find((entry) => entry.eventId.endsWith(':upgrade-outcome'));
  assert.deepStrictEqual(upgradeVerify.parameters, { objectiveScope: 'upgrade_stage' });
  assert.ok(transcodePrecheck.dependsOn.includes(upgradeOutcome.eventId));
  assert.strictEqual(value.nodes.filter((entry) => entry.capability === 'optimization.result.publish').length, 1);
});

test('organize terminates its Graph and materialization resumes only after Libra and Nexora rebind', () => {
  const organize = plan(fixture('org', 'optimize', { layoutFacts: { compliant: false }, objective: { targetMediaFacts: { storageLayout: 'organized', metadataArtifacts: 'materialized' } }, metadataArtifactsReady: true, metadataArtifactsMaterialized: false }));
  assert.strictEqual(organize.classification, 'source_mutation');
  assert.deepStrictEqual(capabilities(organize), ['source.organize']);
  const resumed = plan(fixture('mat', 'optimize', { layoutFacts: { compliant: true }, metadataArtifactsReady: true, metadataArtifactsMaterialized: false, objective: { targetMediaFacts: { storageLayout: 'organized', metadataArtifacts: 'materialized' } } }));
  assert.deepStrictEqual(capabilities(resumed), ['metadata.artifacts.materialize', 'filesystem.layout.verify', 'optimization.result.publish']);
});

test('Objective verification rejects a stale or incorrectly planned no-op', async () => {
  const capability = registry.get('optimization.objective.verify');
  await assert.rejects(() => capability.execute({
    task: { id: 'bad', objectiveRevisionSnapshot: '1', itemInfo: { codec: 'h264' }, taskTarget: { gateObjective: { targetMediaFacts: { targetCodec: 'h265' } } } },
    event: { eventId: 'bad:verify' }, input: {}, parameters: {}, config: {},
  }), { code: 'OPTIMIZE_OBJECTIVE_NOT_SATISFIED' });
});

test('upgrade-stage media verification ignores a codec gap owned by the following Transcode stage', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-flow-parity-'));
  const output = path.join(temp, 'upgrade.mkv');
  fs.writeFileSync(output, Buffer.alloc(1024));
  const originalProbe = transcodeService.probeSummary;
  transcodeService.probeSummary = async () => ({ durationSec: 10, width: 3840, height: 2160, videoCodec: 'h264' });
  try {
    const capability = registry.get('output.media.verify');
    const result = await capability.execute({
      task: { itemInfo: { codec: 'h264', resolution: '720p' }, taskTarget: { gateObjective: { targetMediaFacts: { minResolution: '2160p', targetCodec: 'h265' } } } },
      event: { eventId: 'verify' }, config: {}, parameters: { objectiveScope: 'upgrade_stage' },
      input: { stagedAsset: { assetId: 'asset', sourcePath: output, workDir: temp, replacementScope: 'file', producingEventId: 'producer', path: output, originalSizeBytes: 2048 } },
    });
    assert.strictEqual(result.result.objectiveSatisfied, true);
    assert.strictEqual(result.result.objectiveScope, 'upgrade_stage');
  } finally {
    transcodeService.probeSummary = originalProbe;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
