'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const approvalPolicy = require('../src/approvalPolicy');
const businessFlowPolicy = require('../src/businessFlowPolicy');
const configStore = require('../src/configStore');
const lifecycleTaskPlanner = require('../src/lifecycleTaskPlanner');
const libraryStore = require('../src/libraryStore');
const taskAdmission = require('../src/taskAdmission');
const smartTaskEngine = require('../src/smartTaskEngine');
const taskStore = require('../src/taskStore');
const scrapeVerification = require('../src/scrapeVerification');
const lifecycleProjection = require('../src/lifecycleProjection');
const resourceProjection = require('../src/resourceProjection');
const diagnosticLog = require('../src/diagnosticLog');
const backgroundIoGuard = require('../src/backgroundIoGuard');
const metadataStatus = require('../src/metadataStatus');
const flowRecoveryContract = require('../src/flowRecoveryContract');

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
    action: 'transcode',
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
    task: { id: 'scrape-task-1', actionType: 'scrape', status: 'executing' },
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

test('taskAdmission allows automatic task creation for manual sub-libraries', () => {
  const config = {
    smartTaskEnabledActions: ['transcode'],
    subLibraries: [{ uuid: 'manual-lib', automationMode: 'manual' }],
  };
  const item = metadataReadyMovie({ itemId: 'i1', subLibraryId: 'manual-lib' });
  const auto = taskAdmission.canCreateTask({
    item,
    actionType: 'transcode',
    source: 'auto',
    config,
    tasks: [],
  });
  const manual = taskAdmission.canCreateTask({
    item,
    actionType: 'transcode',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(auto.allowed, true);
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission uses smartTaskEnabledActions as the global automatic allow-list', () => {
  const config = {
    smartTaskEnabledActions: ['ingest'],
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const scrape = taskAdmission.canCreateTask({
    item: { itemId: 'i1', subLibraryId: 'lib-a' },
    actionType: 'scrape',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(scrape.allowed, false);
  assert.strictEqual(scrape.reason, 'action_not_enabled');

  const ingest = taskAdmission.canCreateTask({
    item: { itemId: 'i2', subLibraryId: 'lib-a' },
    actionType: 'ingest',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(ingest.allowed, true);
});

test('taskAdmission treats a missing automatic allow-list as disabled', () => {
  const config = {
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const auto = taskAdmission.canCreateTask({
    item: { itemId: 'i1', subLibraryId: 'lib-a' },
    actionType: 'scrape',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'action_not_enabled');

  const manual = taskAdmission.canCreateTask({
    item: { itemId: 'i1', subLibraryId: 'lib-a' },
    actionType: 'scrape',
    source: 'manual',
    config,
    tasks: [],
  });
  assert.strictEqual(manual.allowed, true);
});

test('businessFlowPolicy resolves automatic metadata repair triggers outside SmartTaskEngine', () => {
  const config = {
    smartTaskEnabledActions: ['scrape'],
    subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie' }],
  };
  const trigger = businessFlowPolicy.resolveAutomaticTrigger({
    config,
    item: {
      itemId: 'movie-missing-metadata',
      source: 'emby',
      subLibraryId: 'movie-lib',
      type: 'movie',
      name: 'Movie Missing Metadata',
      path: '/media/missing.mkv',
      size: 1024,
      duration: 3600,
      bitrate: 4000000,
      resolution: '1920x1080',
      codec: 'h264',
      watched: true,
      userRating: 4,
    },
  });

  assert.strictEqual(trigger.allowed, true);
  assert.strictEqual(trigger.actionType, 'scrape');
  assert.strictEqual(trigger.bridgeKind, 'metadata');
  assert.strictEqual(trigger.reason, 'metadata_gate_not_met');
  assert.ok(trigger.metadataMissingReasons.includes('identity.externalId'));
});

test('businessFlowPolicy resolves automatic optimize triggers from strategy output', () => {
  const config = {
    smartTaskEnabledActions: ['transcode'],
    subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie' }],
  };
  const trigger = businessFlowPolicy.resolveAutomaticTrigger({
    config,
    item: metadataReadyMovie({
      itemId: 'movie-auto-optimize',
      subLibraryId: 'movie-lib',
      watched: false,
      action: 'transcode',
      reason: 'strategy selected transcode',
    }),
  });

  assert.strictEqual(trigger.allowed, true);
  assert.strictEqual(trigger.actionType, 'transcode');
  assert.strictEqual(trigger.bridgeKind, 'optimize');
  assert.strictEqual(trigger.reason, 'lifecycle_gate_met');
  assert.strictEqual(trigger.planningMode, 'strategy_result');
});

test('lifecycleTaskPlanner selects optimize flow from strategy result', () => {
  const item = metadataReadyMovie({
    itemId: 'movie-planner-upgrade',
    action: 'upgrade',
    reason: 'strategy selected upgrade',
  });

  const selected = lifecycleTaskPlanner.selectStrategyOperation(item);
  assert.strictEqual(selected.allowed, true);
  assert.strictEqual(selected.operation, 'upgrade');
  assert.strictEqual(selected.bridgeKind, 'optimize');
  assert.strictEqual(selected.planningMode, 'strategy_result');

  const planned = lifecycleTaskPlanner.planOperationFlow({
    actionType: selected.operation,
    source: 'auto',
    itemId: item.itemId,
    itemInfo: item,
  });
  assert.strictEqual(planned.taskBridge.kind, 'optimize');
  assert.strictEqual(planned.flowPlan.direction, 'optimize.upgrade');
  assert.strictEqual(planned.flowPlan.operationKind, 'upgrade');
  assert.strictEqual(planned.flowPlan.primaryResourceType, 'moviepilot');
});

test('businessFlowPolicy keeps disabled automatic operations out of SmartTask candidates', () => {
  const config = {
    smartTaskEnabledActions: ['scrape'],
    subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie' }],
  };
  const trigger = businessFlowPolicy.resolveAutomaticTrigger({
    config,
    item: metadataReadyMovie({
      itemId: 'movie-disabled-auto-optimize',
      subLibraryId: 'movie-lib',
      action: 'transcode',
      reason: 'strategy selected transcode',
    }),
  });

  assert.strictEqual(trigger.allowed, false);
  assert.strictEqual(trigger.operation, 'transcode');
  assert.strictEqual(trigger.reason, 'action_not_enabled');
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
        action: 'transcode',
        actionParams: { targetBitrate: 3, targetCodec: 'h265' },
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
        action: 'transcode',
        actionParams: { targetBitrate: 4, targetCodec: 'h265' },
      }],
    }],
  };
  const item = metadataReadyMovie({
    itemId: 'broken-gate-movie',
    subLibraryId: 'broken-movie-lib',
  });

  const validation = metadataStatus.validateMetadataGateForSubLibrary(config.subLibraries[0], config);
  assert.strictEqual(validation.ok, false);
  assert.ok(validation.missingRequirements.includes('decision.rating'));
  assert.ok(validation.missingRequirements.includes('media.duration'));

  const meta = metadataStatus.resolveMetadataStatus(item, config);
  assert.strictEqual(meta.metadataStatus, 'missing');
  assert.ok(meta.metadataMissingReasons.includes('metadata_gate_contract_broken'));
});

test('flowRecoveryContract documents retry points for every current flow', () => {
  const expected = {
    ingest: ['ingest_precheck', 'ingest_commit'],
    scrape: ['scrape_precheck', 'scrape_executing', 'scrape_write_metadata', 'scrape_review'],
    transcode: ['transcode_precheck', 'transcode_executing', 'transcode_verify', 'transcode_replace'],
    upgrade: ['upgrade_precheck', 'upgrade_planning', 'upgrade_executing', 'upgrade_pre_replace_verify', 'upgrade_replace'],
    delete: ['delete_precheck', 'delete_executing'],
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
    actionType: 'scrape',
    status: 'failed_hard',
    resumePoint: 'scrape_executing',
    retryCount: 1,
  });
  assert.strictEqual(good.available, true);
  assert.strictEqual(good.flowKey, 'scrape');
  assert.strictEqual(good.resumePoint, 'scrape_executing');
  assert.strictEqual(good.resumePointContract.retryStrategy, 'resume_step');

  const bad = flowRecoveryContract.buildRecoveryPlan({
    actionType: 'scrape',
    status: 'failed_hard',
    resumePoint: 'metadata_magic',
  });
  assert.strictEqual(bad.available, false);
  assert.strictEqual(bad.reason, 'unknown_resume_point');
  assert.strictEqual(bad.effect, 'resume_point_not_in_flow_recovery_contract');
});

test('smartTaskEngine treats an empty automatic allow-list as an intentional disabled state', () => {
  smartTaskEngine.stop();
  smartTaskEngine.start(
    { loadConfig: () => ({
      smartTaskInitialDelaySeconds: 60,
      smartTaskPollIntervalMinutes: 10,
      smartTaskMaxPerRun: 10,
      smartTaskMaxQueueSize: 50,
      smartTaskEnabledActions: [],
      smartTaskLookbackDays: 30,
    }) },
    { getLibrary: () => ({ items: [] }) },
    { getTasks: () => [], createTask: () => { throw new Error('should not create tasks'); } },
  );

  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.status, 'green');
  assert.strictEqual(health.enabled, false);
  assert.strictEqual(health.disabledReason, 'no_enabled_actions');
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
  assert.strictEqual(health.disabledReason, 'no_enabled_actions');
  assert.deepStrictEqual(health.enabledActions, []);
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
          smartTaskEnabledActions: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'manual-lib', automationMode: 'manual' }],
          taskPriority: { autoTaskPriorityBase: 100, actionTypeWeights: { transcode: 130 }, rules: { transcode: [] } },
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

test('smartTaskEngine auto-enqueues pending adult scrape candidates through TaskAdmission priority', async () => {
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
          smartTaskEnabledActions: ['scrape', 'transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [
            { uuid: 'adult-lib', automationMode: 'auto', priorityWeight: 100 },
            { uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 },
          ],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { scrape: 80, transcode: 130 },
            rules: { scrape: [], transcode: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { scrape: 0, transcode: 0 },
            maxQueuedByAction: { scrape: 20, transcode: 50 },
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
            action: 'keep',
            scraped: false,
            subLibraryId: 'adult-lib',
            path: '/adult/pending.mp4',
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
  assert.strictEqual(created[0].actionType, 'scrape');
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
          smartTaskEnabledActions: ['scrape'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', source: 'emby', mediaType: 'movie', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { scrape: 80 },
            rules: { scrape: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { scrape: 0 },
            maxQueuedByAction: { scrape: 20 },
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
  assert.strictEqual(created[0].actionType, 'scrape');
  assert.strictEqual(created[0].taskBridge.kind, 'metadata');
  assert.strictEqual(created[0].flowPlan.primaryResourceType, 'emby');
  assert.ok(created[0].flowPlan.resourceTypes.includes('emby'));
  const health = smartTaskEngine.getHealth();
  assert.strictEqual(health.lastScanSummary.status, 'done');
  assert.strictEqual(health.lastScanSummary.candidateCount, 1);
  assert.strictEqual(health.lastScanSummary.evaluatedCandidates, 1);
  assert.strictEqual(health.lastScanSummary.candidatesByAction.scrape, 1);
  assert.strictEqual(health.lastScanSummary.enqueued, 1);
  assert.strictEqual(health.lastScanSummary.enqueuedByAction.scrape, 1);
  assert.strictEqual(health.lastScanSummary.admissionRejected, 0);
});

test('smartTaskEngine health explains queue-cap skips without creating tasks', async () => {
  smartTaskEngine.stop();
  const activeTasks = [{
    id: 'active-transcode',
    itemId: 'active-transcode-item',
    actionType: 'transcode',
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
          smartTaskEnabledActions: ['transcode'],
          smartTaskLookbackDays: 30,
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { transcode: 130 },
            rules: { transcode: [] },
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
  assert.strictEqual(health.lastScanSummary.candidatesByAction.transcode, 1);
  assert.strictEqual(health.lastScanSummary.enqueued, 0);
  assert.strictEqual(health.lastScanSummary.skippedByQueueCap, 1);
  assert.strictEqual(health.lastScanSummary.skippedByQueueCapByAction.transcode, 1);
  assert.strictEqual(health.lastScanSummary.admissionRejected, 0);
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
          smartTaskEnabledActions: ['ingest', 'transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [
            { uuid: 'adult-lib', source: 'folder', mediaType: 'adult', automationMode: 'auto', priorityWeight: 100 },
            { uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 },
          ],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { ingest: 60, transcode: 130 },
            rules: { ingest: [], transcode: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { ingest: 0, transcode: 0 },
            maxQueuedByAction: { ingest: 50, transcode: 50 },
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
  assert.strictEqual(created[0].actionType, 'ingest');
  assert.strictEqual(created[0].itemId, 'ingest:adult-lib:new-file');
  assert.strictEqual(created[0].priority, 240);
  assert.strictEqual(created[0].source, 'auto');
});

test('smartTaskEngine leaves failed adult scrape candidates for explicit user action', async () => {
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
          smartTaskEnabledActions: ['scrape'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-lib', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { scrape: 80 },
            rules: { scrape: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { scrape: 0 },
            maxQueuedByAction: { scrape: 20 },
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
            action: 'keep',
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

test('smartTaskEngine auto-enqueues western adult pending scrape candidates for first AI analysis', async () => {
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
          smartTaskEnabledActions: ['scrape'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-western', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { scrape: 80 },
            rules: { scrape: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { scrape: 0 },
            maxQueuedByAction: { scrape: 20 },
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
            action: 'keep',
            scraped: false,
            subLibraryId: 'adult-western',
            path: '/adult/western-unknown.mp4',
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
  assert.strictEqual(created[0].actionType, 'scrape');
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
    action: 'keep',
    scraped: false,
    subLibraryId: 'adult-lib',
    path: `/adult/${itemId}.mp4`,
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
          smartTaskEnabledActions: ['scrape'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-lib', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { scrape: 80 },
            rules: { scrape: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { scrape: 0 },
            maxQueuedByAction: { scrape: 20 },
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
  assert.ok(created.every((t) => t.actionType === 'scrape'));
});

test('smartTaskEngine keeps transcode action priority when library weight is neutral', async () => {
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
          smartTaskEnabledActions: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { transcode: 130 },
            rules: { transcode: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { transcode: 0 },
            maxQueuedByAction: { transcode: 50 },
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
  assert.strictEqual(created[0].actionType, 'transcode');
  assert.strictEqual(created[0].priority, 330);
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
          smartTaskEnabledActions: ['transcode'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { transcode: 130 },
            rules: { transcode: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { transcode: 0 },
            maxQueuedByAction: { transcode: 50 },
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
  assert.strictEqual(created[0].actionType, 'transcode');
  assert.strictEqual(created[0].taskBridge.kind, 'optimize');
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
          smartTaskEnabledActions: ['transcode'],
          smartTaskLookbackDays: 1,
          subLibraries: [{ uuid: 'movie-lib', automationMode: 'auto', priorityWeight: 100 }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { transcode: 130 },
            rules: { transcode: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { transcode: 0 },
            maxQueuedByAction: { transcode: 50 },
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
  assert.strictEqual(created[0].actionType, 'transcode');
  assert.strictEqual(created[0].taskBridge.kind, 'optimize');
});

test('smartTaskEngine leaves ambiguous adult scrape candidates for explicit user action', async () => {
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
          smartTaskEnabledActions: ['scrape'],
          smartTaskLookbackDays: 30,
          subLibraries: [{ uuid: 'adult-lib', automationMode: 'auto' }],
          taskPriority: {
            autoTaskPriorityBase: 100,
            actionTypeWeights: { scrape: 80 },
            rules: { scrape: [] },
          },
          taskAdmission: {
            cooldownHoursByAction: { scrape: 0 },
            maxQueuedByAction: { scrape: 20 },
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
            action: 'keep',
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
    smartTaskEnabledActions: ['upgrade', 'scrape'],
    taskAdmission: { defaultCooldownHours: 48 },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const item = {
    itemId: 'i1',
    subLibraryId: 'lib-a',
    lastTaskDoneAt: new Date().toISOString(),
  };
  const cooled = taskAdmission.canCreateTask({
    item,
    actionType: 'upgrade',
    source: 'auto',
    config,
    tasks: [],
  });
  assert.strictEqual(cooled.allowed, false);
  assert.strictEqual(cooled.reason, 'recent_task_cooldown');
  assert.ok(cooled.nextEligibleAt);

  const active = taskAdmission.canCreateTask({
    item: { itemId: 'i2', subLibraryId: 'lib-a' },
    actionType: 'scrape',
    source: 'auto',
    config,
    tasks: [{ id: 't1', itemId: 'i2', status: 'queued' }],
  });
  assert.strictEqual(active.allowed, false);
  assert.strictEqual(active.reason, 'active_task_exists');
});

test('taskAdmission blocks automatic re-transcode after successful transcode', () => {
  const config = {
    smartTaskEnabledActions: ['transcode'],
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const item = {
    itemId: 'i1',
    subLibraryId: 'lib-a',
    path: '/media/movie.mkv',
    assetKey: 'asset-1',
  };
  const tasks = [{
    id: 'done-transcode',
    itemId: 'old-id',
    actionType: 'transcode',
    status: 'done',
    itemInfo: { subLibraryId: 'lib-a', path: '/media/movie.mkv', assetKey: 'asset-1' },
  }];
  const result = taskAdmission.canCreateTask({
    item,
    actionType: 'transcode',
    source: 'auto',
    config,
    tasks,
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, 'already_transcoded');
});

test('taskAdmission caps automatic queue by action type', () => {
  const config = {
    smartTaskEnabledActions: ['ingest'],
    taskAdmission: {
      cooldownHoursByAction: { ingest: 6 },
      maxQueuedByAction: { ingest: 2 },
    },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const tasks = [
    { id: 't1', itemId: 'ingest:a', actionType: 'ingest', status: 'queued' },
    { id: 't2', itemId: 'ingest:b', actionType: 'ingest', status: 'pending_manual' },
    { id: 's1', itemId: 'item-c', actionType: 'scrape', status: 'queued' },
  ];
  const auto = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:c', subLibraryId: 'lib-a' },
    actionType: 'ingest',
    source: 'auto',
    config,
    tasks,
  });
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'queue_limit');
  assert.strictEqual(auto.limit, 2);

  const manual = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:c', subLibraryId: 'lib-a' },
    actionType: 'ingest',
    source: 'manual',
    config,
    tasks,
  });
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission applies cooldown from terminal task history', () => {
  const config = {
    smartTaskEnabledActions: ['ingest'],
    taskAdmission: {
      cooldownHoursByAction: { ingest: 6 },
      maxQueuedByAction: { ingest: 10 },
    },
    subLibraries: [{ uuid: 'lib-a', automationMode: 'auto' }],
  };
  const result = taskAdmission.canCreateTask({
    item: { itemId: 'ingest:lib-a:file-a', subLibraryId: 'lib-a' },
    actionType: 'ingest',
    source: 'auto',
    config,
    tasks: [{
      id: 'old-ingest',
      itemId: 'ingest:lib-a:file-a',
      actionType: 'ingest',
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
          smartTaskEnabledActions: ['transcode', 'upgrade'],
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
      { id: 'done-1', itemId: 'i1', itemName: 'Done', actionType: 'scrape', status: 'done', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
      { id: 'failed-1', itemId: 'i2', itemName: 'Failed', actionType: 'scrape', status: 'failed_hard', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z' },
      { id: 'queued-1', itemId: 'i3', itemName: 'Queued', actionType: 'ingest', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:03:00.000Z' },
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
      { id: 'checkpoint-small-1', itemId: 'i1', itemName: 'Small', actionType: 'scrape', status: 'queued' },
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
      actionType: 'transcode',
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
      actionType: 'transcode',
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
      actionType: 'transcode',
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
      actionType: 'transcode',
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
    assert.strictEqual(failed.payload.operationKind, 'transcode');
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
      actionType: 'scrape',
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
      actionType: 'scrape',
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
        action: 'keep',
        reason: 'modern codec already within target',
        metadataComplete: true,
        metadataStatus: 'complete',
      }, {
        itemId: 'v3-media-3',
        subLibraryId: 'lib-v3',
        source: 'emby',
        sourceId: 'emby-v3-media-3',
        name: 'V3 Media Three',
        type: 'movie',
        path: '/media/v3-three.mkv',
        action: 'keep',
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
      actionType: 'upgrade',
      source: 'manual',
      status: 'queued',
      itemInfo: { subLibraryId: 'lib-v3', path: '/media/v3-task.mkv' },
    });
    taskStore.appendTaskEvent(task, 'flow.dispatched', {
      bridgeKind: 'optimize',
      flowDirection: 'optimize.upgrade',
      operationKind: 'upgrade',
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
    assert.strictEqual(dispatched.operationKind, 'upgrade');
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
    { id: 'dry-run-task', itemId: 'i1', actionType: 'scrape', status: 'done' },
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
  const missing = lifecycleProjection.resolveLifecycle({
    action: 'transcode',
    metadataComplete: false,
  });
  assert.strictEqual(missing.lifecycleStage, 'ingested');
  assert.strictEqual(missing.lifecycleNextTask, 'metadata');

  const pendingOptimize = lifecycleProjection.resolveLifecycle({
    action: 'upgrade',
    metadataComplete: true,
    optimizationStatus: 'none',
  });
  assert.strictEqual(pendingOptimize.lifecycleStage, 'metadata_ready');
  assert.strictEqual(pendingOptimize.lifecycleNextTask, 'optimize');

  const strategyPending = lifecycleProjection.resolveLifecycle({
    action: 'keep',
    reason: '新入库',
    metadataComplete: true,
  });
  assert.strictEqual(strategyPending.lifecycleStage, 'metadata_ready');
  assert.strictEqual(strategyPending.lifecycleNextTask, 'optimize');
  assert.strictEqual(strategyPending.lifecycleDone, false);
  assert.strictEqual(strategyPending.lifecycleReason, 'strategy_pending');

  const strategyMissing = lifecycleProjection.resolveLifecycle({
    action: '',
    metadataComplete: true,
  });
  assert.strictEqual(strategyMissing.lifecycleStage, 'metadata_ready');
  assert.strictEqual(strategyMissing.lifecycleNextTask, 'optimize');
  assert.strictEqual(strategyMissing.lifecycleDone, false);
  assert.strictEqual(strategyMissing.lifecycleReason, 'strategy_missing');

  const keep = lifecycleProjection.resolveLifecycle({
    action: 'keep',
    reason: 'modern codec already within target',
    metadataComplete: true,
  });
  assert.strictEqual(keep.lifecycleStage, 'archived');
  assert.strictEqual(keep.archiveStatus, 'archived_like');
  assert.strictEqual(keep.lifecycleDone, true);
});

test('resourceProjection groups active tasks by resource rather than task type only', () => {
  const view = resourceProjection.buildResourceView([
    { id: 't1', itemId: 'i1', itemName: 'Movie', actionType: 'transcode', status: 'executing', priority: 1 },
    { id: 't2', itemId: 'i2', itemName: 'Adult', actionType: 'scrape', status: 'queued', priority: 2, itemInfo: { subLibraryId: 'adult-western', adultMetadata: { region: 'western_adult' } } },
    { id: 't3', itemId: 'i3', itemName: 'Upgrade', actionType: 'upgrade', status: 'awaiting_user_confirm', priority: 3 },
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
