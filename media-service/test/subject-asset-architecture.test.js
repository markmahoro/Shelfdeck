'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-subject-asset-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  for (const name of ['../src/nexoraStore', '../src/nexoraService', '../src/libraStore', '../src/kairoxStore', '../src/kairoxAdmissionStore']) {
    try { require(name).resetForTests(); } catch (_) {}
  }
  return dir;
}

test('a complete observation session groups all Seasons and Episodes into one Series Manifest', () => {
  freshDataDir();
  const nexora = require('../src/nexoraService');
  const observations = [1, 2, 3].map((episode) => ({
    sourceSubjectKey: 'emby:server:series-1', sourceAssetKey: `emby:server:episode-${episode}`,
    subjectKind: 'series', displayName: 'Series One', sourceReference: { source: 'emby', sourceRefId: 'series-1', subLib: { uuid: 'library', embyServerId: 'server' } },
    asset: { assetKind: 'episode', seasonKey: episode < 3 ? '1' : '2', episodeKey: String(episode), partKey: '', sourceIdentity: { embyItemId: `episode-${episode}` }, providerIdentity: {}, sourceReference: { embyItemId: `episode-${episode}` }, canonicalLocator: { path: `Z:/Series/S0${episode < 3 ? 1 : 2}E0${episode}.mkv` }, evidence: {} },
  }));
  nexora.stageObservationPage({ workId: 'work', subLibraryId: 'library', observations: observations.slice(0, 2), cursor: { startIndex: 2 } });
  nexora.stageObservationPage({ workId: 'work', subLibraryId: 'library', observations: observations.slice(2), cursor: { startIndex: 3 } });
  const manifests = nexora.finalizeObservationWork({ workId: 'work' });
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].subjectKind, 'series');
  assert.equal(manifests[0].assets.length, 3);
});

test('Nexora preserves Asset identity across locator change by provider or episode key', () => {
  freshDataDir();
  const store = require('../src/nexoraStore');
  const first = store.upsertSourceAsset({ subjectId: 'subject', assetKind: 'episode', seasonKey: '1', episodeKey: '1', sourceIdentity: { embyItemId: 'old' }, providerIdentity: { Tvdb: '11' }, canonicalLocator: { path: 'Z:/old.mkv' } });
  const rebound = store.upsertSourceAsset({ subjectId: 'subject', assetKind: 'episode', seasonKey: '1', episodeKey: '1', sourceIdentity: { embyItemId: 'new' }, providerIdentity: { Tvdb: '11' }, canonicalLocator: { path: 'Z:/new.mkv' } });
  assert.equal(rebound.assetId, first.assetId);
  assert.equal(rebound.assetRevision, first.assetRevision + 1);
});

test('one Series Basedata Task fans out typed Asset Events and joins into Subject publication', () => {
  const registry = require('../src/capabilityRegistry');
  registry.resetForTests();
  require('../src/builtInCapabilities').registerBuiltIns();
  const planner = require('../src/workflowPlanner');
  const task = { id: 'task', subjectId: 'series', targetGate: 'basedata', taskTarget: { targetGate: 'basedata', gateObjective: {} },
    subjectInfo: { subjectKind: 'series', subLibraryId: 'library' }, helixAdmission: { sourceRevision: '1', sourceAccessDescriptor: { sourceType: 'emby', subLibraryId: 'library' }, assets: [
      { assetId: 'e1', assetKind: 'episode', seasonKey: '1', episodeKey: '1', assetRevision: 1, canonicalLocator: { path: 'Z:/S01E01.mkv' } },
      { assetId: 'e2', assetKind: 'episode', seasonKey: '1', episodeKey: '2', assetRevision: 1, canonicalLocator: { path: 'Z:/S01E02.mkv' } },
    ] } };
  const plan = planner.planTask(task, { subLibraries: [{ uuid: 'library' }] });
  assert.equal(plan.nodes.filter((node) => node.capability === 'emby.item.observe').length, 2);
  assert.equal(plan.nodes.filter((node) => node.capability === 'basedata.publish').length, 2);
  assert.equal(plan.nodes.at(-1).capability, 'basedata.subject.publish');
  assert.deepEqual(plan.nodes.filter((node) => node.assetScope).map((node) => node.assetScope.assetId).filter((id, index, rows) => rows.indexOf(id) === index), ['e1', 'e2']);
});

test('Season package must be a superset of managed Episode keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-season-package-'));
  fs.writeFileSync(path.join(root, 'Show.S01E01.mkv'), 'one');
  const service = require('../src/seriesSeasonReplacementService');
  const assets = [
    { assetId: 'e1', seasonKey: '1', episodeKey: '1', partKey: '' },
    { assetId: 'e2', seasonKey: '1', episodeKey: '2', partKey: '' },
  ];
  assert.throws(() => service.inspectPackage(root, assets, '1'), { code: 'SERIES_SEASON_PACKAGE_NOT_SUPERSET' });
  fs.writeFileSync(path.join(root, 'Show.S01E02.mkv'), 'two');
  assert.equal(service.inspectPackage(root, assets, '1').superset, true);
});

