'use strict';

const PERIOD_MS = 24 * 60 * 60 * 1000;
const MIN_PERIOD_MS = 6 * 60 * 60 * 1000;

class PerceptionAcquisitionAutomationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PerceptionAcquisitionAutomationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PerceptionAcquisitionAutomationError(code, message, details);
}

function createPerceptionAcquisitionAutomation(options) {
  if (typeof options?.now !== 'function' || typeof options.listAcquisitions !== 'function' ||
      typeof options.requestAcquisition !== 'function') {
    fail('PERCEPTION_ACQUISITION_AUTOMATION_DEPENDENCIES',
      'Perception Acquisition automation requires clock, Acquisition list, and requestAcquisition.');
  }
  const periodMs = Number.isSafeInteger(options.periodMs) ? Math.max(options.periodMs, MIN_PERIOD_MS) : PERIOD_MS;
  let sweepNotBeforeMs = 0;

  function doubanConfig() {
    return typeof options.readDoubanSourceConfiguration === 'function'
      ? options.readDoubanSourceConfiguration()
      : null;
  }

  function providerAcquisitions(sourceId) {
    return options.listAcquisitions()
      .filter((item) => item.perceptionSourceId === sourceId)
      .sort((left, right) => Number(right.createdAtMs) - Number(left.createdAtMs)
        || left.perceptionAcquisitionId.localeCompare(right.perceptionAcquisitionId));
  }

  function hasCompletedProviderAcquisition(sourceId) {
    return providerAcquisitions(sourceId).some((item) => item.state === 'completed' && item.terminalAtMs != null);
  }

  function listPage({ cursor, limit }) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      fail('PERCEPTION_ACQUISITION_AUTOMATION_PAGE_INVALID', 'Perception Acquisition reconcile page limit is invalid.');
    }
    const config = doubanConfig();
    if (!config) return [];
    const gated = cursor === null && options.now() < sweepNotBeforeMs;
    if (gated && hasCompletedProviderAcquisition(config.sourceId)) return [];
    if (cursor !== null && config.sourceId <= cursor) return [];
    const page = [Object.freeze({ cursor: config.sourceId, scope: Object.freeze({ sourceId: config.sourceId }) })];
    if (!gated && page.length < limit) sweepNotBeforeMs = options.now() + periodMs;
    return page;
  }

  function reconcile({ sourceId }) {
    const config = doubanConfig();
    if (!config || config.sourceId !== sourceId) return Object.freeze({ kind: 'not_configured', sourceId });
    const items = providerAcquisitions(sourceId);
    const active = items.find((item) => item.state === 'active');
    if (active) return Object.freeze({ kind: 'in_progress', sourceId, perceptionAcquisitionId: active.perceptionAcquisitionId });
    const completed = items.find((item) => item.state === 'completed' && item.terminalAtMs != null);
    if (completed && options.now() - Number(completed.terminalAtMs) < periodMs) {
      return Object.freeze({ kind: 'not_due', sourceId, perceptionAcquisitionId: completed.perceptionAcquisitionId });
    }
    const observed = options.requestAcquisition({
      idempotencyKey: 'periodic-douban-acquisition:' + config.sourceId + ':config-' + config.configRevision
        + ':after-' + (completed ? completed.perceptionAcquisitionId : 'none'),
    });
    return Object.freeze({
      kind: 'issued',
      sourceId,
      perceptionAcquisitionId: observed.operationRef,
      replayed: observed.replayed === true,
    });
  }

  return Object.freeze({ PERIOD_MS, MIN_PERIOD_MS, periodMs, listPage, reconcile });
}

module.exports = Object.freeze({
  PerceptionAcquisitionAutomationError,
  PERIOD_MS,
  MIN_PERIOD_MS,
  createPerceptionAcquisitionAutomation,
});
