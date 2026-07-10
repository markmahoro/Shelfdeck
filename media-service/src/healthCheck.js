'use strict';

/**
 * Health check module (HEALTH_CHECK.md).
 * Eight check items → green/yellow/red aggregation.
 * Each functional module self-reports health via getHealth().
 * Checks cached for 10s; GET /v1/health returns last result.
 * Internal timer runs every 30s.
 */

const configStore = require('./configStore');
const embyService = require('./services/embyService');
const activityLog = require('./activityLog');

let lastResult = null;
let checkTimer = null;
let lastEmbyStatus = null;

// ── Emby check (multi-server) ────────────────────────────────────────────────

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

// ── Scheduler state (push model to avoid circular dep) ────────────────────────

let _schedulerState = null;
function setSchedulerState(state) {
  _schedulerState = state;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function aggregate(checks) {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

// ── Run all ──────────────────────────────────────────────────────────────────

async function runAllChecks() {
  const cfg = configStore.loadConfig();

  // taskScheduler: push model (avoids circular dep)
  const schedulerState = _schedulerState;
  const scheduler = schedulerState && schedulerState.running
    ? { status: 'green', runningTasks: schedulerState.runningTasks || 0 }
    : { status: 'red', runningTasks: 0 };

  // Lazy-require to avoid circular deps on startup
  const libraReconcileEngine = require('./libraReconcileEngine');
  const doubanService = require('./services/doubanService');
  const moviepilotService = require('./services/moviepilotService');
  const transcodeService = require('./services/transcodeService');

  const [emby, upgrade, transcode, douban] = await Promise.all([
    checkEmby(),
    moviepilotService.getHealth(cfg),
    transcodeService.getHealth(cfg),
    doubanService.getHealth(cfg),
  ]);

  const checks = {
    scheduler:   scheduler,
    libraReconciler: libraReconcileEngine.getHealth(),
    douban,
    emby,
    upgrade,
    transcode,
  };

  // Detect Emby status changes and emit activity events
  if (lastEmbyStatus !== null && lastEmbyStatus !== emby.status) {
    if (emby.status === 'red') {
      activityLog.addActivity('health', `Emby 服务器连接异常：${emby.message || '无法连接'}`);
    } else if (emby.status === 'green' && lastEmbyStatus === 'red') {
      activityLog.addActivity('health', 'Emby 服务器连接已恢复');
    }
  }
  lastEmbyStatus = emby.status;

  return {
    status: aggregate(checks),
    checks,
    timestamp: new Date().toISOString(),
  };
}

// ── Timer ────────────────────────────────────────────────────────────────────

function startHealthCheckTimer(intervalMs = 30000) {
  if (checkTimer) return;
  runAllChecks().then((r) => { lastResult = r; }).catch(() => {});
  checkTimer = setInterval(async () => {
    try {
      lastResult = await runAllChecks();
    } catch (_) {}
  }, intervalMs);
  checkTimer.unref && checkTimer.unref();
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

module.exports = {
  startHealthCheckTimer,
  stopHealthCheckTimer,
  getLastResult,
  getPublicResult,
  runAllChecks,
  setSchedulerState,
};
