'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeAtomic } = require('./clean-runtime-operations');
const { canonicalDigest } = require('./helix/contracts/canonical-json');

const DAY = 86400000, WEEK = 7 * DAY, OFFSET = 8 * 3600000;
const DEFAULT_CONFIG = Object.freeze({ weekday: 6, startTime: '03:00', endTime: '09:00', timeZone: 'Asia/Shanghai' });
const PHASES = new Set(['entering', 'recovering', 'maintaining', 'settling']);

function immutableCopy(value) {
  const copy = structuredClone(value);
  function freeze(item) {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  }
  return freeze(copy);
}

function validateConfiguration(value) {
  exact(value, ['revision', 'settings', 'pendingSettings']);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('MAINTENANCE_RECORD_INVALID', '维护配置版本损坏。');
  config(value.settings);
  if (value.pendingSettings !== null) {
    exact(value.pendingSettings, ['settings', 'effectiveAtMs']); config(value.pendingSettings.settings);
    if (!Number.isSafeInteger(value.pendingSettings.effectiveAtMs)) fail('MAINTENANCE_RECORD_INVALID', '维护配置生效时间损坏。');
  }
}

function fail(code, message) { throw Object.assign(new Error(message), { code, statusCode: 409 }); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    fail('MAINTENANCE_INPUT_INVALID', '维护配置参数不完整。');
  }
}
function minutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('MAINTENANCE_TIME_INVALID', '维护时间须为 HH:mm。');
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
function config(value) {
  exact(value, ['weekday', 'startTime', 'endTime', 'timeZone']);
  if (!Number.isInteger(value.weekday) || value.weekday < 0 || value.weekday > 6 || value.timeZone !== 'Asia/Shanghai' ||
      minutes(value.startTime) === minutes(value.endTime)) fail('MAINTENANCE_CONFIG_INVALID', '维护星期或起止时间无效。');
  return Object.freeze({ ...value });
}
function currentWindow(now, settings) {
  const local = new Date(now + OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET;
  let startAtMs = midnight - ((local.getUTCDay() - settings.weekday + 7) % 7) * DAY + minutes(settings.startTime) * 60000;
  if (startAtMs > now) startAtMs -= WEEK;
  const duration = (minutes(settings.endTime) - minutes(settings.startTime) + 1440) % 1440;
  const endAtMs = startAtMs + duration * 60000;
  return Object.freeze({ windowId: String(startAtMs), startAtMs, endAtMs });
}
function nextStart(now, settings) { return currentWindow(now, settings).startAtMs + WEEK; }

function createFileStore(dataDir) {
  const root = path.join(dataDir, 'operator-runtime');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink()) fail('MAINTENANCE_STORAGE_UNSAFE', '维护配置目录不安全。');
  const file = path.join(root, 'maintenance.json');
  return Object.freeze({
    load() {
      if (!fs.existsSync(file)) return null;
      if (fs.lstatSync(file).isSymbolicLink()) fail('MAINTENANCE_STORAGE_UNSAFE', '维护配置记录不安全。');
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save: value => writeAtomic(file, value),
  });
}

function createMaintenanceWindow(options) {
  if (!options || typeof options.now !== 'function' || typeof options.desiredMode !== 'function' ||
      typeof options.isDrained !== 'function' || typeof options.setAdmission !== 'function') throw new TypeError('Maintenance requires clock, operator intent and admission ports.');
  const store = options.store || createFileStore(options.dataDir);
  let record = store.load() || { schema: 'shelfdeck.maintenance-window@1', revision: 0, settings: DEFAULT_CONFIG,
    pendingSettings: null, active: null, lastWindowStartAtMs: null, configurationReceipts: [] };
  exact(record, ['schema', 'revision', 'settings', 'pendingSettings', 'active', 'lastWindowStartAtMs', 'configurationReceipts']);
  if (record.schema !== 'shelfdeck.maintenance-window@1' || !Number.isSafeInteger(record.revision) || record.revision < 0) fail('MAINTENANCE_RECORD_INVALID', '维护记录损坏。');
  validateConfiguration({ revision: record.revision, settings: record.settings, pendingSettings: record.pendingSettings });
  if (!Array.isArray(record.configurationReceipts) || record.lastWindowStartAtMs !== null && !Number.isSafeInteger(record.lastWindowStartAtMs)) {
    fail('MAINTENANCE_RECORD_INVALID', '维护记录损坏。');
  }
  const receiptKeys = new Set();
  for (const receipt of record.configurationReceipts) {
    exact(receipt, ['key', 'digest', 'result']);
    if (!/^[a-f0-9]{64}$/.test(receipt.key) || !/^[a-f0-9]{64}$/.test(receipt.digest) || receiptKeys.has(receipt.key)) {
      fail('MAINTENANCE_RECORD_INVALID', '维护配置操作记录损坏。');
    }
    receiptKeys.add(receipt.key); validateConfiguration(receipt.result);
    if (receipt.result.revision > record.revision) fail('MAINTENANCE_RECORD_INVALID', '维护配置操作版本损坏。');
  }
  if (record.active) {
    exact(record.active, ['windowId', 'startAtMs', 'endAtMs', 'phase']);
    if (!PHASES.has(record.active.phase) || !Number.isSafeInteger(record.active.startAtMs) || !Number.isSafeInteger(record.active.endAtMs) ||
        record.active.startAtMs >= record.active.endAtMs || record.active.windowId !== String(record.active.startAtMs)) fail('MAINTENANCE_RECORD_INVALID', '维护窗口记录损坏。');
  }
  let timer = null, ticking = null, scopeSequence = 0, admission = 'normal', closed = false;
  const activeScopes = new Map();
  const setAdmission = mode => { if (mode === admission) return; admission = mode; options.setAdmission(mode); };
  const persist = patch => { const next = { ...record, ...patch, revision: record.revision + 1 }; store.save(next); record = next; };
  // Recovering a persisted maintenance phase must drain the restarted runtime first.
  if (record.active && record.active.phase === 'maintaining') persist({ active: { ...record.active, phase: 'recovering' } });
  const initial = currentWindow(options.now(), record.settings);
  if (record.active || options.now() >= initial.startAtMs && options.now() < initial.endAtMs && record.lastWindowStartAtMs !== initial.startAtMs) setAdmission('draining');

  function closeWindow() {
    const previous = record.active;
    if (previous) persist({ active: null, lastWindowStartAtMs: previous.startAtMs });
    setAdmission('normal');
  }

  async function advance() {
    if (closed) return snapshot();
    const now = options.now();
    if (record.pendingSettings && !record.active && now >= record.pendingSettings.effectiveAtMs) {
      persist({ settings: record.pendingSettings.settings, pendingSettings: null });
    }
    if (options.desiredMode() !== 'running') {
      setAdmission('draining');
      if (record.active && options.isDrained() && activeScopes.size === 0) closeWindow();
      const window = currentWindow(now, record.settings);
      if (!record.active && now >= window.startAtMs && now < window.endAtMs && record.lastWindowStartAtMs !== window.startAtMs) {
        persist({ lastWindowStartAtMs: window.startAtMs });
      }
      return snapshot();
    }
    if (!record.active) {
      const window = currentWindow(now, record.settings);
      if (now < window.startAtMs || now >= window.endAtMs || record.lastWindowStartAtMs !== null && window.startAtMs <= record.lastWindowStartAtMs) {
        setAdmission('normal'); return snapshot();
      }
      persist({ active: { ...window, phase: 'entering' } }); setAdmission('draining');
    }
    const active = record.active;
    if (active.phase === 'entering') {
      setAdmission('draining');
      if (now >= Math.min(active.startAtMs + 15 * 60000, active.endAtMs - 5 * 60000)) {
        // No extension, forced cancellation or catch-up after the fixed entry deadline.
        closeWindow(); return snapshot();
      }
      if (options.isDrained() && activeScopes.size === 0) {
        persist({ active: { ...active, phase: 'maintaining' } }); setAdmission('maintenance');
      }
    } else if (active.phase === 'recovering') {
      setAdmission('draining');
      if (now >= active.endAtMs - 5 * 60000) persist({ active: { ...active, phase: 'settling' } });
      else if (options.isDrained() && activeScopes.size === 0) {
        persist({ active: { ...active, phase: 'maintaining' } }); setAdmission('maintenance');
      }
    } else if (active.phase === 'maintaining') {
      if (now >= active.endAtMs - 5 * 60000) { setAdmission('draining'); persist({ active: { ...active, phase: 'settling' } }); }
      else setAdmission('maintenance');
    } else {
      setAdmission('draining');
      if (now >= active.endAtMs && options.isDrained() && activeScopes.size === 0) closeWindow();
    }
    return snapshot();
  }

  function snapshot() {
    const phase = record.active?.phase || null;
    return Object.freeze({ maintenanceActive: Boolean(phase), phase, currentTask: phase === 'settling' ? '安全收尾' : phase ? [...activeScopes.values()].filter(Boolean).at(-1) || null : null,
      windowEndAtMs: record.active?.endAtMs || null });
  }
  function tick() {
    if (ticking) return ticking;
    ticking = Promise.resolve().then(advance).finally(() => { ticking = null; });
    return ticking;
  }
  return Object.freeze({ snapshot, tick,
    normalSupplyAllowed: () => options.desiredMode() === 'running' && admission === 'normal',
    allows(category) { return category === 'safety' || options.desiredMode() === 'running' && (admission === 'normal' && category === 'normal' || admission === 'maintenance' && category === 'maintenance'); },
    beginScope(title) { const key = ++scopeSequence; activeScopes.set(key, admission === 'maintenance' ? title : null);
      return () => { activeScopes.delete(key); }; },
    configuration() { return immutableCopy({ revision: record.revision, settings: record.settings, pendingSettings: record.pendingSettings }); },
    configure(body, actorId) {
      exact(body, ['expectedRevision', 'idempotencyKey', 'settings']);
      if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings) || !Object.keys(body.settings).length ||
          Object.keys(body.settings).some(key => !['weekday', 'startTime', 'endTime', 'timeZone'].includes(key))) {
        fail('MAINTENANCE_INPUT_INVALID', '维护配置参数无效。');
      }
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || typeof body.idempotencyKey !== 'string' ||
          !body.idempotencyKey || body.idempotencyKey.length > 128 || !actorId) fail('MAINTENANCE_INPUT_INVALID', '维护配置版本或操作标识无效。');
      const command = { key: canonicalDigest({ actorId, idempotencyKey: body.idempotencyKey }), digest: canonicalDigest(body) };
      const existing = record.configurationReceipts.find(receipt => receipt.key === command.key);
      if (existing) {
        if (existing.digest !== command.digest) fail('MAINTENANCE_COMMAND_CONFLICT', '操作标识已用于其他配置。');
        return immutableCopy(existing.result);
      }
      if (body.expectedRevision !== record.revision) fail('MAINTENANCE_REVISION_CONFLICT', '维护配置已变化，请刷新后重试。');
      const settings = config({ ...(record.pendingSettings?.settings || record.settings), ...body.settings });
      const pendingSettings = { settings, effectiveAtMs: nextStart(options.now(), settings) };
      const result = { revision: record.revision + 1, settings: record.settings, pendingSettings };
      persist({ pendingSettings, configurationReceipts: [...record.configurationReceipts, { ...command, result }] });
      return immutableCopy(result);
    },
    async start() { closed = false; await tick(); if (!timer) { timer = setInterval(() => void tick().catch(options.onError || (() => {})), 1000); timer.unref?.(); } },
    async stop() { closed = true; if (timer) clearInterval(timer); timer = null; if (ticking) await ticking; },
  });
}

module.exports = Object.freeze({ DEFAULT_CONFIG, currentWindow, createMaintenanceWindow });
