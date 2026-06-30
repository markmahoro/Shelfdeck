'use strict';

function cleanToken(value) {
  return String(value || '').trim().toLowerCase();
}

function hasValue(value) {
  if (value === undefined || value === null || value === '') return false;
  return true;
}

function cleanObject(value = {}) {
  const result = {};
  for (const [key, entry] of Object.entries(value || {})) {
    if (!hasValue(entry)) continue;
    result[key] = entry;
  }
  return result;
}

function explicitOptimizeObjective(item = {}) {
  const objective = item.optimizeObjective || item.optimizationObjective || item.gateObjective;
  return objective && typeof objective === 'object' ? objective : null;
}

function inferOperation(item = {}, operationHint = '') {
  return cleanToken(
    (explicitOptimizeObjective(item) || {}).operationHint
    || operationHint
    || item.optimizationAction
    || item.action
  );
}

function isStrategyPlaceholder(action, reason) {
  if (!action || action === 'none') return true;
  if (action !== 'keep') return false;
  return ['新入库', '成人库新入库'].includes(String(reason || '').trim());
}

function commonObjective(input = {}) {
  return cleanObject({
    source: input.source || 'lifecycle_strategy',
    reason: input.reason || '',
    acceptableOperations: input.acceptableOperations,
    operationHint: input.operationHint,
  });
}

function resolveOptimizeObjective(item = {}, options = {}) {
  const explicit = explicitOptimizeObjective(item);
  if (explicit) {
    return cleanObject({
      ...explicit,
      source: explicit.source || 'explicit_lifecycle_objective',
      operationHint: explicit.operationHint || options.operationHint || inferOperation(item, options.operationHint),
    });
  }

  const operation = inferOperation(item, options.operationHint);
  const reason = item.reason || '';
  if (isStrategyPlaceholder(operation, reason)) {
    return cleanObject({
      kind: 'optimize_strategy_pending',
      description: 'Optimize objective has not been resolved by Lifecycle rules yet.',
      ...commonObjective({
        source: 'lifecycle_pending',
        reason,
        acceptableOperations: [],
        operationHint: operation || options.operationHint || '',
      }),
    });
  }

  if (operation === 'keep') {
    return cleanObject({
      kind: 'keep_current',
      description: 'Current media already satisfies the configured optimize objective.',
      ...commonObjective({
        reason,
        acceptableOperations: ['archive'],
        operationHint: 'keep',
      }),
    });
  }

  if (operation === 'transcode') {
    return cleanObject({
      kind: 'reduce_bitrate',
      description: 'Media should satisfy the configured bitrate or codec optimization target.',
      targetBitrate: item.targetBitrate,
      targetCodec: item.targetCodec,
      equivalentBitrate: item.equivalentBitrate,
      ...commonObjective({
        reason,
        acceptableOperations: ['transcode'],
        operationHint: 'transcode',
      }),
    });
  }

  if (operation === 'upgrade') {
    return cleanObject({
      kind: 'improve_source_quality',
      description: 'Media should be replaced by a better acceptable source.',
      targetBitrate: item.targetBitrate,
      targetCodec: item.targetCodec,
      maxSizeGB: item.maxSizeGB,
      seedPreferences: item.seedPreferences,
      ...commonObjective({
        reason,
        acceptableOperations: ['upgrade'],
        operationHint: 'upgrade',
      }),
    });
  }

  if (operation === 'delete') {
    return cleanObject({
      kind: 'remove_media',
      description: 'Media should be removed as a destructive optimize objective.',
      destructive: true,
      ...commonObjective({
        reason,
        acceptableOperations: ['delete'],
        operationHint: 'delete',
      }),
    });
  }

  if (options.operationHint) {
    return cleanObject({
      kind: cleanToken(options.operationHint) || 'unknown',
      description: 'Legacy optimize objective inferred from compatibility operation hint.',
      ...commonObjective({
        source: 'operation_hint_compatibility',
        reason,
        acceptableOperations: [cleanToken(options.operationHint)].filter(Boolean),
        operationHint: cleanToken(options.operationHint),
      }),
    });
  }

  return cleanObject({
    kind: 'unknown',
    description: 'Optimize objective could not be resolved from lifecycle facts.',
    ...commonObjective({
      source: 'unresolved',
      reason,
      acceptableOperations: [],
      operationHint: operation,
    }),
  });
}

module.exports = {
  resolveOptimizeObjective,
};
