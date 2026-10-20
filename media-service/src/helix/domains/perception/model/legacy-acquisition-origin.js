'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

// The old periodic coordinator sealed its source, config revision and previous
// terminal acquisition into this exact request identity. Do not guess manual
// origin, mutate the old Scope, or infer origin from priority or display text.
function proveLegacyPeriodicAcquisition(acquisition, history) {
  const scope = JSON.parse(acquisition.scopeJson);
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort());
  if (!exact(scope, ['mode', 'collection', 'sourceId', 'acquisitionWindow']) || scope.mode !== 'provider' ||
      scope.collection !== 'watched_movies' || scope.sourceId !== acquisition.perceptionSourceId ||
      canonicalDigest(scope) !== acquisition.scopeDigest ||
      !exact(scope.acquisitionWindow, ['kind', 'openedAtMs']) || scope.acquisitionWindow.kind !== 'full_snapshot' ||
      !Number.isSafeInteger(scope.acquisitionWindow.openedAtMs) || scope.acquisitionWindow.openedAtMs < 0 ||
      scope.acquisitionWindow.openedAtMs > acquisition.createdAtMs || !Number.isSafeInteger(acquisition.createdAtMs) ||
      !Number.isSafeInteger(acquisition.sourceConfigRevision) || acquisition.sourceConfigRevision < 1 ||
      !Array.isArray(history) || history.length > 4096) return null;
  const candidates = [null, ...history.filter(previous => previous.perceptionSourceId === acquisition.perceptionSourceId &&
    ['completed', 'failed'].includes(previous.state) && Number.isSafeInteger(previous.terminalAtMs) &&
    previous.terminalAtMs <= acquisition.createdAtMs && previous.perceptionAcquisitionId !== acquisition.perceptionAcquisitionId)];
  const matches = candidates.filter(previous => {
    const idempotencyKey = 'periodic-douban-acquisition:' + acquisition.perceptionSourceId + ':config-' +
      acquisition.sourceConfigRevision + ':after-' + (previous ? previous.perceptionAcquisitionId : 'none');
    return acquisition.perceptionAcquisitionId === 'perception-douban-acquisition-' +
      canonicalDigest({ sourceId: acquisition.perceptionSourceId, idempotencyKey }).slice(0, 40);
  });
  return matches.length === 1 ? Object.freeze({ executionOrigin: 'periodic', scopeDigest: acquisition.scopeDigest,
    previousAcquisitionId: matches[0]?.perceptionAcquisitionId || null }) : null;
}

module.exports = Object.freeze({ proveLegacyPeriodicAcquisition });
