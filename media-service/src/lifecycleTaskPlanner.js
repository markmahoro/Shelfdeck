'use strict';

const flowPlanner = require('./flowPlanner');
const lifecycleObjectiveResolver = require('./lifecycleObjectiveResolver');

const USER_OPERATIONS = ['ingest', 'scrape', 'transcode', 'upgrade', 'delete', 'archive'];

const BRIDGE_OPERATIONS = {
  ingest: ['ingest'],
  metadata: ['scrape'],
  optimize: ['transcode', 'upgrade'],
  archive: ['archive'],
  delete: ['delete'],
};

function cleanToken(value) {
  return String(value || '').trim().toLowerCase();
}

function requestedIntent(input = {}) {
  const nested = input.intent && typeof input.intent === 'object' ? input.intent : {};
  return {
    bridgeKind: cleanToken(input.bridgeKind || nested.bridgeKind),
    preferredOperation: cleanToken(input.preferredOperation || nested.preferredOperation),
    operationKind: cleanToken(input.operationKind || input.operation || nested.operationKind || nested.operation),
  };
}

function blocked(operation, reason, extra = {}) {
  return { operation, allowed: false, reason, ...extra };
}

function intentResult(operation, bridgeKind, intentMode, intent) {
  return {
    allowed: true,
    operation,
    operationKind: operation,
    bridgeKind,
    preferredOperation: intent.preferredOperation || '',
    intentMode,
    requestedIntent: {
      bridgeKind: intent.bridgeKind || bridgeKind,
      preferredOperation: intent.preferredOperation || '',
      operationKind: intent.operationKind || '',
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

function objectiveForOperation(operationKind, itemInfo = {}) {
  const operation = cleanToken(operationKind);
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
    return lifecycleObjectiveResolver.resolveOptimizeObjective(itemInfo, { operationHint: 'transcode' });
  }
  if (operation === 'upgrade') {
    return lifecycleObjectiveResolver.resolveOptimizeObjective(itemInfo, { operationHint: 'upgrade' });
  }
  if (operation === 'delete') {
    return cleanObject({
      kind: 'delete_archived_media',
      description: 'Archived media item is eligible for delete gate disposal after user review.',
      acceptableOperations: ['delete'],
      archivedAt: itemInfo.archiveDoneAt || '',
      deleteCandidate: itemInfo.deleteCandidate || null,
    });
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
  const operationKind = cleanToken(input.operationKind || input.operation);
  const bridgeKind = cleanToken(input.targetGate || input.bridgeKind) || bridgeKindForAction(operationKind);
  const itemId = String(input.itemId || itemInfo.itemId || '');
  const explicitGateObjective = input.gateObjective && typeof input.gateObjective === 'object' ? input.gateObjective : null;
  const gateObjective = explicitGateObjective || (bridgeKind === 'optimize'
    ? lifecycleObjectiveResolver.resolveOptimizeObjective(itemInfo, { operationHint: operationKind })
    : objectiveForOperation(operationKind, itemInfo));
  return {
    object: {
      type: 'media_item',
      itemId,
      subLibraryId: itemInfo.subLibraryId || '',
    },
    targetGate: bridgeKind,
    gateObjective,
    source: input.source || '',
    operationHint: operationKind,
  };
}

function selectStrategyOperation(item = {}, options = {}) {
  const hasObjective = item && item.optimizeObjective && typeof item.optimizeObjective === 'object';
  if (hasObjective || item.optimizeObjectiveStatus) {
    const selection = flowPlanner.selectOptimizeFlow({
      itemInfo: item,
      optimizeObjective: item.optimizeObjective,
      optimizeObjectiveStatus: item.optimizeObjectiveStatus,
      objectiveHash: item.objectiveHash,
      allowedOperations: options.allowedOptimizeOperations,
      flowSafetyFacts: options.flowSafetyFacts,
    });
    if (selection.selectedOperation === 'no_op') {
      return blocked('', 'objective_already_satisfied', {
        planningMode: 'objective_gap_analysis',
        flowSelection: selection,
      });
    }
    if (!selection.allowed) {
      return blocked(selection.operation || selection.selectedOperation || '', selection.blockedReason || selection.reason, {
        planningMode: 'objective_gap_analysis',
        flowSelection: selection,
      });
    }
    const operation = cleanToken(selection.operation || selection.selectedOperation);
    if (!USER_OPERATIONS.includes(operation)) {
      return blocked(operation, 'unsupported_recommended_operation', {
        planningMode: 'objective_gap_analysis',
        flowSelection: selection,
      });
    }
    return {
      allowed: true,
      operation,
      operationKind: operation,
      bridgeKind: flowPlanner.bridgeKindForAction(operation),
      planningMode: 'objective_gap_analysis',
      flowSelection: selection,
    };
  }

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
    operationKind: operation,
    bridgeKind: flowPlanner.bridgeKindForAction(operation),
    planningMode: 'strategy_result',
  };
}

function resolveManualOperationIntent(input = {}) {
  const intent = requestedIntent(input);
  const item = input.item || input.itemInfo || {};
  const bridgeKind = intent.bridgeKind;
  const preferred = intent.preferredOperation;
  const operationKind = intent.operationKind;

  if (!bridgeKind) {
    if (!operationKind) return blocked('', 'missing_task_intent');
    if (!USER_OPERATIONS.includes(operationKind)) return blocked(operationKind, 'invalid_operation_kind');
    return intentResult(operationKind, flowPlanner.bridgeKindForAction(operationKind), 'operation_kind', intent);
  }

  const supportedOperations = BRIDGE_OPERATIONS[bridgeKind];
  if (!supportedOperations) {
    return blocked(operationKind || preferred, 'invalid_bridge_kind', { bridgeKind });
  }

  if (operationKind && !USER_OPERATIONS.includes(operationKind)) {
    return blocked(operationKind, 'invalid_operation_kind', { bridgeKind });
  }
  if (preferred && !USER_OPERATIONS.includes(preferred)) {
    return blocked(preferred, 'invalid_preferred_operation', { bridgeKind });
  }
  if (operationKind && preferred && operationKind !== preferred) {
    return blocked(operationKind, 'conflicting_task_intent', {
      bridgeKind,
      preferredOperation: preferred,
      operationKind,
    });
  }

  let operation = preferred || operationKind || '';
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
  const taskTarget = planTaskTarget(input);
  const planned = flowPlanner.planFlow({
    ...input,
    taskTarget,
    gateObjective: taskTarget.gateObjective,
  });
  return {
    ...planned,
    taskTarget: {
      ...taskTarget,
      targetGate: taskTarget.targetGate || (planned.taskBridge && planned.taskBridge.kind),
    },
  };
}

function bridgeKindForAction(operationKind) {
  return flowPlanner.bridgeKindForAction(operationKind);
}

module.exports = {
  USER_OPERATIONS,
  BRIDGE_OPERATIONS,
  cleanToken,
  selectStrategyOperation,
  resolveManualOperationIntent,
  planTaskTarget,
  objectiveForOperation,
  resolveOptimizeObjective: lifecycleObjectiveResolver.resolveOptimizeObjective,
  planOperationFlow,
  bridgeKindForAction,
};
