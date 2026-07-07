'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const approvalPolicy = require('../src/approvalPolicy');
const configStore = require('../src/configStore');
const libraryStore = require('../src/libraryStore');
const taskAdmission = require('../src/taskAdmission');
const smartTaskEngine = require('../src/smartTaskEngine');
const taskStore = require('../src/taskStore');
const embyService = require('../src/services/embyService');
const transcodeService = require('../src/services/transcodeService');
const scrapeVerification = require('../src/scrapeVerification');
const lifecycleGateService = require('../src/lifecycleGateService');
const lifecycleProjection = require('../src/lifecycleProjection');
const lifecycleObjectiveResolver = require('../src/lifecycleObjectiveResolver');
const resourceProjection = require('../src/resourceProjection');
const diagnosticLog = require('../src/diagnosticLog');
const backgroundIoGuard = require('../src/backgroundIoGuard');
const mediaLibraryService = require('../src/mediaLibraryService');
const metadataStatus = require('../src/metadataStatus');
const flowRecoveryContract = require('../src/flowRecoveryContract');
const flowPlanner = require('../src/flowPlanner');
const optimizationStatus = require('../src/optimizationStatus');
const v3Model = require('../src/v3Model');

function metadataReadyMovie(overrides = {}) {
  const itemId = overrides.itemId || 'movie-' + crypto.randomUUID().slice(0, 8);
  return {
    itemId,
    source: 'emby',
    sourceId: itemId,
    name: 'Metadata Ready Movie',
    type: 'movie',
    path: `/media/${itemId}.mkv`,
    size: 1024 * 1024 * 1024,
    duration: 3600,
    bitrate: 4_000_000,
    resolution: '1920x1080',
    codec: 'h264',
    watched: true,
    userRating: 4,
    tmdbId: '10001',
    metadataComplete: true,
    metadataStatus: 'complete',
    optimizeObjectiveStatus: 'ready',
    optimizeObjective: {
      kind: 'target_media_facts',
      targetMediaFacts: { targetBitrate: 6, targetCodec: 'h265' },
    },
    targetMediaFacts: { targetBitrate: 6, targetCodec: 'h265' },
    targetBitrate: 6,
    targetCodec: 'h265',
    userRatingUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('approvalPolicy default gate catalog is complete and normalized', () => {
  const expected = [
    'delete.beforeExecute',
    'transcode.dolbyVisionTonemap',
    'transcode.beforeReplace',
    'upgrade.candidateSelect',
    'upgrade.identityMismatch',
    'upgrade.beforeReplace',
    'scrape.beforeWriteMetadata',
    'scrape.beforeOrganize',
    'scrape.reviewResult',
  ];
  const actual = Object.keys(approvalPolicy.DEFAULT_APPROVAL_POLICY).sort();
  assert.deepStrictEqual(actual, [...expected].sort());
  for (const gateId of expected) {
    assert.ok(['auto', 'confirm', 'forceConfirm'].includes(approvalPolicy.DEFAULT_APPROVAL_POLICY[gateId]));
  }
});

test('approvalPolicy resolves global, sub-library, and task overrides', () => {
  const config = {
    approvalPolicy: { 'transcode.beforeReplace': 'confirm' },
    subLibraries: [{
      uuid: 'lib-a',
      approvalPolicy: { 'transcode.beforeReplace': 'auto' },
    }],
  };
  const itemInfo = { itemId: 'i1', subLibraryId: 'lib-a' };

  assert.strictEqual(
    approvalPolicy.resolveGate('transcode.beforeReplace', { itemInfo, config }),
    'auto',
  );
  assert.strictEqual(
    approvalPolicy.resolveGate('transcode.beforeReplace', {
      itemInfo,
      task: { approvalPolicy: { 'transcode.beforeReplace': 'confirm' } },
      config,
    }),
    'confirm',
  );
});

test('scrapeVerification judges scraped item state instead of task completion state', () => {
  const mediaPath = path.join(os.tmpdir(), 'SORA-107 Some Title.mp4');
  const item = {
    itemId: 'adult-1',
    name: 'SORA-107 Some Title',
    source: 'adult_folder',
    path: mediaPath,
    subLibraryId: 'adult-lib',
    scraped: true,
    size: 1024 * 1024,
    duration: 1200,
    bitrate: 3_000_000,
    resolution: '1920x1080',
    codec: 'h264',
    adultMetadata: {
      region: 'japanese_jav',
      scrapeStatus: 'done',
      adultId: 'SORA-107',
      title: 'SORA-107 Some Title',
      source: 'javbus',
      nfoPath: path.join(os.tmpdir(), 'movie.nfo'),
      fileNfoPath: path.join(os.tmpdir(), 'SORA-107.nfo'),
      posterPath: path.join(os.tmpdir(), 'poster.jpg'),
      markerPath: path.join(os.tmpdir(), '.shelfdeck.json'),
    },
  };

  const result = scrapeVerification.verifyScrapedItem(item, {
    checkFiles: false,
    requireMarker: false,
    scrapeTaskId: 'scrape-task-1',
    task: { id: 'scrape-task-1', flowPlan: { flowKind: 'scrape' }, status: 'executing' },
    config: { adultLibrary: { japaneseJav: { writeNfo: true } } },
    subLib: { uuid: 'adult-lib', adultRegion: 'japanese_jav' },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.checks['task.done'], undefined);
});

test('approvalPolicy forceConfirm cannot be lowered by overrides', () => {
  const config = {
    approvalPolicy: { 'upgrade.identityMismatch': 'auto' },
    subLibraries: [{ uuid: 'lib-a', approvalPolicy: { 'upgrade.identityMismatch': 'auto' } }],
  };
  const itemInfo = { itemId: 'i1', subLibraryId: 'lib-a' };
  assert.strictEqual(
    approvalPolicy.resolveGate('upgrade.identityMismatch', { itemInfo, config }),
    'forceConfirm',
  );
});

test('resolveSubLibSchedule treats automationMode as the canonical scheduling switch', () => {
  const config = {
    subLibraries: [{
      uuid: 'lib-a',
      automationMode: 'manual',
      scheduleMode: 'full_auto',
      autoCreate: true,
      autoExecute: true,
      approvalPolicy: { 'scrape.reviewResult': 'confirm' },
    }, {
      uuid: 'lib-b',
      automationMode: 'auto',
      scheduleMode: 'full_manual',
      autoCreate: false,
      autoExecute: false,
    }, {
      uuid: 'legacy-custom',
      scheduleMode: 'custom',
      autoCreate: true,
      autoExecute: false,
    }],
  };

  assert.deepStrictEqual(
    configStore.resolveSubLibSchedule({ subLibraryId: 'lib-a' }, config),
    {
      automationMode: 'manual',
      autoCreate: true,
      autoExecute: false,
      approvalPolicy: { 'scrape.reviewResult': 'confirm' },
    },
  );
  assert.deepStrictEqual(
    configStore.resolveSubLibSchedule({ subLibraryId: 'lib-b' }, config),
    {
      automationMode: 'auto',
      autoCreate: true,
      autoExecute: true,
      approvalPolicy: {},
    },
  );
  assert.deepStrictEqual(
    configStore.resolveSubLibSchedule({ subLibraryId: 'legacy-custom' }, config),
    {
      automationMode: 'manual',
      autoCreate: true,
      autoExecute: false,
      approvalPolicy: {},
    },
  );
});

test('config migration adds archive to legacy non-empty smart task automation allow-list', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  delete process.env.MEDIA_SERVICE_DATA_DIR;

  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      smartTaskEnabledActions: ['ingest', 'scrape', 'transcode'],
      ruleTemplates: configStore.getDefaultConfig().ruleTemplates,
    }, null, 2));

    const loaded = configStore.loadConfig();
    assert.strictEqual(loaded.smartTaskEnabledActions, undefined);
    assert.deepStrictEqual(loaded.automaticTaskTargets, ['ingest', 'metadata', 'optimize', 'archive']);
    assert.deepStrictEqual(loaded.optimizeAllowedFlowKinds, ['transcode']);
    assert.strictEqual(loaded.migrations.v31ArchiveAutomation, true);
    assert.ok(fs.existsSync(path.join(dir, 'config.json.v9.backup')));

    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.strictEqual(saved.smartTaskEnabledActions, undefined);
    assert.deepStrictEqual(saved.automaticTaskTargets, ['ingest', 'metadata', 'optimize', 'archive']);
    assert.deepStrictEqual(saved.optimizeAllowedFlowKinds, ['transcode']);
    assert.strictEqual(saved.migrations.v31ArchiveAutomation, true);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('config migration projects legacy delete as a delete target, not an optimize operation', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  delete process.env.MEDIA_SERVICE_DATA_DIR;

  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      smartTaskEnabledActions: ['transcode', 'delete'],
      ruleTemplates: configStore.getDefaultConfig().ruleTemplates,
    }, null, 2));

    const loaded = configStore.loadConfig();
    assert.deepStrictEqual(loaded.automaticTaskTargets, ['optimize', 'delete', 'archive']);
    assert.deepStrictEqual(loaded.optimizeAllowedFlowKinds, ['transcode']);
    assert.strictEqual(loaded.smartTaskEnabledActions, undefined);
    assert.strictEqual(loaded.deleteGatePolicy.enabled, false);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('config migration removes delete from new optimize operation allow-list', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  delete process.env.MEDIA_SERVICE_DATA_DIR;

  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      automaticTaskTargets: ['optimize', 'delete'], optimizeAllowedFlowKinds: ['transcode'],
      ruleTemplates: configStore.getDefaultConfig().ruleTemplates,
    }, null, 2));

    const loaded = configStore.loadConfig();
    assert.deepStrictEqual(loaded.automaticTaskTargets, ['optimize', 'delete']);
    assert.deepStrictEqual(loaded.optimizeAllowedFlowKinds, ['transcode']);
    assert.strictEqual(loaded.smartTaskEnabledActions, undefined);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('config migration keeps an empty smart task automation allow-list disabled', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  delete process.env.MEDIA_SERVICE_DATA_DIR;

  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      automaticTaskTargets: [], optimizeAllowedFlowKinds: [],
      ruleTemplates: configStore.getDefaultConfig().ruleTemplates,
    }, null, 2));

    const loaded = configStore.loadConfig();
    assert.strictEqual(loaded.smartTaskEnabledActions, undefined);
    assert.deepStrictEqual(loaded.automaticTaskTargets, []);
    assert.deepStrictEqual(loaded.optimizeAllowedFlowKinds, []);
    assert.strictEqual(loaded.migrations, undefined);
    assert.strictEqual(fs.existsSync(path.join(dir, 'config.json.v9.backup')), false);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('config normalization keeps new automatic task targets authoritative over legacy projection', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  delete process.env.MEDIA_SERVICE_DATA_DIR;

  try {
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      automaticTaskTargets: ['ingest'],
      optimizeAllowedFlowKinds: [],
      ruleTemplates: configStore.getDefaultConfig().ruleTemplates,
    }, null, 2));

    const loaded = configStore.loadConfig();
    assert.deepStrictEqual(loaded.automaticTaskTargets, ['ingest']);
    assert.deepStrictEqual(loaded.optimizeAllowedFlowKinds, []);
    assert.strictEqual(loaded.smartTaskEnabledActions, undefined);
    assert.strictEqual(loaded.migrations, undefined);
    assert.strictEqual(fs.existsSync(path.join(dir, 'config.json.v9.backup')), false);

    const saved = configStore.saveConfig({
      ...loaded,
      automaticTaskTargets: ['ingest'],
      optimizeAllowedFlowKinds: [],
    });
    assert.deepStrictEqual(saved.automaticTaskTargets, ['ingest']);
    assert.deepStrictEqual(saved.optimizeAllowedFlowKinds, []);
    assert.strictEqual(saved.smartTaskEnabledActions, undefined);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskAdmission allows automatic task creation for manual sub-libraries', () => {
  const config = {
    automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
    subLibraries: [{ uuid: 'manual-lib', automationMode: 'manual' }],
  };
  const item = metadataReadyMovie({ itemId: 'i1', subLibraryId: 'manual-lib', metadataComplete: true });
  const auto = taskAdmission.canCreateTask({
    item,
    targetGate: 'optimize',
    source: 'auto',
    config,
    tasks: [],
  });
  const manual = taskAdmission.canCreateTask({
    item,
    targetGate: 'optimize',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(auto.allowed, true);
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission uses automaticTaskTargets as the global automatic allow-list', () => {
  const config = {
    automaticTaskTargets: ['ingest'], optimizeAllowedFlowKinds: [],
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const scrape = taskAdmission.canCreateTask({
    item: { itemId: 'i1', subLibraryId: 'lib-a' },
    targetGate: 'metadata',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(scrape.allowed, false);
  assert.strictEqual(scrape.reason, 'target_gate_not_enabled');

  const ingest = taskAdmission.canCreateTask({
    item: { itemId: 'i2', subLibraryId: 'lib-a' },
    targetGate: 'ingest',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(ingest.allowed, true);
});

test('taskAdmission allows automatic optimize operations when `optimize` is configured', () => {
  const config = {
    automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode', 'upgrade'],
    subLibraries: [{ uuid: 'lib-a', source: 'emby', mediaType: 'movie', automationMode: 'auto' }],
  };
  const auto = taskAdmission.canCreateTask({
    item: metadataReadyMovie({ itemId: 'i1', subLibraryId: 'lib-a', metadataComplete: true }),
    targetGate: 'optimize',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(auto.allowed, true);
  assert.strictEqual(auto.taskTarget.targetGate, 'optimize');
});

test('taskAdmission separates automatic task targets from optimize operation authorization', () => {
  const config = {
    automaticTaskTargets: ['metadata', 'optimize'],
    optimizeAllowedFlowKinds: ['transcode'],
    subLibraries: [{ uuid: 'lib-a', source: 'emby', mediaType: 'movie', automationMode: 'auto' }],
  };

  const scrape = taskAdmission.canCreateTask({
    item: { itemId: 'missing-metadata', source: 'emby', subLibraryId: 'lib-a', type: 'movie', name: 'Missing Metadata' },
    targetGate: 'metadata',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(scrape.allowed, true);
  assert.strictEqual(scrape.taskTarget.targetGate, 'metadata');

  const optimize = taskAdmission.canCreateTask({
    item: metadataReadyMovie({ itemId: 'optimize-allowed', subLibraryId: 'lib-a', metadataComplete: true }),
    targetGate: 'optimize',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(optimize.allowed, true);
  assert.strictEqual(optimize.taskTarget.targetGate, 'optimize');

  const ingest = taskAdmission.canCreateTask({
    item: { itemId: 'ingest-blocked', subLibraryId: 'lib-a' },
    targetGate: 'ingest',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(ingest.allowed, false);
  assert.strictEqual(ingest.reason, 'target_gate_not_enabled');
});

test('taskAdmission treats a missing automatic allow-list as disabled', () => {
  const config = {
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const auto = taskAdmission.canCreateTask({
    item: { itemId: 'i1', subLibraryId: 'lib-a' },
    targetGate: 'metadata',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'target_gate_not_enabled');

  const manual = taskAdmission.canCreateTask({
    item: { itemId: 'i1', subLibraryId: 'lib-a' },
    targetGate: 'metadata',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission allows archive only after optimize gate is satisfied and not closed', () => {
  const config = {
    automaticTaskTargets: ['archive'], optimizeAllowedFlowKinds: [],
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const ready = metadataReadyMovie({
    itemId: 'archive-ready',
    subLibraryId: 'lib-a',
    action: 'transcode',
    optimizationStatus: 'transcoded',
    optimizeFlowKind: 'transcode',
    optimizationDoneAt: new Date().toISOString(),
    codec: 'h265',
    videoCodec: 'h265',
    optimizeGate: { gate: 'optimize', passed: true, status: 'passed', flowKind: 'transcode' },
  });
  const allowed = taskAdmission.canCreateTask({
    item: ready,
    targetGate: 'archive',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(allowed.allowed, true);
  assert.strictEqual(allowed.taskTarget.targetGate, 'archive');

  const notOptimized = taskAdmission.canCreateTask({
    item: metadataReadyMovie({ itemId: 'archive-not-optimized', subLibraryId: 'lib-a', action: 'transcode' }),
    targetGate: 'archive',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(notOptimized.allowed, false);
  assert.strictEqual(notOptimized.reason, 'optimize_gate_missing');

  const closed = taskAdmission.canCreateTask({
    item: { ...ready, archiveStatus: 'archived_like', archiveDoneAt: new Date().toISOString() },
    targetGate: 'archive',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(closed.allowed, false);
  assert.strictEqual(closed.reason, 'archive_already_closed');
});





test('flowPlanner selects no-op, transcode, and blocked upgrade from objective gaps', () => {
  const objective = {
    kind: 'target_media_facts',
    targetMediaFacts: {
      qualityTier: 'standard',
      targetBitrateByBucket: { '1080p': 4 },
      targetCodec: 'h265',
    },
  };

  const satisfied = flowPlanner.selectOptimizeFlow({
    itemInfo: metadataReadyMovie({ bitrate: 4_200_000, equivalentBitrate: 4.2, codec: 'hevc' }),
    optimizeObjective: objective,
    optimizeObjectiveStatus: 'ready',
  });
  assert.strictEqual(satisfied.flowKind, 'no_op');
  assert.strictEqual(satisfied.reason, 'objective_already_satisfied');

  const transcode = flowPlanner.selectOptimizeFlow({
    itemInfo: metadataReadyMovie({ bitrate: 10_000_000, equivalentBitrate: 10, codec: 'h264' }),
    optimizeObjective: objective,
    optimizeObjectiveStatus: 'ready',
    allowedOptimizeFlowKinds: ['transcode'],
  });
  assert.strictEqual(transcode.flowKind, 'transcode');
  assert.ok(transcode.gap.some((gap) => gap.reason === 'bitrate_above_target'));
  assert.ok(transcode.gap.some((gap) => gap.reason === 'codec_mismatch'));

  const plannedFromTaskTarget = flowPlanner.planFlow({
    targetGate: 'optimize',
    source: 'manual',
    itemId: 'movie-root-objective',
    itemInfo: metadataReadyMovie({
      itemId: 'movie-root-objective',
      bitrate: 10_000_000,
      equivalentBitrate: 10,
      resolution: '3840x2160',
      codec: 'h265',
    }),
    taskTarget: {
      targetGate: 'optimize',
      gateObjective: {
        kind: 'reduce_bitrate',
        targetBitrate: 6,
        targetCodec: 'h265',
      },
    },
    allowedOptimizeFlowKinds: ['transcode'],
  });
  assert.strictEqual(plannedFromTaskTarget.flowPlan.flowSelection.flowKind, 'transcode');
  assert.strictEqual(plannedFromTaskTarget.flowPlan.flowSelection.reason, 'local_transform_satisfies_objective');

  const needsUpgrade = flowPlanner.selectOptimizeFlow({
    itemInfo: metadataReadyMovie({ bitrate: 4_000_000, equivalentBitrate: 4, resolution: '1920x1080', codec: 'hevc' }),
    optimizeObjective: {
      kind: 'target_media_facts',
      targetMediaFacts: {
        qualityTier: 'premium',
        minResolution: '4K',
        targetBitrateByBucket: { '1080p': 8, '4K': 18 },
        targetCodec: 'h265',
      },
    },
    optimizeObjectiveStatus: 'ready',
    allowedOptimizeFlowKinds: ['transcode'],
  });
  assert.strictEqual(needsUpgrade.flowKind, 'blocked');
  assert.strictEqual(needsUpgrade.suggestedFlowKind, 'upgrade');
  assert.strictEqual(needsUpgrade.blockedReason, 'needs_upgrade');

  const upgrade = flowPlanner.selectOptimizeFlow({
    itemInfo: metadataReadyMovie({ bitrate: 4_000_000, equivalentBitrate: 4, resolution: '1920x1080', codec: 'hevc' }),
    optimizeObjective: {
      kind: 'target_media_facts',
      targetMediaFacts: {
        qualityTier: 'premium',
        minResolution: '4K',
        targetBitrateByBucket: { '1080p': 8, '4K': 18 },
        targetCodec: 'h265',
      },
    },
    optimizeObjectiveStatus: 'ready',
    allowedOptimizeFlowKinds: ['upgrade'],
    flowSafetyFacts: {
      moviepilotConfigured: true,
      upgradeCanarySlotAvailable: true,
    },
  });
  assert.strictEqual(upgrade.flowKind, 'upgrade');
  assert.strictEqual(upgrade.reason, 'better_source_required');
});









test('lifecycleObjectiveResolver keeps optimize objective separate from selected flow fallback', () => {
  const explicit = lifecycleObjectiveResolver.resolveOptimizeObjective({
    action: 'transcode',
    optimizeObjective: {
      kind: 'repair_dolby_vision_compatibility',
      description: 'Media should be playable on configured clients.',
      selectedFlow: 'remux',
    },
  }, { selectedFlow: 'transcode' });
  assert.strictEqual(explicit.kind, 'repair_dolby_vision_compatibility');
  assert.strictEqual(explicit.selectedFlow, undefined);
  assert.strictEqual(explicit.source, 'explicit_lifecycle_objective');

  const pending = lifecycleObjectiveResolver.resolveOptimizeObjective({
    itemId: 'newly-discovered',
    reason: '新入库',
  });
  assert.strictEqual(pending.kind, 'optimize_strategy_pending');
  assert.strictEqual(pending.source, 'lifecycle_pending');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(pending, 'acceptableFlows'), false);
});

test('flowPlanner blocks legacy remove_media objectives from optimize flow selection', () => {
  const selection = flowPlanner.selectOptimizeFlow({
    itemInfo: metadataReadyMovie({
      itemId: 'legacy-remove-media',
      optimizeObjective: { kind: 'remove_media', destructive: true },
      optimizeObjectiveStatus: 'ready',
    }),
    optimizeObjective: { kind: 'remove_media', destructive: true },
    optimizeObjectiveStatus: 'ready',
    allowedOptimizeFlowKinds: ['transcode', 'upgrade'],
  });

  assert.strictEqual(selection.flowKind, 'blocked');
  assert.strictEqual(selection.allowed, false);
  assert.strictEqual(selection.reason, 'delete_is_not_optimize');
  assert.strictEqual(selection.blockedReason, 'delete_gate_required');
});

test('satisfied target facts pass optimize gate as no-op', () => {
  const gate = lifecycleGateService.evaluateOptimizeGate(metadataReadyMovie({
    itemId: 'target-facts-no-op',
    reason: 'already acceptable',
    targetMediaFacts: { targetCodec: 'h264' },
    optimizeObjective: { kind: 'target_media_facts', targetMediaFacts: { targetCodec: 'h264' } },
    targetCodec: 'h264',
    codec: 'h264',
  }));
  assert.strictEqual(gate.passed, true);
  assert.strictEqual(gate.flowKind, 'no_op');
  assert.strictEqual(gate.reason, 'objective_already_satisfied');
  assert.strictEqual(gate.target.targetCodec, 'h264');
});

test('optimization read model does not project delete as an optimize result', () => {
  const deleteOnly = optimizationStatus.resolveOptimization({
    itemId: 'deleted-item',
    subLibraryId: 'lib-a',
    deletedAt: '2026-07-01T00:00:00.000Z',
    removed: true,
    optimizationStatus: 'deleted',
    optimizeFlowKind: 'delete',
    optimizationDoneAt: '2026-07-01T00:00:00.000Z',
  }, optimizationStatus.buildOptimizationIndex([
    {
      id: 'delete-task',
      itemId: 'deleted-item',
      flowPlan: { flowKind: 'delete' },
      status: 'done',
      updatedAt: '2026-07-01T00:00:00.000Z',
      itemInfo: { subLibraryId: 'lib-a', path: '/media/deleted.mkv' },
    },
  ], { subLibraries: [{ uuid: 'lib-a' }] }), { subLibraries: [{ uuid: 'lib-a' }] });

  assert.deepStrictEqual(deleteOnly, {
    optimizationStatus: 'none',
    optimizeFlowKind: null,
    optimizationDoneAt: null,
    optimizationTaskId: null,
  });

  const facts = v3Model.mediaItemFacts({
    itemId: 'legacy-deleted-item',
    optimizationStatus: 'deleted',
    optimizeFlowKind: 'delete',
    deleted: true,
    deleteGate: { gate: 'delete', passed: true, status: 'passed', reason: 'legacy_delete_marker_migrated' },
  });
  assert.strictEqual(facts.optimization_status, 'none');
  assert.strictEqual(facts.optimization_action, '');
});


test('metadataStatus uses sub-library metadataGate as the optimize-ready contract', () => {
  const config = {
    subLibraries: [{
      uuid: 'cn-tv-lib',
      source: 'emby',
      mediaType: 'tv',
      ruleTemplateId: 'tv_technical_only',
      metadataGate: {
        all: [
          'identity.itemId',
          'identity.name',
          'media.path',
          'media.size',
          'media.duration',
          'media.bitrate',
          'media.resolution',
          'media.codec',
        ],
      },
    }],
    ruleTemplates: [{
      id: 'tv_technical_only',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'and', conditions: [['codec', '=', 'h264'], ['equivalentBitrate', '>', 3]] }],
        targetMediaFacts: { targetBitrate: 3, targetCodec: 'h265' },
      }],
    }],
  };
  const item = {
    itemId: 'cn-tv-season',
    source: 'emby',
    name: '国产剧集',
    type: 'season',
    subLibraryId: 'cn-tv-lib',
    path: '/media/cn-tv-season',
    size: 1024,
    duration: 3600,
    bitrate: 5000000,
    resolution: '1920x1080',
    codec: 'h264',
  };

  const meta = metadataStatus.resolveMetadataStatus(item, config);
  assert.strictEqual(meta.metadataStatus, 'complete');
  assert.deepStrictEqual(meta.metadataMissingReasons, []);
});

test('metadataStatus default gate follows sub-library strategy inputs', () => {
  const config = {
    subLibraries: [{
      uuid: 'cn-series-lib',
      source: 'emby',
      mediaType: 'tv',
      ruleTemplateId: 'chn_series',
    }],
    ruleTemplates: [{
      id: 'chn_series',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'and', conditions: [['watched', '=', true], ['bucket', '=', '1080p'], ['equivalentBitrate', '>', 3]] }],
        targetMediaFacts: { targetBitrate: 3, targetCodec: 'h265' },
      }],
    }],
  };
  const item = {
    itemId: 'cn-season-no-rating',
    source: 'emby',
    sourceId: 'cn-season-no-rating',
    name: '国产剧 Season 1',
    type: 'season',
    seriesName: '国产剧',
    seasonNumber: 1,
    subLibraryId: 'cn-series-lib',
    path: '/media/cn-series/Season 1',
    size: 1024 * 1024,
    duration: 3600,
    bitrate: 5_000_000,
    equivalentBitrate: 5,
    resolution: '1920x1080',
    codec: 'h264',
    watched: true,
  };

  const meta = metadataStatus.resolveMetadataStatus(item, config);
  assert.strictEqual(meta.metadataStatus, 'complete');
  assert.deepStrictEqual(meta.metadataMissingReasons, []);

  const unwatched = metadataStatus.resolveMetadataStatus({ ...item, watched: undefined }, config);
  assert.strictEqual(unwatched.metadataStatus, 'complete');
  assert.deepStrictEqual(unwatched.metadataMissingReasons, []);
  assert.ok(!unwatched.metadataMissingReasons.includes('decision.rating'));
  assert.ok(!unwatched.metadataMissingReasons.includes('decision.providerId'));
});

test('metadataStatus default movie gate does not require user perception consumed by strategy', () => {
  const config = {
    subLibraries: [{
      uuid: 'movie-lib',
      source: 'emby',
      mediaType: 'movie',
      ruleTemplateId: 'rating_strategy',
    }],
    ruleTemplates: [{
      id: 'rating_strategy',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'or', conditions: [['userRating', '=', 4], ['doubanRating', '=', 4]] }],
        targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
      }],
    }],
  };

  const missingRating = metadataStatus.resolveMetadataStatus(metadataReadyMovie({
    itemId: 'movie-no-rating',
    subLibraryId: 'movie-lib',
    userRating: undefined,
    doubanRating: undefined,
    doubanStars: undefined,
  }), config);

  assert.strictEqual(missingRating.metadataStatus, 'complete');
  assert.deepStrictEqual(missingRating.metadataMissingReasons, []);
});

test('metadataStatus sanitizes legacy perception fields from custom metadataGate', () => {
  const config = {
    subLibraries: [{
      uuid: 'legacy-gate-lib',
      source: 'emby',
      mediaType: 'movie',
      metadataGate: {
        all: [
          'identity.itemId',
          'identity.name',
          'decision.rating',
          'decision.watched',
          'decision.providerId',
          'media.path',
          'media.duration',
          'media.bitrate',
          'media.resolution',
          'media.codec',
        ],
      },
    }],
  };
  const item = metadataReadyMovie({
    itemId: 'legacy-perception-gate-movie',
    subLibraryId: 'legacy-gate-lib',
    userRating: undefined,
    doubanRating: undefined,
    doubanStars: undefined,
    watched: undefined,
    tmdbId: '12345',
  });

  const gate = metadataStatus.resolveGate(item, config.subLibraries[0], 'emby', config);
  assert.ok(!gate.all.includes('decision.rating'));
  assert.ok(!gate.all.includes('decision.watched'));
  assert.ok(gate.all.includes('identity.providerId'));

  const meta = metadataStatus.resolveMetadataStatus(item, config);
  assert.strictEqual(meta.metadataStatus, 'complete');
  assert.deepStrictEqual(meta.metadataMissingReasons, []);
});

test('configStore migrates legacy perception fields out of saved metadataGate', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  delete process.env.MEDIA_SERVICE_DATA_DIR;

  try {
    const cfg = configStore.saveConfig({
      ...configStore.getDefaultConfig(),
      subLibraries: [{
        uuid: 'legacy-config-gate-lib',
        name: 'Legacy Config Gate',
        source: 'emby',
        mediaType: 'movie',
        ruleTemplateId: 'default',
        metadataGate: {
          all: [
            'identity.itemId',
            'decision.watched',
            'decision.rating',
            'decision.providerId',
            'media.path',
            'media.duration',
            'media.bitrate',
            'media.resolution',
            'media.codec',
          ],
        },
      }],
    });

    const gateFields = cfg.subLibraries[0].metadataGate.all;
    assert.ok(!gateFields.includes('decision.watched'));
    assert.ok(!gateFields.includes('decision.rating'));
    assert.ok(!gateFields.includes('decision.providerId'));
    assert.ok(gateFields.includes('identity.providerId'));
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('metadataStatus marks a custom metadataGate contract broken when strategy inputs are not covered', () => {
  const config = {
    subLibraries: [{
      uuid: 'broken-movie-lib',
      source: 'emby',
      mediaType: 'movie',
      ruleTemplateId: 'rating_strategy',
      metadataGate: { all: ['identity.itemId', 'identity.name', 'media.path'] },
    }],
    ruleTemplates: [{
      id: 'rating_strategy',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'or', conditions: [['userRating', '=', 4], ['doubanRating', '=', 4]] }],
        targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
      }],
    }],
  };
  const item = metadataReadyMovie({
    itemId: 'broken-gate-movie',
    subLibraryId: 'broken-movie-lib',
  });

  const validation = metadataStatus.validateMetadataGateForSubLibrary(config.subLibraries[0], config);
  assert.strictEqual(validation.ok, false);
  assert.ok(!validation.missingRequirements.includes('decision.rating'));
  assert.ok(validation.missingRequirements.includes('media.duration'));

  const meta = metadataStatus.resolveMetadataStatus(item, config);
  assert.strictEqual(meta.metadataStatus, 'missing');
  assert.ok(meta.metadataMissingReasons.includes('metadata_gate_contract_broken'));
});

test('configStore rejects metadataGate configs that do not cover optimize inputs', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  delete process.env.MEDIA_SERVICE_DATA_DIR;

  try {
    configStore.saveConfig({
      ...configStore.getDefaultConfig(),
      subLibraries: [],
    });

    assert.throws(() => {
      configStore.patchConfig({
        subLibraries: [{
          uuid: 'broken-movie-lib',
          name: 'Broken Movies',
          source: 'emby',
          mediaType: 'movie',
          ruleTemplateId: 'rating_strategy',
          metadataGate: { all: ['identity.itemId', 'identity.name', 'media.path'] },
        }],
        ruleTemplates: [{
          id: 'rating_strategy',
          rules: [{
            priority: 1,
            groupsConnector: 'and',
            groups: [{ connector: 'or', conditions: [['userRating', '=', 4], ['doubanRating', '=', 4]] }],
            targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
          }],
        }],
      });
    }, (err) => {
      assert.strictEqual(err.code, 'METADATA_GATE_CONTRACT_BROKEN');
      assert.ok(!err.details.violations[0].missingRequirements.includes('decision.rating'));
      assert.ok(err.details.violations[0].missingRequirements.includes('media.duration'));
      return true;
    });

    const saved = configStore.loadConfig();
    assert.deepStrictEqual(saved.subLibraries, []);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('flowRecoveryContract documents retry points for every current flow', () => {
  const expected = {
    ingest: ['ingest_precheck', 'ingest_commit'],
    archive: ['archive_precheck', 'archive_finalize'],
    scrape: ['scrape_precheck', 'scrape_executing', 'scrape_write_metadata', 'scrape_review'],
    transcode: ['transcode_precheck', 'transcode_executing', 'transcode_verify', 'transcode_replace'],
    upgrade: ['upgrade_precheck', 'upgrade_planning', 'upgrade_executing', 'upgrade_pre_replace_verify', 'upgrade_replace'],
    delete: ['delete_precheck', 'delete_executing', 'delete_verify'],
  };
  for (const [flowKey, resumePoints] of Object.entries(expected)) {
    const contract = flowRecoveryContract.getContract(flowKey);
    assert.ok(contract, `${flowKey} recovery contract exists`);
    assert.strictEqual(contract.flowKey, flowKey);
    assert.ok(resumePoints.includes(contract.defaultResumePoint));
    assert.deepStrictEqual(Object.keys(contract.resumePoints), resumePoints);
    for (const resumePoint of resumePoints) {
      const point = contract.resumePoints[resumePoint];
      assert.ok(point.label, `${flowKey}/${resumePoint} has a label`);
      assert.ok(point.retryStrategy, `${flowKey}/${resumePoint} has a retry strategy`);
      assert.ok(point.idempotency, `${flowKey}/${resumePoint} has idempotency notes`);
    }
  }
});

test('flowRecoveryContract rejects unknown resume points and exposes current point details', () => {
  const good = flowRecoveryContract.buildRecoveryPlan({
    flowPlan: { flowKind: 'scrape' },
    status: 'failed_hard',
    resumePoint: 'scrape_executing',
    retryCount: 1,
  });
  assert.strictEqual(good.available, true);
  assert.strictEqual(good.flowKey, 'scrape');
  assert.strictEqual(good.resumePoint, 'scrape_executing');
  assert.strictEqual(good.resumePointContract.retryStrategy, 'resume_step');

  const bad = flowRecoveryContract.buildRecoveryPlan({
    flowPlan: { flowKind: 'scrape' },
    status: 'failed_hard',
    resumePoint: 'metadata_magic',
  });
  assert.strictEqual(bad.available, false);
  assert.strictEqual(bad.reason, 'unknown_resume_point');
  assert.strictEqual(bad.effect, 'resume_point_not_in_flow_recovery_contract');
});

test('transcode flow plan uses the recovery resume point for verify node attribution', () => {
  const { flowPlan } = flowPlanner.planFlow({
    targetGate: 'optimize',
    taskTarget: {
      targetGate: 'optimize',
      gateObjective: { targetMediaFacts: { targetBitrate: 5, targetCodec: 'h265' } },
    },
    allowedOptimizeFlowKinds: ['transcode'],
    source: 'manual',
    itemId: 'transcode-verify-plan',
    itemInfo: { itemId: 'transcode-verify-plan', bitrate: 10_000_000, codec: 'h264', resolution: '1080p' },
  });
  const phases = flowPlan.steps.map((step) => step.phase);
  assert.deepStrictEqual(phases, [
    'transcode_precheck',
    'transcode_executing',
    'transcode_verify',
    'transcode_replace',
  ]);

  const task = {
    flowPlan,
    resumePoint: 'transcode_verify',
  };
  const step = flowPlanner.currentFlowStep(task);
  assert.strictEqual(step.phase, 'transcode_verify');
  assert.strictEqual(step.eventType, 'optimize.transcode.verify');
  assert.strictEqual(flowPlanner.currentResourceType(task), 'filesystem');
});

test('smartTaskEngine treats an empty automatic allow-list as an intentional disabled state', () => {
  smartTaskEngine.stop();
  smartTaskEngine.start(
    { loadConfig: () => ({
      smartTaskInitialDelaySeconds: 60,
      smartTaskPollIntervalMinutes: 10,
      smartTaskMaxPerRun: 10,
      smartTaskMaxQueueSize: 50,
      automaticTaskTargets: [], optimizeAllowedFlowKinds: [],
      smartTaskLookbackDays: 30,
    }) },
    { getLibrary: () => ({ items: [] }) },
    { getTasks: () => [], createTask: () => { throw new Error('should not create tasks'); } },
  );

  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.status, 'green');
  assert.strictEqual(health.enabled, false);
  assert.strictEqual(health.disabledReason, 'no_enabled_task_targets');
  assert.strictEqual(health.message, '后台自动入队未启用');
  smartTaskEngine.stop();
});

test('smartTaskEngine treats a missing automatic allow-list as disabled', () => {
  smartTaskEngine.stop();
  smartTaskEngine.start(
    { loadConfig: () => ({
      smartTaskInitialDelaySeconds: 60,
      smartTaskPollIntervalMinutes: 10,
      smartTaskMaxPerRun: 10,
      smartTaskMaxQueueSize: 50,
      smartTaskLookbackDays: 30,
    }) },
    { getLibrary: () => ({ items: [] }) },
    { getTasks: () => [], createTask: () => { throw new Error('should not create tasks'); } },
  );

  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.status, 'green');
  assert.strictEqual(health.enabled, false);
  assert.strictEqual(health.disabledReason, 'no_enabled_task_targets');
  assert.deepStrictEqual(health.enabledTaskTargets, []);
  assert.deepStrictEqual(health.allowedOptimizeFlowKinds, []);
  smartTaskEngine.stop();
});

test('smartTaskEngine creates pending_manual tasks for manual sub-libraries', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'manual-lib', automationMode: 'manual' }],
          taskPriority: { autoTaskPriorityBase: 100, targetGateWeights: { optimize: 110 }, optimizeOperationHints: { transcode: 20 }, rulesByTargetGate: { optimize: [] } },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'manual-auto-create',
            name: 'Manual Auto Create',
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'manual-lib',
            path: '/media/manual-auto-create.mkv',
          })],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].status, 'pending_manual');
  assert.strictEqual(created[0].source, 'auto');
});

test('smartTaskEngine auto-enqueues pending adult metadata candidates through TaskAdmission priority', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 1,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata', 'optimize'], optimizeAllowedFlowKinds: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [
            { uuid: 'adult-lib', automationMode: 'auto', priorityWeight: 100 },
            { uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 },
          ],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80, optimize: 110 },
            optimizeOperationHints: { transcode: 20 },
            rulesByTargetGate: { metadata: [], optimize: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0, optimize: 0 },
            maxQueuedByTargetGate: { metadata: 20, optimize: 50 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'movie-transcode',
            name: 'Movie Transcode',
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'movie-lib',
            path: '/media/movie.mkv',
          }), {
            itemId: 'adult-pending-scrape',
            name: 'Adult Pending Scrape',
            source: 'adult_folder',
            type: 'movie',
            watched: false,
            scraped: false,
            subLibraryId: 'adult-lib',
            path: '/adult/pending.mp4',
            size: 1024,
            duration: 1800,
            bitrate: 4000000,
            resolution: '1920x1080',
            codec: 'h264',
            adultMetadata: { scrapeStatus: 'pending' },
          }],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].itemId, 'adult-pending-scrape');
  assert.strictEqual(created[0].taskTarget.targetGate, 'metadata');
  assert.strictEqual(created[0].priority, 260);
  assert.strictEqual(created[0].source, 'auto');
});

