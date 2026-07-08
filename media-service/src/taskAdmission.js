'use strict';

const taskCreationPolicy = require('./taskCreationPolicy');

function canCreateTask(input = {}) {
  return taskCreationPolicy.canCreateTargetTask(input);
}

function canCreateManualIntent(input = {}) {
  const intent = input.intent && typeof input.intent === 'object' ? input.intent : {};
  return taskCreationPolicy.canCreateTargetTask({
    ...input,
    targetGate: input.targetGate || intent.targetGate,
    gateObjective: input.gateObjective || intent.gateObjective,
    source: 'manual',
  });
}

module.exports = {
  canCreateTask,
  canCreateManualIntent,
};
