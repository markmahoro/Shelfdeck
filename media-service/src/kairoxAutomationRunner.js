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
  try {
    return await resourceGovernor.runWithPermit({
      owner: 'kairox', workId: 'maintenance-automation', resourceKey: 'control:kairox', priority: 5,
    }, () => resourceGovernor.runWithPermit({
      owner: 'kairox', workId: 'maintenance-automation', resourceKey: 'db:tasks:write', priority: 5,
    }, async () => {
      const admissions = kairoxAdmissionStore.listActiveAdmissions({ afterItemId, limit });
      const ids = admissions.map((admission) => admission.itemId);
      const projections = kairoxService.reconcileObjectives(ids);
      const config = configStore.loadConfig();
      let created = 0;
      for (const admission of admissions) {
        const projection = projections[admission.itemId] || {};
        if (projection.maintenanceComplete || !projection.nextTargetGate) continue;
        if (projection.automationBlocker) continue;
        if ((projection.activeTasks || []).length > 0) continue;
        const descriptor = admission.sourceAccessDescriptor || {};
        const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId);
        const decision = automationPolicy.decideAutomaticTrigger({
          targetGate: projection.nextTargetGate,
          maintenanceAutomationMode: subLibrary && subLibrary.maintenanceAutomationMode || 'manual',
          lifecycleBlockedReason: projection.blockedReason || '',
        });
        if (!decision.allowed) continue;
        const result = kairoxService.requestMaintenance({
          itemId: admission.itemId,
          libraryGeneration: admission.admissionGeneration,
          targetGate: projection.nextTargetGate,
          gateObjective: projection.nextGateObjective || {},
          source: 'auto',
          status: 'queued',
          config,
          tasks: projection.activeTasks || [],
          logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Task created by Kairox Maintenance Automation' }],
        });
        if (result && result.allowed !== false && result.task) created += 1;
      }
      const cursor = admissions.length < limit ? '' : admissions[admissions.length - 1].itemId;
      kairoxStore.updateAutomationState('maintenance', {
        cursor: { afterItemId: cursor }, lastRunAt: new Date().toISOString(), lastError: '',
      });
      health = { status: 'green', lastRunAt: new Date().toISOString(), lastError: '', scanned: admissions.length, created, cursor };
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

function wake() { wakePending = true; schedule(0); }

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
  kairoxService = null;
}

function getHealth() { return { ...health, running }; }

module.exports = { start, stop, wake, runOnce, getHealth };
