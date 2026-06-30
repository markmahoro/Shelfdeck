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
      kind: 'optimize',
      from: 'metadata_ready_item',
      to: 'removed_media',
      reason: 'Remove media as a destructive optimize flow under the existing mutation safety gates.',
    },
    direction: 'optimize.delete',
    operationKind: 'delete',
    executor: 'deleteFlowExecutor',
    primaryResourceType: 'filesystem',
    steps: [
      { phase: 'delete_precheck', eventType: 'optimize.delete.precheck', resourceType: 'filesystem' },
      { phase: 'delete_executing', eventType: 'optimize.delete.execute', resourceType: 'filesystem' },
      { phase: 'delete_verify', eventType: 'optimize.delete.verify', resourceType: 'filesystem' },
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

function isStandardMetadataRepair(actionType, itemInfo = {}) {
  if (actionType !== 'scrape') return false;
  return itemInfo.source === 'emby' || itemInfo.metadataKind === 'emby';
}

function defaultDefinition(actionType) {
  return {
    bridge: {
      kind: 'metadata',
      from: 'unknown',
      to: 'unknown',
      reason: 'Legacy task without a known v2.7 flow definition.',
    },
    direction: 'metadata.unknown',
    operationKind: String(actionType || 'unknown'),
    executor: '',
    primaryResourceType: 'service_api',
    steps: [],
  };
}

function planFlow(input = {}) {
  const actionType = String(input.actionType || '');
  const source = String(input.source || '');
  const itemInfo = input.itemInfo && typeof input.itemInfo === 'object' ? input.itemInfo : {};
  const definition = clone(FLOW_DEFINITIONS[actionType] || defaultDefinition(actionType));
  if (isStandardMetadataRepair(actionType, itemInfo)) {
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
    actionType,
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
    actionType,
    source,
    resourceTypes,
    steps: definition.steps,
    plannedAt,
  };
  return { taskBridge, flowPlan };
}

function bridgeKindForAction(actionType) {
  return (FLOW_DEFINITIONS[actionType] || defaultDefinition(actionType)).bridge.kind;
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
  bridgeKindForAction,
  currentResourceType,
  currentFlowStep,
};
