'use strict';

const automationPolicy = require('./automationPolicy');
const configStore = require('./configStore');
const kairoxAdmissionStore = require('./kairoxAdmissionStore');
const kairoxStore = require('./kairoxStore');
const resourceGovernor = require('./resourceGovernor');
const automationInvariantMonitor = require('./automationInvariantMonitor');
const signalBus = require('./kairoxSignalBus');

let timer = null;
let intervalTimer = null;
let unsubscribe = null;
let running = false;
let wakePending = false;
const targetedItemIds = new Set();
let kairoxService = null;
let health = { status: 'disabled', lastRunAt: '', lastError: '', scanned: 0, created: 0, cursor: '' };

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

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
  requestedItemIds.forEach((subjectId) => targetedItemIds.delete(subjectId));
  try {
    return await resourceGovernor.runWithPermit({
      owner: 'kairox', workId: 'maintenance-automation', resourceKey: 'control:kairox', priority: 5,
    }, () => resourceGovernor.runWithPermit({
      owner: 'kairox', workId: 'maintenance-automation', resourceKey: 'db:tasks:write', priority: 5,
    }, async () => {
      const phaseStartedAt = Date.now();
      const phaseDurationsMs = {};
      let phaseAt = phaseStartedAt;
      const markPhase = (name) => {
        const now = Date.now();
        phaseDurationsMs[name] = now - phaseAt;
        phaseAt = now;
      };
      const admissions = requestedItemIds.length
        ? Object.values(kairoxAdmissionStore.getAdmissions(requestedItemIds)).filter((admission) => admission && admission.status === 'active')
        : kairoxAdmissionStore.listActiveAdmissions({ afterItemId, limit });
      const ids = admissions.map((admission) => admission.subjectId);
      const config = configStore.loadConfig();
      const invariantHealth = automationInvariantMonitor.evaluate(config);
      markPhase('load_and_invariants');
      if (invariantHealth.circuitOpen) {
        const message = `Maintenance automation circuit open: ${invariantHealth.violations.map((entry) => entry.code).join(', ')}`;
        kairoxStore.updateAutomationState('maintenance', { lastRunAt: new Date().toISOString(), lastError: message });
        health = { status: 'red', lastRunAt: new Date().toISOString(), lastError: message, circuitOpen: true, scanned: admissions.length, created: 0, cursor: afterItemId };
        return health;
      }
      const admissionProjections = kairoxService.reconcileObjectives(ids);
      markPhase('reconcile_objectives');
      for (const admission of admissions) {
        kairoxService.reconcileMaintenanceRun({
          subjectId: admission.subjectId,
          config,
          maintenanceProjection: admissionProjections[admission.subjectId],
          includeProjection: false,
        });
        await yieldToEventLoop();
      }
      markPhase('reconcile_runs');
      // Supply only from the same bounded admission batch reconciled above.
      // Reading the global first N ready Runs lets a saturated Gate monopolize
      // the window and starve other Gates (or a targeted manual Run).
      const readyRuns = kairoxStore.listMaintenanceRuns({ statuses: ['ready'], subjectIds: ids, limit });
      const runIds = readyRuns.map((run) => run.subjectId);
      const runAdmissions = kairoxAdmissionStore.getAdmissions(runIds);
      const projections = kairoxService.reconcileObjectives(runIds);
      markPhase('project_ready_runs');
      let created = 0;
      const supplyRemaining = { ...(invariantHealth.remainingByTargetGate || {}) };
      for (const run of readyRuns) {
        await yieldToEventLoop();
        const admission = runAdmissions[run.subjectId];
        if (!admission || admission.status !== 'active') continue;
        const projection = projections[run.subjectId] || {};
        if (projection.maintenanceComplete || !projection.nextTargetGate) continue;
        if (projection.automationBlocker) continue;
        if ((projection.activeTasks || []).length > 0) continue;
        const decision = automationPolicy.decideRunProgress({
          targetGate: projection.nextTargetGate,
          runStatus: run.status,
          lifecycleBlockedReason: projection.blockedReason || '',
        });
        if (!decision.allowed) continue;
        if (supplyRemaining[projection.nextTargetGate] === 0) continue;
        const result = kairoxService.requestMaintenance({
          subjectId: admission.subjectId,
          libraryGeneration: admission.admissionGeneration,
          runId: run.runId,
          targetGate: projection.nextTargetGate,
          gateObjective: projection.nextGateObjective || {},
          maintenanceProjection: projection,
          config,
          logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Task created by Kairox Maintenance Automation' }],
        });
        if (result && result.allowed !== false && result.task) {
          created += 1;
          if (Number.isFinite(supplyRemaining[projection.nextTargetGate])) {
            supplyRemaining[projection.nextTargetGate] = Math.max(0, supplyRemaining[projection.nextTargetGate] - 1);
          }
        }
      }
      markPhase('supply_tasks');
      const cursor = requestedItemIds.length ? afterItemId : (admissions.length < limit ? '' : admissions[admissions.length - 1].subjectId);
      kairoxStore.updateAutomationState('maintenance', { cursor: { afterItemId: cursor }, lastRunAt: new Date().toISOString(), lastError: '' });
      health = {
        status: 'green', lastRunAt: new Date().toISOString(), lastError: '', scanned: admissions.length,
        suppliedRuns: readyRuns.length, created, cursor, durationMs: Date.now() - phaseStartedAt, phaseDurationsMs,
      };
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
  const ids = Array.isArray(signal.subjectIds) ? signal.subjectIds : signal.subjectId ? [signal.subjectId] : [];
  ids.map(String).filter(Boolean).forEach((subjectId) => targetedItemIds.add(subjectId));
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

function getHealth() { return { ...health, ...automationInvariantMonitor.getHealth(), running }; }

module.exports = { start, stop, wake, runOnce, getHealth };
