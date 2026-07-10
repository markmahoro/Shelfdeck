'use strict';

const bitrateObjectiveProfile = require('./bitrateObjectiveProfile');

const FLOW_PLAN_VERSION = 'v2.7';

const FLOW_DEFINITIONS = {
  basedata: {
    bridge: {
      kind: 'basedata',
      from: 'admitted_source',
      to: 'observed_media',
      reason: 'Observe operational media facts from the current SourceBinding.',
    },
    direction: 'basedata.observe',
    flowKind: 'basedata',
    executor: 'basedataFlowExecutor',
    primaryResourceType: 'filesystem',
    steps: [
      { phase: 'basedata_observe', eventType: 'basedata.observe', resourceType: 'filesystem' },
      { phase: 'basedata_publish', eventType: 'basedata.publish', resourceType: 'service_api' },
    ],
  },
  scrape: {
    bridge: {
      kind: 'metadata',
      from: 'library_item',
      to: 'metadata_enriched_item',
      reason: 'Resolve missing or incomplete metadata for an existing media item.',
    },
    direction: 'metadata.enrich',
    flowKind: 'scrape',
    executor: 'scrapeFlowExecutor',
    primaryResourceType: 'scraper',
    steps: [
      { phase: 'scrape_precheck', eventType: 'metadata.scrape.precheck', resourceType: 'service_api' },
      { phase: 'scrape_executing', eventType: 'metadata.scrape.fetch', resourceType: 'scraper' },
      { phase: 'scrape_write_metadata', eventType: 'metadata.scrape.write', resourceType: 'filesystem' },
      { phase: 'scrape_review', eventType: 'metadata.scrape.review', resourceType: 'service_api' },
    ],
  },
  transcode: {
    bridge: {
      kind: 'optimize',
      from: 'original_media',
      to: 'optimized_media',
      reason: 'Produce a lower-cost playable derivative while preserving the media item.',
    },
    direction: 'optimize.transcode',
    flowKind: 'transcode',
    executor: 'transcodeFlowExecutor',
    primaryResourceType: 'transcode',
    steps: [
      { phase: 'transcode_precheck', eventType: 'optimize.transcode.precheck', resourceType: 'filesystem' },
      { phase: 'transcode_executing', eventType: 'optimize.transcode.execute', resourceType: 'transcode' },
      { phase: 'transcode_verify', eventType: 'optimize.transcode.verify', resourceType: 'filesystem' },
      { phase: 'transcode_replace', eventType: 'optimize.transcode.replace', resourceType: 'filesystem' },
    ],
  },
  upgrade: {
    bridge: {
      kind: 'optimize',
      from: 'current_media',
      to: 'upgraded_media',
      reason: 'Replace a media item with a better source selected by the upgrade flow.',
    },
    direction: 'optimize.upgrade',
    flowKind: 'upgrade',
    executor: 'upgradeFlowExecutor',
    primaryResourceType: 'moviepilot',
    steps: [
      { phase: 'upgrade_precheck', eventType: 'optimize.upgrade.precheck', resourceType: 'service_api' },
      { phase: 'upgrade_planning', eventType: 'optimize.upgrade.plan', resourceType: 'moviepilot' },
      { phase: 'upgrade_executing', eventType: 'optimize.upgrade.download', resourceType: 'moviepilot' },
      { phase: 'upgrade_pre_replace_verify', eventType: 'optimize.upgrade.verify_source', resourceType: 'filesystem' },
      { phase: 'upgrade_replace', eventType: 'optimize.upgrade.replace', resourceType: 'filesystem' },
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isStandardMetadataRepair(flowKind, itemInfo = {}) {
  if (flowKind !== 'scrape') return false;
  return itemInfo.source === 'emby' || itemInfo.metadataKind === 'emby';
}

function cleanToken(value) {
  return String(value || '').trim().toLowerCase();
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeBitrateMbps(value) {
  const n = numberOrNull(value);
  if (n == null) return null;
  return n > 100000 ? n / 1000000 : n;
}

function normalizeCodec(value) {
  const raw = cleanToken(value).replace(/[^a-z0-9]/g, '');
  if (['h265', 'x265', 'hevc'].includes(raw)) return 'h265';
  if (['h264', 'x264', 'avc', 'avc1'].includes(raw)) return 'h264';
  return raw;
}

function parseResolutionRank(value, item = {}) {
  const explicit = cleanToken(value || item.bucket || item.resolutionBucket);
  if (explicit.includes('4k') || explicit.includes('2160')) return 4;
  if (explicit.includes('1080')) return 3;
  if (explicit.includes('720')) return 2;
  if (explicit.includes('480')) return 1;
  const width = Number(item.width || item.originalWidth || 0);
  const height = Number(item.height || item.originalHeight || 0);
  const text = String(value || item.resolution || '');
  const match = text.match(/(\d{3,5})\D+(\d{3,5})/);
  const w = width || (match ? Number(match[1]) : 0);
  const h = height || (match ? Number(match[2]) : 0);
  if (w >= 3000 || h >= 2000) return 4;
  if (w >= 1600 || h >= 900) return 3;
  if (w >= 1100 || h >= 650) return 2;
  if (w > 0 || h > 0) return 1;
  return 0;
}

function resolutionLabel(rank) {
  if (rank >= 4) return '4K';
  if (rank === 3) return '1080p';
  if (rank === 2) return '720p';
  if (rank === 1) return 'SD';
  return '';
}

function objectiveTargetFacts(objective = {}, item = {}) {
  const target = objective.targetMediaFacts && typeof objective.targetMediaFacts === 'object'
    ? objective.targetMediaFacts
    : {};
  const bitrateProfile = bitrateObjectiveProfile.resolveBitrateProfile({ objective, item });
  return {
    qualityTier: target.qualityTier || objective.qualityTier || '',
    minResolution: target.minResolution || objective.minResolution || '',
    bitrateProfile,
    targetMbps: bitrateProfile ? bitrateProfile.targetMbps : null,
    targetCodec: normalizeCodec(target.targetCodec || target.codec || objective.targetCodec),
    maxSizeGB: target.maxSizeGB || objective.maxSizeGB || null,
  };
}

function currentMediaFacts(item = {}) {
  return {
    bitrate: normalizeBitrateMbps(item.equivalentBitrate || item.bitrate || item.originalBitrate),
    codec: normalizeCodec(item.codec || item.videoCodec || item.originalVideoCodec),
    resolutionRank: parseResolutionRank(item.resolution || item.bucket, item),
    resolution: resolutionLabel(parseResolutionRank(item.resolution || item.bucket, item)),
    isDiscLike: !!item.isDiscLike,
  };
}

function flowAuthorized(flowKind, allowedFlows) {
  if (!Array.isArray(allowedFlows)) return true;
  if (allowedFlows.length === 0) return false;
  return allowedFlows.includes(flowKind);
}

function upgradeSafetyBlocker(item = {}, flowSafetyFacts = {}) {
  const facts = flowSafetyFacts && typeof flowSafetyFacts === 'object' ? flowSafetyFacts : {};
  if (facts.allowDiscLike !== true && (item.isDiscLike || facts.isDiscLike)) {
    return 'upgrade_not_supported_for_disc_like_source';
  }
  if (facts.moviepilotConfigured === false) return 'moviepilot_not_configured';
  if (facts.upgradeCanarySlotAvailable === false) return 'upgrade_canary_limit';
  return '';
}

function flowSelectionResult(input = {}) {
  const result = {
    flowKind: input.flowKind || 'blocked',
    suggestedFlowKind: input.suggestedFlowKind || '',
    allowed: !!input.allowed,
    reason: input.reason || '',
    blockedReason: input.blockedReason || '',
    objectiveHash: input.objectiveHash || '',
    currentFacts: input.currentFacts || {},
    targetFacts: input.targetFacts || {},
    gap: input.gap || [],
  };
  Object.keys(result).forEach((key) => {
    if (result[key] === '' || result[key] === null || result[key] === undefined) delete result[key];
    if (Array.isArray(result[key]) && result[key].length === 0) delete result[key];
  });
  return result;
}

function selectOptimizeFlow(input = {}) {
  const item = input.currentMediaFacts || input.itemInfo || input.item || {};
  const objective = input.optimizeObjective || item.optimizeObjective || item.optimizationObjective || {};
  const objectiveStatus = cleanToken(input.optimizeObjectiveStatus || item.optimizeObjectiveStatus || '');
  const objectiveHash = input.objectiveHash || item.objectiveHash || '';
  const currentFacts = currentMediaFacts(item);
  const targetFacts = objectiveTargetFacts(objective, item);
  const kind = cleanToken(objective.kind);
  const allowedFlows = input.allowedOptimizeFlowKinds || input.allowedOptimizeFlows;
  const flowSafetyFacts = input.flowSafetyFacts || {};

  if (objectiveStatus && objectiveStatus !== 'ready') {
    return flowSelectionResult({
      flowKind: 'blocked',
      allowed: false,
      reason: 'objective_not_ready',
      blockedReason: objectiveStatus,
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  if (kind === 'keep_current') {
    return flowSelectionResult({
      flowKind: 'no_op',
      allowed: true,
      reason: 'objective_already_satisfied',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  if (kind === 'remove_media') {
    return flowSelectionResult({
      flowKind: 'blocked',
      allowed: false,
      reason: 'invalid_maintenance_objective',
      blockedReason: 'objective_outside_kairox_maintenance',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  const hasTargetCriteria = !!(
    targetFacts.minResolution
    || targetFacts.bitrateProfile
    || targetFacts.targetCodec
  );
  if (!hasTargetCriteria) {
    return flowSelectionResult({
      flowKind: 'blocked',
      allowed: false,
      reason: 'objective_not_plannable',
      blockedReason: 'objective_gap_unknown',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  const gap = [];
  const missing = [];
  const minResolutionRank = parseResolutionRank(targetFacts.minResolution);
  if (minResolutionRank > 0) {
    if (!currentFacts.resolutionRank) {
      missing.push('media.resolution');
    } else if (currentFacts.resolutionRank < minResolutionRank) {
      gap.push({
        field: 'resolution',
        current: currentFacts.resolution,
        target: resolutionLabel(minResolutionRank),
        requiredFlowKind: 'upgrade',
        reason: 'resolution_below_target',
      });
    }
  }

  if (targetFacts.bitrateProfile) {
    if (currentFacts.bitrate == null) {
      missing.push('media.bitrate');
    } else {
      const bitrateComparison = bitrateObjectiveProfile.compareBitrateToProfile(currentFacts.bitrate, targetFacts.bitrateProfile);
      if (bitrateComparison.status === 'below') {
        gap.push({
          field: 'bitrate',
          current: currentFacts.bitrate,
          target: targetFacts.bitrateProfile.targetMbps,
          min: targetFacts.bitrateProfile.minMbps,
          max: targetFacts.bitrateProfile.maxMbps,
          requiredFlowKind: 'upgrade',
          reason: 'bitrate_below_range',
        });
      } else if (bitrateComparison.status === 'above') {
        gap.push({
          field: 'bitrate',
          current: currentFacts.bitrate,
          target: targetFacts.bitrateProfile.targetMbps,
          min: targetFacts.bitrateProfile.minMbps,
          max: targetFacts.bitrateProfile.maxMbps,
          requiredFlowKind: 'transcode',
          reason: 'bitrate_above_range',
        });
      }
    }
  }

  if (targetFacts.targetCodec) {
    if (!currentFacts.codec) {
      missing.push('media.codec');
    } else if (currentFacts.codec !== targetFacts.targetCodec) {
      const localCanSatisfy = targetFacts.targetCodec === 'h265';
      gap.push({
        field: 'codec',
        current: currentFacts.codec,
        target: targetFacts.targetCodec,
        requiredFlowKind: localCanSatisfy ? 'transcode' : 'blocked',
        reason: localCanSatisfy ? 'codec_mismatch' : 'unsupported_target_codec',
      });
    }
  }

  if (missing.length > 0) {
    return flowSelectionResult({
      flowKind: 'blocked',
      allowed: false,
      reason: 'facts_missing',
      blockedReason: 'needs_metadata_repair',
      objectiveHash,
      currentFacts,
      targetFacts,
      gap: missing.map((field) => ({ field, reason: 'missing_fact' })),
    });
  }

  if (gap.length === 0) {
    return flowSelectionResult({
      flowKind: 'no_op',
      allowed: true,
      reason: 'objective_already_satisfied',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  if (gap.some((entry) => entry.requiredFlowKind === 'blocked')) {
    return flowSelectionResult({
      flowKind: 'blocked',
      allowed: false,
      reason: 'unsupported_objective',
      blockedReason: 'unsupported_target_codec',
      objectiveHash,
      currentFacts,
      targetFacts,
      gap,
    });
  }

  if (gap.some((entry) => entry.requiredFlowKind === 'upgrade')) {
    if (!flowAuthorized('upgrade', allowedFlows)) {
      return flowSelectionResult({
        flowKind: 'blocked',
        suggestedFlowKind: 'upgrade',
        allowed: false,
        reason: 'better_source_required',
        blockedReason: 'needs_upgrade',
        objectiveHash,
        currentFacts,
        targetFacts,
        gap,
      });
    }
    const safetyBlocker = upgradeSafetyBlocker(item, flowSafetyFacts);
    if (safetyBlocker) {
      return flowSelectionResult({
        flowKind: 'blocked',
        suggestedFlowKind: 'upgrade',
        allowed: false,
        reason: 'upgrade_safety_blocked',
        blockedReason: safetyBlocker,
        objectiveHash,
        currentFacts,
        targetFacts,
        gap,
      });
    }
    return flowSelectionResult({
      flowKind: 'upgrade',
      allowed: true,
      reason: 'better_source_required',
      objectiveHash,
      currentFacts,
      targetFacts,
      gap,
    });
  }

  if (gap.some((entry) => entry.requiredFlowKind === 'transcode')) {
    if (!flowAuthorized('transcode', allowedFlows)) {
      return flowSelectionResult({
        flowKind: 'blocked',
        suggestedFlowKind: 'transcode',
        allowed: false,
        reason: 'local_transform_required',
        blockedReason: 'transcode_not_authorized',
        objectiveHash,
        currentFacts,
        targetFacts,
        gap,
      });
    }
    return flowSelectionResult({
      flowKind: 'transcode',
      allowed: true,
      reason: 'local_transform_satisfies_objective',
      objectiveHash,
      currentFacts,
      targetFacts,
      gap,
    });
  }

  return flowSelectionResult({
    flowKind: 'blocked',
    allowed: false,
    reason: 'objective_not_plannable',
    blockedReason: 'objective_gap_unknown',
    objectiveHash,
    currentFacts,
    targetFacts,
  });
}

function defaultDefinition(flowKind) {
  return {
    bridge: {
      kind: 'metadata',
      from: 'unknown',
      to: 'unknown',
      reason: 'Legacy task without a known v2.7 flow definition.',
    },
    direction: 'metadata.unknown',
    flowKind: String(flowKind || 'unknown'),
    executor: '',
    primaryResourceType: 'service_api',
    steps: [],
  };
}

function targetGateForInput(input = {}) {
  const taskTarget = input.taskTarget && typeof input.taskTarget === 'object' ? input.taskTarget : {};
  return cleanToken(input.targetGate || taskTarget.targetGate || input.bridgeKind || '');
}

function deterministicFlowKindForGate(targetGate) {
  if (targetGate === 'basedata') return 'basedata';
  if (targetGate === 'metadata') return 'scrape';
  return '';
}

function planFlow(input = {}) {
  const source = String(input.source || '');
  const itemInfo = input.itemInfo && typeof input.itemInfo === 'object' ? input.itemInfo : {};
  const taskTarget = input.taskTarget && typeof input.taskTarget === 'object' ? input.taskTarget : {};
  const targetGate = targetGateForInput(input);
  let flowSelection = null;
  let flowKind = deterministicFlowKindForGate(targetGate);
  if (targetGate === 'optimize') {
    flowSelection = selectOptimizeFlow({
      itemInfo,
      optimizeObjective: input.optimizeObjective
        || input.gateObjective
        || taskTarget.gateObjective
        || itemInfo.optimizeObjective,
      optimizeObjectiveStatus: input.optimizeObjectiveStatus || itemInfo.optimizeObjectiveStatus,
      objectiveHash: input.objectiveHash || itemInfo.objectiveHash,
      allowedOptimizeFlowKinds: input.allowedOptimizeFlowKinds || input.allowedOptimizeFlows,
      flowSafetyFacts: input.flowSafetyFacts,
    });
    flowKind = flowSelection.flowKind;
  }
  flowKind = flowKind || 'blocked';
  const definition = clone(FLOW_DEFINITIONS[flowKind] || defaultDefinition(flowKind));
  if (flowKind === 'basedata' && itemInfo.source === 'emby') {
    definition.primaryResourceType = 'emby';
    definition.steps = [
      { phase: 'basedata_observe', eventType: 'basedata.emby.observe', resourceType: 'emby' },
      { phase: 'basedata_publish', eventType: 'basedata.publish', resourceType: 'service_api' },
    ];
  }
  if (isStandardMetadataRepair(flowKind, itemInfo)) {
    definition.primaryResourceType = 'emby';
    definition.steps = [
      { phase: 'scrape_precheck', eventType: 'metadata.repair.precheck', resourceType: 'service_api' },
      { phase: 'scrape_executing', eventType: 'metadata.repair.emby_fetch', resourceType: 'emby' },
      { phase: 'scrape_write_metadata', eventType: 'metadata.repair.write', resourceType: 'service_api' },
      { phase: 'scrape_review', eventType: 'metadata.repair.review', resourceType: 'service_api' },
    ];
  }
  const resourceTypes = [...new Set(definition.steps.map((step) => step.resourceType).filter(Boolean))];
  const plannedAt = input.plannedAt || new Date().toISOString();
  const taskBridge = {
    ...definition.bridge,
    flowKind,
    source,
    itemId: input.itemId || itemInfo.itemId || '',
    subLibraryId: itemInfo.subLibraryId || '',
  };
  const flowPlan = {
    version: FLOW_PLAN_VERSION,
    bridgeKind: taskBridge.kind,
    direction: definition.direction,
    flowKind: definition.flowKind,
    executor: definition.executor,
    primaryResourceType: definition.primaryResourceType,
    source,
    resourceTypes,
    steps: definition.steps,
    plannedAt,
  };
  if (flowSelection) flowPlan.flowSelection = flowSelection;
  return { taskBridge, flowPlan };
}

function bridgeKindForFlowKind(flowKind) {
  return (FLOW_DEFINITIONS[flowKind] || defaultDefinition(flowKind)).bridge.kind;
}

function currentPlanForTask(task) {
  const stored = task && task.flowPlan && typeof task.flowPlan === 'object' ? task.flowPlan : null;
  if (!stored) return planFlow(task || {}).flowPlan;
  const hasResourceContract = stored.primaryResourceType || (Array.isArray(stored.steps) && stored.steps.length > 0);
  return hasResourceContract ? stored : planFlow(task || {}).flowPlan;
}

function currentResourceType(task) {
  const plan = currentPlanForTask(task);
  const phase = task && (task.phase || task.resumePoint);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const current = phase ? steps.find((step) => step.phase === phase) : null;
  return (current && current.resourceType) || plan.primaryResourceType || (steps[0] && steps[0].resourceType) || 'service_api';
}

function currentFlowStep(task) {
  const plan = currentPlanForTask(task);
  const phase = task && (task.phase || task.resumePoint);
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const current = phase ? steps.find((step) => step.phase === phase) : null;
  return current || steps[0] || {
    phase: phase || '',
    eventType: `${plan.direction || 'task'}.dispatch`,
    resourceType: plan.primaryResourceType || 'service_api',
  };
}

module.exports = {
  FLOW_PLAN_VERSION,
  planFlow,
  selectOptimizeFlow,
  bridgeKindForFlowKind,
  currentResourceType,
  currentFlowStep,
};