test('smartTaskEngine auto-enqueues standard metadata repair scrape', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80 },
            rulesByTargetGate: { metadata: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0 },
            maxQueuedByTargetGate: { metadata: 20 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [{
            itemId: 'standard-missing-metadata',
            source: 'emby',
            name: 'Standard Missing Metadata',
            type: 'movie',
            subLibraryId: 'movie-lib',
            path: '/media/standard-missing-metadata.mkv',
            size: 1024,
            duration: 3600,
            bitrate: 4000000,
            resolution: '1920x1080',
            codec: 'h264',
            watched: true,
            userRating: 4,
          }],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].itemId, 'standard-missing-metadata');
  assert.strictEqual(created[0].taskTarget.targetGate, 'metadata');
  assert.strictEqual(created[0].flowPlan, undefined);
  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.lastScanSummary.status, 'done');
  assert.strictEqual(health.lastScanSummary.candidateCount, 1);
  assert.strictEqual(health.lastScanSummary.evaluatedCandidates, 1);
  assert.strictEqual(health.lastScanSummary.candidatesByTargetGate.metadata, 1);
  assert.strictEqual(health.lastScanSummary.enqueued, 1);
  assert.strictEqual(health.lastScanSummary.enqueuedByTargetGate.metadata, 1);
  assert.strictEqual(health.lastScanSummary.admissionRejected, 0);
});

