'use strict';

const flowPlanner = require('./flowPlanner');

const USER_OPERATIONS = ['ingest', 'scrape', 'transcode', 'upgrade', 'delete', 'archive'];

const BRIDGE_OPERATIONS = {
  ingest: ['ingest'],
  metadata: ['scrape'],
  optimize: ['transcode', 'upgrade', 'delete'],
  archive: ['archive'],
};

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

function blocked(operation, reason, extra = {}) {
  return { operation, allowed: false, reason, ...extra };
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

function cleanObject(value = {}) {
  const result = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === undefined || entry === null || entry === '') continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    result[key] = entry;
  }
  return result;
}

function objectiveForOperation(actionType, itemInfo = {}) {
  const operation = cleanToken(actionType);
  if (operation === 'ingest') {
    return {
      kind: 'managed_item',
      description: 'External source candidate becomes a managed ShelfDeck media item.',
      acceptableOperations: ['ingest'],
    };
  }
  if (operation === 'scrape') {
    const metadataKind = cleanToken(itemInfo.metadataKind || (itemInfo.source === 'adult_folder' ? 'adult' : 'standard'));
    return cleanObject({
      kind: 'metadata_complete',
      description: 'Item has enough user-semantic metadata to enter optimize.',
      metadataKind,
      repairMode: itemInfo.source === 'emby' || metadataKind === 'emby' ? 'emby_repair' : 'scrape',
      acceptableOperations: ['scrape'],
    });
  }
  if (operation === 'transcode') {
    return cleanObject({
      kind: 'reduce_bitrate',
      description: 'Media should satisfy the configured bitrate or codec optimization target.',
      targetBitrate: itemInfo.targetBitrate,
      targetCodec: itemInfo.targetCodec,
      equivalentBitrate: itemInfo.equivalentBitrate,
      acceptableOperations: ['transcode'],
      operationHint: 'transcode',
    });
  }
  if (operation === 'upgrade') {
    return cleanObject({
      kind: 'improve_source_quality',
      description: 'Media should be replaced by a better acceptable source.',
      maxSizeGB: itemInfo.maxSizeGB,
      seedPreferences: itemInfo.seedPreferences,
      acceptableOperations: ['upgrade'],
      operationHint: 'upgrade',
    });
  }
  if (operation === 'delete') {
    return {
      kind: 'remove_media',
      description: 'Media should be removed as a destructive optimize objective.',
      destructive: true,
      acceptableOperations: ['delete'],
      operationHint: 'delete',
    };
  }
  if (operation === 'archive') {
    return {
      kind: 'finalize_lifecycle',
      description: 'Optimized-like result is accepted and the lifecycle closes for this item.',
      acceptableOperations: ['archive'],
    };
  }
  return cleanObject({
    kind: operation || 'unknown',
    description: 'Legacy task objective inferred from compatibility operation.',
    acceptableOperations: operation ? [operation] : [],
    operationHint: operation,
  });
}

function planTaskTarget(input = {}) {
  const itemInfo = input.itemInfo && typeof input.itemInfo === 'object' ? input.itemInfo : {};
  const actionType = cleanToken(input.actionType || input.operation);
  const bridgeKind = cleanToken(input.bridgeKind) || bridgeKindForAction(actionType);
  const itemId = String(input.itemId || itemInfo.itemId || '');
  return {
    object: {
      type: 'media_item',
      itemId,
      subLibraryId: itemInfo.subLibraryId || '',
    },
    targetGate: bridgeKind,
    gateObjective: objectiveForOperation(actionType, itemInfo),
    source: input.source || '',
    operationHint: actionType,
  };
}

function selectStrategyOperation(item = {}) {
  const operation = cleanToken(item.action);
  if (!operation || operation === 'keep' || operation === 'none') {
    return blocked(operation, 'no_automatic_task_required');
  }
  if (!USER_OPERATIONS.includes(operation)) {
    return blocked(operation, 'unsupported_recommended_operation');
  }
  return {
    allowed: true,
    operation,
    actionType: operation,
    bridgeKind: flowPlanner.bridgeKindForAction(operation),
    planningMode: 'strategy_result',
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

  const supportedOperations = BRIDGE_OPERATIONS[bridgeKind];
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
    if (bridgeKind === 'ingest') operation = 'ingest';
    else if (bridgeKind === 'metadata') operation = 'scrape';
    else if (bridgeKind === 'archive') operation = 'archive';
    else {
      const strategy = selectStrategyOperation(item);
      if (strategy.allowed && strategy.bridgeKind === bridgeKind && supportedOperations.includes(strategy.operation)) {
        operation = strategy.operation;
      }
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

function planOperationFlow(input = {}) {
  const planned = flowPlanner.planFlow(input);
  return {
    ...planned,
    taskTarget: planTaskTarget({
      ...input,
      bridgeKind: planned.taskBridge && planned.taskBridge.kind,
    }),
  };
}

function bridgeKindForAction(actionType) {
  return flowPlanner.bridgeKindForAction(actionType);
}

module.exports = {
  USER_OPERATIONS,
  BRIDGE_OPERATIONS,
  cleanToken,
  selectStrategyOperation,
  resolveManualOperationIntent,
  planTaskTarget,
  objectiveForOperation,
  planOperationFlow,
  bridgeKindForAction,
};
