'use strict';

const path = require('path');

function normalizePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function stripRoot(rawPath, root) {
  const p = normalizePath(rawPath);
  const r = normalizePath(root);
  if (!p || !r) return null;
  if (p === r) return '';
  if (p.startsWith(`${r}/`)) return p.slice(r.length + 1);
  return null;
}

function relativePathKey(rawPath, subLib) {
  if (!rawPath) return null;
  const mappedFrom = stripRoot(rawPath, subLib && subLib.pathMapFrom);
  if (mappedFrom != null) return mappedFrom;
  const mappedTo = stripRoot(rawPath, subLib && subLib.pathMapTo);
  if (mappedTo != null) return mappedTo;
  return normalizePath(rawPath);
}

function collectTaskPathKeys(task, subLib) {
  const info = task && task.itemInfo || {};
  const candidates = [
    info.path,
    info.sourcePath,
    info.originalSourcePath,
    info.replacementTargetPath,
    info.originalDiscPath,
    info.deleteTargetPath,
    task && task.verifyResult && task.verifyResult.outputPath,
    task && task.verifyResult && task.verifyResult.deletedPath,
    task && task.upgradePreview && task.upgradePreview.oldFile && task.upgradePreview.oldFile.path,
    task && task.upgradePreview && task.upgradePreview.newFile && task.upgradePreview.newFile.path,
  ];

  return new Set(candidates.map((p) => relativePathKey(p, subLib)).filter(Boolean));
}

function buildOptimizationIndex(tasks, config) {
  const subLibs = (config && config.subLibraries) || [];
  const byItemId = new Map();
  const byPath = new Map();

  for (const task of tasks || []) {
    if (!task || task.status !== 'done') continue;
    if (task.actionType !== 'transcode' && task.actionType !== 'upgrade' && task.actionType !== 'delete') continue;

    const subLibraryId = task.itemInfo && task.itemInfo.subLibraryId;
    const subLib = subLibs.find((s) => s.uuid === subLibraryId) || {};
    const status = task.actionType === 'upgrade' ? 'upgraded'
      : task.actionType === 'delete' ? 'deleted'
      : 'transcoded';
    const entry = {
      action: task.actionType,
      status,
      taskId: task.id,
      doneAt: task.optimizationDoneAt || task.updatedAt || task.createdAt || null,
      subLibraryId: subLibraryId || null,
    };

    if (task.itemId) {
      const key = `${subLibraryId || ''}:${task.itemId}`;
      const existing = byItemId.get(key);
      if (!existing || newer(entry.doneAt, existing.doneAt)) byItemId.set(key, entry);
    }

    for (const p of collectTaskPathKeys(task, subLib)) {
      const key = `${subLibraryId || ''}:${p}`;
      const existing = byPath.get(key);
      if (!existing || newer(entry.doneAt, existing.doneAt)) byPath.set(key, entry);
    }
  }

  return { byItemId, byPath };
}

function newer(a, b) {
  return new Date(a || 0).getTime() > new Date(b || 0).getTime();
}

function statusFromMarker(item) {
  const transcodeAt = item && item.lastTranscodeDoneAt;
  const upgradeAt = item && item.lastUpgradeDoneAt;
  const deleteAt = item && (item.deletedAt || item.removedAt || (item.optimizationStatus === 'deleted' ? item.optimizationDoneAt : null));
  if (!transcodeAt && !upgradeAt && !deleteAt) return null;
  if (deleteAt && (!transcodeAt || newer(deleteAt, transcodeAt)) && (!upgradeAt || newer(deleteAt, upgradeAt))) {
    return { action: 'delete', status: 'deleted', taskId: item.optimizationTaskId || null, doneAt: deleteAt, subLibraryId: item.subLibraryId || null };
  }
  if (upgradeAt && (!transcodeAt || newer(upgradeAt, transcodeAt))) {
    return { action: 'upgrade', status: 'upgraded', taskId: null, doneAt: upgradeAt, subLibraryId: item.subLibraryId || null };
  }
  return { action: 'transcode', status: 'transcoded', taskId: null, doneAt: transcodeAt, subLibraryId: item.subLibraryId || null };
}

function resolveOptimization(item, index, config) {
  const marker = statusFromMarker(item);
  const subLib = ((config && config.subLibraries) || []).find((s) => s.uuid === item.subLibraryId) || {};
  const itemKey = `${item.subLibraryId || ''}:${item.itemId}`;
  const pathKey = relativePathKey(item.path, subLib);
  const byId = index && index.byItemId && index.byItemId.get(itemKey);
  const byPath = pathKey && index && index.byPath && index.byPath.get(`${item.subLibraryId || ''}:${pathKey}`);

  const candidates = [marker, byId, byPath].filter(Boolean);
  if (candidates.length === 0) {
    return { optimizationStatus: 'none', optimizationAction: null, optimizationDoneAt: null, optimizationTaskId: null };
  }

  candidates.sort((a, b) => new Date(b.doneAt || 0).getTime() - new Date(a.doneAt || 0).getTime());
  const best = candidates[0];
  return {
    optimizationStatus: best.status,
    optimizationAction: best.action,
    optimizationDoneAt: best.doneAt || null,
    optimizationTaskId: best.taskId || null,
  };
}

function decorateItems(items, tasks, config) {
  const index = buildOptimizationIndex(tasks, config);
  return (items || []).map((item) => ({
    ...item,
    ...resolveOptimization(item, index, config),
  }));
}

module.exports = {
  buildOptimizationIndex,
  collectTaskPathKeys,
  decorateItems,
  relativePathKey,
  resolveOptimization,
};