test('smartTaskEngine does not auto-enqueue standard scrape when only rating facts are missing', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie', automationMode: 'auto', ruleTemplateId: 'default' }],
          ruleTemplates: [{
            id: 'default',
            rules: [{
              action: 'transcode',
              groups: [{
                connector: 'or',
                conditions: [
                  ['userRating', '>=', 4],
                  ['doubanRating', '>=', 8],
                ],
              }],
            }],
          }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80 },
            rulesByTargetGate: { metadata: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0 },
            maxQueuedByTargetGate: { metadata: 20 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [{
            itemId: 'standard-missing-rating',
            source: 'emby',
            name: 'Standard Missing Rating',
            type: 'movie',
            subLibraryId: 'movie-lib',
            tmdbId: '12345',
            metadataComplete: true,
            metadataStatus: 'complete',
            path: '/media/standard-missing-rating.mkv',
            size: 1024,
            duration: 3600,
            bitrate: 4000000,
            resolution: '1920x1080',
            codec: 'h264',
            watched: true,
          }],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask() {
        throw new Error('rating-only metadata gap must not auto-enqueue a scrape task');
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 0);
  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.lastScanSummary.status, 'done');
  assert.strictEqual(health.lastScanSummary.candidateCount, 0);
  assert.strictEqual(health.lastScanSummary.enqueued, 0);
});

test('smartTaskEngine health explains queue-cap skips without creating tasks', async () => {
  smartTaskEngine.stop();
  const activeTasks = [{
    id: 'active-transcode',
    itemId: 'active-transcode-item',
    taskTarget: { targetGate: 'optimize', gateObjective: {} },
    flowPlan: { flowKind: 'transcode', primaryResourceType: 'transcode' },
    status: 'queued',
    updatedAt: new Date().toISOString(),
  }];
  smartTaskEngine.start(
    {
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 1,
          smartTaskDeferWhenActiveBacklog: false,
          automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
          smartTaskLookbackDays: 30,
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { optimize: 110 },
            optimizeOperationHints: { transcode: 20 },
            rulesByTargetGate: { optimize: [] },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'queue-cap-candidate',
            name: 'Queue Cap Candidate',
            action: 'transcode',
            reason: 'high bitrate',
          })],
        };
      },
    },
    {
      getTasks: () => [...activeTasks],
      loadTasks: () => [...activeTasks],
      createTask() {
        throw new Error('queue cap should prevent task creation');
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.lastScanSummary.status, 'done');
  assert.strictEqual(health.lastScanSummary.candidateCount, 1);
  assert.strictEqual(health.lastScanSummary.evaluatedCandidates, 1);
  assert.strictEqual(health.lastScanSummary.candidatesByTargetGate.optimize, 1);
  assert.strictEqual(health.lastScanSummary.enqueued, 0);
  assert.strictEqual(health.lastScanSummary.skippedByQueueCap, 1);
  assert.strictEqual(health.lastScanSummary.skippedByQueueCapByTargetGate.optimize, 1);
  assert.strictEqual(health.lastScanSummary.admissionRejected, 0);
});

test('smartTaskEngine defers auto-enqueue while active backlog exists', async () => {
  smartTaskEngine.stop();
  const activeTasks = [{
    id: 'running-transcode',
    itemId: 'running-transcode-item',
    taskTarget: { targetGate: 'optimize', gateObjective: {} },
    flowPlan: { flowKind: 'transcode', primaryResourceType: 'transcode' },
    status: 'executing',
    updatedAt: new Date().toISOString(),
  }];
  smartTaskEngine.start(
    {
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          smartTaskDeferWhenActiveBacklog: true,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 130 },
            rulesByTargetGate: { metadata: [] },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'deferred-candidate',
            name: 'Deferred Candidate',
            action: 'scrape',
            reason: 'metadata incomplete',
            metadataStatus: 'incomplete',
            metadataComplete: false,
          })],
        };
      },
    },
    {
      getTasks: () => [...activeTasks],
      loadTasks: () => [...activeTasks],
      createTask() {
        throw new Error('active backlog should defer automatic creation');
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.lastScanSummary.status, 'skipped');
  assert.strictEqual(health.lastScanSummary.reason, 'active_task_backlog');
  assert.strictEqual(health.lastScanSummary.activeBacklog, 1);
  assert.strictEqual(health.lastScanSummary.deferredByActiveBacklog, true);
  assert.strictEqual(health.lastScanSummary.enqueued, 0);
});

test('smartTaskEngine pressure policy allows metadata supply while transcode is running', async () => {
  smartTaskEngine.stop();
  const activeTasks = [{
    id: 'running-transcode',
    itemId: 'running-transcode-item',
    taskTarget: { targetGate: 'optimize', gateObjective: {} },
    flowPlan: { flowKind: 'transcode', primaryResourceType: 'transcode' },
    status: 'executing',
    updatedAt: new Date().toISOString(),
  }];
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie', automationMode: 'auto' }],
          resourceCapacity: { 'local:ffmpeg': 1, 'emby:metadata': 1 },
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80 },
            rulesByTargetGate: { metadata: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0 },
            maxQueuedByTargetGate: { metadata: 20 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [{
            itemId: 'metadata-candidate-during-transcode',
            source: 'emby',
            name: 'Metadata Candidate During Transcode',
            type: 'movie',
            subLibraryId: 'movie-lib',
            path: '/media/metadata-candidate-during-transcode.mkv',
            size: 1024,
            duration: 3600,
            bitrate: 4000000,
            resolution: '1920x1080',
            codec: 'h264',
            watched: true,
            userRating: 4,
          }],
        };
      },
    },
    {
      getTasks: () => [...activeTasks, ...created],
      loadTasks: () => [...activeTasks, ...created].filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].itemId, 'metadata-candidate-during-transcode');
  assert.strictEqual(created[0].taskTarget.targetGate, 'metadata');
  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.lastScanSummary.status, 'done');
  assert.strictEqual(health.lastScanSummary.deferredByActiveBacklog, false);
  assert.strictEqual(health.lastScanSummary.activeBacklog, 1);
  assert.ok(health.lastScanSummary.activeBacklogByResource['local:ffmpeg']);
  assert.strictEqual(health.lastScanSummary.enqueuedByTargetGate.metadata, 1);
});

