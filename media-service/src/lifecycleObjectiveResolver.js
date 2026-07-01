'use strict';

const crypto = require('crypto');

const PERCEPTION_CONDITION_FIELDS = new Set([
  'userRating',
  'doubanRating',
  'doubanStars',
  'rating',
  'watched',
  'playCount',
  'lastPlayedAt',
  'favorite',
  'manualTier',
]);

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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      const entry = stableValue(value[key]);
      if (entry !== undefined) acc[key] = entry;
      return acc;
    }, {});
  }
  if (value === undefined) return undefined;
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function hashObject(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16);
}

function explicitOptimizeObjective(item = {}, options = {}) {
  if (options.ignoreExistingProjection) return null;
  const objective = item.optimizeObjective || item.optimizationObjective || item.gateObjective;
  return objective && typeof objective === 'object' ? objective : null;
}

function inferOperation(item = {}, operationHint = '', options = {}) {
  return cleanToken(
    (explicitOptimizeObjective(item, options) || {}).operationHint
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

function findSubLibrary(item = {}, config = {}) {
  const subLibraryId = item.subLibraryId || item.libraryId || '';
  return (config.subLibraries || []).find((sl) => sl && sl.uuid === subLibraryId) || null;
}

function findRuleTemplate(item = {}, config = {}) {
  const subLib = findSubLibrary(item, config);
  const templateId = (subLib && subLib.ruleTemplateId) || item.ruleTemplateId || 'default';
  const template = (config.ruleTemplates || []).find((tpl) => tpl && tpl.id === templateId) || null;
  return { subLibrary: subLib, template, templateId };
}

function collectConditionFields(rule = {}) {
  const fields = [];
  const groups = Array.isArray(rule.groups) ? rule.groups : [];
  for (const group of groups) {
    const conditions = Array.isArray(group) ? group : (group && Array.isArray(group.conditions) ? group.conditions : []);
    for (const condition of conditions) {
      if (Array.isArray(condition) && condition[0]) fields.push(String(condition[0]));
    }
  }
  return fields;
}

function collectPerceptionFields(template) {
  const fields = new Set();
  for (const rule of (template && template.rules) || []) {
    for (const field of collectConditionFields(rule)) {
      if (PERCEPTION_CONDITION_FIELDS.has(field)) fields.add(field);
    }
  }
  return [...fields];
}

function hasPerceptionFact(item = {}, field) {
  const facts = item.userPerceptionFacts && typeof item.userPerceptionFacts === 'object'
    ? item.userPerceptionFacts
    : {};
  if (field === 'rating') return hasValue(facts.rating) || hasValue(item.userRating) || hasValue(item.doubanRating) || hasValue(item.doubanStars);
  if (field === 'userRating') return hasValue(item.userRating);
  if (field === 'doubanRating' || field === 'doubanStars') return hasValue(item.doubanRating) || hasValue(item.doubanStars);
  if (field === 'watched') return typeof facts.watched === 'boolean' || typeof item.watched === 'boolean';
  if (field === 'playCount') return hasValue(facts.playCount) || hasValue(item.playCount);
  if (field === 'lastPlayedAt') return hasValue(facts.lastPlayedAt) || hasValue(item.lastPlayedAt);
  if (field === 'favorite') return typeof facts.favorite === 'boolean' || typeof item.favorite === 'boolean';
  if (field === 'manualTier') return hasValue(facts.manualTier) || hasValue(item.manualTier);
  return hasValue(item[field]);
}

function objectiveDerivedFrom(item = {}, config = {}) {
  const { subLibrary, templateId } = findRuleTemplate(item, config);
  return cleanObject({
    metadataStatus: item.metadataStatus,
    metadataUpdatedAt: item.metadataUpdatedAt,
    perceptionVersion: item.perceptionVersion || (item.userPerceptionFacts || {}).perceptionVersion,
    perceptionUpdatedAt: item.perceptionUpdatedAt || (item.userPerceptionFacts || {}).perceptionUpdatedAt,
    subLibraryId: item.subLibraryId || (subLibrary && subLibrary.uuid),
    ruleTemplateId: templateId,
    legacyAction: item.action,
    legacyReason: item.reason,
  });
}

function nextObjectiveVersion(item = {}, objectiveHash = '') {
  if (!objectiveHash) return null;
  const currentVersion = Number(item.objectiveVersion || item.optimizeObjectiveVersion || 0);
  const currentHash = item.objectiveHash || item.optimizeObjectiveHash || '';
  if (!currentHash) return currentVersion > 0 ? currentVersion : 1;
  if (currentHash === objectiveHash) return currentVersion > 0 ? currentVersion : 1;
  return (currentVersion > 0 ? currentVersion : 1) + 1;
}

function resolveOptimizeObjective(item = {}, options = {}) {
  const explicit = explicitOptimizeObjective(item, options);
  if (explicit) {
    return cleanObject({
      ...explicit,
      source: explicit.source || 'explicit_lifecycle_objective',
      operationHint: explicit.operationHint || options.operationHint || inferOperation(item, options.operationHint, options),
    });
  }

  if (item.targetMediaFacts && typeof item.targetMediaFacts === 'object') {
    const operation = inferOperation(item, options.operationHint, options);
    return cleanObject({
      kind: 'target_media_facts',
      description: 'Media should satisfy the configured archive-before target facts.',
      targetMediaFacts: item.targetMediaFacts,
      qualityTier: item.targetMediaFacts.qualityTier,
      targetBitrate: item.targetBitrate,
      targetCodec: item.targetCodec || item.targetMediaFacts.targetCodec,
      maxSizeGB: item.maxSizeGB || item.targetMediaFacts.maxSizeGB,
      seedPreferences: item.seedPreferences || item.targetMediaFacts.seedPreferences,
      ...commonObjective({
        reason: item.reason || '',
        acceptableOperations: ['transcode', 'upgrade'],
        operationHint: operation,
      }),
    });
  }

  const operation = inferOperation(item, options.operationHint, options);
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

function projectOptimizeObjective(item = {}, options = {}) {
  const config = options.config || {};
  const metadataComplete = item.metadataComplete === true;
  const derivedFrom = objectiveDerivedFrom(item, config);

  if (!metadataComplete) {
    return {
      optimizeObjectiveStatus: 'pending_metadata',
      optimizeObjective: null,
      objectiveHash: null,
      objectiveVersion: null,
      objectiveDerivedFrom: derivedFrom,
    };
  }

  const { template } = findRuleTemplate(item, config);
  const perceptionFields = collectPerceptionFields(template);
  const missingPerceptionFacts = perceptionFields.filter((field) => !hasPerceptionFact(item, field));
  const objective = resolveOptimizeObjective(item, options);
  const objectiveKind = cleanToken(objective && objective.kind);
  const reason = String(item.reason || '');
  let status = 'ready';
  let blockedReason = '';

  if (objectiveKind === 'optimize_strategy_pending') {
    status = missingPerceptionFacts.length > 0 ? 'pending_perception' : 'blocked_contract';
    blockedReason = status === 'pending_perception' ? 'perception_facts_missing' : 'objective_not_projected';
  } else if (objectiveKind === 'unknown') {
    status = 'blocked_contract';
    blockedReason = 'objective_unknown';
  }

  if (/无策略模板/.test(reason)) {
    status = 'blocked_contract';
    blockedReason = 'rule_template_missing';
  } else if (/策略未覆盖/.test(reason)) {
    status = missingPerceptionFacts.length > 0 ? 'pending_perception' : 'blocked_contract';
    blockedReason = status === 'pending_perception' ? 'perception_facts_missing' : 'rule_template_not_matched';
  }

  const objectiveHash = objective ? hashObject({ objective }) : null;
  return cleanObject({
    optimizeObjectiveStatus: status,
    optimizeObjective: objective || null,
    objectiveHash,
    objectiveVersion: nextObjectiveVersion(item, objectiveHash),
    objectiveDerivedFrom: derivedFrom,
    objectiveBlockedReason: blockedReason,
    objectiveMissingPerceptionFacts: missingPerceptionFacts,
  });
}

function applyOptimizeObjectiveProjection(item = {}, options = {}) {
  const projection = projectOptimizeObjective(item, options);
  Object.assign(item, projection);
  return projection;
}

module.exports = {
  resolveOptimizeObjective,
  projectOptimizeObjective,
  applyOptimizeObjectiveProjection,
};
