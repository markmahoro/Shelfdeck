'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../../contracts/canonical-json');
const { writeAtomic } = require('../../../clean-runtime-operations');
const {
  createFormationRetirementHistoryIntegrityAction,
} = require('./maintenance-actions/formation-retirement-history-integrity');

function fail(code, message, details) {
  throw Object.assign(new Error(message), { code, statusCode: 409, details });
}

function previewDigestOf(preview) {
  const body = {
    schemaRef: preview.schemaRef,
    actionId: preview.actionId,
    ready: preview.ready,
    blockers: preview.blockers,
    summary: preview.summary,
  };
  if (preview.rebuildMarkers !== undefined) body.rebuildMarkers = preview.rebuildMarkers;
  if (preview.orphanReceipts !== undefined) body.orphanReceipts = preview.orphanReceipts;
  if (preview.items !== undefined) body.items = preview.items;
  return canonicalDigest(body);
}

function createOperatorMaintenance(options) {
  if (!options || typeof options.dataDir !== 'string' || typeof options.databasePath !== 'string' ||
      typeof options.Database !== 'function') {
    throw new TypeError('Operator maintenance requires dataDir, databasePath, and Database.');
  }
  const Database = options.Database;
  const now = options.now || Date.now;
  const actions = new Map();
  const root = path.join(options.dataDir, 'operator-runtime', 'maintenance');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  function register(action) {
    if (!action || typeof action.actionId !== 'string' || !action.actionId ||
        typeof action.preview !== 'function' || typeof action.apply !== 'function') {
      throw new TypeError('Maintenance action requires actionId, preview, and apply.');
    }
    if (actions.has(action.actionId)) {
      throw new Error('Duplicate maintenance action: ' + action.actionId);
    }
    actions.set(action.actionId, Object.freeze({
      actionId: action.actionId,
      title: action.title || action.actionId,
      summary: action.summary || '',
      requiresStopped: action.requiresStopped !== false,
      preview: action.preview,
      apply: action.apply,
    }));
  }

  for (const action of options.actions || [createFormationRetirementHistoryIntegrityAction()]) {
    register(action);
  }

  function requireKnown(actionId) {
    const action = actions.get(actionId);
    if (!action) fail('OPERATOR_MAINTENANCE_ACTION_UNKNOWN', '未注册的维护动作。', { actionId });
    return action;
  }

  function requireStopped(action) {
    const mode = options.runtimeMode?.();
    if (action.requiresStopped && mode !== 'stopped') {
      fail('OPERATOR_MAINTENANCE_REQUIRES_STOPPED', '请先完成安全停机后再执行该维护动作。', {
        actionId: action.actionId,
        mode,
      });
    }
  }

  function withDatabase(work) {
    const database = new Database(options.databasePath);
    try {
      database.pragma('foreign_keys = ON');
      return work(database);
    } finally {
      database.close();
    }
  }

  function readReceipt(file) {
    if (fs.lstatSync(file).isSymbolicLink()) fail('OPERATOR_MAINTENANCE_PATH_UNSAFE', '维护操作记录不安全。');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function identity(actionId, body, actor) {
    if (!body || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length > 128) {
      fail('OPERATOR_MAINTENANCE_INPUT_INVALID', '操作标识无效。');
    }
    const allowed = ['idempotencyKey', 'previewDigest', 'confirmed'];
    if (Object.keys(body).some((key) => !allowed.includes(key))) {
      fail('OPERATOR_MAINTENANCE_INPUT_INVALID', '操作包含不支持的参数。');
    }
    const id = canonicalDigest({ actorId: actor.actorId, actionId, idempotencyKey: body.idempotencyKey });
    const requestDigest = canonicalDigest({ actionId, body });
    const receiptFile = path.join(root, id + '.json');
    if (fs.existsSync(receiptFile)) {
      const receipt = readReceipt(receiptFile);
      if (receipt.requestDigest !== requestDigest) {
        fail('OPERATOR_MAINTENANCE_KEY_CONFLICT', '操作标识已用于另一项请求。');
      }
      return { id, requestDigest, receiptFile, existing: receipt };
    }
    return { id, requestDigest, receiptFile };
  }

  function list() {
    const body = {
      schemaRef: 'platform.operator-maintenance-catalog@1',
      actions: Object.freeze([...actions.values()].map((action) => Object.freeze({
        actionId: action.actionId,
        title: action.title,
        summary: action.summary,
        requiresStopped: action.requiresStopped,
      }))),
    };
    // Read-only Operator Observability status lives on the same Maintenance
    // Suite catalog surface. It never registers a destructive action here.
    if (typeof options.observabilityStatus === 'function') {
      body.observability = options.observabilityStatus();
    }
    return Object.freeze(body);
  }

  function preview(actionId) {
    const action = requireKnown(actionId);
    requireStopped(action);
    return withDatabase((database) => {
      const body = action.preview({ database, nowMs: now() });
      if (!body || body.actionId !== action.actionId) {
        fail('OPERATOR_MAINTENANCE_PREVIEW_INVALID', '维护预览结果无效。');
      }
      return Object.freeze({
        ...body,
        previewDigest: previewDigestOf(body),
      });
    });
  }

  function apply(actionId, body, actor) {
    const action = requireKnown(actionId);
    requireStopped(action);
    if (body?.confirmed !== true || typeof body.previewDigest !== 'string') {
      fail('OPERATOR_MAINTENANCE_CONFIRMATION_REQUIRED', '请核对预览清单并确认维护后果。');
    }
    const request = identity(actionId, body, actor);
    if (request.existing) return request.existing;

    const previewBody = preview(actionId);
    if (previewBody.previewDigest !== body.previewDigest) {
      fail('OPERATOR_MAINTENANCE_PREVIEW_STALE', '维护范围已变化，请重新预览并确认。');
    }
    if (!previewBody.ready) {
      fail('OPERATOR_MAINTENANCE_BLOCKED', '当前维护动作存在阻断项，不能执行。', {
        blockers: previewBody.blockers,
      });
    }

    const receipt = {
      schema: 'shelfdeck.operator-maintenance-receipt@1',
      operationId: request.id,
      actionId,
      requestDigest: request.requestDigest,
      previewDigest: previewBody.previewDigest,
      state: 'pending',
      createdAt: new Date(now()).toISOString(),
    };
    writeAtomic(request.receiptFile, receipt);

    try {
      const result = withDatabase((database) => action.apply(previewBody, {
        database,
        actor,
        nowMs: now(),
        operationId: request.id,
      }));
      const completed = {
        ...receipt,
        state: 'completed',
        result,
        finishedAt: new Date(now()).toISOString(),
      };
      writeAtomic(request.receiptFile, completed);
      return completed;
    } catch (cause) {
      const failed = {
        ...receipt,
        state: 'failed',
        error: { code: cause.code || 'OPERATOR_MAINTENANCE_FAILED', message: cause.message },
        finishedAt: new Date(now()).toISOString(),
      };
      try { writeAtomic(request.receiptFile, failed); } catch { /* keep original throw */ }
      throw cause;
    }
  }

  return Object.freeze({
    list,
    preview,
    apply,
    register,
    actionIds: () => Object.freeze([...actions.keys()]),
  });
}

module.exports = Object.freeze({
  createOperatorMaintenance,
  previewDigestOf,
  createDefaultOperatorMaintenance(options) {
    return createOperatorMaintenance({
      ...options,
      actions: [createFormationRetirementHistoryIntegrityAction()],
    });
  },
});
