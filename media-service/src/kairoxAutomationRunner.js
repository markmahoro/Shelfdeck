'use strict';

const automationPolicy = require('./automationPolicy');
const configStore = require('./configStore');
const kairoxAdmissionStore = require('./kairoxAdmissionStore');
const kairoxStore = require('./kairoxStore');
const resourceGovernor = require('./resourceGovernor');
const signalBus = require('./kairoxSignalBus');

let timer = null;
let intervalTimer = null;
let unsubscribe = null;
let running = false;
let wakePending = false;
const targetedItemIds = new Set();
let kairoxService = null;
let health = { status: 'disabled', lastRunAt: '', lastError: '', scanned: 0, created: 0, cursor: '' };

async function runOnce(options = {}) {
  if (running || !kairoxService) {
    wakePending = true;
    return health;
  }
  running = true;
  wakePending = false;
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 100));
  const state = kairoxStore.getAutomationState('maintenance');
  const afterItemId = String(state.cursor.afterItemId || '');
  const requestedItemIds = [...targetedItemIds].slice(0, limit);
  requestedItemIds.forEach((itemId) => targetedItemIds.delete(itemId));
  try {
    return await resourceGovernor.runWithPermit({
      owner: 'kairox', workId: 'maintenance-automation', resourceKey: 'control:kairox', priority: 5,
    }, () => resourceGovernor.runWithPermit({
      owner: 'kairox', workId: 'maintenance-automation', resourceKey: 'db:tasks:write', priority: 5,
    }, async () => {
      const admissions = requestedItemIds.length
        ? Object.values(kairoxAdmissionStore.getAdmissions(requestedItemIds)).filter((admission) => admission && admission.status === 'active')
        : kairoxAdmissionStore.listActiveAdmissions({ afterItemId, limit });
      const ids = admissions.map((admission) => admission.itemId);
      const config = configStore.loadConfig();
      kairoxService.reconcileObjectives(ids);
      for (const admission of admissions) {
        kairoxService.reconcileMaintenanceRun({ itemId: admission.itemId, config });
      }
      const readyRuns = kairoxStore.listMaintenanceRuns({ statuses: ['ready'], limit });
      const runIds = readyRuns.map((run) => run.itemId);
      const runAdmissions = kairoxAdmissionStore.getAdmissions(runIds);
      const projections = kairoxService.reconcileObjectives(runIds);
      let created = 0;
      for (const run of readyRuns) {
        const admission = runAdmissions[run.itemId];
        if (!admission || admission.status !== 'active') continue;
        const projection = projections[run.itemId] || {};
        if (projection.maintenanceComplete || !projection.nextTargetGate) continue;
        if (projection.automationBlocker) continue;
        if ((projection.activeTasks || []).length > 0) continue;
        const decision = automationPolicy.decideRunProgress({
          targetGate: projection.nextTargetGate,
          runStatus: run.status,
          lifecycleBlockedReason: projection.blockedReason || '',
        });
        if (!decision.allowed) continue;
        const result = kairoxService.requestMaintenance({
          itemId: admission.itemId,
          libraryGeneration: admission.admissionGeneration,
          runId: run.runId,
          targetGate: projection.nextTargetGate,
          gateObjective: projection.nextGateObjective || {},
          config,
          tasks: projection.activeTasks || [],
          logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Task created by Kairox Maintenance Automation' }],
        });
        if (result && result.allowed !== false && result.task) created += 1;
      }
      const cursor = requestedItemIds.length ? afterItemId : (admissions.length < limit ? '' : admissions[admissions.length - 1].itemId);
      kairoxStore.updateAutomationState('maintenance', { cursor: { afterItemId: cursor }, lastRunAt: new Date().toISOString(), lastError: '' });
      health = { status: 'green', lastRunAt: new Date().toISOString(), lastError: '', scanned: admissions.length, suppliedRuns: readyRuns.length, created, cursor };
      return health;
    }));
  } catch (error) {
    kairoxStore.updateAutomationState('maintenance', { lastRunAt: new Date().toISOString(), lastError: error.message });
    health = { ...health, status: error.code === 'RESOURCE_QUEUE_FULL' ? 'waiting_for_resource' : 'red', lastRunAt: new Date().toISOString(), lastError: error.message };
    return health;
  } finally {
    running = false;
    if (wakePending) schedule(0);
  }
}

function schedule(delayMs = 25) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runOnce();
  }, Math.max(0, delayMs));
  timer.unref && timer.unref();
}

function wake(signal = {}) {
  const ids = Array.isArray(signal.itemIds) ? signal.itemIds : signal.itemId ? [signal.itemId] : [];
  ids.map(String).filter(Boolean).forEach((itemId) => targetedItemIds.add(itemId));
  wakePending = true;
  schedule(0);
}

function start(service, options = {}) {
  stop();
  kairoxService = service;
  unsubscribe = signalBus.subscribe(wake);
  health = { status: 'starting', lastRunAt: '', lastError: '', scanned: 0, created: 0, cursor: '' };
  if (options.immediate !== false) schedule(0);
  intervalTimer = setInterval(wake, Math.max(1000, Number(options.intervalMs) || 5000));
  intervalTimer.unref && intervalTimer.unref();
}

function stop() {
  if (timer) clearTimeout(timer);
  if (intervalTimer) clearInterval(intervalTimer);
  if (unsubscribe) unsubscribe();
  timer = null;
  intervalTimer = null;
  unsubscribe = null;
  running = false;
  wakePending = false;
  targetedItemIds.clear();
  kairoxService = null;
}

function getHealth() { return { ...health, running }; }

module.exports = { start, stop, wake, runOnce, getHealth };
