'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const approvalPolicy = require('../src/approvalPolicy');
const configStore = require('../src/configStore');
const taskAdmission = require('../src/taskAdmission');
const smartTaskEngine = require('../src/smartTaskEngine');
const taskStore = require('../src/taskStore');
const scrapeVerification = require('../src/scrapeVerification');

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
    path: mediaPath,
    subLibraryId: 'adult-lib',
    scraped: true,
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
  const item = { itemId: 'i1', subLibraryId: 'manual-lib' };
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
          items: [{
            itemId: 'manual-auto-create',
            name: 'Manual Auto Create',
            source: 'emby',
            type: 'movie',
            watched: true,
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'manual-lib',
            userRatingUpdatedAt: new Date().toISOString(),
            path: '/media/manual-auto-create.mkv',
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
          items: [{
            itemId: 'movie-transcode',
            name: 'Movie Transcode',
            source: 'emby',
            type: 'movie',
            watched: true,
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'movie-lib',
            userRatingUpdatedAt: new Date().toISOString(),
            path: '/media/movie.mkv',
          }, {
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
            itemId: 'movie-transcode',
            name: 'Movie Transcode',
            source: 'emby',
            type: 'movie',
            watched: true,
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'movie-lib',
            userRatingUpdatedAt: new Date().toISOString(),
            path: '/media/movie.mkv',
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
          items: [{
            itemId: 'movie-neutral-transcode',
            name: 'Movie Neutral Transcode',
            source: 'emby',
            type: 'movie',
            watched: true,
            action: 'transcode',
            reason: 'high bitrate',
            subLibraryId: 'movie-lib',
            userRatingUpdatedAt: new Date().toISOString(),
            path: '/media/movie-neutral.mkv',
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
  assert.strictEqual(created[0].actionType, 'transcode');
  assert.strictEqual(created[0].priority, 330);
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
