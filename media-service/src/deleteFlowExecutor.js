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
const assetIdentity = require('./assetIdentity');
const approvalPolicy = require('./approvalPolicy');
const mediaLibraryService = require('./mediaLibraryService');
const fs = require('fs');
const path = require('path');

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

function getEmbyItemId(task) {
  return (task.itemInfo && task.itemInfo.embyItemId) ||
    assetIdentity.getEmbyItemId(task.itemInfo || {}) ||
    task.itemId;
}

function findSubLibrary(config, task, item) {
  const subLibraryId = (item && item.subLibraryId) || (task.itemInfo && task.itemInfo.subLibraryId);
  return (config.subLibraries || []).find((s) => s.uuid === subLibraryId) || null;
}

function isPathInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function directorySizeBytes(targetPath) {
  let total = 0;
  const stack = [targetPath];
  while (stack.length > 0) {
    const current = stack.pop();
    let st;
    try {
      st = fs.lstatSync(current);
    } catch (_) {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else {
      total += st.size || 0;
    }
  }
  return total;
}

function fileOrDirectorySizeBytes(targetPath) {
  const st = fs.existsSync(targetPath) ? fs.lstatSync(targetPath) : null;
  if (!st) return 0;
  if (st.isDirectory()) return directorySizeBytes(targetPath);
  return st.size || 0;
}

function readMarker(markerPath) {
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function organizedFolderName(subLib) {
  return String(
    (subLib && (subLib.organizedFolderName || subLib.scrapedFolderName)) ||
    'scraped'
  ).trim() || 'scraped';
}

function resolveAdultFolderDeleteTarget(task) {
  const config = configStore.loadConfig();
  const item = mediaLibraryService.getLibraryItem(task.itemId);
  const subLib = findSubLibrary(config, task, item);
  if (!subLib || subLib.source !== 'folder' || subLib.mediaType !== 'adult') return null;
  if (!subLib.watchRoot) throw new Error('watchRoot is not configured');

  const mediaPath = (item && item.path) || (task.itemInfo && task.itemInfo.path) || '';
  if (!mediaPath) throw new Error('Media path is not available');

  const watchRoot = path.resolve(subLib.watchRoot);
  const mediaAbs = path.resolve(mediaPath);
  if (!isPathInside(watchRoot, mediaAbs) || mediaAbs === watchRoot) {
    throw new Error(`Refusing to delete outside watchRoot: ${mediaPath}`);
  }

  const mediaExists = fs.existsSync(mediaAbs);
  const mediaStat = mediaExists ? fs.lstatSync(mediaAbs) : null;
  const mediaDir = mediaStat && mediaStat.isDirectory() ? mediaAbs : path.dirname(mediaAbs);
  const scrapedRoot = path.resolve(watchRoot, organizedFolderName(subLib));
  const markerPath = (item && item.adultMetadata && item.adultMetadata.markerPath) || path.join(mediaDir, '.shelfdeck.json');
  const marker = fs.existsSync(markerPath) ? readMarker(markerPath) : null;

  let targetPath = mediaAbs;
  let targetKind = mediaStat && mediaStat.isDirectory() ? 'directory' : 'file';
  if (
    marker &&
    String(marker.itemId || '') === String(task.itemId) &&
    (!marker.subLibraryId || String(marker.subLibraryId) === String(subLib.uuid))
  ) {
    targetPath = mediaDir;
    targetKind = 'directory';
  } else if (isPathInside(scrapedRoot, mediaDir) && path.resolve(mediaDir) !== scrapedRoot) {
    targetPath = mediaDir;
    targetKind = 'directory';
  }

  targetPath = path.resolve(targetPath);
  if (!isPathInside(watchRoot, targetPath) || targetPath === watchRoot || targetPath === scrapedRoot) {
    throw new Error(`Refusing to delete unsafe target: ${targetPath}`);
  }

  return {
    item,
    subLib,
    mediaPath: mediaAbs,
    targetPath,
    targetKind,
    watchRoot,
    exists: fs.existsSync(targetPath),
    sizeBytes: fs.existsSync(targetPath) ? fileOrDirectorySizeBytes(targetPath) : ((item && item.size) || (task.itemInfo && task.itemInfo.size) || 0),
  };
}

function removeLibraryItem(itemId) {
  const lib = mediaLibraryService.loadLibrary();
  const before = Array.isArray(lib.items) ? lib.items.length : 0;
  lib.items = (lib.items || []).filter((item) => item.itemId !== itemId);
  if (lib.items.length !== before) {
    lib.cachedAt = new Date().toISOString();
    mediaLibraryService.saveLibrary(lib);
  }
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
  let adultDelete = null;
  try {
    adultDelete = resolveAdultFolderDeleteTarget(task);
  } catch (e) {
    setPhase(taskId, 'failed_hard');
    appendLog(taskId, 'error', `Local delete precheck failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    return;
  }
  if (adultDelete) {
    if (rp === 'delete_precheck') {
      await runAdultFolderPrecheck(taskId, task, adultDelete);
    } else if (rp === 'delete_executing') {
      await runAdultFolderExecuting(taskId, task, adultDelete);
    }
    return;
  }

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

async function runAdultFolderPrecheck(taskId, task, target) {
  setPhase(taskId, 'precheck');
  appendLog(taskId, 'info', 'Local folder delete precheck started');

  if (!target.exists) {
    appendLog(taskId, 'info', 'Local media target already missing — removing library cache item');
    removeLibraryItem(task.itemId);
    scheduler.reportStatus(taskId, 'done', 100);
    setPhase(taskId, 'done');
    return;
  }

  const displayName = (target.item && target.item.name) || (task.itemInfo && task.itemInfo.name) || task.itemName || task.itemId;
  taskStore.updateTask(taskId, {
    itemName: displayName,
    itemInfo: {
      ...(task.itemInfo || {}),
      name: displayName,
      itemId: task.itemId,
      subLibraryId: target.subLib.uuid,
      source: 'adult_folder',
      path: target.mediaPath,
      deleteTargetPath: target.targetPath,
      deleteTargetKind: target.targetKind,
      originalSizeBytes: target.sizeBytes,
      size: target.sizeBytes,
      adultMetadata: target.item && target.item.adultMetadata,
    },
  });

  const config = configStore.loadConfig();
  const updatedTask = taskStore.getTask(taskId);
  const approval = approvalPolicy.makeApproval('delete.beforeExecute', {
    task: updatedTask,
    itemInfo: updatedTask && updatedTask.itemInfo,
    config,
    message: `Delete local media ${displayName}.`,
    options: ['approve', 'reject'],
    payload: {
      itemName: displayName,
      path: target.mediaPath,
      deleteTargetPath: target.targetPath,
      deleteTargetKind: target.targetKind,
      originalSizeBytes: target.sizeBytes,
    },
  });

  if (approvalPolicy.requiresConfirmation('delete.beforeExecute', { task: updatedTask, itemInfo: updatedTask && updatedTask.itemInfo, config })) {
    appendLog(taskId, 'info', `Local delete target found: ${target.targetPath}, awaiting user confirmation`);
    scheduler.pauseForConfirm(taskId, 'delete_executing', approval);
    return;
  }

  appendLog(taskId, 'info', `Local delete target found: ${target.targetPath}, delete approval auto-passed`);
  await runAdultFolderExecuting(taskId, updatedTask || task, target);
}

async function runAdultFolderExecuting(taskId, task, target) {
  setPhase(taskId, 'executing');
  scheduler.reportStatus(taskId, 'executing');
  appendLog(taskId, 'info', `Deleting local ${target.targetKind}: ${target.targetPath}`);

  try {
    fs.rmSync(target.targetPath, { recursive: true, force: true });
    if (fs.existsSync(target.targetPath)) throw new Error('target still exists after delete');
    removeLibraryItem(task.itemId);
    taskStore.updateTask(taskId, {
      verifyResult: {
        bytesSaved: target.sizeBytes,
        deletedPath: target.targetPath,
        deletedKind: target.targetKind,
      },
    });
    appendLog(taskId, 'info', 'Local media delete completed successfully');
    scheduler.reportStatus(taskId, 'done', 100);
    setPhase(taskId, 'done');
  } catch (e) {
    appendLog(taskId, 'error', `Local delete failed: ${e.message}`);
    scheduler.reportStatus(taskId, 'failed_hard');
    setPhase(taskId, 'failed_hard');
  }
}

async function runPrecheck(taskId, task, serverConfig) {
  setPhase(taskId, 'precheck');
  appendLog(taskId, 'info', 'Delete precheck started');

  try {
    const embyItemId = getEmbyItemId(task);
    const deleteInfo = await embyService.getItemDeleteInfo(serverConfig, embyItemId);
    if (!deleteInfo) {
      appendLog(taskId, 'info', 'Item not found in Emby — treating as already deleted');
      scheduler.reportStatus(taskId, 'done', 100);
      setPhase(taskId, 'done');
      return;
    }

    const exists = await embyService.libraryItemExists(serverConfig, embyItemId);
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
        embyItemId,
        path: deleteInfo.Path || '',
        originalSizeBytes,
      },
    });

    const config = configStore.loadConfig();
    const updatedTask = taskStore.getTask(taskId);
    const approval = approvalPolicy.makeApproval('delete.beforeExecute', {
      task: updatedTask,
      itemInfo: updatedTask && updatedTask.itemInfo,
      config,
      message: `Delete ${displayName} from Emby.`,
      options: ['approve', 'reject'],
      payload: {
        itemName: displayName,
        embyItemId,
        path: deleteInfo.Path || '',
        originalSizeBytes,
      },
    });
    if (approvalPolicy.requiresConfirmation('delete.beforeExecute', { task: updatedTask, itemInfo: updatedTask && updatedTask.itemInfo, config })) {
      appendLog(taskId, 'info', `Item found: ${deleteInfo.Name || embyItemId}, awaiting user confirmation`);
      scheduler.pauseForConfirm(taskId, 'delete_executing', approval);
      return;
    }

    appendLog(taskId, 'info', `Item found: ${deleteInfo.Name || embyItemId}, delete approval auto-passed`);
    await runExecuting(taskId, updatedTask || task, serverConfig);
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
    const embyItemId = getEmbyItemId(task);
    await embyService.deleteLibraryItem(serverConfig, embyItemId);
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
    const embyItemId = getEmbyItemId(task);
    const stillExists = await embyService.libraryItemExists(serverConfig, embyItemId);
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