test('one Series Optimize Task fans out transcode effects per Episode Asset and joins once', () => {
  const registry = require('../src/capabilityRegistry');
  registry.resetForTests();
  require('../src/builtInCapabilities').registerBuiltIns();
  const planner = require('../src/workflowPlanner');
  const task = { id: 'series-optimize', subjectId: 'series', targetGate: 'optimize', objectiveRevisionSnapshot: 'o1',
    taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { targetCodec: 'h265' } } },
    subjectInfo: { subjectKind: 'series', type: 'series', codec: 'h264', bitrate: 10, resolution: '1920x1080', subLibraryId: 'library' },
    helixAdmission: { assets: [
      { assetId: 'e1', assetKind: 'episode', seasonKey: '1', episodeKey: '1', assetRevision: 1, canonicalLocator: { path: 'Z:/S01E01.mkv' } },
      { assetId: 'e2', assetKind: 'episode', seasonKey: '1', episodeKey: '2', assetRevision: 1, canonicalLocator: { path: 'Z:/S01E02.mkv' } },
    ], sourceAccessDescriptor: { subLibraryId: 'library' } } };
  const plan = planner.planTask(task, { transcodeEncodingDevices: [{ stableKey: 'cpu:libx265', inPool: true }], subLibraries: [{ uuid: 'library', allowedCapabilities: { optimize: ['media.transcode', 'media.file.replace'] } }] });
  assert.equal(plan.classification, 'series_transcode');
  assert.equal(plan.nodes.filter((node) => node.capability === 'media.transcode.precheck').length, 2);
  assert.equal(plan.nodes.filter((node) => node.capability === 'media.file.replace').length, 2);
  assert.equal(plan.nodes.filter((node) => node.capability === 'series.optimization.result.publish').length, 1);
});

test('Season replacement rolls the original directory back when commit rename fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-season-rollback-'));
  const target = path.join(root, 'Season 01');
  const staged = path.join(root, 'staged');
  fs.mkdirSync(target); fs.mkdirSync(staged);
  fs.writeFileSync(path.join(target, 'Show.S01E01.mkv'), 'original');
  fs.writeFileSync(path.join(target, 'poster.jpg'), 'sidecar');
  fs.writeFileSync(path.join(staged, 'Show.S01E01.mkv'), 'replacement');
  const service = require('../src/seriesSeasonReplacementService');
  const originalRename = fs.renameSync;
  let renameCount = 0;
  fs.renameSync = (...args) => { renameCount += 1; if (renameCount === 2) throw Object.assign(new Error('injected commit failure'), { code: 'INJECTED' }); return originalRename(...args); };
  try {
    assert.throws(() => service.replaceSeason({ packageRoot: staged, currentAssets: [{ assetId: 'e1', seasonKey: '1', episodeKey: '1', partKey: '', canonicalLocator: { path: path.join(target, 'Show.S01E01.mkv') } }], seasonKey: '1', operationId: 'rollback' }), { code: 'INJECTED' });
  } finally { fs.renameSync = originalRename; }
  assert.equal(fs.readFileSync(path.join(target, 'Show.S01E01.mkv'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(target, 'poster.jpg'), 'utf8'), 'sidecar');
});

test('Series Upgrade selects the first Season with an unresolved objective gap', () => {
  const registry = require('../src/capabilityRegistry'); registry.resetForTests(); require('../src/builtInCapabilities').registerBuiltIns();
  const plan = require('../src/workflowPlanner').planTask({ id: 'season-order', subjectId: 'series', targetGate: 'optimize',
    taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { minResolution: '2160p' } } },
    subjectInfo: { subjectKind: 'series', type: 'series', subLibraryId: 'library', resolution: '720p', basedataFacts: { assets: [
      { assetId: 's1e1', facts: { resolution: '3840x2160' } }, { assetId: 's2e1', facts: { resolution: '1920x1080' } },
    ] } }, helixAdmission: { assets: [
      { assetId: 's2e1', assetKind: 'episode', seasonKey: '2', episodeKey: '1', canonicalLocator: { path: 'Z:/S02E01.mkv' } },
      { assetId: 's1e1', assetKind: 'episode', seasonKey: '1', episodeKey: '1', canonicalLocator: { path: 'Z:/S01E01.mkv' } },
    ], sourceAccessDescriptor: { subLibraryId: 'library' } } }, { subLibraries: [{ uuid: 'library', allowedCapabilities: { optimize: ['source.upgrade.request', 'series.season.replace'] } }] });
  assert.equal(plan.nodes.find((node) => node.capability === 'series.upgrade.identity.resolve').parameters.seasonKey, '2');
});
