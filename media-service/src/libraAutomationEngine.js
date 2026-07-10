'use strict';

const resourceGovernor = require('./resourceGovernor');

let initialTimer = null;
let intervalTimer = null;
let running = false;
let wakeRequested = false;
let libraService = null;
let configStore = null;
let health = { status: 'disabled', lastRunAt: '', lastError: '', currentWorkId: '', processedWork: 0 };

function timeBucket(minutes) {
  const windowMs = Math.max(1, Number(minutes) || 5) * 60000;
  return Math.floor(Date.now() / windowMs);
}

function ensurePeriodicWork() {
  const config = configStore.loadConfig();
  const observationMinutes = Math.max(1, Number(config.libraObservationIntervalMinutes) || 15);
  for (const subLibrary of config.subLibraries || []) {
    if (subLibrary.enabled === false || subLibrary.libraryAutomationMode !== 'auto') continue;
    libraService.requestLibraryObservation({
      subLibraryId: subLibrary.uuid,
      idempotencyKey: `observe-library:${subLibrary.uuid}:${timeBucket(observationMinutes)}`,
      requestedBy: 'periodic_automation',
    });
  }
  const reconcileMinutes = Math.max(1, Number(config.libraReconcileIntervalMinutes) || 5);
  libraService.requestReconcileSweep({
    idempotencyKey: `reconcile-library:${timeBucket(reconcileMinutes)}`,
    requestedBy: 'periodic_automation',
  });
}

async function drain() {
  if (running || !libraService || !configStore) {
    wakeRequested = true;
    return;
  }
  running = true;
  wakeRequested = false;
  try {
    ensurePeriodicWork();
    const projection = libraService.getAutomationProjection();
    const work = (projection.runnableWorks || [])
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (!work) {
      health = { ...health, status: 'green', lastRunAt: new Date().toISOString(), lastError: '', currentWorkId: '' };
      return;
    }
    health = { ...health, status: 'running', currentWorkId: work.workId };
    await resourceGovernor.runWithPermit({
      owner: 'libra',
      workId: work.workId,
      resourceKey: 'control:libra',
      priority: 0,
    }, () => resourceGovernor.runWithPermit({
      owner: 'libra', workId: work.workId, resourceKey: 'db:library:write', priority: 0,
    }, () => libraService.runLibraryWork(work.workId, { limit: 100, timeBudgetMs: 5000 })));
    health = {
      status: 'green', lastRunAt: new Date().toISOString(), lastError: '', currentWorkId: '',
      processedWork: health.processedWork + 1,
    };
    wakeRequested = true;
  } catch (error) {
    health = { ...health, status: error.code === 'RESOURCE_QUEUE_FULL' ? 'waiting_for_resource' : 'red', lastRunAt: new Date().toISOString(), lastError: error.message, currentWorkId: '' };
  } finally {
    running = false;
    if (wakeRequested) schedule(0);
  }
}

function schedule(delayMs = 25) {
  if (initialTimer) clearTimeout(initialTimer);
  initialTimer = setTimeout(() => {
    initialTimer = null;
    drain();
  }, Math.max(0, delayMs));
  initialTimer.unref && initialTimer.unref();
}

function wake() {
  wakeRequested = true;
  schedule(0);
}

function start(service, configs) {
  stop();
  libraService = service;
  configStore = configs;
  health = { status: 'starting', lastRunAt: '', lastError: '', currentWorkId: '', processedWork: 0 };
  schedule(0);
  intervalTimer = setInterval(wake, 5000);
  intervalTimer.unref && intervalTimer.unref();
}

function stop() {
  if (initialTimer) clearTimeout(initialTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  initialTimer = null;
  intervalTimer = null;
  running = false;
  wakeRequested = false;
  libraService = null;
  configStore = null;
}

function getHealth() {
  return { ...health, ...(libraService ? libraService.getAutomationProjection() : { works: [], runnable: 0 }) };
}

module.exports = { start, stop, wake, getHealth, _drainForTests: drain };
