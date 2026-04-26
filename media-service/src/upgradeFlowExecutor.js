'use strict';

/**
 * UpgradeFlowExecutor (UPGRADE_FLOW.md).
 * Currently a stub — always returns failed_hard.
 * Future: MoviePilot REST API integration for upgrade/洗版.
 */

const taskStore = require('./taskStore');

let scheduler = null;
function setScheduler(s) { scheduler = s; }

function appendLog(taskId, level, msg) {
  const entry = { ts: new Date().toISOString(), level, msg };
  taskStore.updateTask(taskId, { logs: [entry] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;

  setPhase(taskId, 'precheck');
  appendLog(taskId, 'info', 'Upgrade flow not yet implemented');

  // Stub: always fail
  appendLog(taskId, 'error', 'Upgrade/洗版 via MoviePilot is not yet implemented');
  scheduler.reportStatus(taskId, 'failed_hard');
  setPhase(taskId, 'failed_hard');
}

function pause(taskId) {
  // No-op for stub
}

function cancel(taskId) {
  // No-op for stub
}

function confirmReceived(taskId) {
  // No-op for stub
}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
