'use strict';

const bitrateObjectiveProfile = require('./bitrateObjectiveProfile');

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (abs >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (abs >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function estimate(item = {}) {
  const objective = item.helix && item.helix.maintenance && item.helix.maintenance.optimizeObjective || item.optimizeObjective || {};
  const facts = objective.targetMediaFacts || {};
  const profile = bitrateObjectiveProfile.resolveBitrateProfile({ targetMediaFacts: facts, item });
  const size = Number(item.size) || 0;
  const currentMbps = Number(item.bitrate) > 100000 ? Number(item.bitrate) / 1000000 : Number(item.bitrate) || 0;
  if (!profile || !size || !currentMbps || currentMbps <= profile.targetMbps) return 0;
  return Math.max(0, size * (1 - profile.targetMbps / currentMbps));
}

function computeSpaceStats(library = {}, tasks = [], config = {}) {
  const items = library.items || [];
  const grouped = new Map();
  for (const item of items) {
    const key = item.subLibraryId || '__unknown__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  let currentTotalBytes = 0;
  let expectedSavingsBytes = 0;
  const subLibraries = [...grouped.entries()].map(([uuid, rows]) => {
    const currentBytes = rows.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
    const savings = rows.reduce((sum, item) => sum + estimate(item), 0);
    currentTotalBytes += currentBytes;
    expectedSavingsBytes += savings;
    const definition = (config.subLibraries || []).find((entry) => entry.uuid === uuid);
    return {
      uuid,
      name: definition && definition.name || uuid,
      itemCount: rows.length,
      currentBytes,
      expectedBytes: currentBytes - savings,
      optimize: { expectedSavingsBytes: savings, realizedSavingsBytes: 0, itemCount: rows.filter((item) => estimate(item) > 0).length },
    };
  });
  let realizedSavingsBytes = 0;
  for (const task of tasks || []) {
    if (task.status !== 'done' || !['transcode', 'source_upgrade', 'composite_maintenance'].includes(String(task.classification || ''))) continue;
    if (task.verifyResult && Number.isFinite(Number(task.verifyResult.bytesSaved))) {
      realizedSavingsBytes += Math.max(0, Number(task.verifyResult.bytesSaved));
    }
  }
  return {
    currentTotalBytes,
    expectedTotalBytes: currentTotalBytes - expectedSavingsBytes,
    reclaimableBytes: expectedSavingsBytes,
    realizedReclaimedBytes: realizedSavingsBytes,
    optimize: { expectedSavingsBytes, realizedSavingsBytes },
    subLibraries,
  };
}

module.exports = { computeSpaceStats, fmtBytes };