test('smartTaskEngine pressure policy does not let awaiting confirmation stall ingest supply', async () => {
  smartTaskEngine.stop();
  const activeTasks = [{
    id: 'awaiting-transcode-confirm',
    itemId: 'awaiting-transcode-item',
    taskTarget: { targetGate: 'optimize', gateObjective: {} },
    flowPlan: { flowKind: 'transcode', primaryResourceType: 'transcode' },
    status: 'awaiting_user_confirm',
    updatedAt: new Date().toISOString(),
  }];
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['ingest'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-lib', source: 'folder', mediaType: 'adult', automationMode: 'auto', priorityWeight: 100 }],
          resourceCapacity: { 'local:ffmpeg': 1, 'filesystem:ingest': 1 },
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { ingest: 60 },
            rules: { ingest: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { ingest: 0 },
            maxQueuedByTargetGate: { ingest: 50 },
          },
        };
      },
    },
    {
      getLibrary() {
        return { items: [] };
      },
    },
    {
      getTasks: () => [...activeTasks, ...created],
      loadTasks: () => [...activeTasks, ...created].filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
    {
      ingestCandidateProvider() {
        return [{
          timestamp: Date.now(),
          itemInfo: {
            itemId: 'ingest:adult-lib:new-pressure-file',
            name: 'New Pressure File',
            path: '/adult/new-pressure-file.mp4',
            subLibraryId: 'adult-lib',
            source: 'adult_folder',
            mediaType: 'adult',
          },
        }];
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].itemId, 'ingest:adult-lib:new-pressure-file');
  assert.strictEqual(created[0].taskTarget.targetGate, 'ingest');
  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.lastScanSummary.status, 'done');
  assert.strictEqual(health.lastScanSummary.deferredByActiveBacklog, false);
  assert.strictEqual(health.lastScanSummary.activeBacklogByResource['local:ffmpeg'].blocked, 1);
  assert.strictEqual(health.lastScanSummary.enqueuedByTargetGate.ingest, 1);
});

test('smartTaskEngine auto-enqueues ingest candidates through unified priority before transcode', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 1,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['ingest', 'optimize'], optimizeAllowedFlowKinds: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [
            { uuid: 'adult-lib', source: 'folder', mediaType: 'adult', automationMode: 'auto', priorityWeight: 100 },
            { uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 },
          ],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { ingest: 60, optimize: 110 }, optimizeOperationHints: { transcode: 20 },
            rulesByTargetGate: { ingest: [], optimize: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { ingest: 0, optimize: 0 },
            maxQueuedByTargetGate: { ingest: 50, optimize: 50 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [{
            ...metadataReadyMovie({
              itemId: 'movie-transcode',
              name: 'Movie Transcode',
              action: 'transcode',
              reason: 'high bitrate',
              subLibraryId: 'movie-lib',
              path: '/media/movie.mkv',
            }),
          }],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
    {
      ingestCandidateProvider() {
        return [{
          timestamp: Date.now(),
          itemInfo: {
            itemId: 'ingest:adult-lib:new-file',
            name: 'New Adult File',
            path: '/adult/new-file.mp4',
            subLibraryId: 'adult-lib',
            source: 'adult_folder',
            mediaType: 'adult',
          },
        }];
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].taskTarget.targetGate, 'ingest');
  assert.strictEqual(created[0].itemId, 'ingest:adult-lib:new-file');
  assert.strictEqual(created[0].priority, 240);
  assert.strictEqual(created[0].source, 'auto');
});

test('smartTaskEngine leaves failed adult metadata candidates for explicit user action', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-lib', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80 },
            rulesByTargetGate: { metadata: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0 },
            maxQueuedByTargetGate: { metadata: 20 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [{
            itemId: 'adult-failed-scrape',
            name: 'Adult Failed Scrape',
            source: 'adult_folder',
            type: 'movie',
            scraped: false,
            subLibraryId: 'adult-lib',
            path: '/adult/failed.mp4',
            adultMetadata: { scrapeStatus: 'failed' },
          }],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 0);
});

test('smartTaskEngine auto-enqueues western adult pending metadata candidates for first AI analysis', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-western', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80 },
            rulesByTargetGate: { metadata: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0 },
            maxQueuedByTargetGate: { metadata: 20 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [{
            itemId: 'western-unknown-pending',
            name: 'UNK-999',
            source: 'adult_folder',
            type: 'movie',
            scraped: false,
            subLibraryId: 'adult-western',
            path: '/adult/western-unknown.mp4',
            size: 1024,
            duration: 1800,
            bitrate: 4000000,
            resolution: '1920x1080',
            codec: 'h264',
            adultMetadata: {
              region: 'western_adult',
              scrapeStatus: 'pending',
              actors: [],
              faceClusters: [],
              unknownFaces: [],
            },
          }],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].itemId, 'western-unknown-pending');
  assert.strictEqual(created[0].taskTarget.targetGate, 'metadata');
  assert.strictEqual(created[0].priority, 260);
});

test('smartTaskEngine auto scrape trigger is based on not-scraped pending item state', async () => {
  smartTaskEngine.stop();
  const created = [];
  const mk = (itemId, scrapeStatus, extra = {}) => ({
    itemId,
    name: itemId,
    source: 'adult_folder',
    type: 'movie',
    scraped: false,
    subLibraryId: 'adult-lib',
    path: `/adult/${itemId}.mp4`,
    size: 1024,
    duration: 1800,
    bitrate: 4000000,
    resolution: '1920x1080',
    codec: 'h264',
    adultMetadata: { scrapeStatus },
    ...extra,
  });
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-lib', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80 },
            rulesByTargetGate: { metadata: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0 },
            maxQueuedByTargetGate: { metadata: 20 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [
            mk('empty-status', ''),
            mk('pending-status', 'pending'),
            mk('failed-status', 'failed'),
            mk('ambiguous-status', 'ambiguous'),
            mk('review-status', 'needs_review'),
            mk('done-status', 'done'),
            mk('scraped-true', 'pending', { scraped: true }),
          ],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.deepStrictEqual(created.map((t) => t.itemId).sort(), ['empty-status', 'pending-status']);
  assert.ok(created.every((t) => t.taskTarget.targetGate === 'metadata'));
});

test('smartTaskEngine keeps optimize target priority when library weight is neutral', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 1,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { optimize: 110 },
            optimizeOperationHints: { transcode: 20 },
            rulesByTargetGate: { optimize: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { optimize: 0 },
            maxQueuedByTargetGate: { optimize: 50 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'movie-neutral-transcode',
            name: 'Movie Neutral Transcode',
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'movie-lib',
            path: '/media/movie-neutral.mkv',
            metadataComplete: true,
            bitrate: 10_000_000,
            equivalentBitrate: 10,
            codec: 'h264',
            optimizeObjectiveStatus: 'ready',
            optimizeObjective: {
              kind: 'target_media_facts',
              targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
            },
          })],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].taskTarget.targetGate, 'optimize');
  assert.strictEqual(created[0].flowPlan, undefined);
  assert.strictEqual(created[0].priority, 310);
});

test('smartTaskEngine auto-enqueues transcode when only optimize umbrella is enabled', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 1,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode', 'upgrade'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { optimize: 110, delete: 90 }, optimizeOperationHints: { transcode: 20, upgrade: 0 },
            rulesByTargetGate: { optimize: [], delete: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { optimize: 0, delete: 0 },
            maxQueuedByTargetGate: { optimize: 50, delete: 50 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'movie-optimize-aliased',
            name: 'Movie Aliased Optimize',
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'movie-lib',
            path: '/media/movie.mkv',
          })],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].taskTarget.targetGate, 'optimize');
  assert.strictEqual(created[0].source, 'auto');
  const health = smartTaskEngine.getHealth();
  assert.deepStrictEqual(health.enabledTaskTargets, ['optimize']);
  assert.deepStrictEqual(health.allowedOptimizeFlowKinds, ['transcode', 'upgrade']);
  assert.deepStrictEqual(health.lastScanSummary.enabledTaskTargets, ['optimize']);
  assert.deepStrictEqual(health.lastScanSummary.allowedOptimizeFlowKinds, ['transcode', 'upgrade']);
});

test('smartTaskEngine treats metadata-complete unwatched items as optimize candidates', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { optimize: 110 },
            optimizeOperationHints: { transcode: 20 },
            rulesByTargetGate: { optimize: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { optimize: 0 },
            maxQueuedByTargetGate: { optimize: 50 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'movie-unwatched-transcode',
            name: 'Movie Unwatched Transcode',
            watched: false,
            action: 'transcode',
            reason: 'strategy selected transcode',
            subLibraryId: 'movie-lib',
            path: '/media/movie-unwatched.mkv',
          })],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].itemId, 'movie-unwatched-transcode');
  assert.strictEqual(created[0].taskTarget.targetGate, 'optimize');
});

