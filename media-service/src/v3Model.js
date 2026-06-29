'use strict';

const lifecycleProjection = require('./lifecycleProjection');
const flowPlanner = require('./flowPlanner');

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
    ? item.metadataMissingReasons
    : [];
  const explicitStatus = cleanString(item.metadataStatus || adultMetadata.scrapeStatus).toLowerCase();
  const metadataComplete = item.metadataComplete !== undefined
    ? !!item.metadataComplete
    : !!(item.scraped || adultMetadata.scrapeStatus === 'done' || item.tmdbId || item.doubanId || item.providerIds);
  const metadataStatus = explicitStatus || (metadataComplete ? 'complete' : 'missing');
  return {
    metadata_status: metadataStatus,
    metadata_kind: cleanString(item.metadataKind || (item.source === 'adult_folder' ? 'adult' : 'standard')),
    metadata_complete: boolInt(metadataComplete),
    metadata_missing_reasons_json: jsonStringify(missingReasons),
    metadata_updated_at: cleanString(adultMetadata.scrapedAt || item.doubanRatingUpdatedAt || item.lastRefreshedAt || ''),
  };
}

function resolveOptimizationFacts(item = {}) {
  const action = cleanString(item.action || '').toLowerCase();
  const explicitStatus = cleanString(item.optimizationStatus || '').toLowerCase();
  const status = explicitStatus || 'none';
  const actionValue = cleanString(item.optimizationAction || (['transcode', 'upgrade'].includes(action) ? action : ''));
  return {
    optimization_status: status,
    optimization_action: actionValue,
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
  const planned = flowPlanner.planFlow({
    actionType: task.actionType,
    source: task.source,
    itemId: task.itemId,
    itemInfo: task.itemInfo,
    plannedAt: task.createdAt,
  });
  const bridge = task.taskBridge && typeof task.taskBridge === 'object'
    ? task.taskBridge
    : planned.taskBridge;
  const flow = task.flowPlan && typeof task.flowPlan === 'object'
    ? task.flowPlan
    : planned.flowPlan;
  const itemInfo = task.itemInfo && typeof task.itemInfo === 'object' ? task.itemInfo : {};
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
    operation_kind: cleanString(flow.operationKind || task.actionType || ''),
    flow_executor: cleanString(flow.executor || ''),
    primary_resource_type: cleanString(flow.primaryResourceType || ''),
    resource_types_json: jsonStringify(Array.isArray(flow.resourceTypes) ? flow.resourceTypes : []),
    flow_steps_json: jsonStringify(Array.isArray(flow.steps) ? flow.steps : []),
  };
}

function taskEventFacts(event = {}) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return {
    bridge_kind: cleanString(payload.bridgeKind || (payload.taskBridge && payload.taskBridge.kind) || ''),
    flow_direction: cleanString(payload.flowDirection || (payload.flowPlan && payload.flowPlan.direction) || ''),
    operation_kind: cleanString(payload.operationKind || (payload.flowPlan && payload.flowPlan.operationKind) || event.actionType || ''),
    resource_key: cleanString(payload.resourceKey || ''),
    resource_label: cleanString(payload.resourceLabel || ''),
  };
}

module.exports = {
  mediaItemFacts,
  taskFacts,
  taskEventFacts,
};
