'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-scheduler-restart-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const cleanState = require('../src/helixCleanState');
const taskStore = require('../src/taskStore');
const scheduler = require('../src/taskScheduler');

cleanState.applyCleanInit({ dataDir, confirmation: cleanState.APPLY_CONFIRMATION });

test.after(() => {
  scheduler.stopScheduler();
  taskStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('restart restores resource-waiting task without consuming retry budget', () => {
  const created = taskStore.createTask({
    itemId: 'waiting-item',
    status: 'waiting_for_resource',
    taskTarget: { object: { type: 'media_item', itemId: 'waiting-item' }, targetGate: 'optimize' },
  });
  const task = taskStore.updateTask(created.id, {
    retryCount: 2,
    resourceBlocker: {
      code: 'waiting_for_resource',
      resourceKey: 'local:ffmpeg',
      retryAt: '2099-01-01T00:00:00.000Z',
    },
  });

  scheduler.recoverInterruptedTasks();

  const recovered = taskStore.getTask(task.id);
  assert.strictEqual(recovered.status, 'queued');
  assert.strictEqual(recovered.retryCount, 2);
  assert.strictEqual(recovered.resourceBlocker, null);
  const events = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 50 }).events;
  assert.strictEqual(events.filter((event) => event.eventType === 'task.restart_resource_wait_requeued').length, 1);
  assert.strictEqual(events.some((event) => event.eventType === 'task.restart_interrupted'), false);
});

test('restart still marks genuinely executing work as interrupted', () => {
  const task = taskStore.createTask({
    itemId: 'executing-item',
    status: 'executing',
    retryCount: 0,
    taskTarget: { object: { type: 'media_item', itemId: 'executing-item' }, targetGate: 'basedata' },
  });

  scheduler.recoverInterruptedTasks();

  const recovered = taskStore.getTask(task.id);
  assert.strictEqual(recovered.status, 'interrupted');
  assert.strictEqual(recovered.retryCount, 0);
});