test('smartTaskEngine does not hide optimize candidates behind rating lookback', async () => {
  smartTaskEngine.stop();
  const created = [];
  const oldTimestamp = new Date(Date.now() - 365 * 86400000).toISOString();
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
          smartTaskLookbackDays: 1,
          subLibraries: [{ uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { optimize: 110 },
            optimizeOperationHints: { transcode: 20 },
            rulesByTargetGate: { optimize: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { optimize: 0 },
            maxQueuedByTargetGate: { optimize: 50 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [metadataReadyMovie({
            itemId: 'movie-old-rating-transcode',
            name: 'Movie Old Rating Transcode',
            action: 'transcode',
            reason: 'strategy selected transcode',
            subLibraryId: 'movie-lib',
            path: '/media/movie-old-rating.mkv',
            userRatingUpdatedAt: oldTimestamp,
            doubanRatingUpdatedAt: oldTimestamp,
            updatedAt: oldTimestamp,
            lastRefreshedAt: oldTimestamp,
          })],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].itemId, 'movie-old-rating-transcode');
  assert.strictEqual(created[0].taskTarget.targetGate, 'optimize');
});

test('smartTaskEngine leaves ambiguous adult metadata candidates for explicit user action', async () => {
  smartTaskEngine.stop();
  const created = [];
  smartTaskEngine.start(
    {
      resolveSubLibSchedule: configStore.resolveSubLibSchedule,
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 0,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['metadata'], optimizeAllowedFlowKinds: [],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-lib', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            targetGateWeights: { metadata: 80 },
            rulesByTargetGate: { metadata: [] },
          },
          taskAdmission: {
            cooldownHoursByTargetGate: { metadata: 0 },
            maxQueuedByTargetGate: { metadata: 20 },
          },
        };
      },
    },
    {
      getLibrary() {
        return {
          items: [{
            itemId: 'adult-ambiguous-scrape',
            name: 'Adult Ambiguous Scrape',
            source: 'adult_folder',
            type: 'movie',
            scraped: false,
            subLibraryId: 'adult-lib',
            path: '/adult/ambiguous.mp4',
            adultMetadata: { scrapeStatus: 'ambiguous' },
          }],
        };
      },
    },
    {
      getTasks: () => [...created],
      loadTasks: () => created.filter((t) => !['done', 'failed_hard', 'cancelled', 'skipped', 'deleted'].includes(t.status)),
      createTask(taskData) {
        const task = { id: `t-${created.length + 1}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...taskData };
        created.push(task);
        return task;
      },
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 20));
  smartTaskEngine.stop();
  assert.strictEqual(created.length, 0);
});

test('taskAdmission applies cooldown and active task dedupe', () => {
  const config = {
    automaticTaskTargets: ['optimize', 'metadata'], optimizeAllowedFlowKinds: ['upgrade'],
    moviepilot: { baseUrl: 'http://moviepilot.local', apiKey: 'token' },
    upgradeStagingLocalPath: 'C:\\staging',
    taskAdmission: { defaultCooldownHours: 48 },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const item = {
    itemId: 'i1',
    subLibraryId: 'lib-a',
    metadataComplete: true,
    lastTaskDoneAt: new Date().toISOString(),
  };
  const cooled = taskAdmission.canCreateTask({
    item,
    targetGate: 'optimize',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(cooled.allowed, false);
  assert.strictEqual(cooled.reason, 'recent_task_cooldown');

  const active = taskAdmission.canCreateTask({
    item: { itemId: 'i2', subLibraryId: 'lib-a' },
    targetGate: 'metadata',
    source: 'auto',
    config,
    tasks: [{
      id: 't1',
      itemId: 'i2',
      status: 'queued',
      taskTarget: { targetGate: 'metadata' },
    }],
  });
  assert.strictEqual(active.allowed, false);
  assert.strictEqual(active.reason, 'active_task_exists');
});

test('taskAdmission blocks automatic optimize when optimize gate already passed', () => {
  const config = {
    automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const item = metadataReadyMovie({
    itemId: 'i1',
    subLibraryId: 'lib-a',
    path: '/media/movie.mkv',
    optimizeGate: { gate: 'optimize', passed: true, status: 'passed', flowKind: 'transcode' },
  });
  const result = taskAdmission.canCreateTask({
    item,
    targetGate: 'optimize',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'optimize_gate_already_passed');
});

test('taskAdmission routes optimize gate failures to failure handling instead of new optimize tasks', () => {
  const config = {
    automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode'],
    subLibraries: [{ uuid: 'lib-a', source: 'emby', mediaType: 'movie', automationMode: 'auto' }],
  };
  const item = metadataReadyMovie({
    itemId: 'failed-optimize-admission',
    subLibraryId: 'lib-a',
    metadataComplete: true,
    action: 'transcode',
    optimizeGate: {
      gate: 'optimize',
      passed: false,
      status: 'failed',
      reason: 'target_bitrate_exceeded',
      flowKind: 'transcode',
      failureReasons: ['target_bitrate_exceeded'],
      retryPolicy: { automaticRetry: false, manualRetryAllowed: true, reason: 'heavy_resource_gate_miss' },
    },
  });

  const auto = taskAdmission.canCreateTask({
    item,
    targetGate: 'optimize',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'optimize_gate_failed_requires_failure_handling');
  assert.strictEqual(auto.retryPolicy.manualRetryAllowed, true);
  assert.strictEqual(auto.failureHandling.surface, 'task_center');

  const manual = taskAdmission.canCreateTask({
    item,
    targetGate: 'optimize',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(manual.allowed, false);
  assert.strictEqual(manual.reason, 'optimize_gate_failed_requires_failure_handling');
  assert.strictEqual(manual.failureHandling.userAction, 'inspect_failure_or_mark_no_action');
});

test('taskAdmission caps automatic queue by target gate', () => {
  const config = {
    automaticTaskTargets: ['ingest'], optimizeAllowedFlowKinds: [],
    taskAdmission: {
      cooldownHoursByTargetGate: { ingest: 6 },
      maxQueuedByTargetGate: { ingest: 2 },
    },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const tasks = [
    { id: 't1', itemId: 'ingest:a', taskTarget: { targetGate: 'ingest' }, status: 'queued' },
    { id: 't2', itemId: 'ingest:b', taskTarget: { targetGate: 'ingest' }, status: 'pending_manual' },
    { id: 's1', itemId: 'item-c', taskTarget: { targetGate: 'metadata' }, status: 'queued' },
  ];
  const auto = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:c', subLibraryId: 'lib-a' },
    targetGate: 'ingest',
    source: 'auto',
    config,
    tasks,
  });
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'queue_limit');
  assert.strictEqual(auto.limit, 2);

  const manual = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:c', subLibraryId: 'lib-a' },
    targetGate: 'ingest',
    source: 'manual',
    config,
    tasks,
  });
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission applies cooldown from terminal task history', () => {
  const config = {
    automaticTaskTargets: ['ingest'], optimizeAllowedFlowKinds: [],
    taskAdmission: {
      cooldownHoursByTargetGate: { ingest: 6 },
      maxQueuedByTargetGate: { ingest: 10 },
    },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const result = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:lib-a:file-a', subLibraryId: 'lib-a' },
    targetGate: 'ingest',
    source: 'auto',
    config,
    tasks: [{
      id: 'old-ingest',
      itemId: 'ingest:lib-a:file-a',
      taskTarget: { targetGate: 'ingest' },
      status: 'failed_hard',
      updatedAt: new Date().toISOString(),
    }],
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'recent_task_cooldown');
});

test('smartTaskEngine stop cancels delayed startup scan', async () => {
  let getLibraryCalls = 0;
  smartTaskEngine.stop();
  smartTaskEngine.start(
    {
      loadConfig() {
        return {
          smartTaskInitialDelaySeconds: 60,
          smartTaskPollIntervalMinutes: 10,
          smartTaskMaxPerRun: 10,
          smartTaskMaxQueueSize: 50,
          automaticTaskTargets: ['optimize'], optimizeAllowedFlowKinds: ['transcode', 'upgrade'],
          smartTaskLookbackDays: 30,
        };
      },
    },
    {
      getLibrary() {
        getLibraryCalls += 1;
        return { items: [] };
      },
    },
    { getTasks() { return []; } },
  );
  smartTaskEngine.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(getLibraryCalls, 0);
});

test('taskStore migrates JSON history to SQLite without feeding scheduler hot path', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-store-sqlite-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  try {
    const legacy = [
      { id: 'done-1', itemId: 'i1', itemName: 'Done', SelectedFlow: 'scrape', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
      { id: 'failed-1', itemId: 'i2', itemName: 'Failed', SelectedFlow: 'scrape', status: 'failed_hard', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z' },
      { id: 'queued-1', itemId: 'i3', itemName: 'Queued', SelectedFlow: 'ingest', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:03:00.000Z' },
    ];
    fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(legacy, null, 2), 'utf8');

    const active = taskStore.loadTasks({ includeHistory: false });
    assert.deepStrictEqual(active.map((t) => t.id), ['queued-1']);
    assert.strictEqual(taskStore.getTasks().length, 3);
    assert.ok(fs.existsSync(path.join(dir, 'tasks.db')));
    assert.ok(fs.existsSync(path.join(dir, 'tasks.json.migrated')));
    assert.ok(fs.existsSync(path.join(dir, 'tasks.json')), 'legacy JSON is preserved as migration source record');
    const walPath = path.join(dir, 'tasks.db-wal');
    const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    assert.ok(walSize < 1024 * 1024, `tasks WAL should be truncated after migration, got ${walSize}`);

    taskStore.updateTask('queued-1', { status: 'done' });
    assert.strictEqual(taskStore.loadTasks({ includeHistory: false }).length, 0);
    assert.strictEqual(taskStore.getTask('queued-1').status, 'done');
    assert.strictEqual(taskStore.getTasks({ status: 'done' }).length, 2);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskStore records skipped WAL checkpoint for small saveTasks writes', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-store-checkpoint-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  diagnosticLog.resetForTests();

  try {
    taskStore.saveTasks([
      { id: 'checkpoint-small-1', itemId: 'i1', itemName: 'Small', SelectedFlow: 'scrape', status: 'queued' },
    ]);

    const logs = diagnosticLog.list({ limit: 20 }).logs
      .filter((log) => log.scope === 'taskStore.checkpointWal');
    assert.ok(logs.some((log) => log.status === 'skipped' && log.payload.reason === 'save_tasks'));
    assert.ok(logs.some((log) => log.payload && log.payload.trigger === 'wal_below_threshold'));
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('routine WAL checkpoints are deferred off the service hot path', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const previousTaskMin = process.env.SHELFDECK_TASK_WAL_CHECKPOINT_MIN_BYTES;
  const previousLibraryMin = process.env.SHELFDECK_LIBRARY_WAL_CHECKPOINT_MIN_BYTES;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-checkpoint-deferred-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  process.env.SHELFDECK_TASK_WAL_CHECKPOINT_MIN_BYTES = '0';
  process.env.SHELFDECK_LIBRARY_WAL_CHECKPOINT_MIN_BYTES = '0';
  diagnosticLog.resetForTests();

  try {
    taskStore.saveTasks([
      { id: 'checkpoint-deferred-1', itemId: 'i1', itemName: 'Deferred', SelectedFlow: 'scrape', status: 'queued' },
    ]);
    libraryStore.replaceSubLibraryItems('checkpoint-lib', [
      { itemId: 'checkpoint-lib-1', subLibraryId: 'checkpoint-lib', name: 'Deferred Library', source: 'emby', type: 'movie' },
    ], { cachedAt: '2026-06-30T00:00:00.000Z' });

    const logs = diagnosticLog.list({ limit: 40 }).logs;
    assert.ok(logs.some((log) => log.scope === 'taskStore.checkpointWal' && log.payload?.trigger === 'routine_checkpoint_deferred'));
    assert.ok(logs.some((log) => log.scope === 'libraryStore.checkpointWal' && log.payload?.trigger === 'routine_checkpoint_deferred'));
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
    if (previousTaskMin === undefined) delete process.env.SHELFDECK_TASK_WAL_CHECKPOINT_MIN_BYTES;
    else process.env.SHELFDECK_TASK_WAL_CHECKPOINT_MIN_BYTES = previousTaskMin;
    if (previousLibraryMin === undefined) delete process.env.SHELFDECK_LIBRARY_WAL_CHECKPOINT_MIN_BYTES;
    else process.env.SHELFDECK_LIBRARY_WAL_CHECKPOINT_MIN_BYTES = previousLibraryMin;
  }
});

test('taskStore exposes lightweight optimization task rows', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-store-opt-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const done = taskStore.createTask({
      itemId: 'item-opt',
      itemName: 'Optimized Movie',
      taskTarget: { targetGate: 'optimize', gateObjective: {} },
      flowPlan: { flowKind: 'transcode', bridgeKind: 'optimize', direction: 'optimize.transcode', primaryResourceType: 'transcode' },
      status: 'executing',
      itemInfo: {
        subLibraryId: 'sub-opt',
        path: '/media/movie.mkv',
        sourcePath: '/mapped/movie.mkv',
      },
      logs: Array.from({ length: 20 }, (_, i) => ({ ts: new Date().toISOString(), level: 'info', msg: `verbose log ${i}` })),
    });
    taskStore.updateTask(done.id, {
      status: 'done',
      verifyResult: { outputPath: '/transcode/movie.partial.mkv' },
    });
    taskStore.createTask({
      itemId: 'item-active',
      itemName: 'Active Movie',
      taskTarget: { targetGate: 'optimize', gateObjective: {} },
      flowPlan: { flowKind: 'transcode', bridgeKind: 'optimize', direction: 'optimize.transcode', primaryResourceType: 'transcode' },
      status: 'queued',
    });

    const rows = taskStore.queryOptimizationTaskIndexRows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].id, done.id);
    assert.strictEqual(rows[0].itemInfo.subLibraryId, 'sub-opt');
    assert.strictEqual(rows[0].itemInfo.path, '/media/movie.mkv');
    assert.strictEqual(rows[0].verifyResult.outputPath, '/transcode/movie.partial.mkv');
    assert.strictEqual(rows[0].logs, undefined);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('libraryStore smart task candidate projection keeps strategy media facts', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-smart-candidates-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    libraryStore.replaceSubLibraryItems('candidate-lib', [
      metadataReadyMovie({
        itemId: 'candidate-optimize',
        subLibraryId: 'candidate-lib',
        reason: '4 star 1080p target facts',
        bucket: '1080p',
        audioCodecs: ['aac'],
        equivalentBitrate: 8,
        targetMediaFacts: { targetBitrate: 7, targetCodec: 'h265' },
        targetBitrate: 7,
        targetCodec: 'h265',
      }),
    ], { cachedAt: new Date().toISOString() });

    const rows = libraryStore.querySmartTaskCandidateItems();
    const item = rows.find((row) => row.itemId === 'candidate-optimize');
    assert.ok(item);
    assert.strictEqual(item.bucket, '1080p');
    assert.deepStrictEqual(item.audioCodecs, ['aac']);
    assert.strictEqual(item.equivalentBitrate, 8);
    assert.strictEqual(item.targetBitrate, 7);
    assert.strictEqual(item.targetCodec, 'h265');

    const selection = flowPlanner.selectOptimizeFlow({
      itemInfo: item,
      optimizeObjective: {
        kind: 'target_media_facts',
        targetMediaFacts: { targetBitrate: 7, targetCodec: 'h265' },
      },
      optimizeObjectiveStatus: 'ready',
      allowedOperations: ['transcode', 'upgrade'],
    });
    assert.strictEqual(selection.allowed, true);
    assert.strictEqual(selection.flowKind, 'transcode');
    assert.strictEqual(selection.reason, 'local_transform_satisfies_objective');
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskStore writes task event journal without replacing task payload', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-events-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const task = taskStore.createTask({
      itemId: 'event-item',
      itemName: 'Event Item',
      SelectedFlow: 'transcode',
      status: 'created',
      priority: 42,
      itemInfo: { path: '/media/event-item.mkv' },
      logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'verbose payload stays on task' }],
    });

    taskStore.updateTask(task.id, { status: 'queued', phase: 'precheck', resumePoint: 'resume.precheck' });
    taskStore.updateTask(task.id, { priority: 7, priorityManuallyAdjusted: true });

    const eventTypes = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 20 }).events.map((event) => event.eventType);
    assert.ok(eventTypes.includes('task.created'));
    assert.ok(eventTypes.includes('task.status_changed'));
    assert.ok(eventTypes.includes('task.runtime_changed'));
    assert.ok(eventTypes.includes('task.priority_changed'));
    assert.strictEqual(taskStore.getTask(task.id).logs.length, 1);

    taskStore.deleteTask(task.id);
    const afterDelete = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 20 }).events;
    assert.ok(afterDelete.some((event) => event.eventType === 'task.deleted'));
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskStore records failure summary on task.failed events', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-failure-summary-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const task = taskStore.createTask({
      itemId: 'failure-summary-item',
      itemName: 'Failure Summary Item',
      taskTarget: { targetGate: 'optimize', gateObjective: {} },
      taskBridge: { kind: 'optimize', flowKind: 'transcode' },
      flowPlan: { flowKind: 'transcode', bridgeKind: 'optimize', direction: 'optimize.transcode', primaryResourceType: 'transcode' },
      status: 'executing',
      phase: 'executing',
      resumePoint: 'transcode_executing',
      itemInfo: { path: '/media/failure-summary-item.mkv' },
    });

    taskStore.updateTask(task.id, {
      logs: [{ ts: '2026-06-30T00:00:00.000Z', level: 'error', msg: 'Encoder failed with code 1' }],
    });
    taskStore.updateTask(task.id, { status: 'failed_hard' });

    const events = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 50 }).events;
    const failed = events.find((event) => event.eventType === 'task.failed');
    assert.ok(failed, 'failed status transition writes task.failed');
    assert.strictEqual(failed.payload.failureStatus, 'failed_hard');
    assert.strictEqual(failed.payload.failureSummary.message, 'Encoder failed with code 1');
    assert.strictEqual(failed.payload.failureSummary.level, 'error');
    assert.strictEqual(failed.payload.failureSummary.source, 'task_log');
    assert.strictEqual(failed.payload.flowKind, 'transcode');
    assert.strictEqual(failed.payload.bridgeKind, 'optimize');
    assert.strictEqual(failed.payload.primaryResourceType, taskStore.getTask(task.id).flowPlan.primaryResourceType);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskStore exposes scheduler lightweight rows for active tasks only', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-rows-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const active = taskStore.createTask({
      itemId: 'scheduler-active',
      itemName: 'Scheduler Active',
      SelectedFlow: 'scrape',
      status: 'queued',
      source: 'auto',
      itemInfo: {
        subLibraryId: 'adult-western',
        adultMetadata: { region: 'western_adult' },
      },
      logs: Array.from({ length: 30 }, (_, i) => ({ ts: new Date().toISOString(), level: 'info', msg: `log ${i}` })),
    });
    taskStore.createTask({
      itemId: 'scheduler-done',
      itemName: 'Scheduler Done',
      SelectedFlow: 'scrape',
      status: 'done',
    });

    const rows = taskStore.querySchedulerTasks();
    assert.deepStrictEqual(rows.map((row) => row.id), [active.id]);
    assert.strictEqual(rows[0].logs, undefined);
    assert.strictEqual(rows[0].itemInfo.subLibraryId, 'adult-western');
    assert.strictEqual(rows[0].itemInfo.adultMetadata.region, 'western_adult');
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('libraryStore persists v3 media lifecycle facts as SQL query fields', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-v3-facts-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    libraryStore.saveLibrary({
      version: 1,
      cachedAt: new Date().toISOString(),
      items: [{
        itemId: 'v3-media-1',
        subLibraryId: 'lib-v3',
        source: 'emby',
        sourceId: 'emby-v3-media-1',
        name: 'V3 Media One',
        type: 'movie',
        path: '/media/v3-one.mkv',
        duration: 3600,
        size: 1024,
        action: 'transcode',
        metadataComplete: true,
        metadataStatus: 'complete',
        optimizationStatus: 'none',
      }, {
        itemId: 'v3-media-2',
        subLibraryId: 'lib-v3',
        source: 'emby',
        sourceId: 'emby-v3-media-2',
        name: 'V3 Media Two',
        type: 'movie',
        path: '/media/v3-two.mkv',
        duration: 3600,
        size: 1024,
        reason: 'modern codec already within target',
        metadataComplete: true,
        metadataStatus: 'complete',
        targetMediaFacts: { targetCodec: 'h264' },
        targetCodec: 'h264',
        codec: 'h264',
        archiveStatus: 'archived_like',
        archiveDoneAt: new Date().toISOString(),
      }, {
        itemId: 'v3-media-3',
        subLibraryId: 'lib-v3',
        source: 'emby',
        sourceId: 'emby-v3-media-3',
        name: 'V3 Media Three',
        type: 'movie',
        path: '/media/v3-three.mkv',
        duration: 3600,
        size: 1024,
        reason: '新入库',
        metadataComplete: true,
        metadataStatus: 'complete',
      }],
    });

    const open = libraryStore.queryItems({ lifecycle: 'open' }).items;
    assert.deepStrictEqual(open.map((item) => item.itemId), ['v3-media-1', 'v3-media-3']);
    assert.strictEqual(open[0].lifecycleStage, 'metadata_ready');
    assert.strictEqual(open[0].metadataStatus, 'complete');
    assert.strictEqual(open[1].lifecycleStage, 'metadata_ready');
    assert.strictEqual(open[1].lifecycleReason, 'strategy_pending');

    const closed = libraryStore.queryItems({ lifecycle: 'done' }).items;
    assert.deepStrictEqual(closed.map((item) => item.itemId), ['v3-media-2']);
    assert.strictEqual(closed[0].archiveStatus, 'archived_like');
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskStore persists v3 bridge flow runtime and event resource facts as SQL fields', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-v3-facts-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const task = taskStore.createTask({
      itemId: 'v3-task-item',
      itemName: 'V3 Task Item',
      taskTarget: { targetGate: 'optimize', gateObjective: {} },
      taskBridge: { kind: 'optimize', flowKind: 'upgrade' },
      flowPlan: { flowKind: 'upgrade', bridgeKind: 'optimize', direction: 'optimize.upgrade', primaryResourceType: 'moviepilot' },
      source: 'manual',
      status: 'queued',
      itemInfo: { subLibraryId: 'lib-v3', path: '/media/v3-task.mkv' },
    });
    taskStore.appendTaskEvent(task, 'flow.dispatched', {
      bridgeKind: 'optimize',
      flowDirection: 'optimize.upgrade',
      flowKind: 'upgrade',
      resourceKey: 'moviepilot',
      resourceLabel: 'MoviePilot',
    }, { resourceType: 'moviepilot' });

    const rows = taskStore.querySchedulerTasks();
    assert.strictEqual(rows[0].taskBridge.kind, 'optimize');
    assert.strictEqual(rows[0].flowPlan.direction, 'optimize.upgrade');
    assert.strictEqual(rows[0].flowPlan.primaryResourceType, 'moviepilot');

    const events = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 20 }).events;
    const dispatched = events.find((event) => event.eventType === 'flow.dispatched');
    assert.ok(dispatched);
    assert.strictEqual(dispatched.resourceKey, 'moviepilot');
    assert.strictEqual(dispatched.bridgeKind, 'optimize');
    assert.strictEqual(dispatched.flowKind, 'upgrade');
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskStore does not project legacy archive delete tasks into delete gate runtime', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-legacy-delete-projection-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const legacy = taskStore.createTask({
      itemId: 'legacy-delete-item',
      itemName: 'Legacy Delete Item',
      SelectedFlow: 'delete',
      source: 'manual',
      status: 'queued',
      itemInfo: { subLibraryId: 'lib-legacy', path: '/media/legacy-delete.mkv' },
      taskBridge: {
        kind: 'archive',
        from: 'optimized_item',
        to: 'archived_item',
        reason: 'legacy archive delete',
      },
      flowPlan: {
        version: 'v2.7',
        bridgeKind: 'archive',
        direction: 'archive.delete',
        SelectedFlow: 'delete',
        executor: 'deleteFlowExecutor',
        primaryResourceType: 'filesystem',
        SelectedFlow: 'delete',
        source: 'manual',
        resourceTypes: ['filesystem'],
        steps: [{ phase: 'precheck', eventType: 'archive.delete.precheck', resourceType: 'filesystem' }],
      },
    });
    taskStore.appendTaskEvent(legacy, 'flow.dispatched', {
      bridgeKind: 'archive',
      flowDirection: 'archive.delete',
      SelectedFlow: 'delete',
      resourceKey: 'filesystem',
      resourceLabel: 'Local filesystem',
    }, { resourceType: 'filesystem' });

    const loaded = taskStore.getTask(legacy.id);
    assert.strictEqual(loaded.taskBridge.kind, 'archive');
    assert.strictEqual(loaded.flowPlan.direction, 'archive.delete');
    assert.strictEqual(loaded.taskTarget.targetGate, 'archive');
    assert.strictEqual(loaded.legacyTaskBridge, undefined);
    assert.strictEqual(loaded.legacyFlowPlan, undefined);
    assert.strictEqual(loaded.compatibilityProjection, undefined);

    const optimizeSummaries = taskStore.queryTaskSummaries({ bridgeKind: 'optimize' }, { includeAll: true }).tasks;
    assert.ok(!optimizeSummaries.some((task) => task.id === legacy.id));
    const deleteSummaries = taskStore.queryTaskSummaries({ bridgeKind: 'delete' }, { includeAll: true }).tasks;
    assert.ok(!deleteSummaries.some((task) => task.id === legacy.id));
    const archiveSummaries = taskStore.queryTaskSummaries({ bridgeKind: 'archive' }, { includeAll: true }).tasks;
    assert.ok(archiveSummaries.some((task) => task.id === legacy.id));

    const schedulerRows = taskStore.querySchedulerTasks();
    assert.ok(schedulerRows.some((task) => task.id === legacy.id && task.flowPlan.direction === 'archive.delete'));

    const stats = taskStore.queryDashboardTaskStats();
    assert.strictEqual(stats.activeByBridgeKind.delete, undefined);
    assert.strictEqual(stats.activeByBridgeKind.optimize, undefined);
    assert.strictEqual(stats.activeByBridgeKind.archive, 1);

    const events = taskStore.queryTaskEvents({ taskId: legacy.id }, { pageSize: 20 }).events;
    const dispatched = events.find((event) => event.eventType === 'flow.dispatched');
    assert.ok(dispatched);
    assert.strictEqual(dispatched.bridgeKind, 'archive');
    assert.strictEqual(dispatched.flowDirection, 'archive.delete');
    assert.strictEqual(dispatched.legacyBridgeKind, undefined);
    assert.strictEqual(dispatched.legacyFlowDirection, undefined);

    const optimizeEvents = taskStore.queryTaskEvents({ bridgeKind: 'optimize' }, { pageSize: 20 }).events;
    assert.ok(!optimizeEvents.some((event) => event.taskId === legacy.id));
    const deleteEvents = taskStore.queryTaskEvents({ bridgeKind: 'delete' }, { pageSize: 20 }).events;
    assert.ok(!deleteEvents.some((event) => event.taskId === legacy.id));
    const archiveEvents = taskStore.queryTaskEvents({ bridgeKind: 'archive' }, { pageSize: 20 }).events;
    assert.ok(archiveEvents.some((event) => event.taskId === legacy.id));
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('v3 data migration script defaults to dry-run without creating backups', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-migration-dry-run-'));
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify([
    { id: 'dry-run-task', itemId: 'i1', SelectedFlow: 'scrape', status: 'done' },
  ]), 'utf8');

  const script = path.join(__dirname, '..', 'scripts', 'v3-data-migration.js');
  const result = spawnSync(process.execPath, [script, `--data-dir=${dir}`], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  assert.strictEqual(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.strictEqual(plan.mode, 'dry-run');
  assert.strictEqual(plan.actions[0], 'No files will be changed.');
  assert.deepStrictEqual(fs.readdirSync(dir).filter((name) => name.includes('.v2-backup-')), []);
});

test('lifecycleProjection separates metadata, optimize, and archive-like closure', () => {
  const discovered = lifecycleProjection.resolveLifecycle({
    action: 'transcode',
    metadataComplete: false,
  });
  assert.strictEqual(discovered.lifecycleStage, 'source_discovered');
  assert.strictEqual(discovered.lifecycleNextTask, 'ingest');
  assert.strictEqual(discovered.ingestGate.passed, false);

  const missing = lifecycleProjection.resolveLifecycle({
    itemId: 'missing-metadata-movie',
    source: 'emby',
    sourceId: 'emby-missing-metadata-movie',
    path: '/media/missing-metadata-movie.mkv',
    duration: 3600,
    action: 'transcode',
    metadataComplete: false,
  });
  assert.strictEqual(missing.lifecycleStage, 'ingested');
  assert.strictEqual(missing.lifecycleNextTask, 'metadata');
  assert.strictEqual(missing.ingestGate.passed, true);

  const pendingOptimize = lifecycleProjection.resolveLifecycle({
    itemId: 'pending-upgrade-movie',
    source: 'emby',
    sourceId: 'emby-pending-upgrade-movie',
    path: '/media/pending-upgrade-movie.mkv',
    duration: 3600,
    resolution: '1920x1080',
    targetMediaFacts: { minResolution: '4K', targetCodec: 'h265' },
    metadataComplete: true,
    optimizationStatus: 'none',
  });
  assert.strictEqual(pendingOptimize.lifecycleStage, 'metadata_ready');
  assert.strictEqual(pendingOptimize.lifecycleNextTask, 'optimize');

  const strategyPending = lifecycleProjection.resolveLifecycle({
    itemId: 'strategy-pending-movie',
    source: 'emby',
    sourceId: 'emby-strategy-pending-movie',
    path: '/media/strategy-pending-movie.mkv',
    duration: 3600,
    reason: '新入库',
    metadataComplete: true,
  });
  assert.strictEqual(strategyPending.lifecycleStage, 'metadata_ready');
  assert.strictEqual(strategyPending.lifecycleNextTask, null);
  assert.strictEqual(strategyPending.lifecycleDone, false);
  assert.strictEqual(strategyPending.lifecycleReason, 'strategy_pending');

  const strategyMissing = lifecycleProjection.resolveLifecycle({
    itemId: 'strategy-missing-movie',
    source: 'emby',
    sourceId: 'emby-strategy-missing-movie',
    path: '/media/strategy-missing-movie.mkv',
    duration: 3600,
    metadataComplete: true,
  });
  assert.strictEqual(strategyMissing.lifecycleStage, 'metadata_ready');
  assert.strictEqual(strategyMissing.lifecycleNextTask, null);
  assert.strictEqual(strategyMissing.lifecycleDone, false);
  assert.strictEqual(strategyMissing.lifecycleReason, 'strategy_missing');

  const keep = lifecycleProjection.resolveLifecycle({
    itemId: 'keep-movie',
    source: 'emby',
    sourceId: 'emby-keep-movie',
    path: '/media/keep-movie.mkv',
    duration: 3600,
    reason: 'modern codec already within target',
    targetMediaFacts: { targetCodec: 'h264' },
    targetCodec: 'h264',
    codec: 'h264',
    metadataComplete: true,
  });
  assert.strictEqual(keep.lifecycleStage, 'optimized');
  assert.strictEqual(keep.lifecycleNextTask, 'archive');
  assert.strictEqual(keep.lifecycleDone, false);
  assert.strictEqual(keep.archiveGate.passed, false);
  assert.ok(keep.archiveGate.missingReasons.includes('archive.finalization'));

  const archivedKeep = lifecycleProjection.resolveLifecycle({
    itemId: 'archived-keep-movie',
    source: 'emby',
    sourceId: 'emby-archived-keep-movie',
    path: '/media/archived-keep-movie.mkv',
    duration: 3600,
    reason: 'modern codec already within target',
    optimizeGate: { passed: true, operation: 'no_op', reason: 'objective_already_satisfied' },
    metadataComplete: true,
    archiveStatus: 'archived_like',
    archiveDoneAt: new Date().toISOString(),
  });
  assert.strictEqual(archivedKeep.lifecycleStage, 'archived');
  assert.strictEqual(archivedKeep.archiveStatus, 'archived_like');
  assert.strictEqual(archivedKeep.lifecycleDone, true);
  assert.strictEqual(archivedKeep.archiveGate.passed, true);
});

test('lifecycleProjection exposes first-class ingest and archive gate contracts', () => {
  const ingestGate = lifecycleProjection.evaluateIngestGate({
    itemId: 'probe-failed-adult',
    source: 'adult_folder',
    subLibraryId: 'adult-lib',
    path: '/adult/probe-failed.mp4',
    probeError: 'ffprobe timed out',
  });
  assert.strictEqual(ingestGate.passed, true);
  assert.strictEqual(ingestGate.reason, 'ingest_gate_met');

  const incompleteIngest = lifecycleProjection.evaluateIngestGate({
    source: 'adult_folder',
    path: '/adult/no-id.mp4',
  });
  assert.strictEqual(incompleteIngest.passed, false);
  assert.ok(incompleteIngest.missingReasons.includes('identity.itemId'));
  assert.ok(incompleteIngest.missingReasons.includes('media.basic_facts_or_probe_failure'));

  const blockedArchive = lifecycleProjection.resolveLifecycle({
    itemId: 'blocked-archive-movie',
    source: 'emby',
    sourceId: 'emby-blocked-archive-movie',
    path: '/media/blocked-archive-movie.mkv',
    duration: 3600,
    metadataComplete: true,
    optimizationStatus: 'transcoded',
    targetMediaFacts: { targetCodec: 'h264' },
    targetCodec: 'h264',
    codec: 'h264',
    archiveBlockers: ['pending_result_summary'],
  });
  assert.strictEqual(blockedArchive.lifecycleStage, 'optimized');
  assert.strictEqual(blockedArchive.lifecycleNextTask, 'archive');
  assert.strictEqual(blockedArchive.archiveGate.passed, false);
  assert.ok(blockedArchive.archiveGate.blockers.includes('pending_result_summary'));
});

test('lifecycleProjection projects upstream ingest invalidation back to ingest', () => {
  const lifecycle = lifecycleProjection.resolveLifecycle({
    itemId: 'source-moved-after-ingest',
    source: 'adult_folder',
    subLibraryId: 'adult-lib',
    mediaType: 'adult',
    path: '/adult/moved.mp4',
    size: 1024,
    duration: 3600,
    bitrate: 4000000,
    resolution: '1920x1080',
    codec: 'h264',
    metadataComplete: false,
    ingestGateFailure: {
      gate: 'ingest',
      invalidatedGate: 'ingest',
      reason: 'source_missing',
      message: 'Media file does not exist: /adult/moved.mp4',
      invalidatedAt: new Date().toISOString(),
    },
  });

  assert.strictEqual(lifecycle.lifecycleStage, 'source_discovered');
  assert.strictEqual(lifecycle.lifecycleNextTask, 'ingest');
  assert.strictEqual(lifecycle.ingestGate.status, 'invalidated');
  assert.strictEqual(lifecycle.ingestGate.reason, 'ingest_gate_invalidated');
  assert.ok(lifecycle.ingestGate.missingReasons.includes('source.file'));
});

test('lifecycleProjection evaluates optimize gate targets before archive closure', () => {
  const pending = lifecycleProjection.resolveLifecycle({
    itemId: 'pending-transcode-gate',
    source: 'emby',
    sourceId: 'emby-pending-transcode-gate',
    path: '/media/pending-transcode-gate.mkv',
    duration: 3600,
    metadataComplete: true,
    targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
    targetBitrate: 4,
    targetCodec: 'h265',
    bitrate: 10_000_000,
    codec: 'h264',
  });
  assert.strictEqual(pending.lifecycleStage, 'metadata_ready');
  assert.strictEqual(pending.lifecycleNextTask, 'optimize');
  assert.strictEqual(pending.optimizeGate.passed, false);
  assert.strictEqual(pending.optimizeGate.status, 'pending');
  assert.strictEqual(pending.optimizeGate.reason, 'optimize_not_attempted');

  const passed = lifecycleProjection.resolveLifecycle({
    itemId: 'passed-transcode-gate',
    source: 'emby',
    sourceId: 'emby-passed-transcode-gate',
    path: '/media/passed-transcode-gate.mkv',
    duration: 3600,
    metadataComplete: true,
    targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
    optimizationStatus: 'transcoded',
    targetBitrate: 4,
    targetCodec: 'h265',
    verifyResult: {
      bitrate: 4_600_000,
      videoCodec: 'hevc',
    },
  });
  assert.strictEqual(passed.lifecycleStage, 'optimized');
  assert.strictEqual(passed.lifecycleNextTask, 'archive');
  assert.strictEqual(passed.lifecycleDone, false);
  assert.strictEqual(passed.optimizeGate.passed, true);
  assert.strictEqual(passed.optimizeGate.reason, 'optimize_gate_met');
  assert.strictEqual(passed.optimizeGate.flowKind, 'transcode');
  assert.strictEqual(passed.archiveGate.passed, false);
  assert.ok(passed.archiveGate.missingReasons.includes('archive.finalization'));

  const archived = lifecycleProjection.resolveLifecycle({
    itemId: 'archived-transcode-gate',
    source: 'emby',
    sourceId: 'emby-archived-transcode-gate',
    path: '/media/archived-transcode-gate.mkv',
    duration: 3600,
    metadataComplete: true,
    targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
    optimizationStatus: 'transcoded',
    targetBitrate: 4,
    targetCodec: 'h265',
    verifyResult: {
      bitrate: 4_600_000,
      videoCodec: 'hevc',
    },
    archiveStatus: 'archived_like',
    archiveDoneAt: new Date().toISOString(),
  });
  assert.strictEqual(archived.lifecycleStage, 'archived');
  assert.strictEqual(archived.lifecycleDone, true);
  assert.strictEqual(archived.archiveGate.passed, true);

  const failed = lifecycleProjection.resolveLifecycle({
    itemId: 'failed-transcode-gate',
    source: 'emby',
    sourceId: 'emby-failed-transcode-gate',
    path: '/media/failed-transcode-gate.mkv',
    duration: 3600,
    metadataComplete: true,
    targetMediaFacts: { targetBitrate: 4, targetCodec: 'h265' },
    optimizationStatus: 'transcoded',
    targetBitrate: 4,
    targetCodec: 'h265',
    verifyResult: {
      bitrate: 8_000_000,
      videoCodec: 'h264',
    },
  });
  assert.strictEqual(failed.lifecycleStage, 'metadata_ready');
  assert.strictEqual(failed.lifecycleNextTask, null);
  assert.strictEqual(failed.lifecycleReason, 'optimize_gate_failed');
  assert.strictEqual(failed.optimizeGate.status, 'failed');
  assert.strictEqual(failed.optimizeGate.retryPolicy.automaticRetry, false);
  assert.ok(failed.optimizeGate.failureReasons.includes('target_bitrate_exceeded'));
  assert.ok(failed.optimizeGate.failureReasons.includes('target_codec_not_met'));
});

test('lifecycleProjection passes optimize gate when target media facts are already satisfied', () => {
  const lifecycle = lifecycleProjection.resolveLifecycle(metadataReadyMovie({
    itemId: 'objective-no-op-pass',
    source: 'emby',
    subLibraryId: 'movie-lib',
    metadataComplete: true,
    bitrate: 4_300_000,
    equivalentBitrate: 4.3,
    codec: 'hevc',
    action: 'transcode',
    optimizeObjectiveStatus: 'ready',
    optimizeObjective: {
      kind: 'target_media_facts',
      targetMediaFacts: {
        qualityTier: 'standard',
        targetBitrateByBucket: { '1080p': 4 },
        targetCodec: 'h265',
      },
      acceptableFlows: ['transcode', 'upgrade'],
    },
    objectiveHash: 'noopobjective123',
  }));

  assert.strictEqual(lifecycle.lifecycleStage, 'optimized');
  assert.strictEqual(lifecycle.lifecycleNextTask, 'archive');
  assert.strictEqual(lifecycle.optimizeGate.passed, true);
  assert.strictEqual(lifecycle.optimizeGate.flowKind, 'no_op');
  assert.strictEqual(lifecycle.optimizeGate.reason, 'objective_already_satisfied');
});

test('rule templates persist archive-before target facts without action-like fields', () => {
  const cfg = configStore.getDefaultConfig();
  const defaultTemplates = cfg.ruleTemplates.filter((tpl) => tpl && tpl.tag && tpl.tag.type === 'default');
  assert.ok(defaultTemplates.length >= 4);
  for (const tpl of defaultTemplates) {
    for (const rule of tpl.rules || []) {
      assert.ok(rule.targetMediaFacts && typeof rule.targetMediaFacts === 'object');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(rule, 'action'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(rule, 'actionParams'), false);
    }
  }

  const normalized = configStore.normalizeRuleTemplate({
    id: 'target-facts-template',
    rules: [{
      priority: 1,
      groupsConnector: 'and',
      groups: [{ connector: 'and', conditions: [['userRating', '>=', 4]] }],
      targetMediaFacts: { qualityTier: 'standard', targetBitrate: 6, targetCodec: 'h265' },
      reason: 'target facts input',
    }],
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized.rules[0], 'action'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized.rules[0], 'actionParams'), false);
  assert.deepStrictEqual(normalized.rules[0].targetMediaFacts, {
    qualityTier: 'standard',
    targetBitrate: 6,
    targetCodec: 'h265',
  });
});

test('lifecycleProjection exposes optimize objective readiness and revision facts', () => {
  const cfg = {
    subLibraries: [{ uuid: 'movie-lib', ruleTemplateId: 'rating_strategy' }],
    ruleTemplates: [{
      id: 'rating_strategy',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'or', conditions: [['userRating', '=', 5], ['doubanRating', '=', 5]] }],
        reason: 'premium target',
        targetMediaFacts: { targetBitrate: 8, targetCodec: 'h265' },
      }],
    }],
  };

  const pendingPerception = lifecycleProjection.resolveLifecycle(metadataReadyMovie({
    itemId: 'pending-perception-objective',
    subLibraryId: 'movie-lib',
    metadataComplete: true,
    userRating: null,
    doubanRating: null,
    targetMediaFacts: undefined,
    targetBitrate: undefined,
    targetCodec: undefined,
    optimizeObjective: undefined,
    reason: '策略未覆盖',
  }), cfg);
  assert.strictEqual(pendingPerception.lifecycleNextTask, null);
  assert.strictEqual(pendingPerception.lifecycleReason, 'pending_perception');
  assert.strictEqual(pendingPerception.optimizeObjectiveStatus, 'pending_perception');
  assert.deepStrictEqual(pendingPerception.objectiveMissingPerceptionFacts.sort(), ['doubanRating', 'userRating']);

  const ready = lifecycleProjection.resolveLifecycle(metadataReadyMovie({
    itemId: 'ready-objective',
    subLibraryId: 'movie-lib',
    metadataComplete: true,
    reason: 'premium target',
    targetMediaFacts: { targetBitrate: 8, targetCodec: 'h265' },
    targetBitrate: 8,
    targetCodec: 'h265',
    optimizeObjective: undefined,
    perceptionVersion: 3,
  }), cfg);
  assert.strictEqual(ready.optimizeObjectiveStatus, 'ready');
  assert.strictEqual(ready.optimizeObjective.kind, 'target_media_facts');
  assert.strictEqual(ready.optimizeObjective.targetBitrate, 8);
  assert.strictEqual(ready.objectiveHash.length, 16);
  assert.strictEqual(ready.objectiveVersion, 1);
  assert.strictEqual(ready.objectiveDerivedFrom.perceptionVersion, 3);

  const revised = lifecycleProjection.resolveLifecycle(metadataReadyMovie({
    itemId: 'revised-objective',
    subLibraryId: 'movie-lib',
    metadataComplete: true,
    reason: 'premium target',
    targetMediaFacts: { targetBitrate: 8, targetCodec: 'h265' },
    targetBitrate: 8,
    targetCodec: 'h265',
    optimizeObjective: undefined,
    objectiveHash: 'previous-objective',
    objectiveVersion: 4,
  }), cfg);
  assert.strictEqual(revised.objectiveVersion, 5);
});

test('strategyEngine persists lifecycle objective projection after compatibility strategy evaluation', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'objective-projection-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  const strategyEngine = require('../src/strategyEngine');

  try {
    configStore.patchConfig({
      subLibraries: [{
        uuid: 'movie-lib',
        name: 'Movies',
        source: 'emby',
        mediaType: 'movie',
        enabled: true,
        ruleTemplateId: 'rating_strategy',
      }],
      ruleTemplates: [{
        id: 'rating_strategy',
        rules: [{
          priority: 1,
          groupsConnector: 'and',
          groups: [{ connector: 'and', conditions: [['userRating', '>=', 4]] }],
          reason: 'high perception target',
          targetMediaFacts: { targetBitrate: 6, targetCodec: 'h265' },
        }],
      }],
      strategyPollIntervalMinutes: 0,
    });
    libraryStore.saveLibrary({
      version: 1,
      cachedAt: new Date().toISOString(),
      items: [metadataReadyMovie({
        itemId: 'strategy-objective-projection',
        subLibraryId: 'movie-lib',
        metadataComplete: true,
        action: '',
        reason: '',
        userRating: 5,
      })],
    });

    strategyEngine.start(configStore, mediaLibraryService);
    const result = strategyEngine.runOnce();
    assert.strictEqual(result.changed, 1);

    const stored = libraryStore.getItem('strategy-objective-projection');
    assert.strictEqual(stored.action || '', '');
    assert.deepStrictEqual(stored.targetMediaFacts, { targetBitrate: 6, targetCodec: 'h265' });
    assert.strictEqual(stored.optimizeObjectiveStatus, 'ready');
    assert.strictEqual(stored.optimizeObjective.kind, 'target_media_facts');
    assert.strictEqual(stored.optimizeObjective.targetBitrate, 6);
    assert.strictEqual(stored.objectiveHash.length, 16);
    assert.ok(Number.isInteger(stored.objectiveVersion) && stored.objectiveVersion >= 1);
  } finally {
    strategyEngine.stop();
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('archiveFlowExecutor finalizes optimized items into archived lifecycle state', async () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-flow-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const mediaLibraryService = require('../src/mediaLibraryService');
    const archiveFlow = require('../src/archiveFlowExecutor');
    mediaLibraryService.saveLibrary({
      cachedAt: new Date().toISOString(),
      items: [metadataReadyMovie({
        itemId: 'archive-flow-item',
        subLibraryId: 'lib-archive',
        source: 'emby',
        action: 'transcode',
        reason: 'strategy selected transcode',
        optimizationStatus: 'transcoded',
        optimizationAction: 'transcode',
        optimizationDoneAt: new Date().toISOString(),
        codec: 'h265',
        videoCodec: 'h265',
      })],
    });
    const task = taskStore.createTask({
      itemId: 'archive-flow-item',
      itemName: 'Archive Flow Item',
      SelectedFlow: 'archive',
      source: 'manual',
      status: 'queued',
      itemInfo: { itemId: 'archive-flow-item', subLibraryId: 'lib-archive' },
    });
    archiveFlow.setScheduler({
      reportStatus: (id, status) => taskStore.updateTask(id, { status }),
      pauseForConfirm: () => {},
    });

    await archiveFlow.driveTask(task.id);

    const doneTask = taskStore.getTask(task.id);
    assert.strictEqual(doneTask.status, 'done');
    assert.strictEqual(doneTask.phase, 'done');
    assert.strictEqual(doneTask.archiveGate.passed, true);
    assert.strictEqual(doneTask.verifyResult.archiveStatus, 'archived_like');

    const item = mediaLibraryService.loadLibrary().items.find((it) => it.itemId === 'archive-flow-item');
    assert.strictEqual(item.archiveStatus, 'archived_like');
    assert.strictEqual(item.lifecycleStage, 'archived');
    assert.strictEqual(item.lifecycleDone, true);
    assert.strictEqual(item.lifecycleNextTask, null);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('taskScheduler writes transcode verify facts back to the library item on success', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcode-done-facts-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  try {
    const taskScheduler = require('../src/taskScheduler');
    mediaLibraryService.saveLibrary({
      cachedAt: new Date().toISOString(),
      items: [metadataReadyMovie({
        itemId: 'transcode-done-facts',
        subLibraryId: 'movie-lib',
        bitrate: 10_000_000,
        equivalentBitrate: 10,
        codec: 'h264',
        targetBitrate: 4,
        targetCodec: 'h265',
      })],
    });
    const task = taskStore.createTask({
      itemId: 'transcode-done-facts',
      itemName: 'Transcode Done Facts',
      flowPlan: { flowKind: 'transcode' },
      status: 'executing',
      itemInfo: {
        itemId: 'transcode-done-facts',
        subLibraryId: 'movie-lib',
        objectiveHash: 'doneobjective123',
      },
      taskTarget: {
        targetGate: 'optimize',
        gateObjective: {
          kind: 'target_media_facts',
          targetBitrate: 4,
          targetCodec: 'h265',
        },
      },
    });
    taskStore.updateTask(task.id, {
      verifyResult: {
        sizeBytes: 1_500_000_000,
        bitrate: 4200,
        videoCodec: 'hevc',
        audioCodec: 'aac',
        width: 1920,
        height: 1080,
        durationSec: 3600,
        outputPath: '/tmp/transcode-done-facts.partial.mkv',
        bytesSaved: 500_000_000,
        objectiveHash: 'doneobjective123',
        targetBitrate: 4,
        targetCodec: 'h265',
      },
    });

    taskScheduler.reportStatus(task.id, 'done', 100);
    const stored = mediaLibraryService.loadLibrary().items.find((item) => item.itemId === 'transcode-done-facts');
    assert.strictEqual(stored.optimizationStatus, 'transcoded');
    assert.strictEqual(stored.optimizeFlowKind, 'transcode');
    assert.strictEqual(stored.bitrate, 4_200_000);
    assert.strictEqual(stored.equivalentBitrate, 4.2);
    assert.strictEqual(stored.codec, 'hevc');
    assert.strictEqual(stored.resolution, '1920x1080');
    assert.strictEqual(stored.optimizeGate.passed, true);
    assert.strictEqual(stored.optimizeGate.flowKind, 'transcode');
    assert.strictEqual(stored.optimizeGate.target.objectiveHash, 'doneobjective123');
    assert.strictEqual(stored.optimizeGate.observed.outputPath, '/tmp/transcode-done-facts.partial.mkv');
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
  }
});

test('taskScheduler writes upgrade verify facts back to the library item on success', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-done-facts-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  try {
    const taskScheduler = require('../src/taskScheduler');
    mediaLibraryService.saveLibrary({
      cachedAt: new Date().toISOString(),
      items: [metadataReadyMovie({
        itemId: 'upgrade-done-facts',
        subLibraryId: 'movie-lib',
        bitrate: 4_000_000,
        equivalentBitrate: 4,
        codec: 'h264',
        resolution: '1920x1080',
      })],
    });
    const task = taskStore.createTask({
      itemId: 'upgrade-done-facts',
      itemName: 'Upgrade Done Facts',
      flowPlan: { flowKind: 'upgrade' },
      status: 'executing',
      itemInfo: {
        itemId: 'upgrade-done-facts',
        subLibraryId: 'movie-lib',
        objectiveHash: 'upgradeobjective123',
      },
      taskTarget: {
        targetGate: 'optimize',
        gateObjective: {
          kind: 'target_media_facts',
          targetMediaFacts: {
            qualityTier: 'premium',
            minResolution: '4K',
            targetBitrateByBucket: { '4K': 18 },
            targetCodec: 'h265',
          },
        },
      },
    });
    taskStore.updateTask(task.id, {
      verifyResult: {
        sizeBytes: 9_000_000_000,
        bitrate: 18500,
        videoCodec: 'hevc',
        width: 3840,
        height: 2160,
        durationSec: 3900,
        outputPath: 'C:\\staging\\upgrade-done-facts.mkv',
        objectiveHash: 'upgradeobjective123',
        targetBitrate: 18,
        targetCodec: 'h265',
        minResolution: '4K',
      },
    });

    taskScheduler.reportStatus(task.id, 'done', 100);
    const stored = mediaLibraryService.loadLibrary().items.find((item) => item.itemId === 'upgrade-done-facts');
    assert.strictEqual(stored.optimizationStatus, 'upgraded');
    assert.strictEqual(stored.optimizeFlowKind, 'upgrade');
    assert.strictEqual(stored.bitrate, 18_500_000);
    assert.strictEqual(stored.equivalentBitrate, 18.5);
    assert.strictEqual(stored.codec, 'hevc');
    assert.strictEqual(stored.resolution, '3840x2160');
    assert.strictEqual(stored.optimizeGate.passed, true);
    assert.strictEqual(stored.optimizeGate.flowKind, 'upgrade');
    assert.strictEqual(stored.optimizeGate.target.objectiveHash, 'upgradeobjective123');
    assert.strictEqual(stored.optimizeGate.target.minResolution, '4K');
    assert.strictEqual(stored.optimizeGate.observed.outputPath, 'C:\\staging\\upgrade-done-facts.mkv');
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
  }
});

test('taskScheduler records delete done as a delete gate result on media item', () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const previousMediaDir = process.env.MEDIA_SERVICE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-optimize-gate-'));
  process.env.MEDIA_SERVICE_DATA_DIR = dir;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const taskScheduler = require('../src/taskScheduler');
    libraryStore.saveLibrary({
      version: 1,
      cachedAt: new Date().toISOString(),
      items: [metadataReadyMovie({
        itemId: 'delete-gate-item',
        subLibraryId: 'movie-lib',
        path: '/media/delete-gate-item.mkv',
        action: 'delete',
      })],
    });
    const task = taskStore.createTask({
      itemId: 'delete-gate-item',
      itemName: 'Delete Gate Item',
      flowPlan: { flowKind: 'delete' },
      source: 'manual',
      status: 'executing',
      itemInfo: {
        itemId: 'delete-gate-item',
        subLibraryId: 'movie-lib',
        path: '/media/delete-gate-item.mkv',
        size: 4096,
        embyItemId: 'emby-delete-gate-item',
      },
      verifyResult: {
        bytesSaved: 4096,
        deletedPath: '/media/delete-gate-item.mkv',
        deletedKind: 'emby_item',
        embyItemId: 'emby-delete-gate-item',
      },
    });

    taskScheduler.reportStatus(task.id, 'done', 100);

    const stored = libraryStore.getItem('delete-gate-item');
    assert.strictEqual(stored.deleted, true);
    assert.strictEqual(stored.removed, true);
    assert.strictEqual(stored.deleteStatus, 'deleted');
    assert.strictEqual(stored.deleteTaskId, task.id);
    assert.strictEqual(stored.deleteGate.passed, true);
    assert.strictEqual(stored.deleteGate.flowKind, 'delete');
    assert.strictEqual(stored.deleteGate.reason, 'delete_target_removed');
    assert.strictEqual(stored.optimizeGate, undefined);
    assert.strictEqual(lifecycleProjection.resolveLifecycle(stored).deleteGate.passed, true);
  } finally {
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
    if (previousMediaDir === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR;
    else process.env.MEDIA_SERVICE_DATA_DIR = previousMediaDir;
  }
});

test('resourceProjection groups active tasks by resource rather than task type only', () => {
  const view = resourceProjection.buildResourceView([
    {
      id: 't1',
      itemId: 'i1',
      itemName: 'Movie',
      status: 'executing',
      priority: 1,
      flowPlan: {
        direction: 'optimize.transcode',
        flowKind: 'transcode',
        primaryResourceType: 'transcode',
        steps: [{ phase: 'transcode_executing', eventType: 'optimize.transcode.execute', resourceType: 'transcode' }],
      },
      taskTarget: {
        object: { type: 'media_item', itemId: 'i1' },
        targetGate: 'optimize',
        gateObjective: { kind: 'reduce_bitrate', targetBitrate: 2500, targetCodec: 'h264', source: 'policy' },
      },
    },
    {
      id: 't2',
      itemId: 'i2',
      itemName: 'Adult',
      flowPlan: { flowKind: 'scrape', primaryResourceType: 'scraper' },
      status: 'queued',
      priority: 2,
      itemInfo: { subLibraryId: 'adult-western', adultMetadata: { region: 'western_adult' } },
    },
    {
      id: 't3',
      itemId: 'i3',
      itemName: 'Upgrade',
      flowPlan: { flowKind: 'upgrade', primaryResourceType: 'moviepilot' },
      status: 'awaiting_user_confirm',
      priority: 3,
    },
  ], {
    transcodeConcurrency: 2,
    scrapeConcurrency: 3,
    upgradeConcurrency: 1,
    subLibraries: [{ uuid: 'adult-western', adultRegion: 'western_adult' }],
    adultLibrary: { western: { computeMode: 'local' } },
  }, {
    runtimeEvents: [
      {
        eventId: 'evt-1',
        eventType: 'douban.sync',
        eventStatus: 'running',
        component: 'mediaLibraryService',
        resourceType: 'douban',
        resourceKey: 'douban:movie-lib',
        resourceLabel: 'Douban sync',
        subLibraryId: 'movie-lib',
        startedAt: new Date().toISOString(),
        durationMs: 10,
      },
    ],
  });

  assert.strictEqual(view.summary.totalTasks, 3);
  assert.strictEqual(view.summary.totalEvents, 1);
  assert.strictEqual(view.summary.runningEvents, 1);
  assert.strictEqual(view.summary.byResourceType.local_transcode, 1);
  assert.strictEqual(view.summary.byResourceType.local_ai, 1);
  assert.strictEqual(view.summary.byResourceType.moviepilot, 1);
  assert.strictEqual(view.summary.byResourceType.douban, 1);
  assert.strictEqual(view.summary.byState.running, 1);
  assert.strictEqual(view.summary.byState.waiting, 1);
  assert.strictEqual(view.summary.byState.blocked, 1);
  const doubanBucket = view.resources.find((bucket) => bucket.resourceKey === 'douban:movie-lib');
  assert.ok(doubanBucket);
  assert.strictEqual(doubanBucket.eventRunning, 1);
  assert.strictEqual(doubanBucket.events[0].eventType, 'douban.sync');
  const transcodeBucket = view.resources.find((bucket) => bucket.resourceKey === 'local:ffmpeg');
  assert.ok(transcodeBucket);
  assert.strictEqual(transcodeBucket.tasks[0].taskTarget.targetGate, 'optimize');
  assert.strictEqual(transcodeBucket.tasks[0].taskTarget.gateObjective.kind, 'reduce_bitrate');
  assert.strictEqual(transcodeBucket.tasks[0].taskTarget.gateObjective.targetBitrate, 2500);
  assert.strictEqual(transcodeBucket.tasks[0].flowKind, 'transcode');
});

test('backgroundIoGuard serializes heavy background operations and records skips', () => {
  backgroundIoGuard.resetForTests();
  diagnosticLog.resetForTests();

  const first = backgroundIoGuard.tryStart({
    operation: 'test.background.write',
    component: 'test',
    lockKey: 'library_background_io',
    resourceKey: 'test:background-write',
    payload: { trigger: 'test' },
  });
  assert.strictEqual(first.started, true);

  const second = backgroundIoGuard.tryStart({
    operation: 'test.background.scan',
    component: 'test',
    lockKey: 'library_background_io',
    resourceKey: 'test:background-scan',
  });
  assert.strictEqual(second.started, false);
  assert.strictEqual(second.reason, 'lock_busy');

  let state = backgroundIoGuard.getState();
  assert.strictEqual(state.summary.activeCount, 1);
  assert.strictEqual(state.summary.skippedCount, 1);
  assert.strictEqual(state.recent[0].status, 'skipped');

  first.finish('done', { writtenRows: 1 });
  state = backgroundIoGuard.getState();
  assert.strictEqual(state.summary.activeCount, 0);
  assert.strictEqual(state.summary.completedCount, 1);
  assert.strictEqual(state.recent[0].operation, 'test.background.write');

  const logs = diagnosticLog.list({ limit: 10 }).logs;
  assert.ok(logs.some((log) => log.category === 'background_io' && log.status === 'skipped'));
  assert.ok(logs.some((log) => log.category === 'background_io' && log.status === 'done'));
});

test('startup library ingest only selects stale sublibraries within startup budget', () => {
  const now = Date.parse('2026-06-30T10:00:00.000Z');
  const subLibraries = [
    { uuid: 'fresh', enabled: true, source: 'emby', lastRefreshedAt: '2026-06-30T09:30:00.000Z' },
    { uuid: 'oldest', enabled: true, source: 'emby', lastRefreshedAt: '2026-06-30T05:00:00.000Z' },
    { uuid: 'older', enabled: true, source: 'emby', lastRefreshedAt: '2026-06-30T06:00:00.000Z' },
    { uuid: 'folder', enabled: true, source: 'folder', lastRefreshedAt: '2026-06-29T00:00:00.000Z' },
    { uuid: 'disabled', enabled: false, source: 'emby', lastRefreshedAt: '2026-06-29T00:00:00.000Z' },
  ];

  const limited = mediaLibraryService._selectStartupIngestSubLibrariesForTest(subLibraries, {
    mediaLibraryStartupRefreshStaleMinutes: 120,
    mediaLibraryStartupRefreshMaxLibraries: 1,
  }, now);
  assert.deepStrictEqual(limited.map((sl) => sl.uuid), ['oldest']);

  const unlimited = mediaLibraryService._selectStartupIngestSubLibrariesForTest(subLibraries, {
    mediaLibraryStartupRefreshStaleMinutes: 120,
    mediaLibraryStartupRefreshMaxLibraries: 0,
  }, now);
  assert.deepStrictEqual(unlimited.map((sl) => sl.uuid), ['oldest', 'older']);
});

test('standard metadata repair aggregates TV season episodes without local ffprobe', async () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const originalGetItemById = embyService.getItemById;
  const originalGetSeasonEpisodes = embyService.getSeasonEpisodes;
  const originalProbeSummary = transcodeService.probeSummary;
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  try {
    const subLib = {
      uuid: 'tv-lib',
      name: 'TV Library',
      source: 'emby',
      mediaType: 'tv',
      enabled: true,
      embyServerId: 'server-a',
      sectionId: 'section-a',
      ruleTemplateId: 'chn_series',
      autoExecute: true,
    };
    configStore.saveConfig({
      ...configStore.getDefaultConfig(),
      embyServers: {
        'server-a': {
          baseUrl: 'http://emby.local',
          apiKey: 'secret',
          userId: 'user-a',
        },
      },
      subLibraries: [subLib],
    });

    libraryStore.saveLibrary({
      version: 1,
      cachedAt: null,
      items: [{
        itemId: 'season-a',
        subLibraryId: 'tv-lib',
        source: 'emby',
        sourceId: 'emby-season-a',
        name: 'Season 1',
        type: 'season',
        path: '/media/show/Season 1',
        watched: true,
      }],
    });

    embyService.getItemById = async () => ({
      itemId: 'emby-season-a',
      sourceId: 'emby-season-a',
      name: 'Season 1',
      type: 'season',
      path: '/media/show/Season 1',
      watched: true,
    });
    embyService.getSeasonEpisodes = async () => ([{
      itemId: 'episode-a',
      sourceId: 'episode-a',
      parentId: 'emby-season-a',
      name: 'Episode 1',
      type: 'episode',
      path: '/media/show/Season 1/Episode 1.mkv',
      size: 900_000_000,
      duration: 1800,
      bitrate: 4_000_000,
      resolution: '1920x1080',
      codec: 'h264',
      audioCodecs: ['aac'],
      watched: true,
    }]);
    transcodeService.probeSummary = async () => {
      throw new Error('local ffprobe should not run for TV season metadata repair');
    };

    const repaired = await mediaLibraryService.completeEmbyItemMetadata('season-a');
    assert.strictEqual(repaired.metadataRepairSummary.localProbe, false);
    assert.strictEqual(repaired.metadataRepairSummary.episodesFetched, 1);
    assert.strictEqual(repaired.duration, 1800);
    assert.strictEqual(repaired.bitrate, 4_000_000);
    assert.strictEqual(repaired.resolution, '1920x1080');
    assert.strictEqual(repaired.codec, 'h264');
  } finally {
    embyService.getItemById = originalGetItemById;
    embyService.getSeasonEpisodes = originalGetSeasonEpisodes;
    transcodeService.probeSummary = originalProbeSummary;
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
  }
});

test('standard metadata repair probes files when audio codecs are missing', async () => {
  const previousControlDir = process.env.CONTROL_PLANE_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  const originalGetItemById = embyService.getItemById;
  const originalGetSeasonEpisodes = embyService.getSeasonEpisodes;
  const originalProbeSummary = transcodeService.probeSummary;
  process.env.CONTROL_PLANE_DATA_DIR = dir;
  let probeCalls = 0;

  try {
    const subLib = {
      uuid: 'movie-lib',
      name: 'Movie Library',
      source: 'emby',
      mediaType: 'movie',
      enabled: true,
      embyServerId: 'server-a',
      sectionId: 'section-a',
      ruleTemplateId: 'movie_audio',
      autoExecute: true,
    };
    configStore.saveConfig({
      ...configStore.getDefaultConfig(),
      embyServers: {
        'server-a': {
          baseUrl: 'http://emby.local',
          apiKey: 'secret',
          userId: 'user-a',
        },
      },
      subLibraries: [subLib],
      ruleTemplates: [{
        id: 'movie_audio',
        rules: [{
          priority: 1,
          groupsConnector: 'and',
          groups: [{ connector: 'and', conditions: [['audioCodecs', 'overlap', ['truehd']]] }],
          targetMediaFacts: { qualityTier: 'baseline', targetCodec: 'h265' },
        }],
      }],
    });

    libraryStore.saveLibrary({
      version: 1,
      cachedAt: null,
      items: [{
        itemId: 'movie-a',
        subLibraryId: 'movie-lib',
        source: 'emby',
        sourceId: 'emby-movie-a',
        name: 'Movie A',
        type: 'movie',
        path: '/media/movie-a.mkv',
        size: 1_000_000_000,
        duration: 3600,
        bitrate: 4_000_000,
        resolution: '1920x1080',
        codec: 'h264',
        watched: true,
      }],
    });

    embyService.getItemById = async () => ({
      itemId: 'emby-movie-a',
      sourceId: 'emby-movie-a',
      name: 'Movie A',
      type: 'movie',
      path: '/media/movie-a.mkv',
      size: 1_000_000_000,
      duration: 3600,
      bitrate: 4_000_000,
      resolution: '1920x1080',
      codec: 'h264',
      audioCodecs: [],
      watched: true,
    });
    embyService.getSeasonEpisodes = async () => {
      throw new Error('season episodes should not be fetched for movies');
    };
    transcodeService.probeSummary = async () => {
      probeCalls += 1;
      return {
        durationSec: 3600,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'truehd',
      };
    };

    const repaired = await mediaLibraryService.completeEmbyItemMetadata('movie-a');
    assert.strictEqual(probeCalls, 1);
    assert.deepStrictEqual(repaired.audioCodecs, ['truehd']);
    assert.strictEqual(repaired.metadataRepairSummary.localProbe, true);
  } finally {
    embyService.getItemById = originalGetItemById;
    embyService.getSeasonEpisodes = originalGetSeasonEpisodes;
    transcodeService.probeSummary = originalProbeSummary;
    if (previousControlDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
    else process.env.CONTROL_PLANE_DATA_DIR = previousControlDir;
  }
});

test('local transcode keeps ffmpeg progress output disabled for service responsiveness', () => {
  const { args } = transcodeService._buildEncodeArgsForTest({
    config: { ffmpegPath: 'ffmpeg' },
    sourcePath: '/media/in.mkv',
    partialPath: '/tmp/out.mkv',
    encoderMode: 'qsv',
    targetBitrate: 16,
  });
  assert.ok(args.includes('-nostats'));
  assert.strictEqual(args.includes('-progress'), false);
  const loglevelIndex = args.indexOf('-loglevel');
  assert.notStrictEqual(loglevelIndex, -1);
  assert.strictEqual(args[loglevelIndex + 1], 'error');
  assert.strictEqual(transcodeService._parseFfmpegTimeMsForTest('out_time_ms=123456000'), 123456);
  assert.strictEqual(transcodeService._parseFfmpegTimeMsForTest('out_time=00:02:03.500000'), 123500);
});
