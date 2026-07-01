'use strict';

const DEFAULT_EMBY_GATE = {
  all: [
    'identity.itemId',
    'identity.externalId',
    'identity.name',
    'identity.seriesName',
    'identity.seasonNumber',
    'media.path',
    'media.size',
    'media.duration',
    'media.bitrate',
    'media.resolution',
    'media.codec',
  ],
};

const DEFAULT_ADULT_GATE = {
  all: [
    'adult.scraped',
    'adult.scrapeStatus',
    'adult.adultId',
    'adult.title',
    'adult.protagonist',
    'media.path',
    'media.size',
    'media.duration',
    'media.bitrate',
    'media.resolution',
    'media.codec',
  ],
};

const LEGACY_PERCEPTION_GATE_FIELDS = new Set([
  'decision.watched',
  'decision.rating',
  'decision.userRating',
  'decision.doubanRating',
]);

const LEGACY_GATE_FIELD_REWRITES = {
  'decision.providerId': 'identity.providerId',
};

function hasText(value) {
  return String(value == null ? '' : value).trim().length > 0;
}

function hasPositiveNumber(value) {
  return Number(value) > 0;
}

function hasRating(item) {
  return item && (item.userRating != null || item.doubanRating != null || item.doubanStars != null);
}

function hasUserRating(item) {
  return item && item.userRating != null;
}

function hasDoubanRating(item) {
  return item && (item.doubanRating != null || item.doubanStars != null);
}

function hasWatchedState(item) {
  return item && (item.watched === true || item.watched === false);
}

function hasExternalIdentity(item) {
  if (!item) return false;
  if (hasText(item.tmdbId) || hasText(item.doubanId)) return true;
  const refs = item.externalRefs || {};
  const emby = refs.emby || {};
  const providerIds = emby.providerIds || item.providerIds || {};
  return hasText(item.sourceId)
    || hasText(emby.id)
    || hasText(providerIds.Tmdb)
    || hasText(providerIds.TMDB)
    || hasText(providerIds.Douban);
}

function subLibraryFor(item, config) {
  const subLibs = (config && config.subLibraries) || [];
  return subLibs.find((sl) => sl.uuid === (item && item.subLibraryId)) || null;
}

function mediaKind(item, subLib) {
  const source = (item && item.source) || (subLib && subLib.source) || 'emby';
  const mediaType = (subLib && subLib.mediaType) || (item && item.mediaType) || '';
  if (source === 'adult_folder' || mediaType === 'adult') return 'adult';
  return 'emby';
}

function isSeason(item) {
  return String((item && item.type) || '').toLowerCase() === 'season';
}

const FIELD_CHECKS = {
  'identity.itemId': (item) => hasText(item && item.itemId),
  'identity.externalId': (item) => hasExternalIdentity(item),
  'identity.name': (item) => hasText(item && item.name),
  'identity.seriesName': (item) => !isSeason(item) || hasText(item && item.seriesName),
  'identity.seasonNumber': (item) => !isSeason(item) || (item && item.seasonNumber != null),
  'identity.providerId': (item) => hasText(item && item.tmdbId) || hasText(item && item.doubanId),

  'media.path': (item) => hasText(item && item.path),
  'media.size': (item) => hasPositiveNumber(item && item.size),
  'media.duration': (item) => hasPositiveNumber(item && item.duration),
  'media.bitrate': (item) => hasPositiveNumber((item && item.bitrate) || (item && item.equivalentBitrate)),
  'media.equivalentBitrate': (item) => hasPositiveNumber(item && item.equivalentBitrate),
  'media.resolution': (item) => hasText(item && item.resolution),
  'media.codec': (item) => hasText(item && item.codec),
  'media.audioCodecs': (item) => Array.isArray(item && item.audioCodecs) && item.audioCodecs.length > 0,

  // Legacy names kept readable for old configs, but user perception cannot block
  // metadata gate completeness under Kairox.
  'decision.watched': () => true,
  'decision.rating': () => true,
  'decision.userRating': () => true,
  'decision.doubanRating': () => true,
  'decision.providerId': () => true,

  'adult.scraped': (item) => !!(item && item.scraped === true),
  'adult.scrapeStatus': (item) => String(((item && item.adultMetadata) || {}).scrapeStatus || '').toLowerCase() === 'done',
  'adult.adultId': (item) => hasText(((item && item.adultMetadata) || {}).adultId),
  'adult.title': (item) => hasText(((item && item.adultMetadata) || {}).title) || hasText(item && item.name),
  'adult.protagonist': (item) => {
    const meta = (item && item.adultMetadata) || {};
    return meta.region !== 'western_adult' || !!(meta.protagonist && meta.protagonist.name);
  },
};

