'use strict';

const businessFlowPolicy = require('./businessFlowPolicy');

function canCreateTask({ item, itemInfo, operationKind, source, config, tasks, optimizationIndex }) {
  return businessFlowPolicy.evaluateOperation({
    item,
    itemInfo,
    operationKind,
    source,
    config,
    tasks,
    optimizationIndex,
  });
}

function canCreateManualIntent({ item, itemInfo, operationKind, bridgeKind, preferredOperation, intent, config, tasks, optimizationIndex }) {
  return businessFlowPolicy.evaluateManualIntent({
    item,
    itemInfo,
    operationKind,
    bridgeKind,
    preferredOperation,
    intent,
    source: 'manual',
    config,
    tasks,
    optimizationIndex,
  });
}

module.exports = {
  canCreateTask,
  canCreateManualIntent,
};
