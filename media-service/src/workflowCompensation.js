'use strict';

const fs = require('fs');
const path = require('path');
const workflowStore = require('./workflowStore');

function inside(root, candidate) {
  if (!root || !candidate) return false;
  const base = path.resolve(root); const target = path.resolve(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}
function collectCleanupPaths(events, config, reason) {
  const transcodeRoot = config.transcodeTempRoot || '';
  const upgradeRoot = config.upgradeStagingLocalPath || '';
  const paths = new Set();
  for (const event of events || []) {
    const result = event.result || {};
    const staged = result.stagedAsset || (result.assetId && result.producingEventId ? result : null);
    for (const candidate of [result.previewWorkDir, staged && staged.workDir]) if (inside(transcodeRoot, candidate)) paths.add(path.resolve(candidate));
    if (reason === 'cancelled' && staged && staged.replacementScope === 'folder' && inside(upgradeRoot, staged.stagedRoot)) paths.add(path.resolve(staged.stagedRoot));
  }
  return [...paths].sort((a, b) => b.length - a.length);
}
function cleanupTask(taskId, config, reason) {
  const paths = collectCleanupPaths(workflowStore.listEvents(taskId), config, reason);
  const removed = [];
  for (const target of paths) {
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: true, force: true }); removed.push(target);
  }
  return { reason, removed };
}

module.exports = { cleanupTask, collectCleanupPaths, inside };