function normalizeGate(gate) {
  if (!gate) return null;
  if (Array.isArray(gate)) return sanitizeMetadataGate({ all: gate });
  if (typeof gate === 'string') return sanitizeMetadataGate({ all: [gate] });
  if (typeof gate === 'object') return sanitizeMetadataGate(gate);
  return null;
}

function sanitizeMetadataGateField(field) {
  const normalized = String(field || '').trim();
  if (!normalized || LEGACY_PERCEPTION_GATE_FIELDS.has(normalized)) return null;
  return LEGACY_GATE_FIELD_REWRITES[normalized] || normalized;
}

function sanitizeMetadataGateNode(node) {
  if (typeof node === 'string') return sanitizeMetadataGateField(node);
  if (Array.isArray(node)) return sanitizeMetadataGateNode({ all: node });
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node.all)) {
    const all = node.all.map(sanitizeMetadataGateNode).filter(Boolean);
    return all.length > 0 ? { ...node, all } : null;
  }

  if (Array.isArray(node.any)) {
    const any = node.any.map(sanitizeMetadataGateNode).filter(Boolean);
    return any.length > 0 ? { ...node, any } : null;
  }

  return null;
}

function sanitizeMetadataGate(gate) {
  return sanitizeMetadataGateNode(gate);
}

function sanitizeMetadataMissingReasons(reasons = []) {
  const cleaned = [];
  for (const reason of Array.isArray(reasons) ? reasons : []) {
    const value = String(reason || '').trim();
    if (!value || LEGACY_PERCEPTION_GATE_FIELDS.has(value)) continue;
    cleaned.push(LEGACY_GATE_FIELD_REWRITES[value] || value);
  }
  return [...new Set(cleaned)];
}

function buildDefaultEmbyGate(subLib, config = {}) {
  const requiredInputs = collectSubLibraryStrategyInputRequirements(subLib, config);
  return {
    all: [...new Set([
      ...DEFAULT_EMBY_GATE.all,
      ...requiredInputs,
    ])],
  };
}

function resolveGate(item, subLib, kind, config = {}) {
  const custom = normalizeGate(subLib && subLib.metadataGate);
  if (custom) return custom;
  return kind === 'adult' ? DEFAULT_ADULT_GATE : buildDefaultEmbyGate(subLib, config);
}

function evaluateGateNode(item, node, missingReasons) {
  if (typeof node === 'string') {
    const check = FIELD_CHECKS[node];
    const ok = typeof check === 'function' ? check(item) : false;
    if (!ok) missingReasons.push(node);
    return ok;
  }

  if (Array.isArray(node)) {
    return evaluateGateNode(item, { all: node }, missingReasons);
  }

  if (!node || typeof node !== 'object') {
    missingReasons.push('metadataGate.invalid');
    return false;
  }

  if (Array.isArray(node.all)) {
    let ok = true;
    for (const child of node.all) {
      if (!evaluateGateNode(item, child, missingReasons)) ok = false;
    }
    return ok;
  }

  if (Array.isArray(node.any)) {
    const branchFailures = [];
    for (const child of node.any) {
      const childFailures = [];
      if (evaluateGateNode(item, child, childFailures)) return true;
      branchFailures.push(childFailures);
    }
    missingReasons.push(`any(${node.any.map((child) => typeof child === 'string' ? child : 'group').join('|')})`);
    return false;
  }

  missingReasons.push('metadataGate.invalid');
  return false;
}

function missingReasonsForGate(item, gate) {
  const missingReasons = [];
  evaluateGateNode(item, gate, missingReasons);
  return [...new Set(missingReasons)];
}

function adultMissingReasons(item) {
  const meta = (item && item.adultMetadata) || {};
  return missingReasonsForGate(item, DEFAULT_ADULT_GATE).filter((reason) => reason !== 'adult.protagonist' || meta.region === 'western_adult');
}

function embyMissingReasons(item) {
  return missingReasonsForGate(item, DEFAULT_EMBY_GATE);
}

function resolveMetadataStatus(item, config = {}) {
  const subLib = subLibraryFor(item, config);
  const kind = mediaKind(item, subLib);
  const gate = resolveGate(item, subLib, kind, config);
  const missingReasons = gate
    ? missingReasonsForGate(item, gate)
    : (kind === 'adult' ? adultMissingReasons(item) : embyMissingReasons(item));
  const gateContract = subLib ? validateMetadataGateForSubLibrary(subLib, config) : { ok: true };
  if (missingReasons.length === 0 && !gateContract.ok) {
    missingReasons.push('metadata_gate_contract_broken');
  }
  const status = missingReasons.length === 0 ? 'complete' : 'missing';
  return {
    metadataStatus: status,
    metadataComplete: status === 'complete',
    metadataMissingReasons: missingReasons,
    metadataKind: kind,
  };
}

