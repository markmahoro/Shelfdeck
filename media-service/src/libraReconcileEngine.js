'use strict';

let initialTimer = null;
let intervalTimer = null;
let debounceTimer = null;
let libraService = null;
let configStore = null;
let running = false;
let pendingFull = false;
const pendingItemIds = new Set();
let health = { status: 'disabled', lastRunAt: '', lastError: '', reconciled: 0 };

async function drain() {
  if (running || !libraService) return;
  running = true;
  const full = pendingFull;
  const itemIds = full ? null : [...pendingItemIds];
  pendingFull = false;
  pendingItemIds.clear();
  try {
    const result = await Promise.resolve(libraService.reconcileBatch(itemIds));
    health = {
      status: 'green',
      lastRunAt: new Date().toISOString(),
      lastError: '',
      reconciled: Array.isArray(result) ? result.length : 0,
    };
  } catch (error) {
    health = { ...health, status: 'red', lastRunAt: new Date().toISOString(), lastError: error.message };
    console.error('[libraReconcileEngine] reconcile failed:', error.message);
  } finally {
    running = false;
    if (pendingFull || pendingItemIds.size > 0) scheduleDrain(0);
  }
}

function scheduleDrain(delayMs = 50) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    drain();
  }, Math.max(0, delayMs));
  debounceTimer.unref && debounceTimer.unref();
}

function wake(itemIds = null) {
  if (Array.isArray(itemIds) && itemIds.length > 0) {
    itemIds.forEach((itemId) => {
      const value = String(itemId || '').trim();
      if (value) pendingItemIds.add(value);
    });
  } else {
    pendingFull = true;
    pendingItemIds.clear();
  }
  scheduleDrain();
}

function start(resolvedLibraService, resolvedConfigStore) {
  stop();
  libraService = resolvedLibraService;
  configStore = resolvedConfigStore;
  const config = configStore.loadConfig();
  const initialDelayMs = Math.max(0, Number(config.libraReconcileInitialDelaySeconds == null ? 15 : config.libraReconcileInitialDelaySeconds)) * 1000;
  const intervalMs = Math.max(1, Number(config.libraReconcilePollIntervalMinutes || 5)) * 60000;
  initialTimer = setTimeout(() => {
    initialTimer = null;
    wake();
  }, initialDelayMs);
  initialTimer.unref && initialTimer.unref();
  intervalTimer = setInterval(() => wake(), intervalMs);
  intervalTimer.unref && intervalTimer.unref();
  health = { status: 'starting', lastRunAt: '', lastError: '', reconciled: 0 };
}

function stop() {
  if (initialTimer) clearTimeout(initialTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  initialTimer = null;
  intervalTimer = null;
  debounceTimer = null;
  libraService = null;
  configStore = null;
  running = false;
  pendingFull = false;
  pendingItemIds.clear();
}

function getHealth() { return { ...health }; }

module.exports = { start, stop, wake, getHealth, _drainForTests: drain };
