'use strict';

const diagnosticLog = require('./diagnosticLog');
const workflowStore = require('./workflowStore');
const resourceGovernor = require('./resourceGovernor');

const ACTIVE_STATUSES = new Set(['executing', 'pausing']);
const BLOCKED_STATUSES = new Set(['awaiting_user_confirm', 'paused']);
const EVENT_RUNNING_STATUSES = new Set(['running', 'executing']);
const EVENT_FAILED_STATUSES = new Set(['failed', 'error']);

function resourceStateForStatus(status) {
  if (ACTIVE_STATUSES.has(status)) return 'running';
  if (BLOCKED_STATUSES.has(status)) return 'blocked';
  return 'waiting';
}

function resourceForPlannedType(task, plannedResourceType, config = {}) {
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
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    const serverId = descriptor.identityPayload && descriptor.identityPayload.serverId || 'default';
    return {
      resourceType: 'emby',
      resourceKey: `emby:${serverId}:api`,
      resourceLabel: 'Emby metadata repair',
    };
  }
  if (plannedResourceType === 'filesystem') {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    const scope = descriptor.subLibraryId || 'default';
    return {
      resourceType: 'filesystem',
      resourceKey: `filesystem:${scope}`,
      resourceLabel: 'Filesystem',
    };
  }
  if (plannedResourceType === 'scraper') {
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
    resourceKey: 'unknown:task',
    resourceLabel: 'Unknown resource',
  };
}

function resourceForTask(task, config = {}) {
  const current = workflowStore.listEvents(task && task.id || '').find((event) => !workflowStore.TERMINAL.has(event.status));
  return resourceForPlannedType(task, current && current.intent && current.intent.resourceRequest && current.intent.resourceRequest.resourceType || 'service_api', config);
}

function resourcesForTask(task, config = {}) {
  const types = workflowStore.listEvents(task && task.id || '').map((event) => event.intent && event.intent.resourceRequest && event.intent.resourceRequest.resourceType).filter(Boolean);
  if (types.length === 0) types.push(resourceForTask(task, config).resourceType);
  const byKey = new Map();
  for (const type of types) {
    const resource = resourceForPlannedType(task, type, config);
    if (resource.resourceType !== 'unknown') byKey.set(resource.resourceKey, resource);
  }
  return [...byKey.values()].sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
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
  };
}

function compactTask(task, config) {
  const resource = resourceForTask(task, config);
  const current = workflowStore.listEvents(task && task.id || '').find((event) => !workflowStore.TERMINAL.has(event.status));
  const step = current ? { eventType: current.capability, phase: current.status } : { eventType: '', phase: '' };
  const resourceState = resourceStateForStatus(task.status);
  const plan = workflowStore.getPlanForTask(task.id);
  return {
    taskId: task.id,
    subjectId: task.subjectId,
    subjectName: task.subjectName,
    taskTarget: compactTaskTarget(task.taskTarget),
    workflowClassification: plan && plan.classification || '',
    currentEventType: step.eventType,
    currentEventPhase: step.phase,
    source: task.source,
    status: task.status,
    phase: task.phase,
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
    configuredSlots: resourceGovernor.capacityFor(taskResource.resourceKey),
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
    subjectId: event.subjectId || '',
    subjectName: event.subjectName || '',
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
  resourcesForTask,
  eventStateForStatus,
  resourceStateForStatus,
};
