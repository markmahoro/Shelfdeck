'use strict';

const diagnosticLog = require('./diagnosticLog');
const flowPlanner = require('./flowPlanner');
const resourceCapacity = require('./resourceCapacity');

const ACTIVE_STATUSES = new Set(['executing', 'pausing']);
const BLOCKED_STATUSES = new Set(['awaiting_user_confirm', 'paused']);
const EVENT_RUNNING_STATUSES = new Set(['running', 'executing']);
const EVENT_FAILED_STATUSES = new Set(['failed', 'error']);

function resourceStateForStatus(status) {
  if (ACTIVE_STATUSES.has(status)) return 'running';
  if (BLOCKED_STATUSES.has(status)) return 'blocked';
  return 'waiting';
}

function concurrencyLimitForAction(operationKind, config = {}) {
  switch (operationKind) {
    case 'ingest': return config.ingestConcurrency || 1;
    case 'delete': return config.deleteConcurrency || 1;
    case 'transcode': return config.transcodeConcurrency || 1;
    case 'upgrade': return config.upgradeConcurrency || 1;
    case 'scrape': return config.scrapeConcurrency || 1;
    default: return 1;
  }
}

function concurrencyLimitForResource(taskResource, config = {}) {
  const legacyFallback = (() => {
  switch (taskResource && taskResource.resourceType) {
    case 'local_transcode':
    case 'worker_transcode':
      return config.transcodeConcurrency || 1;
    case 'moviepilot':
      return config.upgradeConcurrency || 1;
    case 'emby':
      return config.embyMetadataRepairConcurrency || config.scrapeConcurrency || 1;
    case 'scraper':
      return config.scrapeConcurrency || 1;
    case 'local_ai':
      return config.localWesternAiConcurrency || config.westernAiConcurrency || 1;
    case 'filesystem':
      if (taskResource.resourceKey === 'filesystem:ingest') return config.ingestConcurrency || 1;
      if (taskResource.resourceKey === 'filesystem:mutation') return config.deleteConcurrency || 1;
      return 1;
    default:
      return concurrencyLimitForAction(taskResource && taskResource.operationKind, config);
  }
  })();
  return resourceCapacity.capacityForResource(taskResource, config, legacyFallback);
}

function subLibraryForTask(task, config = {}) {
  const subLibraryId = task && task.itemInfo && task.itemInfo.subLibraryId;
  return ((config.subLibraries || []).find((s) => s.uuid === subLibraryId)) || {};
}

function isWesternAiScrape(task, config = {}) {
  if (!task || task.operationKind !== 'scrape') return false;
  const itemInfo = task.itemInfo || {};
  const meta = itemInfo.adultMetadata || {};
  const subLib = subLibraryForTask(task, config);
  const region = meta.region || subLib.adultRegion || '';
  if (region !== 'western_adult') return false;
  const western = {
    ...(((config.adultLibrary || {}).western) || {}),
    ...((subLib && subLib.western) || {}),
  };
  return String(western.computeMode || 'local').toLowerCase() !== 'worker';
}

function resourceForTask(task, config = {}) {
  const operationKind = task && task.operationKind;
  const plannedResourceType = flowPlanner.currentResourceType(task || {});
  if (plannedResourceType === 'transcode') {
    if (task.nodeId) {
      return {
        resourceType: 'worker_transcode',
        resourceKey: `worker:${task.nodeId}`,
        resourceLabel: 'Remote worker transcode',
      };
    }
    return {
      resourceType: 'local_transcode',
      resourceKey: 'local:ffmpeg',
      resourceLabel: 'Local FFmpeg transcode',
    };
  }
  if (plannedResourceType === 'moviepilot') {
    return {
      resourceType: 'moviepilot',
      resourceKey: 'moviepilot',
      resourceLabel: 'MoviePilot',
    };
  }
  if (plannedResourceType === 'emby') {
    return {
      resourceType: 'emby',
      resourceKey: 'emby:metadata',
      resourceLabel: 'Emby metadata repair',
    };
  }
  if (plannedResourceType === 'filesystem') {
    const operationKind = task && task.flowPlan && task.flowPlan.operationKind;
    const suffix = operationKind === 'ingest' || operationKind === 'ingest' ? 'ingest' : 'mutation';
    return {
      resourceType: 'filesystem',
      resourceKey: `filesystem:${suffix}`,
      resourceLabel: suffix === 'ingest' ? 'Filesystem ingest' : 'Filesystem mutation',
    };
  }
  if (plannedResourceType === 'scraper') {
    if (isWesternAiScrape(task, config)) {
      return {
        resourceType: 'local_ai',
        resourceKey: 'local:western-ai',
        resourceLabel: 'Local western AI',
      };
    }
    return {
      resourceType: 'scraper',
      resourceKey: 'scraper:metadata',
      resourceLabel: 'Metadata scraper',
    };
  }
  if (plannedResourceType === 'service_api') {
    return {
      resourceType: 'service_api',
      resourceKey: 'service:task',
      resourceLabel: 'Service task',
    };
  }
  return {
    resourceType: 'unknown',
    resourceKey: `unknown:${operationKind || 'task'}`,
    resourceLabel: 'Unknown resource',
  };
}

function compactTaskTarget(taskTarget) {
  if (!taskTarget || typeof taskTarget !== 'object') return null;
  return {
    object: taskTarget.object && typeof taskTarget.object === 'object' ? { ...taskTarget.object } : {},
    targetGate: taskTarget.targetGate || '',
    gateObjective: taskTarget.gateObjective && typeof taskTarget.gateObjective === 'object'
      ? { ...taskTarget.gateObjective }
      : null,
    source: taskTarget.source || '',
    operationHint: taskTarget.operationHint || '',
  };
}

