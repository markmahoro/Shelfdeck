'use strict';

/**
 * SpaceStats — computes library space metrics.
 *
 * Three layers:
 *   1. Current: SUM(item.size) per sub-library
 *   2. Expected: what the total would be after all strategy recommendations
 *   3. Realized: cumulative bytesSaved from completed tasks
 */

const { effectiveRating, targetMbps } = require('./mediaPolicyService');

function fmtBytes(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (abs >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (abs >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function resolvePolicy(item, config) {
  const subLib = (config.subLibraries || []).find((s) => s.uuid === item.subLibraryId);
  if (subLib && subLib.mediaPolicy) return subLib.mediaPolicy;
  return config.mediaPolicy || null;
}

function estimatedDelta(item, policy) {
  const action = item.action || 'keep';
  const size = typeof item.size === 'number' ? item.size : 0;
  if (size <= 0) return { action, delta: 0 };

  if (action === 'delete') {
    return { action, delta: size };
  }

  if (action === 'transcode' || action === 'upgrade') {
    const bps = typeof item.bitrate === 'number' ? item.bitrate : 0;
    const currentMbps = bps / 1_000_000;
    const target = targetMbps(item, policy);
    if (target != null && currentMbps > 0) {
      const delta = size * (1 - target / currentMbps);
      return { action, delta };
    }
  }

  return { action, delta: 0 };
}

function computeSpaceStats(library, tasks, config) {
  const items = library && library.items ? library.items : [];
  const taskList = tasks || [];

  // ── Group items by subLibrary ──────────────────────────────────────────
  const subLibMap = {};
  for (const item of items) {
    const sid = item.subLibraryId || '__unknown__';
    if (!subLibMap[sid]) subLibMap[sid] = [];
    subLibMap[sid].push(item);
  }

  // ── Per-subLibrary stats ──────────────────────────────────────────────
  const subLibraryDetails = [];
  let currentTotalBytes = 0;
  let transcodeEstimatedSavings = 0;
  let transcodeItemCount = 0;
  let upgradeEstimatedDelta = 0;
  let upgradeItemCount = 0;
  let deleteEstimatedSavings = 0;
  let deleteItemCount = 0;

  for (const [sid, sidItems] of Object.entries(subLibMap)) {
    const firstItem = sidItems[0];
    const policy = resolvePolicy(firstItem, config);
    const subLibCfg = (config.subLibraries || []).find((s) => s.uuid === sid);
    const name = (subLibCfg && subLibCfg.name) || sid;

    let curBytes = 0;
    let tcSavings = 0;
    let tcCount = 0;
    let upDelta = 0;
    let upCount = 0;
    let delSavings = 0;
    let delCount = 0;

    for (const item of sidItems) {
      const sz = typeof item.size === 'number' ? item.size : 0;
      curBytes += sz;

      const est = policy ? estimatedDelta(item, policy) : { action: item.action || 'keep', delta: 0 };
      if (est.action === 'transcode') {
        if (est.delta > 0) tcSavings += est.delta;
        else upDelta += est.delta; // negative delta = size increase
        tcCount++;
      } else if (est.action === 'upgrade') {
        upDelta += est.delta;
        upCount++;
      } else if (est.action === 'delete') {
        delSavings += est.delta;
        delCount++;
      }
    }

    subLibraryDetails.push({
      uuid: sid,
      name,
      itemCount: sidItems.length,
      currentBytes: curBytes,
      expectedBytes: curBytes - tcSavings - delSavings + Math.abs(Math.min(0, upDelta)),
      transcode: { expectedSavingsBytes: tcSavings, realizedSavingsBytes: 0, itemCount: tcCount },
      upgrade: { expectedIncreaseBytes: Math.max(0, -upDelta), realizedIncreaseBytes: 0, itemCount: upCount },
      delete: { expectedSavingsBytes: delSavings, realizedSavingsBytes: 0, itemCount: delCount },
    });

    currentTotalBytes += curBytes;
    transcodeEstimatedSavings += tcSavings;
    transcodeItemCount += tcCount;
    upgradeEstimatedDelta += upDelta;
    upgradeItemCount += upCount;
    deleteEstimatedSavings += delSavings;
    deleteItemCount += delCount;
  }

  // ── Realized savings from done tasks ───────────────────────────────────
  let transcodeRealizedSavings = 0;
  let upgradeRealizedIncrease = 0;
  let deleteRealizedSavings = 0;

  for (const task of taskList) {
    if (task.status !== 'done') continue;

    let bytesSaved = null;
    // Prefer explicitly stored bytesSaved
    if (task.verifyResult && typeof task.verifyResult.bytesSaved === 'number') {
      bytesSaved = task.verifyResult.bytesSaved;
    } else if (task.actionType === 'transcode' && task.itemInfo && task.verifyResult) {
      if (typeof task.itemInfo.originalSizeBytes === 'number' && typeof task.verifyResult.sizeBytes === 'number') {
        bytesSaved = task.itemInfo.originalSizeBytes - task.verifyResult.sizeBytes;
      }
    } else if (task.actionType === 'upgrade' && task.upgradePreview) {
      const oldSize = task.upgradePreview.oldFile && task.upgradePreview.oldFile.size;
      const newSize = task.upgradePreview.newFile && task.upgradePreview.newFile.size;
      if (typeof oldSize === 'number' && typeof newSize === 'number') {
        bytesSaved = oldSize - newSize;
      }
    } else if (task.actionType === 'delete' && task.itemInfo) {
      if (typeof task.itemInfo.originalSizeBytes === 'number') {
        bytesSaved = task.itemInfo.originalSizeBytes;
      }
    }

    if (bytesSaved != null) {
      if (task.actionType === 'transcode') {
        transcodeRealizedSavings += bytesSaved;
      } else if (task.actionType === 'upgrade') {
        // bytesSaved negative → file got bigger → realizedIncrease positive
        if (bytesSaved < 0) upgradeRealizedIncrease += Math.abs(bytesSaved);
        else transcodeRealizedSavings += bytesSaved; // rare: upgrade actually saved space
      } else if (task.actionType === 'delete') {
        deleteRealizedSavings += bytesSaved;
      }
    }
  }

  // ── Merge realized into subLibrary details ────────────────────────────
  // Match done tasks to subLibraries by itemId lookup in library
  const itemSubLibMap = {};
  for (const item of items) {
    itemSubLibMap[item.itemId] = item.subLibraryId;
  }
  for (const task of taskList) {
    if (task.status !== 'done') continue;
    const sid = itemSubLibMap[task.itemId];
    if (!sid) continue;
    const detail = subLibraryDetails.find((d) => d.uuid === sid);
    if (!detail) continue;

    let bytesSaved = null;
    if (task.verifyResult && typeof task.verifyResult.bytesSaved === 'number') {
      bytesSaved = task.verifyResult.bytesSaved;
    } else if (task.actionType === 'transcode' && task.itemInfo && task.verifyResult) {
      if (typeof task.itemInfo.originalSizeBytes === 'number' && typeof task.verifyResult.sizeBytes === 'number') {
        bytesSaved = task.itemInfo.originalSizeBytes - task.verifyResult.sizeBytes;
      }
    } else if (task.actionType === 'upgrade' && task.upgradePreview) {
      const oldSize = task.upgradePreview.oldFile && task.upgradePreview.oldFile.size;
      const newSize = task.upgradePreview.newFile && task.upgradePreview.newFile.size;
      if (typeof oldSize === 'number' && typeof newSize === 'number') {
        bytesSaved = oldSize - newSize;
      }
    } else if (task.actionType === 'delete' && task.itemInfo) {
      if (typeof task.itemInfo.originalSizeBytes === 'number') {
        bytesSaved = task.itemInfo.originalSizeBytes;
      }
    }

    if (bytesSaved != null) {
      if (task.actionType === 'transcode') {
        detail.transcode.realizedSavingsBytes = (detail.transcode.realizedSavingsBytes || 0) + bytesSaved;
      } else if (task.actionType === 'upgrade') {
        if (bytesSaved < 0) {
          detail.upgrade.realizedIncreaseBytes = (detail.upgrade.realizedIncreaseBytes || 0) + Math.abs(bytesSaved);
        }
      } else if (task.actionType === 'delete') {
        detail.delete.realizedSavingsBytes = (detail.delete.realizedSavingsBytes || 0) + bytesSaved;
      }
    }
  }

  const upgradeExpectedIncrease = Math.max(0, -upgradeEstimatedDelta);
  const reclaimableBytes = transcodeEstimatedSavings + deleteEstimatedSavings;
  const realizedReclaimedBytes = transcodeRealizedSavings + deleteRealizedSavings;

  return {
    currentTotalBytes,
    expectedTotalBytes: currentTotalBytes - transcodeEstimatedSavings - deleteEstimatedSavings + upgradeExpectedIncrease,
    reclaimableBytes,
    realizedReclaimedBytes,
    transcode: {
      expectedSavingsBytes: transcodeEstimatedSavings,
      realizedSavingsBytes: transcodeRealizedSavings,
      itemCount: transcodeItemCount,
    },
    upgrade: {
      expectedIncreaseBytes: upgradeExpectedIncrease,
      realizedIncreaseBytes: upgradeRealizedIncrease,
      itemCount: upgradeItemCount,
    },
    delete: {
      expectedSavingsBytes: deleteEstimatedSavings,
      realizedSavingsBytes: deleteRealizedSavings,
      itemCount: deleteItemCount,
    },
    subLibraries: subLibraryDetails,
  };
}

module.exports = { computeSpaceStats, fmtBytes };
