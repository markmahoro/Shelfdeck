'use strict';

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function hasAny(...values) {
  return values.some((value) => clean(value));
}

function normalize(value) {
  return clean(value).toLowerCase();
}

function evaluateIngestGate(item = {}) {
  const missing = [];
  const adultMetadata = item.adultMetadata && typeof item.adultMetadata === 'object'
    ? item.adultMetadata
    : {};

  if (!hasAny(item.itemId)) missing.push('identity.itemId');
  if (!hasAny(item.source, item.subLibraryId, item.mediaType)) missing.push('identity.source_or_sub_library');
  if (!hasAny(item.path, item.sourceId, item.embyItemId, item.assetKey, item.assetRootPath)) {
    missing.push('source.location_or_reference');
  }

  const hasMediaFacts = hasAny(item.duration, item.size, item.bitrate, item.resolution, item.codec)
    || item.probeError
    || adultMetadata.probeError
    || item.mediaFactsUnavailable === true;
  if (!hasMediaFacts) missing.push('media.basic_facts_or_probe_failure');

  return {
    gate: 'ingest',
    passed: missing.length === 0,
    status: missing.length === 0 ? 'passed' : 'missing',
    reason: missing.length === 0 ? 'ingest_gate_met' : 'ingest_gate_missing_required_facts',
    missingReasons: missing,
    userAction: missing.length === 0 ? '' : 'inspect_source_identity_and_probe_result',
  };
}

function isInitialStrategyPlaceholder(action, reason) {
  if (!action || action === 'none') return true;
  if (action !== 'keep') return false;
  return ['新入库', '成人库新入库'].includes(clean(reason));
}

function isOptimizedLike(item = {}) {
  const action = normalize(item.action);
  const reason = clean(item.reason);
  const status = normalize(item.optimizationStatus);
  const archiveStatus = normalize(item.archiveStatus);

  if (archiveStatus === 'archived' || archiveStatus === 'archived_like') return true;
  if (status === 'transcoded' || status === 'upgraded' || status === 'deleted' || status === 'removed') return true;
  if (item.deleted === true || item.removed === true || item.removedAt || item.deletedAt) return true;
  if (action === 'keep' && !isInitialStrategyPlaceholder(action, reason)) return true;
  return false;
}

function evaluateArchiveGate(item = {}) {
  const missing = [];
  const blockers = Array.isArray(item.archiveBlockers) ? item.archiveBlockers.filter(Boolean) : [];

  if (!isOptimizedLike(item)) missing.push('optimize.result');
  if (blockers.length > 0) missing.push('archive.blocker');

  return {
    gate: 'archive',
    passed: missing.length === 0,
    status: missing.length === 0 ? 'passed' : 'not_ready',
    reason: missing.length === 0 ? 'archive_gate_met' : 'archive_gate_not_ready',
    missingReasons: missing,
    blockers,
    userAction: missing.length === 0 ? '' : 'inspect_open_gate_or_active_blocker',
  };
}

module.exports = {
  evaluateIngestGate,
  evaluateArchiveGate,
};
