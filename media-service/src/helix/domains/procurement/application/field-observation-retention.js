'use strict';

const { DELETE_BATCH_LIMIT, RETENTION_MS } = require('../persistence/field-observation-retention-store');

const PERIOD_MS = 6 * 60 * 60 * 1000;
const RECONCILE_BUDGET_MS = 5000;
const RECLAIM_PAGE_LIMIT = 1024;
const SINGLETON_CURSOR = 'field-observation-entry-retention';
const DEFAULT_FULL_OBSERVATION_BYTES = Math.round(39.5 * 1024 * 1024);

class FieldObservationRetentionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldObservationRetentionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldObservationRetentionError(code, message, details);
}

function estimateCapacity({ days, protectedWorksOutsideWindow = 0,
  fullObservationBytes = DEFAULT_FULL_OBSERVATION_BYTES } = {}) {
  if (!Number.isSafeInteger(days) || days < 1 || !Number.isSafeInteger(protectedWorksOutsideWindow) ||
      protectedWorksOutsideWindow < 0 || !Number.isSafeInteger(fullObservationBytes) || fullObservationBytes < 1) {
    fail('P7_FIELD_OBSERVATION_CAPACITY_INPUT_INVALID', 'Observation capacity inputs are invalid.');
  }
  const sweepsPerDay = 24 * 60 * 60 * 1000 / (12 * 60 * 60 * 1000);
  const grossObservationCount = Math.ceil(days * sweepsPerDay);
  const retainedWindowObservationCount = Math.ceil(Math.min(days, 7) * sweepsPerDay);
  return Object.freeze({ days, sweepsPerDay, grossObservationCount,
    grossBytes:grossObservationCount * fullObservationBytes,
    retainedObservationCount:retainedWindowObservationCount + protectedWorksOutsideWindow,
    retainedBytes:(retainedWindowObservationCount + protectedWorksOutsideWindow) * fullObservationBytes });
}

function createFieldObservationRetention(options) {
  if (!options?.store || typeof options.store.purge !== 'function' || typeof options.now !== 'function' ||
      !options.storageMaintenance || typeof options.storageMaintenance.reclaimFreePages !== 'function') {
    fail('P7_FIELD_OBSERVATION_RETENTION_DEPENDENCIES', 'Observation retention requires Owner store, storage maintenance, and clock.');
  }
  let nextDueAtMs = 0;
  let lastResult = null;
  let scanCursor = null;
  let running = null;
  const monotonicNow=options.monotonicNow||(()=>performance.now());

  function listPage({ cursor, limit }) {
    if (!Number.isSafeInteger(limit) || limit < 1) fail('P7_FIELD_OBSERVATION_RETENTION_PAGE_INVALID', 'Retention page limit is invalid.');
    if (cursor !== null || options.now() < nextDueAtMs) return Object.freeze([]);
    return Object.freeze([Object.freeze({ cursor:SINGLETON_CURSOR, scope:Object.freeze({ kind:SINGLETON_CURSOR }) })]);
  }

  async function runReconcile() {
    const startedAtMs = options.now();
    const started=monotonicNow(),cutoffMs=startedAtMs-RETENTION_MS;
    let purge,deleted=0,scanned=0,scannedHeaders=0,slices=0;
    const protectedByReason={};
    do {
      purge=options.store.purge({cutoffMs,limit:DELETE_BATCH_LIMIT-deleted,scanCursor});
      scanCursor=purge.nextScanCursor;
      deleted+=purge.deleted;scanned+=purge.scanned||0;scannedHeaders+=purge.scannedHeaders||0;slices++;
      for(const [reason,count] of Object.entries(purge.protectedByReason||{}))protectedByReason[reason]=(protectedByReason[reason]||0)+count;
      if(!scanCursor||deleted>=DELETE_BATCH_LIMIT||monotonicNow()-started>=RECONCILE_BUDGET_MS)break;
      // Each continuation rechecks all Owner references in its own transaction.
      // Yield between bounded scans instead of blocking HTTP for the full sweep.
      await new Promise(resolve=>setImmediate(resolve));
    }while(true);
    purge=Object.freeze({...purge,deleted,scanned,scannedHeaders,slices,protectedByReason:Object.freeze(protectedByReason)});
    await new Promise(resolve=>setImmediate(resolve));
    const storage = options.storageMaintenance.reclaimFreePages(RECLAIM_PAGE_LIMIT);
    const continueBacklog = purge.backlogLikely || storage.status === 'reclaimed' && storage.freelistCountAfter > 0;
    nextDueAtMs = continueBacklog ? options.now() : options.now() + PERIOD_MS;
    lastResult = Object.freeze({ kind:'field_observation_retention_batch', startedAtMs,
      completedAtMs:options.now(), retentionMs:RETENTION_MS, purge, storage, nextDueAtMs });
    if (options.metrics && typeof options.metrics === 'object') options.metrics.lastObservationRetention = lastResult;
    return lastResult;
  }
  function reconcile(){
    if(running)return running;
    running=runReconcile().finally(()=>{running=null;});return running;
  }

  return Object.freeze({ listPage, reconcile, nextDueAtMs:() => nextDueAtMs, lastResult:() => lastResult });
}

module.exports = Object.freeze({ DEFAULT_FULL_OBSERVATION_BYTES, PERIOD_MS, RECLAIM_PAGE_LIMIT, RETENTION_MS,
  FieldObservationRetentionError, createFieldObservationRetention, estimateCapacity });