function compactTask(task, config) {
  const resource = resourceForTask(task, config);
  const step = flowPlanner.currentFlowStep(task || {});
  const resourceState = resourceStateForStatus(task.status);
  return {
    taskId: task.id,
    itemId: task.itemId,
    itemName: task.itemName,
    operationKind: task.operationKind,
    taskTarget: compactTaskTarget(task.taskTarget),
    bridgeKind: task.taskBridge && task.taskBridge.kind,
    flowDirection: task.flowPlan && task.flowPlan.direction,
    operationKind: task.flowPlan && task.flowPlan.operationKind,
    currentEventType: step.eventType,
    currentEventPhase: step.phase,
    source: task.source,
    status: task.status,
    phase: task.phase,
    resumePoint: task.resumePoint,
    priority: task.priority,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    nodeId: task.nodeId || null,
    resourceState,
    ...resource,
  };
}

function makeResourceBucket(taskResource, config) {
  return {
    resourceType: taskResource.resourceType,
    resourceKey: taskResource.resourceKey,
    resourceLabel: taskResource.resourceLabel,
    configuredSlots: concurrencyLimitForResource(taskResource, config),
    running: 0,
    waiting: 0,
    blocked: 0,
    tasks: [],
    events: [],
    eventRunning: 0,
    eventRecent: 0,
    eventFailed: 0,
  };
}

function eventStateForStatus(status) {
  const value = String(status || '').toLowerCase();
  if (EVENT_RUNNING_STATUSES.has(value)) return 'running';
  if (EVENT_FAILED_STATUSES.has(value)) return 'failed';
  return 'recent';
}

function compactRuntimeEvent(event) {
  const resourceType = event.resourceType || 'service';
  const resourceKey = event.resourceKey || resourceType;
  return {
    eventId: event.eventId || event.id,
    eventType: event.eventType,
    eventStatus: event.eventStatus,
    component: event.component,
    resourceType,
    resourceKey,
    resourceLabel: event.resourceLabel || resourceKey,
    taskId: event.taskId || '',
    itemId: event.itemId || '',
    itemName: event.itemName || '',
    subLibraryId: event.subLibraryId || '',
    source: event.source || '',
    startedAt: event.startedAt,
    endedAt: event.endedAt || null,
    durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
    payload: event.payload || {},
    eventState: eventStateForStatus(event.eventStatus),
  };
}

function buildResourceView(tasks = [], config = {}, opts = {}) {
  const startedAtMs = Date.now();
  const resources = new Map();
  const byResourceType = {};
  const byState = { running: 0, waiting: 0, blocked: 0 };
  const byEventStatus = {};

  for (const task of tasks || []) {
    const taskResource = compactTask(task, config);
    const key = taskResource.resourceKey;
    if (!resources.has(key)) resources.set(key, makeResourceBucket(taskResource, config));
    const bucket = resources.get(key);
    bucket[taskResource.resourceState] += 1;
    bucket.tasks.push(taskResource);
    byResourceType[taskResource.resourceType] = (byResourceType[taskResource.resourceType] || 0) + 1;
    byState[taskResource.resourceState] = (byState[taskResource.resourceState] || 0) + 1;
  }

  for (const event of opts.runtimeEvents || []) {
    const compact = compactRuntimeEvent(event);
    const key = compact.resourceKey;
    if (!resources.has(key)) resources.set(key, makeResourceBucket(compact, config));
    const bucket = resources.get(key);
    bucket.events.push(compact);
    if (compact.eventState === 'running') bucket.eventRunning += 1;
    else if (compact.eventState === 'failed') bucket.eventFailed += 1;
    else bucket.eventRecent += 1;
    byResourceType[compact.resourceType] = (byResourceType[compact.resourceType] || 0) + 1;
    byEventStatus[compact.eventStatus] = (byEventStatus[compact.eventStatus] || 0) + 1;
  }

  const resourceList = [...resources.values()].sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
  const slotUsage = opts.slotUsage || {};
  for (const resource of resourceList) {
    if (resource.resourceType === 'local_transcode' || resource.resourceType === 'worker_transcode') {
      resource.deviceSlotUsage = slotUsage;
    }
  }

  const view = {
    summary: {
      totalTasks: tasks.length,
      totalEvents: (opts.runtimeEvents || []).length,
      runningEvents: (opts.runtimeEvents || []).filter((event) => eventStateForStatus(event.eventStatus) === 'running').length,
      recentEvents: (opts.runtimeEvents || []).filter((event) => eventStateForStatus(event.eventStatus) !== 'running').length,
      byResourceType,
      byState,
      byEventStatus,
      generatedAt: new Date().toISOString(),
    },
    resources: resourceList,
  };
  diagnosticLog.record({
    category: 'projection',
    scope: 'resourceProjection.buildResourceView',
    operation: 'build_resource_view',
    component: 'resourceProjection',
    resourceType: 'projection',
    resourceKey: 'resource_view',
    startedAtMs,
    endedAtMs: Date.now(),
    slowMs: 100,
    payload: {
      taskRows: tasks.length,
      runtimeEventRows: (opts.runtimeEvents || []).length,
      resourceBuckets: resourceList.length,
    },
  });
  return view;
}

module.exports = {
  buildResourceView,
  compactRuntimeEvent,
  resourceForTask,
  eventStateForStatus,
  resourceStateForStatus,
};
