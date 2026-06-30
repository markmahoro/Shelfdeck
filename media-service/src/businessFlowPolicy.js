'use strict';

const optimizationStatus = require('./optimizationStatus');
const metadataStatus = require('./metadataStatus');
const flowPlanner = require('./flowPlanner');

const TERMINAL = new Set(['done', 'failed_hard', 'cancelled', 'skipped', 'deleted']);
const USER_OPERATIONS = ['scrape', 'transcode', 'upgrade', 'delete'];
const MANUAL_INTENT_OPERATIONS = {
  metadata: ['scrape'],
  optimize: ['transcode', 'upgrade'],
  archive: ['delete'],
};

function actionCooldownMs(config, actionType) {
  const cfg = config && config.taskAdmission || {};
  const byAction = cfg.cooldownHoursByAction || {};
  const hours = typeof byAction[actionType] === 'number'
    ? byAction[actionType]
    : (typeof cfg.defaultCooldownHours === 'number' ? cfg.defaultCooldownHours : 48);
  return Math.max(0, hours) * 3600 * 1000;
}

function lastActionDoneAt(item, actionType) {
  if (!item) return null;
  if (actionType === 'transcode' && item.lastTranscodeDoneAt) return item.lastTranscodeDoneAt;
  if (actionType === 'upgrade' && item.lastUpgradeDoneAt) return item.lastUpgradeDoneAt;
  if (item.lastTaskDoneAt) return item.lastTaskDoneAt;
  return null;
}

function lastTerminalTaskAt(tasks, itemId, actionType) {
  if (!itemId) return null;
  let latest = null;
  for (const task of tasks || []) {
    if (!task || task.itemId !== itemId || task.actionType !== actionType) continue;
    if (!TERMINAL.has(task.status)) continue;
    const at = task.updatedAt || task.createdAt;
    if (!at) continue;
    if (!latest || new Date(at).getTime() > new Date(latest).getTime()) latest = at;
  }
  return latest;
}

function activeTaskForItem(tasks, itemId) {
  return (tasks || []).find((t) => t && t.itemId === itemId && !TERMINAL.has(t.status));
}

function queuedCountForAction(tasks, actionType) {
  return (tasks || []).filter((t) => t && t.actionType === actionType && !TERMINAL.has(t.status)).length;
}

