'use strict';

const FLOW_PLAN_VERSION = 'v2.7';

const FLOW_DEFINITIONS = {
  ingest: {
    bridge: {
      kind: 'ingest',
      from: 'file_candidate',
      to: 'ingested_item',
      reason: 'Turn an observed source candidate into a managed media item.',
    },
    direction: 'ingest.commit',
    operationKind: 'ingest',
    executor: 'ingestFlowExecutor',
    primaryResourceType: 'filesystem',
    steps: [
      { phase: 'ingest_precheck', eventType: 'ingest.precheck', resourceType: 'filesystem' },
      { phase: 'ingest_commit', eventType: 'ingest.commit', resourceType: 'filesystem' },
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
    operationKind: 'scrape',
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
    operationKind: 'transcode',
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
    operationKind: 'upgrade',
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
  delete: {
    bridge: {
      kind: 'delete',
      from: 'archived_item',
      to: 'deleted_item',
      reason: 'Remove an archived media item through the delete gate review flow.',
    },
    direction: 'delete.execute',
    operationKind: 'delete',
    executor: 'deleteFlowExecutor',
    primaryResourceType: 'filesystem',
    steps: [
      { phase: 'delete_precheck', eventType: 'delete.precheck', resourceType: 'filesystem' },
      { phase: 'delete_executing', eventType: 'delete.execute', resourceType: 'filesystem' },
      { phase: 'delete_verify', eventType: 'delete.verify', resourceType: 'filesystem' },
    ],
  },
  archive: {
    bridge: {
      kind: 'archive',
      from: 'optimized_item',
      to: 'archived_item',
      reason: 'Finalize a media item lifecycle after the optimize gate is satisfied.',
    },
    direction: 'archive.finalize',
    operationKind: 'archive',
    executor: 'archiveFlowExecutor',
    primaryResourceType: 'service_api',
    steps: [
      { phase: 'archive_precheck', eventType: 'archive.finalize.precheck', resourceType: 'service_api' },
      { phase: 'archive_finalize', eventType: 'archive.finalize.write', resourceType: 'service_api' },
    ],
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isStandardMetadataRepair(operationKind, itemInfo = {}) {
  if (operationKind !== 'scrape') return false;
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

function bucketForItem(item = {}) {
  const rank = parseResolutionRank(item.resolution || item.bucket, item);
  return rank >= 4 ? '4K' : '1080p';
}

function targetBitrateForObjective(objective = {}, item = {}) {
  const target = objective.targetMediaFacts && typeof objective.targetMediaFacts === 'object'
    ? objective.targetMediaFacts
    : objective;
  if (numberOrNull(target.targetBitrate) != null) return Number(target.targetBitrate);
  const byBucket = target.targetBitrateByBucket && typeof target.targetBitrateByBucket === 'object'
    ? target.targetBitrateByBucket
    : {};
  const bucket = bucketForItem(item);
  return numberOrNull(byBucket[bucket]) != null ? Number(byBucket[bucket]) : null;
}

function objectiveTargetFacts(objective = {}, item = {}) {
  const target = objective.targetMediaFacts && typeof objective.targetMediaFacts === 'object'
    ? objective.targetMediaFacts
    : {};
  return {
    qualityTier: target.qualityTier || objective.qualityTier || '',
    minResolution: target.minResolution || objective.minResolution || '',
    targetBitrate: targetBitrateForObjective(objective, item),
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

function operationAuthorized(operation, allowedOperations) {
  if (!Array.isArray(allowedOperations) || allowedOperations.length === 0) return true;
  return allowedOperations.includes(operation);
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
    selectedOperation: input.selectedOperation || 'blocked',
    operation: input.operation || '',
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
  const allowedOperations = input.allowedOperations || input.operationAuthorization || [];
  const flowSafetyFacts = input.flowSafetyFacts || {};

  if (objectiveStatus && objectiveStatus !== 'ready') {
    return flowSelectionResult({
      selectedOperation: 'blocked',
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
      selectedOperation: 'no_op',
      operation: 'no_op',
      allowed: true,
      reason: 'objective_already_satisfied',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  if (kind === 'remove_media') {
    return flowSelectionResult({
      selectedOperation: 'blocked',
      allowed: false,
      reason: 'delete_is_not_optimize',
      blockedReason: 'delete_gate_required',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  const hasTargetCriteria = !!(
    targetFacts.minResolution
    || targetFacts.targetBitrate != null
    || targetFacts.targetCodec
  );
  const legacyOperation = cleanToken(objective.operationHint || item.action);
  const legacyOptimizeOperation = ['transcode', 'upgrade'].includes(legacyOperation) ? legacyOperation : '';
  if (!hasTargetCriteria && legacyOptimizeOperation) {
    return flowSelectionResult({
      selectedOperation: legacyOptimizeOperation,
      operation: legacyOptimizeOperation,
      allowed: true,
      reason: 'legacy_operation_hint',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }
  if (!hasTargetCriteria) {
    return flowSelectionResult({
      selectedOperation: 'blocked',
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
        operation: 'upgrade',
        reason: 'resolution_below_target',
      });
    }
  }

  if (targetFacts.targetBitrate != null) {
    if (currentFacts.bitrate == null) {
      missing.push('media.bitrate');
    } else if (currentFacts.bitrate < targetFacts.targetBitrate * 0.65) {
      gap.push({
        field: 'bitrate',
        current: currentFacts.bitrate,
        target: targetFacts.targetBitrate,
        operation: 'upgrade',
        reason: 'bitrate_below_target',
      });
    } else if (currentFacts.bitrate > targetFacts.targetBitrate * 1.35) {
      gap.push({
        field: 'bitrate',
        current: currentFacts.bitrate,
        target: targetFacts.targetBitrate,
        operation: 'transcode',
        reason: 'bitrate_above_target',
      });
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
        operation: localCanSatisfy ? 'transcode' : 'blocked',
        reason: localCanSatisfy ? 'codec_mismatch' : 'unsupported_target_codec',
      });
    }
  }

  if (missing.length > 0) {
    return flowSelectionResult({
      selectedOperation: 'blocked',
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
      selectedOperation: 'no_op',
      operation: 'no_op',
      allowed: true,
      reason: 'objective_already_satisfied',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  if (gap.some((entry) => entry.operation === 'blocked')) {
    return flowSelectionResult({
      selectedOperation: 'blocked',
      allowed: false,
      reason: 'unsupported_objective',
      blockedReason: 'unsupported_target_codec',
      objectiveHash,
      currentFacts,
      targetFacts,
      gap,
    });
  }

  if (gap.some((entry) => entry.operation === 'upgrade')) {
    if (!operationAuthorized('upgrade', allowedOperations)) {
      return flowSelectionResult({
        selectedOperation: 'blocked',
        operation: 'upgrade',
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
        selectedOperation: 'blocked',
        operation: 'upgrade',
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
      selectedOperation: 'upgrade',
      operation: 'upgrade',
      allowed: true,
      reason: 'better_source_required',
      objectiveHash,
      currentFacts,
      targetFacts,
      gap,
    });
  }

  if (gap.some((entry) => entry.operation === 'transcode')) {
    if (!operationAuthorized('transcode', allowedOperations)) {
      return flowSelectionResult({
        selectedOperation: 'blocked',
        operation: 'transcode',
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
      selectedOperation: 'transcode',
      operation: 'transcode',
      allowed: true,
      reason: 'local_transform_satisfies_objective',
      objectiveHash,
      currentFacts,
      targetFacts,
      gap,
    });
  }

  if (legacyOptimizeOperation) {
    return flowSelectionResult({
      selectedOperation: legacyOptimizeOperation,
      operation: legacyOptimizeOperation,
      allowed: true,
      reason: 'legacy_operation_hint',
      objectiveHash,
      currentFacts,
      targetFacts,
    });
  }

  return flowSelectionResult({
    selectedOperation: 'blocked',
    allowed: false,
    reason: 'objective_not_plannable',
    blockedReason: 'objective_gap_unknown',
    objectiveHash,
    currentFacts,
    targetFacts,
  });
}

function defaultDefinition(operationKind) {
  return {
    bridge: {
      kind: 'metadata',
      from: 'unknown',
      to: 'unknown',
      reason: 'Legacy task without a known v2.7 flow definition.',
    },
    direction: 'metadata.unknown',
    operationKind: String(operationKind || 'unknown'),
    executor: '',
    primaryResourceType: 'service_api',
    steps: [],
  };
}

function planFlow(input = {}) {
  const operationKind = String(input.operationKind || '');
  const source = String(input.source || '');
  const itemInfo = input.itemInfo && typeof input.itemInfo === 'object' ? input.itemInfo : {};
  const definition = clone(FLOW_DEFINITIONS[operationKind] || defaultDefinition(operationKind));
  if (isStandardMetadataRepair(operationKind, itemInfo)) {
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
    operationKind,
    source,
    itemId: input.itemId || itemInfo.itemId || '',
    subLibraryId: itemInfo.subLibraryId || '',
  };
  const flowPlan = {
    version: FLOW_PLAN_VERSION,
    bridgeKind: taskBridge.kind,
    direction: definition.direction,
    operationKind: definition.operationKind,
    executor: definition.executor,
    primaryResourceType: definition.primaryResourceType,
    source,
    resourceTypes,
    steps: definition.steps,
    plannedAt,
  };
  if (taskBridge.kind === 'optimize') {
    const taskTarget = input.taskTarget && typeof input.taskTarget === 'object' ? input.taskTarget : {};
    flowPlan.flowSelection = selectOptimizeFlow({
      itemInfo,
      optimizeObjective: input.optimizeObjective
        || input.gateObjective
        || taskTarget.gateObjective
        || itemInfo.optimizeObjective,
      optimizeObjectiveStatus: input.optimizeObjectiveStatus || itemInfo.optimizeObjectiveStatus,
      objectiveHash: input.objectiveHash || itemInfo.objectiveHash,
      allowedOperations: input.allowedOptimizeOperations || input.allowedOperations,
      flowSafetyFacts: input.flowSafetyFacts,
    });
  }
  return { taskBridge, flowPlan };
}

function bridgeKindForAction(operationKind) {
  return (FLOW_DEFINITIONS[operationKind] || defaultDefinition(operationKind)).bridge.kind;
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
  bridgeKindForAction,
  currentResourceType,
  currentFlowStep,
};