function decorateItem(item, config = {}) {
  return {
    ...item,
    ...resolveMetadataStatus(item, config),
  };
}

function decorateItems(items, config = {}) {
  return (items || []).map((item) => decorateItem(item, config));
}

function gateCoverage(node, out = new Set()) {
  if (!node) return out;
  if (typeof node === 'string') {
    out.add(node);
    return out;
  }
  if (Array.isArray(node)) return gateCoverage({ all: node }, out);
  if (typeof node !== 'object') return out;
  if (Array.isArray(node.all)) {
    for (const child of node.all) gateCoverage(child, out);
  }
  if (Array.isArray(node.any)) {
    for (const child of node.any) gateCoverage(child, out);
  }
  return out;
}

function normalizeConditionGroup(group) {
  if (!group) return { connector: 'and', conditions: [] };
  if (Array.isArray(group)) return { connector: 'and', conditions: group };
  return {
    connector: group.connector || 'and',
    conditions: Array.isArray(group.conditions) ? group.conditions : [],
  };
}

function conditionField(cond) {
  return Array.isArray(cond) && typeof cond[0] === 'string' ? cond[0] : '';
}

function mapStrategyField(field) {
  switch (field) {
    case 'bucket': return 'media.resolution';
    case 'equivalentBitrate':
    case 'bitrate': return 'media.bitrate';
    case 'duration': return 'media.duration';
    case 'size': return 'media.size';
    case 'codec': return 'media.codec';
    case 'audioCodecs': return 'media.audioCodecs';
    case 'path': return 'media.path';
    case 'watched':
    case 'userRating':
    case 'doubanRating':
    case 'doubanStars':
    case 'tmdbId':
    case 'doubanId':
      return null;
    case 'isDiscLike': return null;
    default: return null;
  }
}

function collectRuleInputRequirements(rule) {
  const requirements = new Set();
  const groups = Array.isArray(rule && rule.groups) ? rule.groups : [];
  for (const rawGroup of groups) {
    const group = normalizeConditionGroup(rawGroup);
    const fields = group.conditions.map(conditionField).filter(Boolean);
    for (const field of fields) {
      const mapped = mapStrategyField(field);
      if (mapped) requirements.add(mapped);
    }
  }
  const targetFacts = rule && rule.targetMediaFacts && typeof rule.targetMediaFacts === 'object'
    ? rule.targetMediaFacts
    : {};
  const params = rule && rule.actionParams || {};
  const hasTargetBitrate = targetFacts.targetBitrate != null
    || !!(targetFacts.targetBitrateByBucket && Object.values(targetFacts.targetBitrateByBucket).some((value) => value != null))
    || ((rule.action === 'transcode' || rule.action === 'upgrade') && params.targetBitrate);
  if (hasTargetBitrate) {
    requirements.add('media.duration');
  }
  return requirements;
}

function collectTemplateInputRequirements(template) {
  const requirements = new Set();
  for (const rule of (template && template.rules) || []) {
    for (const req of collectRuleInputRequirements(rule)) requirements.add(req);
  }
  return requirements;
}

function resolveRuleTemplateForSubLibrary(subLib = {}, config = {}) {
  const templates = config.ruleTemplates || [];
  const ruleTemplateId = subLib && subLib.ruleTemplateId;
  return templates.find((tpl) => tpl.id === ruleTemplateId)
    || templates.find((tpl) => tpl.id === 'default')
    || null;
}

function collectSubLibraryStrategyInputRequirements(subLib = {}, config = {}) {
  return [...collectTemplateInputRequirements(resolveRuleTemplateForSubLibrary(subLib, config))].sort();
}

function gateCoversRequirement(coverage, requirement) {
  if (coverage.has(requirement)) return true;
  return false;
}

function validateMetadataGateForSubLibrary(subLib = {}, config = {}) {
  const gate = normalizeGate(subLib.metadataGate);
  if (!gate) return { ok: true, missingRequirements: [], requiredInputs: [] };
  const requiredInputs = collectSubLibraryStrategyInputRequirements(subLib, config);
  const coverage = gateCoverage(gate);
  const missingRequirements = requiredInputs.filter((req) => !gateCoversRequirement(coverage, req));
  return {
    ok: missingRequirements.length === 0,
    missingRequirements,
    requiredInputs,
  };
}

module.exports = {
  decorateItem,
  decorateItems,
  resolveMetadataStatus,
  resolveGate,
  missingReasonsForGate,
  sanitizeMetadataGate,
  sanitizeMetadataGateField,
  sanitizeMetadataMissingReasons,
  collectTemplateInputRequirements,
  validateMetadataGateForSubLibrary,
};
