'use strict';

const lifecycleProjection = require('./lifecycleProjection');
const flowPlanner = require('./flowPlanner');
const metadataStatus = require('./metadataStatus');

function jsonStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolInt(value) {
  return value ? 1 : 0;
}

function cleanString(value) {
  return value == null ? '' : String(value);
}

function resolveMetadataFacts(item = {}) {
  const adultMetadata = item.adultMetadata && typeof item.adultMetadata === 'object'
    ? item.adultMetadata
    : {};
  const missingReasons = Array.isArray(item.metadataMissingReasons)
    ? metadataStatus.sanitizeMetadataMissingReasons(item.metadataMissingReasons)
    : [];
  const explicitStatus = cleanString(item.metadataStatus || adultMetadata.scrapeStatus).toLowerCase();
  const legacyPerceptionOnlyIncomplete = item.metadataComplete === false
    && Array.isArray(item.metadataMissingReasons)
    && item.metadataMissingReasons.length > 0
    && missingReasons.length === 0;
  const metadataComplete = item.metadataComplete !== undefined
    ? (legacyPerceptionOnlyIncomplete ? true : !!item.metadataComplete)
    : !!(item.scraped || adultMetadata.scrapeStatus === 'done' || item.tmdbId || item.doubanId || item.providerIds);
  const status = legacyPerceptionOnlyIncomplete ? 'complete' : (explicitStatus || (metadataComplete ? 'complete' : 'missing'));
  return {
    metadata_status: status,
    metadata_kind: cleanString(item.metadataKind || (item.source === 'adult_folder' ? 'adult' : 'standard')),
    metadata_complete: boolInt(metadataComplete),
    metadata_missing_reasons_json: jsonStringify(missingReasons),
    metadata_updated_at: cleanString(adultMetadata.scrapedAt || item.doubanRatingUpdatedAt || item.lastRefreshedAt || ''),
  };
}

function resolveOptimizationFacts(item = {}) {
  const explicitStatus = cleanString(item.optimizationStatus || '').toLowerCase();
  const explicitFlowKind = cleanString(
    item.optimizeFlowKind
    || (item.optimizeGate && item.optimizeGate.flowKind)
    || (item.optimizationGate && item.optimizationGate.flowKind)
    || ''
  ).toLowerCase();
  const status = explicitStatus === 'deleted' ? 'none' : (explicitStatus || 'none');
  const flowKindValue = ['transcode', 'upgrade'].includes(explicitFlowKind)
    ? explicitFlowKind
    : '';
  return {
    optimization_status: status,
    optimization_action: flowKindValue,
    optimization_done_at: cleanString(item.optimizationDoneAt || ''),
    optimization_task_id: cleanString(item.optimizationTaskId || ''),
  };
}

function mediaItemFacts(item = {}) {
  const lifecycle = lifecycleProjection.resolveLifecycle(item || {});
  const metadata = resolveMetadataFacts(item || {});
  const optimization = resolveOptimizationFacts(item || {});
  return {
    lifecycle_stage: cleanString(lifecycle.lifecycleStage),
    lifecycle_done: boolInt(lifecycle.lifecycleDone),
    lifecycle_next_task: cleanString(lifecycle.lifecycleNextTask || ''),
    lifecycle_reason: cleanString(lifecycle.lifecycleReason || ''),
    ...metadata,
    ...optimization,
    archive_status: cleanString(lifecycle.archiveStatus || ''),
    archive_reason: cleanString(item.archiveReason || lifecycle.lifecycleReason || ''),
    archive_done_at: lifecycle.lifecycleDone ? cleanString(item.archiveDoneAt || item.optimizationDoneAt || item.lastRefreshedAt || '') : '',
  };
}

function taskFacts(task = {}) {
  const itemInfo = task.itemInfo && typeof task.itemInfo === 'object' ? task.itemInfo : {};
  const taskTarget = task.taskTarget && typeof task.taskTarget === 'object'
    ? task.taskTarget
    : {
      object: {
        type: 'media_item',
        itemId: task.itemId || '',
        subLibraryId: itemInfo.subLibraryId || '',
      },
      targetGate: task.targetGate || (task.flowPlan && task.flowPlan.bridgeKind) || '',
      gateObjective: task.gateObjective && typeof task.gateObjective === 'object' ? task.gateObjective : {},
      source: task.source || '',
    };
  const planned = flowPlanner.planFlow({
    targetGate: taskTarget.targetGate,
    taskTarget,
    source: task.source,
    itemId: task.itemId,
    itemInfo,
    plannedAt: task.createdAt,
  });
  const bridge = task.taskBridge && typeof task.taskBridge === 'object'
    ? task.taskBridge
    : planned.taskBridge;
  const flow = task.flowPlan && typeof task.flowPlan === 'object'
    ? task.flowPlan
    : planned.flowPlan;
  const gateObjective = taskTarget.gateObjective && typeof taskTarget.gateObjective === 'object'
    ? taskTarget.gateObjective
    : {};
  return {
    source: cleanString(task.source || ''),
    progress: numberOrNull(task.progress == null ? 0 : task.progress),
    phase: task.phase == null ? null : cleanString(task.phase),
    resume_point: task.resumePoint == null ? null : cleanString(task.resumePoint),
    manual_execute_requested: boolInt(task.manualExecuteRequested),
    priority_manually_adjusted: boolInt(task.priorityManuallyAdjusted),
    priority_model_version: cleanString(task.priorityModelVersion || ''),
    retry_count: Number.isInteger(task.retryCount) ? task.retryCount : Number(task.retryCount || 0) || 0,
    pausing_requested: boolInt(task.pausingRequested),
    node_id: cleanString(task.nodeId || ''),
    sub_library_id: cleanString(itemInfo.subLibraryId || ''),
    item_path: cleanString(itemInfo.path || itemInfo.sourcePath || ''),
    bridge_kind: cleanString(bridge.kind || flow.bridgeKind || ''),
    bridge_from: cleanString(bridge.from || ''),
    bridge_to: cleanString(bridge.to || ''),
    bridge_reason: cleanString(bridge.reason || ''),
    flow_version: cleanString(flow.version || ''),
    flow_direction: cleanString(flow.direction || ''),
    flow_kind: cleanString(flow.flowKind || ''),
    flow_executor: cleanString(flow.executor || ''),
    primary_resource_type: cleanString(flow.primaryResourceType || ''),
    resource_types_json: jsonStringify(Array.isArray(flow.resourceTypes) ? flow.resourceTypes : []),
    flow_steps_json: jsonStringify(Array.isArray(flow.steps) ? flow.steps : []),
    target_gate: cleanString(taskTarget.targetGate || bridge.kind || flow.bridgeKind || ''),
    gate_objective_kind: cleanString(gateObjective.kind || ''),
    gate_objective_json: jsonStringify(gateObjective),
  };
}

function taskEventFacts(event = {}) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return {
    bridge_kind: cleanString(payload.bridgeKind || (payload.taskBridge && payload.taskBridge.kind) || ''),
    flow_direction: cleanString(payload.flowDirection || (payload.flowPlan && payload.flowPlan.direction) || ''),
    flow_kind: cleanString(payload.flowKind || (payload.flowPlan && payload.flowPlan.flowKind) || event.flowKind || ''),
    resource_key: cleanString(payload.resourceKey || ''),
    resource_label: cleanString(payload.resourceLabel || ''),
  };
}

module.exports = {
  mediaItemFacts,
  taskFacts,
  taskEventFacts,
};
