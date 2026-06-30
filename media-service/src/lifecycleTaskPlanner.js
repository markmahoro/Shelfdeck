'use strict';

const flowPlanner = require('./flowPlanner');

const USER_OPERATIONS = ['scrape', 'transcode', 'upgrade', 'delete'];

const BRIDGE_OPERATIONS = {
  metadata: ['scrape'],
  optimize: ['transcode', 'upgrade', 'delete'],
  archive: [],
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
    if (bridgeKind === 'metadata') operation = 'scrape';
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
  return flowPlanner.planFlow(input);
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
  planOperationFlow,
  bridgeKindForAction,
};
