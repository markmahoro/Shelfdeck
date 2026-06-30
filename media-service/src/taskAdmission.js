'use strict';

const businessFlowPolicy = require('./businessFlowPolicy');

function canCreateTask({ item, itemInfo, actionType, source, config, tasks, optimizationIndex }) {
  return businessFlowPolicy.evaluateOperation({
    item,
    itemInfo,
    actionType,
    source,
    config,
    tasks,
    optimizationIndex,
  });
}

function canCreateManualIntent({ item, itemInfo, actionType, bridgeKind, preferredOperation, intent, config, tasks, optimizationIndex }) {
  return businessFlowPolicy.evaluateManualIntent({
    item,
    itemInfo,
    actionType,
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
