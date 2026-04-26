'use strict';

/**
 * Health check module (HEALTH_CHECK.md).
 * Four check items → green/yellow/red aggregation.
 * Checks cached for 10s; GET /v1/health returns last result.
 * Internal timer runs every 30s.
 */

const configStore = require('./configStore');
const embyService = require('./services/embyService');

let lastResult = null;
let checkTimer = null;

function getUptime() {
  return Math.floor(process.uptime());
}

async function checkService() {
  return { status: 'green', uptime: getUptime() };
}

async function checkConfig() {
  try {
    const cfg = configStore.loadConfig();
    const missing = [];
    if (!cfg.transcodeTempRoot) missing.push('transcodeTempRoot');
    if (missing.length > 0) {
      return { status: 'yellow', missingFields: missing };
    }
    return { status: 'green' };
  } catch {
    return { status: 'red' };
  }
}

async function checkEmby() {
  const cfg = configStore.loadConfig();
  const servers = cfg.embyServers || {};
  const serverIds = Object.keys(servers).filter((k) => servers[k] && servers[k].baseUrl);

  if (serverIds.length === 0) {
    return { status: 'yellow', message: 'No Emby servers configured' };
  }

  let anyGreen = false;
  let anyRed = false;
  const messages = [];

  for (const id of serverIds) {
    const sc = servers[id];
    const start = Date.now();
    try {
      await embyService.testConnection(sc);
      const elapsed = Date.now() - start;
      if (elapsed > 2000) {
        messages.push(`Server ${sc.baseUrl} response slow (${(elapsed / 1000).toFixed(1)}s)`);
      } else {
        anyGreen = true;
      }
    } catch (e) {
      anyRed = true;
      messages.push(`Server ${sc.baseUrl} unreachable: ${e.message}`);
    }
  }

  if (anyRed) return { status: 'red', message: messages.join('; ') };
  if (anyGreen) return { status: messages.length > 0 ? 'yellow' : 'green', message: messages.join('; ') || undefined };
  return { status: 'yellow', message: 'All Emby servers slow' };
}

function checkScheduler() {
  // taskScheduler will set its state via setSchedulerState()
  const state = _schedulerState;
  if (!state) return { status: 'yellow', message: 'Scheduler state unknown' };
  if (!state.running) return { status: 'red', message: 'Scheduler not running' };
  return { status: 'green', runningTasks: state.runningTasks || 0 };
}

let _schedulerState = null;
function setSchedulerState(state) {
  _schedulerState = state;
}

function aggregate(checks) {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

async function runAllChecks() {
  const [service, config, emby, scheduler] = await Promise.all([
    checkService(),
    checkConfig(),
    checkEmby(),
    Promise.resolve(checkScheduler()),
  ]);
  return {
    status: aggregate({ service, config, emby, scheduler }),
    checks: { service, config, emby, scheduler },
    timestamp: new Date().toISOString(),
  };
}

function startHealthCheckTimer(intervalMs = 30000) {
  if (checkTimer) return;
  runAllChecks().then((r) => { lastResult = r; }).catch(() => {});
  checkTimer = setInterval(async () => {
    try {
      lastResult = await runAllChecks();
    } catch (_) {}
  }, intervalMs);
}

function stopHealthCheckTimer() {
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
}

function getLastResult() {
  return lastResult;
}

function getPublicResult() {
  const r = lastResult;
  if (!r) return { status: 'yellow', timestamp: new Date().toISOString() };
  return { status: r.status, timestamp: r.timestamp };
}

module.exports = { startHealthCheckTimer, stopHealthCheckTimer, getLastResult, getPublicResult, runAllChecks, setSchedulerState };
