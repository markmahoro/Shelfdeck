'use strict';

const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../src/capabilityCatalog');
const registry = require('../src/capabilityRegistry');
const planner = require('../src/workflowPlanner');
const graph = require('../src/workflowGraph');

const LEGACY_PARITY = [
  ['basedata.observe', ['emby.item.observe', 'filesystem.media.probe']], ['basedata.verify', ['basedata.verify']], ['basedata.publish', ['basedata.publish']],
  ['scrape.identity', ['media.identity.resolve']], ['scrape.provider', ['metadata.provider.fetch']], ['scrape.people', ['person.relations.resolve']],
  ['scrape.nfo', ['metadata.sidecar.render']], ['scrape.images', ['metadata.image.acquire']], ['scrape.publish', ['metadata.publish']],
  ['western.local.analysis', ['media.frames.extract', 'person.faces.embed', 'person.faces.cluster', 'person.faces.match', 'metadata.poster.compose', 'adult.metadata.compose']],
  ['western.worker.analysis', ['compute.asset.register', 'compute.asset.upload', 'adult.analysis.request', 'adult.analysis.observe', 'adult.metadata.normalize']],
  ['transcode.precheck', ['media.transcode.precheck']], ['transcode.dv_approval', ['transcode.tonemap.accept']], ['transcode.encode', ['media.transcode']],
  ['transcode.verify_retry', ['output.media.verify', 'output.media.select']], ['transcode.preview', ['output.preview.generate']],
  ['transcode.large_output', ['output.media.disposition', 'staged.asset.discard']], ['transcode.replace', ['media.replace']], ['transcode.cleanup', ['workspace.cleanup']],
  ['transcode.disc_remux', ['container.remux']],
  ['upgrade.precheck', ['integration.moviepilot.check']], ['upgrade.identity_resolution', ['media.upgrade.identity.resolve']],
  ['upgrade.search_select', ['source.upgrade.search', 'source.upgrade.request']], ['upgrade.download', ['source.upgrade.observe-download']],
  ['upgrade.transfer_settle', ['source.upgrade.observe-transfer', 'source.upgrade.output.resolve', 'source.upgrade.output.settle']],
  ['upgrade.identity_verify', ['media.identity.inspect', 'media.identity.accept']], ['upgrade.replace', ['media.replace']], ['upgrade.cleanup', ['workspace.cleanup']],
  ['optimize.publish', ['optimization.outcome.select', 'optimization.result.publish']],
];

function registerCatalog() {
  registry.resetForTests();
  for (const definition of catalog.list()) registry.register(catalog.apply({ capability: definition.capability, execute: async () => ({}) }));
}

test('every effective legacy Mirex/Kairox phase has a canonical atomic Capability replacement', () => {
  const missing = LEGACY_PARITY.flatMap(([legacy, capabilities]) => capabilities.filter((capability) => !catalog.get(capability)).map((capability) => ({ legacy, capability })));
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(new Set(LEGACY_PARITY.map(([legacy]) => legacy)).size, LEGACY_PARITY.length);
});

test('Basedata, Metadata and Optimize FlowPlans compose the parity capabilities through typed bindings', () => {
  registerCatalog();
  const basedata = planner.planTask({ id: 'b', itemId: 'i', targetGate: 'basedata', taskTarget: { targetGate: 'basedata' }, helixAdmission: { sourceAccessDescriptor: { sourceType: 'emby' } } }, {});
  assert.deepStrictEqual(basedata.nodes.map((node) => node.capability), ['emby.item.observe', 'filesystem.layout.observe', 'basedata.verify', 'basedata.publish']);
  assert.strictEqual(graph.validateGraph(basedata, registry), basedata);

  const metadata = planner.planTask({ id: 'm', itemId: 'i', targetGate: 'metadata', taskTarget: { targetGate: 'metadata' }, itemInfo: { subLibraryId: 'jav' }, helixAdmission: { sourceAccessDescriptor: { sourceType: 'folder', subLibraryId: 'jav' } } }, { subLibraries: [{ uuid: 'jav', mediaType: 'adult', adultRegion: 'japanese_jav', allowedCapabilities: { metadata: ['metadata.sidecar.render', 'metadata.image.acquire'] }, capabilityParameters: { 'metadata.image.acquire': { kinds: ['poster', 'fanart'] } } }] });
  assert.deepStrictEqual(metadata.nodes.map((node) => node.capability), ['media.identity.resolve', 'metadata.provider.fetch', 'person.relations.resolve', 'metadata.sidecar.render', 'metadata.image.acquire', 'metadata.image.acquire', 'metadata.artifacts.verify', 'metadata.publish']);
  assert.strictEqual(graph.validateGraph(metadata, registry), metadata);

  const optimize = planner.planTask({ id: 'o', itemId: 'i', targetGate: 'optimize', taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { targetCodec: 'h265' } } }, itemInfo: { subLibraryId: 'movie', codec: 'h264', bitrate: 20, resolution: '1920x1080' } }, { transcodeEncodingDevices: [{ stableKey: 'qsv:0', inPool: true }, { stableKey: 'cpu:libx265', inPool: true }], transcodeCpuParticipationStrategy: 'backup_only', subLibraries: [{ uuid: 'movie', allowedCapabilities: { optimize: ['media.transcode', 'media.replace'] } }] });
  const capabilities = optimize.nodes.map((node) => node.capability);
  for (const required of ['media.transcode.precheck', 'transcode.tonemap.accept', 'media.transcode', 'output.media.verify', 'output.media.select', 'output.media.disposition', 'output.preview.generate', 'media.replace', 'staged.asset.discard', 'workspace.cleanup', 'optimization.outcome.select', 'optimization.result.publish']) assert.ok(capabilities.includes(required), required);
  assert.strictEqual(graph.validateGraph(optimize, registry), optimize);
});
