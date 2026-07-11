'use strict';

const bitrateObjectiveProfile = require('./bitrateObjectiveProfile');

function codec(value) { const raw = String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return ['h265', 'x265', 'hevc'].includes(raw) ? 'h265' : ['h264', 'x264', 'avc', 'avc1'].includes(raw) ? 'h264' : raw; }
function resolutionRank(value, item = {}) { const text = String(value || item.resolution || '').toLowerCase(); const width = Number(item.width || item.originalWidth || 0); const height = Number(item.height || item.originalHeight || 0); if (text.includes('4k') || text.includes('2160') || width >= 3000 || height >= 2000) return 4; if (text.includes('1080')) return 3; if (text.includes('720')) return 2; return 0; }
function result(status, reason, input, gap = []) {
  return {
    status,
    satisfied: status === 'satisfied',
    plannable: status === 'gap',
    reason,
    objectiveHash: input.objectiveHash || '',
    currentFacts: input.currentMediaFacts || input.subjectInfo || {},
    targetFacts: input.optimizeObjective?.targetMediaFacts || input.optimizeObjective || {},
    gap,
  };
}
function analyze(input = {}) {
  const item = input.currentMediaFacts || input.subjectInfo || {};
  const objective = input.optimizeObjective || item.optimizeObjective || {};
  if (input.optimizeObjectiveStatus && input.optimizeObjectiveStatus !== 'ready') return result('blocked', input.optimizeObjectiveStatus, input);
  if (objective.kind === 'keep_current') return result('satisfied', 'objective_already_satisfied', input);
  const target = objective.targetMediaFacts || objective;
  const profile = bitrateObjectiveProfile.resolveBitrateProfile({ objective, item });
  const gap = [];
  if (target.minResolution && resolutionRank(item.resolution, item) < resolutionRank(target.minResolution)) gap.push({ field: 'resolution', requiredStrategy: 'upgrade', reason: 'resolution_below_target' });
  if (profile) {
    const actual = Number(item.bitrate || 0) > 100000 ? Number(item.bitrate) / 1000000 : Number(item.bitrate || 0);
    const comparison = bitrateObjectiveProfile.compareBitrateToProfile(actual, profile);
    if (comparison.status === 'below') gap.push({ field: 'bitrate', requiredStrategy: 'upgrade', reason: comparison.reason });
    if (comparison.status === 'above') gap.push({ field: 'bitrate', requiredStrategy: 'transcode', reason: comparison.reason });
  }
  if (target.targetCodec && codec(item.codec) !== codec(target.targetCodec)) gap.push({ field: 'codec', requiredStrategy: codec(target.targetCodec) === 'h265' ? 'transcode' : 'blocked', reason: 'codec_mismatch' });
  if (target.storageLayout === 'organized' && item.layoutFacts && item.layoutFacts.compliant !== true) gap.push({ field: 'storageLayout', requiredStrategy: 'organize', reason: 'storage_layout_not_compliant' });
  if (target.metadataArtifacts === 'materialized' && item.metadataArtifactsReady && item.metadataArtifactsMaterialized !== true) gap.push({ field: 'metadataArtifacts', requiredStrategy: 'materialize', reason: 'metadata_artifacts_not_materialized' });
  if (gap.some((entry) => entry.requiredStrategy === 'blocked')) return result('blocked', 'unsupported_objective', input, gap);
  if (gap.length > 0) return result('gap', 'objective_not_satisfied', input, gap);
  return result('satisfied', 'objective_already_satisfied', input, gap);
}

module.exports = { analyze };