function queueLimit(config, actionType) {
  const cfg = config && config.taskAdmission || {};
  const byAction = cfg.maxQueuedByAction || {};
  const raw = byAction[actionType] !== undefined ? byAction[actionType] : cfg.defaultMaxQueued;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function enabledAutoActions(config) {
  return Array.isArray(config && config.smartTaskEnabledActions)
    ? config.smartTaskEnabledActions
    : [];
}

function subLibraryFor(info, config) {
  const subLibs = (config && config.subLibraries) || [];
  return subLibs.find((sl) => sl.uuid === (info && info.subLibraryId)) || null;
}

function isStandardMediaItem(info, config) {
  if (!info) return false;
  if (info.source === 'emby' || info.metadataKind === 'emby') return true;
  const subLib = subLibraryFor(info, config || {});
  if (!subLib) return false;
  return subLib.source === 'emby' || subLib.mediaType === 'movie' || subLib.mediaType === 'tv';
}

function isAdultFolderItem(info, config) {
  if (!info) return false;
  const adultMeta = info.adultMetadata || {};
  if (info.source === 'adult_folder' || info.mediaType === 'adult' || info.metadataKind === 'adult') return true;
  if (adultMeta.region || adultMeta.scrapeStatus !== undefined || adultMeta.adultId) return true;
  const subLib = subLibraryFor(info, config || {});
  return !!(subLib && (subLib.source === 'folder' || subLib.mediaType === 'adult'));
}

function isAutoScrapeCandidate(info) {
  if (!info || info.scraped === true) return false;
  const adultMeta = info.adultMetadata || {};
  const status = String(adultMeta.scrapeStatus || '').toLowerCase();
  return status === '' || status === 'pending';
}

function isSupportedAutomaticItem(item) {
  if (!item) return false;
  return item.source === 'emby' || item.source === 'adult_folder';
}

function isTaskMediaItem(item) {
  return String((item && item.type) || '').toLowerCase() !== 'series';
}

function blocked(actionType, reason, extra = {}) {
  return { operation: actionType, allowed: false, reason, ...extra };
}

function cleanToken(value) {
  return String(value || '').trim().toLowerCase();
}

function requestedIntent(input = {}) {
  const nested = input.intent && typeof input.intent === 'object' ? input.intent : {};
  return {
    bridgeKind: cleanToken(input.bridgeKind || nested.bridgeKind),
    preferredOperation: cleanToken(input.preferredOperation || nested.preferredOperation),
    actionType: cleanToken(input.actionType || input.operation || nested.actionType || nested.operation),
  };
}

function intentResult(operation, bridgeKind, intentMode, intent) {
  return {
    allowed: true,
    operation,
    actionType: operation,
    bridgeKind,
    preferredOperation: intent.preferredOperation || '',
    intentMode,
    requestedIntent: {
      bridgeKind: intent.bridgeKind || bridgeKind,
      preferredOperation: intent.preferredOperation || '',
      actionType: intent.actionType || '',
    },
  };
}

function resolveManualOperationIntent(input = {}) {
  const intent = requestedIntent(input);
  const item = input.item || input.itemInfo || {};
  const bridgeKind = intent.bridgeKind;
  const preferred = intent.preferredOperation;
  const actionType = intent.actionType;

  if (!bridgeKind) {
    if (!actionType) return blocked('', 'missing_task_intent');
    if (!USER_OPERATIONS.includes(actionType)) return blocked(actionType, 'invalid_action_type');
    return intentResult(actionType, flowPlanner.bridgeKindForAction(actionType), 'action_type_compatibility', intent);
  }

  const supportedOperations = MANUAL_INTENT_OPERATIONS[bridgeKind];
  if (!supportedOperations) {
    return blocked(actionType || preferred, 'invalid_bridge_kind', { bridgeKind });
  }

  if (actionType && !USER_OPERATIONS.includes(actionType)) {
    return blocked(actionType, 'invalid_action_type', { bridgeKind });
  }
  if (preferred && !USER_OPERATIONS.includes(preferred)) {
    return blocked(preferred, 'invalid_preferred_operation', { bridgeKind });
  }
  if (actionType && preferred && actionType !== preferred) {
    return blocked(actionType, 'conflicting_task_intent', {
      bridgeKind,
      preferredOperation: preferred,
      actionType,
    });
  }

  let operation = preferred || actionType || '';
  if (operation && !supportedOperations.includes(operation)) {
    return blocked(operation, 'preferred_operation_bridge_mismatch', {
      bridgeKind,
      preferredOperation: operation,
      supportedOperations,
    });
  }

  if (!operation) {
    if (bridgeKind === 'metadata') operation = 'scrape';
    else {
      const recommended = cleanToken(item.action);
      if (supportedOperations.includes(recommended)) operation = recommended;
    }
  }

  if (!operation) {
    return blocked('', 'preferred_operation_required', {
      bridgeKind,
      supportedOperations,
    });
  }

  return intentResult(operation, bridgeKind, 'bridge_intent', intent);
}

function evaluateManualIntent(input = {}) {
  const resolved = resolveManualOperationIntent(input);
  if (!resolved.allowed) return resolved;
  const decision = evaluateOperation({
    ...input,
    actionType: resolved.operation,
    operation: resolved.operation,
    source: 'manual',
  });
  return {
    ...decision,
    actionType: resolved.operation,
    bridgeKind: resolved.bridgeKind,
    preferredOperation: resolved.preferredOperation,
    intentMode: resolved.intentMode,
    requestedIntent: resolved.requestedIntent,
  };
}

function resolveAutomaticTrigger(input = {}) {
  const cfg = input.config || {};
  const item = input.item || input.itemInfo || {};
  const itemId = item && item.itemId || '';
  if (!itemId) return blocked('', 'missing_item_id');
  if (!isSupportedAutomaticItem(item)) return blocked('', 'unsupported_source');
  if (!isTaskMediaItem(item)) return blocked('', 'series_not_task_item');

  const meta = metadataStatus.resolveMetadataStatus(item, cfg);
  const itemWithMetadata = { ...item, ...meta };

  if (!meta.metadataComplete) {
    if (meta.metadataKind === 'adult' && !isAutoScrapeCandidate(itemWithMetadata)) {
      return blocked('scrape', 'scrape_state_not_auto_eligible', {
        item: itemWithMetadata,
        metadataMissingReasons: meta.metadataMissingReasons,
      });
    }
    if (meta.metadataKind !== 'adult' && item.source !== 'emby') {
      return blocked('scrape', 'metadata_not_auto_repairable', {
        item: itemWithMetadata,
        metadataMissingReasons: meta.metadataMissingReasons,
      });
    }
    if (!enabledAutoActions(cfg).includes('scrape')) {
      return blocked('scrape', 'action_not_enabled', {
        item: itemWithMetadata,
        metadataMissingReasons: meta.metadataMissingReasons,
      });
    }
    return {
      allowed: true,
      reason: 'metadata_gate_not_met',
      operation: 'scrape',
      actionType: 'scrape',
      bridgeKind: 'metadata',
      item: itemWithMetadata,
      metadataMissingReasons: meta.metadataMissingReasons,
    };
  }

  const operation = cleanToken(item.action);
  if (!operation || operation === 'keep' || operation === 'none') {
    return blocked(operation, 'no_automatic_task_required', { item: itemWithMetadata });
  }
  if (!USER_OPERATIONS.includes(operation)) {
    return blocked(operation, 'unsupported_recommended_operation', { item: itemWithMetadata });
  }
  if (!enabledAutoActions(cfg).includes(operation)) {
    return blocked(operation, 'action_not_enabled', { item: itemWithMetadata });
  }

  return {
    allowed: true,
    reason: 'lifecycle_gate_met',
    operation,
    actionType: operation,
    bridgeKind: flowPlanner.bridgeKindForAction(operation),
    item: itemWithMetadata,
  };
}

function evaluateOperation(input = {}) {
  const cfg = input.config || {};
  const actionType = String(input.actionType || input.operation || '');
  const source = input.source || 'manual';
  const info = input.itemInfo || input.item || {};
  const item = input.item || info;
  const tasks = input.tasks || [];
  const itemId = info.itemId || (item && item.itemId) || '';

  if (!itemId) return blocked(actionType, 'missing_item_id');

  const active = activeTaskForItem(tasks, itemId);
  if (active) {
    return blocked(actionType, 'active_task_exists', {
      activeTaskId: active.id,
      activeTaskBridge: active.taskBridge && active.taskBridge.kind,
      activeFlowOperation: active.flowPlan && active.flowPlan.operationKind,
    });
  }

  const manual = source === 'manual';
  const automatic = !manual;
  if (automatic && !enabledAutoActions(cfg).includes(actionType)) {
    return blocked(actionType, 'action_not_enabled');
  }

  if (actionType === 'scrape') {
    if (isStandardMediaItem(info, cfg)) {
      const meta = metadataStatus.resolveMetadataStatus(item || info, cfg);
      if (meta.metadataComplete) {
        return blocked(actionType, 'metadata_already_complete');
      }
    }
    if (isAdultFolderItem(info, cfg) && automatic && !isAutoScrapeCandidate(info)) {
      return blocked(actionType, 'scrape_state_not_auto_eligible');
    }
  }

  if (actionType === 'upgrade' && item && item.isDiscLike) {
    return blocked(actionType, 'upgrade_not_supported_for_disc_like_source');
  }

  if (!manual) {
    const lastDoneAt = lastActionDoneAt(item || info, actionType) || lastTerminalTaskAt(tasks, itemId, actionType);
    const cooldown = actionCooldownMs(cfg, actionType);
    if (lastDoneAt && cooldown > 0) {
      const nextEligibleAtMs = new Date(lastDoneAt).getTime() + cooldown;
      if (Date.now() < nextEligibleAtMs) {
        return blocked(actionType, 'recent_task_cooldown', {
          nextEligibleAt: new Date(nextEligibleAtMs).toISOString(),
        });
      }
    }

    const limit = queueLimit(cfg, actionType);
    if (limit !== null && queuedCountForAction(tasks, actionType) >= limit) {
      return blocked(actionType, 'queue_limit', { limit });
    }

    if (actionType === 'transcode') {
      const opt = optimizationStatus.resolveOptimization(
        item || info,
        input.optimizationIndex || optimizationStatus.buildOptimizationIndex(tasks, cfg),
        cfg,
      );
      if (opt.optimizationStatus === 'transcoded') {
        return blocked(actionType, 'already_transcoded');
      }
    }
  }

  if (['delete', 'transcode', 'upgrade'].includes(actionType)) {
    const meta = metadataStatus.resolveMetadataStatus(item || info, cfg);
    if (!meta.metadataComplete) {
      return blocked(actionType, 'metadata_missing', {
        metadataMissingReasons: meta.metadataMissingReasons,
      });
    }
  }

  return {
    operation: actionType,
    allowed: true,
    reason: 'allowed',
    ...flowPlanner.planFlow({ actionType, source, itemId, itemInfo: info }),
  };
}

function compactOperationDecision(decision) {
  const bridgeKind = decision.taskBridge && decision.taskBridge.kind;
  const operationKind = decision.flowPlan && decision.flowPlan.operationKind;
  const result = {
    operation: decision.operation || operationKind || '',
    bridgeKind,
    flowOperation: operationKind,
  };
  Object.keys(result).forEach((key) => {
    if (result[key] === undefined || result[key] === null || result[key] === '') delete result[key];
  });
  return result;
}

function summarizeActiveTask(task) {
  if (!task) return null;
  return {
    kind: 'active_task',
    taskId: task.id,
    status: task.status,
    phase: task.phase || '',
    resumePoint: task.resumePoint || '',
    bridgeKind: task.taskBridge && task.taskBridge.kind,
    flowOperation: task.flowPlan && task.flowPlan.operationKind,
    primaryResourceType: task.flowPlan && task.flowPlan.primaryResourceType,
    updatedAt: task.updatedAt || task.createdAt || '',
  };
}

function failureEventForItem(eventsByItem, itemId) {
  if (!eventsByItem || !itemId) return null;
  if (eventsByItem instanceof Map) return eventsByItem.get(itemId) || null;
  if (Array.isArray(eventsByItem)) return eventsByItem.find((event) => event && event.itemId === itemId) || null;
  return eventsByItem[itemId] || null;
}

function summarizeFailureEvent(event) {
  if (!event) return null;
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const embedded = payload.failureSummary && typeof payload.failureSummary === 'object'
    ? payload.failureSummary
    : null;
  const message = embedded && embedded.message
    || payload.errorMessage
    || payload.message
    || payload.error
    || payload.reason
    || '';
  return {
    kind: 'failure_event',
    eventId: event.id || '',
    taskId: event.taskId || '',
    itemId: event.itemId || '',
    eventType: event.eventType || '',
    status: event.eventStatus || '',
    phase: event.phase || '',
    resumePoint: event.resumePoint || '',
    bridgeKind: event.bridgeKind || payload.bridgeKind || '',
    flowOperation: event.operationKind || payload.operationKind || payload.flowOperation || '',
    primaryResourceType: payload.primaryResourceType || payload.resourceType || event.resourceType || '',
    failureSummary: {
      message: String(message || ''),
      level: String(embedded && embedded.level || (message ? 'error' : '')),
      ts: String(embedded && embedded.ts || event.createdAt || ''),
      source: String(embedded && embedded.source || (message ? 'event_payload' : '')),
      errorName: String(payload.errorName || ''),
    },
    updatedAt: event.createdAt || '',
  };
}

function buildItemDecision(input = {}) {
  const item = input.item || {};
  const cfg = input.config || {};
  const tasks = input.tasks || [];
  const itemId = item.itemId || '';
  const activeTask = activeTaskForItem(tasks, itemId);
  const operations = input.operations || USER_OPERATIONS;
  const allowedOperations = [];
  const blockedOperations = [];
  const blockedReasons = {};

  for (const operation of operations) {
    const decision = evaluateOperation({
      item,
      itemInfo: item,
      actionType: operation,
      source: 'manual',
      config: cfg,
      tasks,
      optimizationIndex: input.optimizationIndex,
    });
    if (decision.allowed) {
      allowedOperations.push(compactOperationDecision(decision));
    } else {
      const blockedItem = {
        operation,
        reason: decision.reason,
      };
      if (decision.metadataMissingReasons) blockedItem.metadataMissingReasons = decision.metadataMissingReasons;
      if (decision.supportedEntry) blockedItem.supportedEntry = decision.supportedEntry;
      if (decision.activeTaskId) blockedItem.activeTaskId = decision.activeTaskId;
      blockedOperations.push(blockedItem);
      blockedReasons[operation] = decision.reason;
    }
  }

  const rawRecommended = typeof item.action === 'string' && item.action ? item.action : null;
  const recommendedOperation = rawRecommended && rawRecommended !== 'keep'
    ? rawRecommended
    : (item.lifecycleDone ? 'keep' : null);
  const recommendedAllowed = recommendedOperation
    ? allowedOperations.find((op) => op.operation === recommendedOperation) || null
    : null;
  const nextBridge = (recommendedAllowed && recommendedAllowed.bridgeKind)
    || item.lifecycleNextTask
    || null;
  const activeSummary = summarizeActiveTask(activeTask);
  const failureSummary = summarizeFailureEvent(failureEventForItem(input.latestFailureEventsByItem, itemId));
  const latestEventSummary = activeSummary || failureSummary;

  return {
    lifecycleStage: item.lifecycleStage || '',
    lifecycleDone: !!item.lifecycleDone,
    metadataStatus: item.metadataStatus || '',
    optimizationStatus: item.optimizationStatus || 'none',
    archiveStatus: item.archiveStatus || '',
    nextBridge,
    recommendedOperation,
    allowedOperations,
    blockedOperations,
    blockedReasons,
    activeTaskBridge: activeSummary && activeSummary.bridgeKind || null,
    activeFlowOperation: activeSummary && activeSummary.flowOperation || null,
    latestEventSummary,
    diagnosticSummary: failureSummary || blockedOperations.length > 0
      ? {
        primaryBlockedReason: blockedOperations[0] && blockedOperations[0].reason || null,
        blockedOperationCount: blockedOperations.length,
        latestFailure: failureSummary && failureSummary.failureSummary || null,
      }
      : null,
  };
}

function decorateItem(item, input = {}) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    businessFlowDecision: buildItemDecision({
      ...input,
      item,
    }),
  };
}

function decorateItems(items, input = {}) {
  return (items || []).map((item) => decorateItem(item, input));
}

module.exports = {
  USER_OPERATIONS,
  evaluateOperation,
  resolveAutomaticTrigger,
  resolveManualOperationIntent,
  evaluateManualIntent,
  buildItemDecision,
  decorateItem,
  decorateItems,
  activeTaskForItem,
  isStandardMediaItem,
  isAdultFolderItem,
  isAutoScrapeCandidate,
};
