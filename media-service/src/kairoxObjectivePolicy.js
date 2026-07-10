'use strict';

const OPERATORS = {
  '>': (a, b) => typeof a === 'number' && a > b,
  '>=': (a, b) => typeof a === 'number' && a >= b,
  '<': (a, b) => typeof a === 'number' && a < b,
  '<=': (a, b) => typeof a === 'number' && a <= b,
  '=': (a, b) => a === b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  'not in': (a, b) => Array.isArray(b) && !b.includes(a),
  overlap: (a, b) => Array.isArray(a) && Array.isArray(b) && a.some((value) => b.includes(value)),
};

function conditionTrue(item, condition) {
  const [field, operator, value] = condition || [];
  const actual = item && item[field];
  if (actual == null && operator !== '=') return false;
  return !!(OPERATORS[operator] && OPERATORS[operator](actual, value));
}

function groupTrue(item, group) {
  const conditions = Array.isArray(group) ? group : group && group.conditions || [];
  const connector = Array.isArray(group) ? 'and' : group && group.connector || 'and';
  if (conditions.length === 0) return true;
  return connector === 'or'
    ? conditions.some((condition) => conditionTrue(item, condition))
    : conditions.every((condition) => conditionTrue(item, condition));
}

function ruleMatches(item, rule = {}) {
  const groups = rule.groups || [];
  if (groups.length === 0) return true;
  const modern = !Array.isArray(groups[0]);
  const connector = modern ? rule.groupsConnector || 'and' : rule.innerConnector === 'and' ? 'or' : 'and';
  return connector === 'or'
    ? groups.some((group) => groupTrue(item, group))
    : groups.every((group) => groupTrue(item, group));
}

function applyObjectivePolicy(item = {}, config = {}) {
  const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === item.subLibraryId);
  const templateId = subLibrary && subLibrary.ruleTemplateId || 'default';
  const template = (config.ruleTemplates || []).find((entry) => entry.id === templateId);
  if (!template || !Array.isArray(template.rules)) return { ...item, reason: '无策略模板' };
  let matched = null;
  for (const rule of [...template.rules].sort((a, b) => (a.priority || 0) - (b.priority || 0))) {
    if (ruleMatches(item, rule)) matched = rule;
  }
  if (!matched) return { ...item, reason: '策略未覆盖' };
  return {
    ...item,
    reason: matched.reason || '',
    targetMediaFacts: matched.targetMediaFacts && typeof matched.targetMediaFacts === 'object' ? { ...matched.targetMediaFacts } : {},
    targetCodec: matched.targetMediaFacts && (matched.targetMediaFacts.targetCodec || matched.targetMediaFacts.codec) || '',
    maxSizeGB: matched.targetMediaFacts && matched.targetMediaFacts.maxSizeGB,
    seedPreferences: matched.targetMediaFacts && matched.targetMediaFacts.seedPreferences,
  };
}

module.exports = { applyObjectivePolicy, conditionTrue, ruleMatches };
