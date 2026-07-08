'use strict';

const taskStore = require('./taskStore');
const mediaLibraryService = require('./mediaLibraryService');
const lifecycleGateService = require('./lifecycleGateService');

let scheduler = null;
function setScheduler(s) { scheduler = s; }

function appendLog(taskId, level, msg) {
  taskStore.updateTask(taskId, { logs: [{ ts: new Date().toISOString(), level, msg }] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

function loadTaskAndItem(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return { task: null, lib: null, item: null };
  const lib = mediaLibraryService.loadLibrary();
  const item = lib && Array.isArray(lib.items)
    ? lib.items.find((it) => it && it.itemId === task.itemId)
    : null;
  return { task, lib, item };
}

function failTask(taskId, message, gate) {
  appendLog(taskId, 'error', message);
  taskStore.updateTask(taskId, {
    archiveGate: gate,
    resumePoint: 'archive_precheck',
  });
  setPhase(taskId, 'failed_hard');
  scheduler.reportStatus(taskId, 'failed_hard', 0);
}

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;
  const rp = task.resumePoint || 'archive_precheck';
  if (rp === 'archive_precheck') await runPrecheck(taskId);
  else if (rp === 'archive_finalize') await runFinalize(taskId);
}

async function runPrecheck(taskId) {
  setPhase(taskId, 'archive_precheck');
  scheduler.reportStatus(taskId, 'executing', 10);
  appendLog(taskId, 'info', 'Archive precheck started');

  const { item } = loadTaskAndItem(taskId);
  if (!item) {
    failTask(taskId, 'Library item not found for archive finalization', {
      gate: 'archive',
      passed: false,
      status: 'not_ready',
      reason: 'archive_item_missing',
      missingReasons: ['archive.item'],
    });
    return;
  }

  const gate = lifecycleGateService.evaluateArchiveGate(item);
  if (gate.passed) {
    taskStore.updateTask(taskId, { archiveGate: gate, resumePoint: null });
    setPhase(taskId, 'done');
    scheduler.reportStatus(taskId, 'done', 100);
    return;
  }
  if (gate.missingReasons.includes('optimize.result') || gate.blockers.length > 0) {
    failTask(taskId, `Archive gate is not ready: ${gate.reason}`, gate);
    return;
  }

  taskStore.updateTask(taskId, { archiveGate: gate, resumePoint: 'archive_finalize' });
  await runFinalize(taskId);
}

async function runFinalize(taskId) {
  setPhase(taskId, 'archive_finalize');
  scheduler.reportStatus(taskId, 'executing', 60);

  const { task, lib, item } = loadTaskAndItem(taskId);
  if (!task || !item) {
    failTask(taskId, 'Library item not found for archive finalization', {
      gate: 'archive',
      passed: false,
      status: 'not_ready',
      reason: 'archive_item_missing',
      missingReasons: ['archive.item'],
    });
    return;
  }

  const gate = lifecycleGateService.evaluateArchiveGate(item);
  if (gate.missingReasons.includes('optimize.result') || gate.blockers.length > 0) {
    failTask(taskId, `Archive gate is not ready: ${gate.reason}`, gate);
    return;
  }

  const archivedAt = new Date().toISOString();
  item.archiveStatus = 'archived_like';
  item.archiveReason = 'archive_finalize_done';
  item.archiveDoneAt = archivedAt;
  item.archiveTaskId = taskId;
  item.lifecycleDone = true;
  item.lifecycleNextTask = null;
  item.archiveGate = {
    gate: 'archive',
    passed: true,
    status: 'passed',
    reason: 'archive_gate_met',
    missingReasons: [],
    blockers: [],
    finalizedAt: archivedAt,
  };
  mediaLibraryService.saveLibrary(lib);

  taskStore.updateTask(taskId, {
    archiveGate: item.archiveGate,
    verifyResult: {
      archiveStatus: item.archiveStatus,
      archivedAt,
      itemId: item.itemId,
    },
    resumePoint: null,
  });
  appendLog(taskId, 'info', `Media item archived: ${item.name || item.itemId}`);
  setPhase(taskId, 'done');
  scheduler.reportStatus(taskId, 'done', 100);
}

async function pause(taskId) {
  taskStore.updateTask(taskId, { status: 'paused', phase: 'archive_paused' });
}

async function cancel() {}

function confirmReceived() {}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
