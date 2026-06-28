'use strict';

const test = require('node:test');
const assert = require('node:assert');

const approvalPolicy = require('../src/approvalPolicy');
const taskAdmission = require('../src/taskAdmission');

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

test('taskAdmission rejects automatic tasks for manual sub-libraries', () => {
  const config = {
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
  assert.strictEqual(auto.allowed, false);
  assert.strictEqual(auto.reason, 'automation_manual');
  assert.strictEqual(manual.allowed, true);
});

test('taskAdmission applies cooldown and active task dedupe', () => {
  const config = {
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
