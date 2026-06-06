'use strict';

/**
 * DeleteFlowExecutor (DELETE_FLOW.md).
 *
 * Flow phases: precheck → executing → verify → done
 * Bidirectional API with TaskScheduler.
 */

const taskStore = require('./taskStore');
const configStore = require('./configStore');
const embyService = require('./services/embyService');

// Lazy ref to taskScheduler (set after module loads to avoid circular require)
let scheduler = null;
function setScheduler(s) { scheduler = s; }

function getServerConfig(task) {
  const cfg = configStore.loadConfig();
  const taskCfg = task.itemInfo || {};
  const subLibId = taskCfg.subLibraryId;
  if (subLibId) {
    const subLib = (cfg.subLibraries || []).find((s) => s.uuid === subLibId);
    if (subLib) {
      const server = (cfg.embyServers || {})[subLib.embyServerId];
      if (server) return server;
    }
  }
  // Fallback: use first server
  const servers = cfg.embyServers || {};
  const first = Object.keys(servers)[0];
  return first ? servers[first] : null;
}

function appendLog(taskId, level, msg) {
  const entry = { ts: new Date().toISOString(), level, msg };
  taskStore.updateTask(taskId, { logs: [entry] });
}

function setPhase(taskId, phase) {
  taskStore.updateTask(taskId, { phase });
}

// ── Flow Executor API ────────────────────────────────────────────────────────

async function drive(resumePoint) {
  // resumePoint is embedded in the task, not passed as arg in v2 pattern
  // The Scheduler calls drive(taskId) and we read the task's resumePoint
  // Actually, per design: scheduler calls flow.drive(resumePoint), flow reads task
  return { phase: 'precheck', resumePoint };
}

async function driveTask(taskId) {
  const task = taskStore.getTask(taskId);
  if (!task) return;

  const rp = task.resumePoint || 'delete_precheck';
  const serverConfig = getServerConfig(task);

  if (!serverConfig) {
    scheduler.reportStatus(taskId, 'failed_hard');
    appendLog(taskId, 'error', 'No Emby server configured');
    return;
  }

  if (rp === 'delete_precheck') {
    await runPrecheck(taskId, task, serverConfig);
  } else if (rp === 'delete_executing') {
    await runExecuting(taskId, task, serverConfig);
  }
}

async function runPrecheck(taskId, task, serverConfig) {
  setPhase(taskId, 'precheck');
  appendLog(taskId, 'info', 'Delete precheck started');

  try {
    const deleteInfo = await embyService.getItemDeleteInfo(serverConfig, task.itemId);
    if (!deleteInfo) {
      appendLog(taskId, 'info', 'Item not found in Emby — treating as already deleted');
      scheduler.reportStatus(taskId, 'done', 100);
      setPhase(taskId, 'done');
      return;
    }

    const exists = await embyService.libraryItemExists(serverConfig, task.itemId);
    if (!exists) {
      appendLog(taskId, 'info', 'Item no longer exists in Emby');
      scheduler.reportStatus(taskId, 'done', 100);
      setPhase(taskId, 'done');
      return;
    }

    // Store item info for confirm display, including original size for space stats
    const originalSizeBytes = (task.itemInfo && task.itemInfo.size) || 0;
    const displayName = deleteInfo.Name || task.itemId;
    taskStore.updateTask(taskId, {
      itemName: displayName,
      itemInfo: {
        ...task.itemInfo,
        name: displayName,
        path: deleteInfo.Path || '',
        originalSizeBytes,
      },
    });

    appendLog(taskId, 'info', `Item found: ${deleteInfo.Name || task.itemId}, awaiting user confirmation`);
    scheduler.pauseForConfirm(taskId, 'delete_executing');
  } catch (e) {
    appendLog(taskId, 'error', `Precheck failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

async function runExecuting(taskId, task, serverConfig) {
  setPhase(taskId, 'executing');
  scheduler.reportStatus(taskId, 'executing');
  appendLog(taskId, 'info', 'Executing delete');

  try {
    await embyService.deleteLibraryItem(serverConfig, task.itemId);
    appendLog(taskId, 'info', 'Emby delete request sent');
  } catch (e) {
    // 404 means item already gone — treat as success (idempotent retry)
    if (e.message && String(e.message).includes('404')) {
      appendLog(taskId, 'info', 'Item already deleted (404), proceeding to verify');
    } else {
      appendLog(taskId, 'error', `Delete failed: ${e.message}`);
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }
  }

  // Verify
  await runVerify(taskId, task, serverConfig);
}

async function runVerify(taskId, task, serverConfig) {
  setPhase(taskId, 'verify');
  appendLog(taskId, 'info', 'Verifying deletion');

  try {
    const stillExists = await embyService.libraryItemExists(serverConfig, task.itemId);
    if (stillExists) {
      appendLog(taskId, 'error', 'Verify failed: item still exists in Emby');
      scheduler.reportStatus(taskId, 'failed_hard');
      setPhase(taskId, 'failed_hard');
      return;
    }
  } catch (e) {
    // If the request itself errors (e.g. 404), treat as success
    appendLog(taskId, 'info', `Verify: item check returned error (expected for deleted item): ${e.message}`);
  }

  appendLog(taskId, 'info', 'Delete completed successfully');
  scheduler.reportStatus(taskId, 'done', 100);
  setPhase(taskId, 'done');
}

function pause() {
  // Delete is atomic — pause is ignored per DELETE_FLOW.md §2.2
}

function cancel() {
  // Delete is irreversible — cancel is ignored per DELETE_FLOW.md §2.3
}

function confirmReceived(taskId) {
  // Called by confirm API after user confirms
  // The Scheduler will re-queue and call driveTask with resumePoint
}

module.exports = { driveTask, pause, cancel, confirmReceived, setScheduler };
