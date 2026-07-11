'use strict';

require('./logger'); // intercept console.log/error → data/shelfdeck.log (before any other module)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cors = require('@fastify/cors');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');

const configStore = require('./configStore');
const taskStore = require('./taskStore');
const taskScheduler = require('./taskScheduler');
const healthCheck = require('./healthCheck');
const embyService = require('./services/embyService');
const doubanService = require('./services/doubanService');
const transcodeService = require('./services/transcodeService');
const moviepilotService = require('./services/moviepilotService');
const automationPolicy = require('./automationPolicy');
const activityLog = require('./activityLog');
const spaceStats = require('./spaceStats');
const nodeStore = require('./nodeStore');
const nodeService = require('./nodeService');
const peopleStore = require('./personCatalogStore');
const kairoxSignalBus = require('./kairoxSignalBus');
const adultActorImageSearchService = require('./services/adultActorImageSearchService');
const westernAdultLocalAiService = require('./services/westernAdultLocalAiService');
const metadataStatus = require('./metadataStatus');
const resourceProjection = require('./resourceProjection');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const resourceRuntime = require('./resourceRuntime');
const { getHelixServices } = require('./libraCompositionRoot');
const libraAutomationEngine = require('./libraAutomationEngine');
const resourceGovernor = require('./resourceGovernor');
const kairoxAutomationRunner = require('./kairoxAutomationRunner');
const diagnosticLog = require('./diagnosticLog');
const taskControlPolicy = require('./taskControlPolicy');
const lifecycleProjection = require('./lifecycleProjection');
const operationalMetrics = require('./operationalMetrics');
const workflowStore = require('./workflowStore');

let serverReady = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiError(reply, status, code, message) {
  return reply.code(status).send({ error: { code, message } });
}

function validateAutomationModePatch(reply, input = {}) {
  const legacy = ['automationMode', 'scheduleMode', 'autoCreate', 'autoExecute']
    .filter((field) => Object.prototype.hasOwnProperty.call(input, field));
  if (legacy.length > 0) {
    return apiError(reply, 400, 'HELIX_CLEAN_INIT_REQUIRED', `Legacy automation fields are not accepted: ${legacy.join(', ')}`);
  }
  if (input.libraryAutomationMode !== undefined && !['auto', 'manual'].includes(input.libraryAutomationMode)) {
    return apiError(reply, 400, 'VALIDATION_ERROR', 'libraryAutomationMode must be auto or manual');
  }
  if (input.maintenanceAutomationMode !== undefined && !['auto', 'manual'].includes(input.maintenanceAutomationMode)) {
    return apiError(reply, 400, 'VALIDATION_ERROR', 'maintenanceAutomationMode must be auto or manual');
  }
  return null;
}

function validateSubLibraryMetadataGateInput(reply, subLibCandidate, config) {
  const result = metadataStatus.validateMetadataGateForSubLibrary(subLibCandidate, config);
  if (result.ok) return null;
  return apiError(
    reply,
    400,
    'METADATA_GATE_CONTRACT_BROKEN',
    `metadataGate does not cover optimize inputs: ${result.missingRequirements.join(', ')}`,
  );
}

function defaultRuleTemplateIdForSubLibrary(input = {}) {
  if (input.ruleTemplateId) return input.ruleTemplateId;
  if (input.mediaType === 'adult') {
    return input.adultRegion === 'western_adult' ? 'adult_western_default' : 'adult_jav_default';
  }
  return input.mediaType === 'tv' ? 'tv_default' : 'default';
}

function detectImageContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return 'image/jpeg';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

let sharpModule;
function loadSharp() {
  if (sharpModule !== undefined) return sharpModule;
  try { sharpModule = require('sharp'); } catch (_) { sharpModule = null; }
  return sharpModule;
}

async function referenceImageBuffer(buffer, opts = {}) {
  if (!opts.thumbnail) return { buffer, contentType: detectImageContentType(buffer) };
  const sharp = loadSharp();
  if (!sharp) return { buffer, contentType: detectImageContentType(buffer) };
  try {
    const resized = await sharp(buffer)
      .rotate()
      .resize(96, 96, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 76, mozjpeg: true })
      .toBuffer();
    return { buffer: resized, contentType: 'image/jpeg' };
  } catch (_) {
    return { buffer, contentType: detectImageContentType(buffer) };
  }
}

function taskNeedsFlowCancel(task) {
  return !!task && [
    'executing',
    'pausing',
    'paused',
    'awaiting_user_confirm',
    'interrupted',
    'waiting_media_source',
  ].includes(task.status);
}

const MASKED_SECRET = '********';
const ADULT_WESTERN_SECRET_KEYS = [
  'metadataApiKey',
  'tpdbApiKey',
  'stashBoxApiKey',
  'tmdbApiKey',
  'tmdbReadAccessToken',
];

function maskAdultLibrarySecrets(adultLibrary = {}) {
  const out = {
    ...(adultLibrary || {}),
    western: {
      ...((adultLibrary && adultLibrary.western) || {}),
    },
  };
  for (const key of ADULT_WESTERN_SECRET_KEYS) {
    if (out.western[key]) out.western[key] = MASKED_SECRET;
  }
  return out;
}

function maskSensitive(config) {
  const masked = { ...config };
  if (masked.apiKey) masked.apiKey = MASKED_SECRET;
  if (masked.douban && masked.douban.cookieHeader) {
    masked.douban = { ...masked.douban, cookieHeader: MASKED_SECRET };
  }
  if (masked.moviepilot && masked.moviepilot.apiKey) {
    masked.moviepilot = { ...masked.moviepilot, apiKey: MASKED_SECRET };
  }
  if (masked.adultLibrary) masked.adultLibrary = maskAdultLibrarySecrets(masked.adultLibrary);
  if (masked.embyServers) {
    const servers = {};
    for (const [k, v] of Object.entries(masked.embyServers)) {
      servers[k] = { ...v, accessToken: v.accessToken ? MASKED_SECRET : '' };
    }
    masked.embyServers = servers;
  }
  return masked;
}

function taskListItemInfo(itemInfo = {}) {
  if (!itemInfo || typeof itemInfo !== 'object') return undefined;
  const adultMetadata = itemInfo.adultMetadata && typeof itemInfo.adultMetadata === 'object'
    ? {
      adultId: itemInfo.adultMetadata.adultId,
      scrapeStatus: itemInfo.adultMetadata.scrapeStatus,
      region: itemInfo.adultMetadata.region,
      protagonist: itemInfo.adultMetadata.protagonist,
    }
    : undefined;
  const compact = {
    name: itemInfo.name,
    title: itemInfo.title,
    type: itemInfo.type,
    seriesName: itemInfo.seriesName,
    seasonNumber: itemInfo.seasonNumber,
    source: itemInfo.source,
    watched: itemInfo.watched,
    metadataStatus: itemInfo.metadataStatus,
    metadataComplete: itemInfo.metadataComplete,
    metadataMissingReasons: itemInfo.metadataMissingReasons,
    metadataKind: itemInfo.metadataKind,
    path: itemInfo.path,
    subLibraryId: itemInfo.subLibraryId,
    adultMetadata,
    originalSizeBytes: itemInfo.originalSizeBytes,
    originalBitrate: itemInfo.originalBitrate,
    originalVideoCodec: itemInfo.originalVideoCodec,
    originalAudioCodec: itemInfo.originalAudioCodec,
    originalWidth: itemInfo.originalWidth,
    originalHeight: itemInfo.originalHeight,
  };
  Object.keys(compact).forEach((key) => {
    if (compact[key] === undefined || compact[key] === null) delete compact[key];
  });
  return Object.keys(compact).length > 0 ? compact : undefined;
}

function taskListSummary(task) {
  const plan = workflowStore.getPlanForTask(task.id);
  const workflowEvents = plan ? workflowStore.listEvents(task.id) : [];
  const currentEvent = workflowEvents.find((event) => !workflowStore.TERMINAL.has(event.status)) || null;
  return {
    id: task.id,
    itemId: task.itemId,
    itemName: task.itemName,
    taskTarget: task.taskTarget,
    workflowSummary: plan ? { planId: plan.planId, schemaVersion: plan.schemaVersion, classification: plan.classification, targetGate: plan.targetGate, eventCount: plan.nodes.length } : null,
    currentEvent: currentEvent ? { eventId: currentEvent.eventId, capability: currentEvent.capability, status: currentEvent.status, resourceKey: currentEvent.resourceKey } : null,
    eventProgress: plan ? { completed: workflowEvents.filter((event) => ['succeeded', 'skipped'].includes(event.status)).length, total: workflowEvents.length } : null,
    source: task.source,
    status: task.status,
    progress: task.progress,
    phase: task.phase,
    retryCount: Number(task.retryCount || 0) || 0,
    nodeId: task.nodeId,
    approval: task.approval,
    priority: task.priority,
    maintenanceRun: task.maintenanceRun || null,
    maintenancePrioritySnapshot: task.maintenancePrioritySnapshot || { class: 'normal', revision: 0 },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    itemInfo: taskListItemInfo(task.itemInfo),
    verifyResult: task.verifyResult,
    confirmData: task.confirmData,
    metadataStatus: task.itemInfo && task.itemInfo.metadataStatus,
    metadataMissingReasons: task.itemInfo && task.itemInfo.metadataMissingReasons,
  };
}

function publicNodeSummary(node) {
  if (!node) return null;
  return {
    id: node.id,
    name: node.name,
    address: node.address,
    status: node.status,
  };
}

function nodeResourceContext(node) {
  return {
    resourceType: 'worker_node',
    resourceKey: `node:${node.id}`,
    resourceLabel: node.name || node.address || node.id,
    nodeId: node.id,
  };
}

function activeNodeTaskSummaries(nodeId) {
  return taskStore.queryTaskSummaries({ nodeId, statuses: ['executing'] }, {
    includeHistory: false,
    includeAll: true,
    orderBy: 'updatedAt',
    orderDir: 'desc',
  }).tasks.map(taskListSummary);
}

const TASK_ATTENTION_QUEUES = {
  needs_action: {
    key: 'needs_action',
    label: '需要处理',
    hint: '等待确认、可恢复、可重试和待手动启动',
  },
  confirmation: {
    key: 'confirmation',
    label: '等待确认',
    hint: '需要用户确认后继续',
  },
  recovery: {
    key: 'recovery',
    label: '可恢复/重试',
    hint: '暂停、中断或失败后可继续处理',
  },
  manual_start: {
    key: 'manual_start',
    label: '待手动启动',
    hint: '需要用户手动开始后进入调度队列',
  },
};

function taskAttentionKeys(task) {
  const controlState = taskControlPolicy.buildTaskControlState(task);
  const primaryAction = controlState.primaryAction || '';
  const executeEffect = controlState.actions
    && controlState.actions.execute
    && controlState.actions.execute.effect;
  const keys = new Set();

  if (primaryAction === 'confirm') keys.add('confirmation');
  if (primaryAction === 'retry') keys.add('recovery');
  if (primaryAction === 'execute') {
    if (executeEffect === 'queue_for_scheduler_dispatch') keys.add('manual_start');
    if (
      executeEffect === 'resume_from_pause'
      || executeEffect === 'resume_after_interruption'
      || executeEffect === 'clear_pause_request'
    ) {
      keys.add('recovery');
    }
  }
  if (keys.size > 0) keys.add('needs_action');
  return keys;
}

function taskMatchesAttention(task, attentionKey) {
  if (!TASK_ATTENTION_QUEUES[attentionKey]) return false;
  return taskAttentionKeys(task).has(attentionKey);
}

function buildAttentionSummary(tasks) {
  const summary = {};
  for (const [key, def] of Object.entries(TASK_ATTENTION_QUEUES)) {
    summary[key] = { ...def, count: 0 };
  }
  for (const task of tasks || []) {
    for (const key of taskAttentionKeys(task)) {
      if (summary[key]) summary[key].count += 1;
    }
  }
  return summary;
}

const TASK_ATTENTION_CANDIDATE_STATUSES = [
  'awaiting_user_confirm',
  'created',
  'pending_manual',
  'interrupted',
  'paused',
  'pausing',
  'failed_hard',
  'failed_soft',
];

function attentionFactsFilter(filter = {}) {
  const out = { ...(filter || {}) };
  const candidateSet = new Set(TASK_ATTENTION_CANDIDATE_STATUSES);
  const requested = [];
  if (out.status) requested.push(String(out.status));
  if (Array.isArray(out.statuses)) {
    for (const status of out.statuses) requested.push(String(status || '').trim());
  }
  const filtered = requested.length > 0
    ? requested.filter((status) => candidateSet.has(status))
    : TASK_ATTENTION_CANDIDATE_STATUSES;
  delete out.status;
  out.statuses = [...new Set(filtered)].filter(Boolean);
  return out;
}

function queryAttentionTasks(filter = {}) {
  const attentionFilter = attentionFactsFilter(filter);
  if (!Array.isArray(attentionFilter.statuses) || attentionFilter.statuses.length === 0) return [];
  return taskStore.queryTaskLifecycleAuditFacts(attentionFilter, {
    orderBy: 'updatedAt',
    orderDir: 'desc',
  });
}

function workflowClassificationForTask(task = {}) {
  const plan = task.id ? workflowStore.getPlanForTask(task.id) : null;
  return String(plan && plan.classification || '');
}

function compactTaskRouteFilter(filter = {}) {
  return {
    status: filter.status || '',
    statuses: Array.isArray(filter.statuses) ? filter.statuses.length : undefined,
    targetGate: filter.targetGate || '',
    hasSearch: !!filter.q,
  };
}

function applyTaskTargetQuery(filter, query = {}) {
  if (query.targetGate) filter.targetGate = query.targetGate;
  return filter;
}

function primaryAttentionQueue(attentionSummary = {}) {
  const order = ['needs_action', 'confirmation', 'recovery', 'manual_start'];
  for (const key of order) {
    const queue = attentionSummary[key];
    if (queue && Number(queue.count || 0) > 0) return queue;
  }
  return null;
}

function buildStatusSummary(tasks) {
  const byStatus = {};
  for (const task of tasks || []) {
    const status = task && task.status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return byStatus;
}

const TASK_LIFECYCLE_STAGE_DEFS = {
  intake: {
    key: 'intake',
    label: 'Created or waiting for manual start',
    statuses: ['created', 'pending_manual'],
  },
  queued: {
    key: 'queued',
    label: 'Queued for scheduler dispatch',
    statuses: ['queued'],
  },
  running: {
    key: 'running',
    label: 'Executing flow events',
    statuses: ['executing', 'pausing_requested'],
  },
  user_gate: {
    key: 'user_gate',
    label: 'Waiting for user confirmation',
    statuses: ['awaiting_user_confirm'],
  },
  recovery_hold: {
    key: 'recovery_hold',
    label: 'Paused or interrupted and needs recovery',
    statuses: ['paused', 'interrupted'],
  },
  terminal_success: {
    key: 'terminal_success',
    label: 'Finished or skipped',
    statuses: ['done', 'skipped'],
  },
  terminal_failure: {
    key: 'terminal_failure',
    label: 'Failed or cancelled',
    statuses: ['failed_hard', 'cancelled'],
  },
};

function taskLifecycleStage(status) {
  const s = String(status || '').trim();
  for (const def of Object.values(TASK_LIFECYCLE_STAGE_DEFS)) {
    if (def.statuses.includes(s)) return def.key;
  }
  return 'unknown';
}

function inc(map, key, by = 1) {
  const k = String(key || 'unknown') || 'unknown';
  map[k] = (map[k] || 0) + by;
}

function makeLifecycleBucket(key, base = {}) {
  return {
    key,
    ...base,
    total: 0,
    byStatus: {},
    byLifecycleStage: {},
    byTargetGate: {},
    byWorkflowClassification: {},
    bySource: {},
    active: 0,
    terminal: 0,
    failed: 0,
    awaitingUser: 0,
  };
}

function addTaskToLifecycleBucket(bucket, task, stage) {
  const status = task.status || 'unknown';
  const targetGate = task.taskTarget && task.taskTarget.targetGate || task.targetGate || 'unknown';
  const classification = workflowClassificationForTask(task) || 'unplanned';
  bucket.total += 1;
  inc(bucket.byStatus, status);
  inc(bucket.byLifecycleStage, stage);
  inc(bucket.byTargetGate, targetGate);
  inc(bucket.byWorkflowClassification, classification);
  inc(bucket.bySource, task.source || 'unknown');
  if (!['done', 'skipped', 'failed_hard', 'cancelled'].includes(status)) bucket.active += 1;
  else bucket.terminal += 1;
  if (status === 'failed_hard' || status === 'cancelled') bucket.failed += 1;
  if (status === 'awaiting_user_confirm') bucket.awaitingUser += 1;
}

function taskSubLibraryId(task) {
  return task && task.itemInfo && task.itemInfo.subLibraryId
    || '';
}

function taskLibraryContext(task, subLibrariesById) {
  const subLibraryId = taskSubLibraryId(task);
  const subLibrary = subLibraryId ? subLibrariesById.get(subLibraryId) : null;
  const itemInfo = task && task.itemInfo || {};
  const inferredAdult = itemInfo.adultMetadata || task && task.source === 'adult_folder';
  const inferredTv = itemInfo.type === 'season' || itemInfo.type === 'episode';
  const mediaType = subLibrary && subLibrary.mediaType
    || (inferredAdult ? 'adult' : inferredTv ? 'tv' : 'unknown');
  const source = subLibrary && subLibrary.source || (inferredAdult ? 'folder' : 'unknown');
  return {
    subLibraryId: subLibraryId || '',
    subLibraryName: subLibrary && subLibrary.name || (subLibraryId ? '(missing sub-library)' : '(no sub-library)'),
    librarySource: source,
    mediaType,
    adultRegion: subLibrary && subLibrary.adultRegion || itemInfo.adultMetadata && itemInfo.adultMetadata.region || '',
    found: !!subLibrary,
  };
}

function addLifecycleSignal(signals, signal, sampleLimit) {
  const code = signal.code || 'unknown';
  const severity = signal.severity || 'info';
  inc(signals.byCode, code);
  inc(signals.bySeverity, severity);
  signals.total += 1;
  if (signals.items.length < sampleLimit) signals.items.push(signal);
}

function taskLifecycleSignals(task, context, controlState) {
  const signals = [];
  const status = task.status || '';
  const targetGate = task.taskTarget && task.taskTarget.targetGate || task.targetGate || '';
  const workflowEvents = workflowStore.listEvents(task.id);
  const confirmationRequired = controlState && controlState.confirmation && controlState.confirmation.required;

  if (!context.subLibraryId) {
    signals.push({ severity: 'warn', code: 'missing_sub_library_context', message: 'Task has no subLibraryId in its lightweight facts.' });
  } else if (!context.found) {
    signals.push({ severity: 'warn', code: 'unknown_sub_library', message: 'Task references a sub-library that is not present in config.' });
  }
  if (!targetGate) {
    signals.push({ severity: 'warn', code: 'missing_target_gate', message: 'Task has no Lifecycle target gate.' });
  }
  if (task.status === 'executing' && workflowEvents.length === 0) {
    signals.push({ severity: 'error', code: 'executing_without_workflow', message: 'Executing Task has no durable Workflow Graph.' });
  }
  if (status === 'awaiting_user_confirm' && !confirmationRequired) {
    signals.push({ severity: 'error', code: 'awaiting_without_confirmation_gate', message: 'Task status is awaiting confirmation but controlState has no active confirmation gate.' });
  }
  if (status === 'executing' && !task.phase) {
    signals.push({ severity: 'warn', code: 'executing_without_phase', message: 'Executing task has no current phase.' });
  }
  if (status === 'failed_hard' && !(controlState && controlState.recovery && controlState.recovery.reason)) {
    signals.push({ severity: 'warn', code: 'failed_without_recovery_reason', message: 'Failed task does not expose a recovery reason.' });
  }
  return signals;
}

function buildTaskLifecycleAudit(tasks, config, opts = {}) {
  const sampleLimit = Math.min(50, Math.max(1, Number(opts.sampleLimit) || 12));
  const subLibrariesById = new Map((config.subLibraries || []).map((sl) => [sl.uuid, sl]));
  const byLibraryType = {};
  const bySubLibraryMap = new Map();
  const byLifecycleStage = {};
  const summary = makeLifecycleBucket('all', {});
  const signals = { total: 0, bySeverity: {}, byCode: {}, items: [] };

  for (const task of tasks || []) {
    const context = taskLibraryContext(task, subLibrariesById);
    const stage = taskLifecycleStage(task.status);
    const stageDef = TASK_LIFECYCLE_STAGE_DEFS[stage] || { key: stage, label: 'Unknown lifecycle stage', statuses: [] };
    const controlState = taskControlPolicy.buildTaskControlState(task);

    if (!byLifecycleStage[stage]) {
      byLifecycleStage[stage] = { key: stage, label: stageDef.label, statuses: stageDef.statuses || [], count: 0 };
    }
    byLifecycleStage[stage].count += 1;

    if (!byLibraryType[context.mediaType]) {
      byLibraryType[context.mediaType] = makeLifecycleBucket(context.mediaType, {
        mediaType: context.mediaType,
      });
    }
    const subKey = context.subLibraryId || '(none)';
    if (!bySubLibraryMap.has(subKey)) {
      bySubLibraryMap.set(subKey, makeLifecycleBucket(subKey, {
        subLibraryId: context.subLibraryId,
        name: context.subLibraryName,
        mediaType: context.mediaType,
        source: context.librarySource,
        adultRegion: context.adultRegion,
        found: context.found,
      }));
    }

    addTaskToLifecycleBucket(summary, task, stage);
    addTaskToLifecycleBucket(byLibraryType[context.mediaType], task, stage);
    addTaskToLifecycleBucket(bySubLibraryMap.get(subKey), task, stage);

    for (const signal of taskLifecycleSignals(task, context, controlState)) {
      addLifecycleSignal(signals, {
        ...signal,
        taskId: task.id,
        itemId: task.itemId,
        itemName: task.itemName || task.itemInfo && task.itemInfo.name || '',
        status: task.status || '',
        lifecycleStage: stage,
        targetGate: task.taskTarget && task.taskTarget.targetGate || task.targetGate || '',
        workflowClassification: workflowClassificationForTask(task),
        source: task.source || '',
        subLibraryId: context.subLibraryId,
        subLibraryName: context.subLibraryName,
        mediaType: context.mediaType,
      }, sampleLimit);
    }
  }

  return {
    total: summary.total,
    summary,
    byLifecycleStage,
    byLibraryType,
    bySubLibrary: [...bySubLibraryMap.values()].sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return String(a.name || a.key).localeCompare(String(b.name || b.key));
    }),
    signals,
  };
}

function sortTasksForAdminList(tasks) {
  return [...(tasks || [])].sort((a, b) => {
    const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function paginateTasks(tasks, page, pageSize) {
  const start = (page - 1) * pageSize;
  return tasks.slice(start, start + pageSize);
}

function summarizeConfirmationQueue(tasks = []) {
  const byGate = {};
  const byTargetGate = {};
  const byWorkflowClassification = {};
  for (const task of tasks || []) {
    const control = taskControlPolicy.buildTaskControlState(task);
    const gate = control.confirmation && control.confirmation.gateId || 'unknown';
    const targetGate = task.taskTarget && task.taskTarget.targetGate || task.targetGate || 'unknown';
    const classification = workflowClassificationForTask(task) || 'unplanned';
    byGate[gate] = (byGate[gate] || 0) + 1;
    byTargetGate[targetGate] = (byTargetGate[targetGate] || 0) + 1;
    byWorkflowClassification[classification] = (byWorkflowClassification[classification] || 0) + 1;
  }
  return {
    total: tasks.length,
    byGate,
    byTargetGate,
    byWorkflowClassification,
  };
}

function summarizeAdultReviewQueue(items = []) {
  const byReviewStatus = {};
  const byScrapeStatus = {};
  const byRegion = {};
  for (const item of items || []) {
    const reviewStatus = item.reviewStatus || item.scrapeStatus || 'unknown';
    const scrapeStatus = item.scrapeStatus || 'unknown';
    const region = item.adultRegion || 'unknown';
    byReviewStatus[reviewStatus] = (byReviewStatus[reviewStatus] || 0) + 1;
    byScrapeStatus[scrapeStatus] = (byScrapeStatus[scrapeStatus] || 0) + 1;
    byRegion[region] = (byRegion[region] || 0) + 1;
  }
  return {
    total: items.length,
    byReviewStatus,
    byScrapeStatus,
    byRegion,
  };
}

function adultReviewReason(item) {
  const reviewStatus = item && item.reviewStatus || '';
  const scrapeStatus = item && item.scrapeStatus || '';
  const idConfidence = item && item.idConfidence || '';
  if (scrapeStatus === 'ambiguous' || idConfidence === 'low') return 'adult_identity_ambiguous';
  if (reviewStatus === 'needs_review' || scrapeStatus === 'needs_review') return 'adult_scrape_result_needs_review';
  return 'adult_item_requires_user_review';
}

function adultReviewQueueItem(item) {
  const reason = adultReviewReason(item);
  const message = reason === 'adult_identity_ambiguous'
    ? 'Adult item identity is ambiguous and requires user confirmation.'
    : 'Adult scrape result requires user review before it can be treated as complete.';
  return {
    id: `adult-review:${item.itemId}`,
    kind: 'adult_review',
    itemId: item.itemId,
    itemName: item.name || item.adultTitle || item.adultId || '',
    source: item.source || 'adult_folder',
    subLibraryId: item.subLibraryId || '',
    status: item.reviewStatus || item.scrapeStatus || 'needs_review',
    updatedAt: item.updatedAt || '',
    workflowSummary: { targetGate: 'metadata', classification: 'adult_review', reason },
    itemInfo: {
      name: item.name || item.adultTitle || item.adultId || '',
      title: item.adultTitle || '',
      type: item.type || '',
      source: item.source || 'adult_folder',
      path: item.path || '',
      subLibraryId: item.subLibraryId || '',
      metadataStatus: item.metadataStatus || '',
      metadataComplete: !!item.metadataComplete,
      metadataKind: item.metadataKind || 'adult',
      metadataMissingReasons: Array.isArray(item.metadataMissingReasons) ? item.metadataMissingReasons : [],
      adultMetadata: {
        adultId: item.adultId || '',
        scrapeStatus: item.scrapeStatus || '',
        reviewStatus: item.reviewStatus || '',
        region: item.adultRegion || '',
        idConfidence: item.idConfidence || '',
        title: item.adultTitle || '',
        originalTitle: item.adultOriginalTitle || '',
        protagonist: item.protagonist,
        scrapeError: item.scrapeError || '',
        scrapeFailedAt: item.scrapeFailedAt || '',
      },
    },
    confirmation: {
      required: true,
      gateId: reason,
      message,
      options: reason === 'adult_identity_ambiguous'
        ? ['correct_identity', 'rescrape_after_fix']
        : ['approve_result', 'rescrape'],
      effect: 'user_must_review_adult_metadata_before_metadata_ready',
      whyRequired: reason,
    },
    confirmAction: {
      enabled: false,
      reason: 'adult_review_requires_dedicated_metadata_review',
      label: 'review',
      endpoint: `/v1/admin/adult/items/${encodeURIComponent(item.itemId)}`,
      method: 'GET',
      effect: 'open_adult_item_review',
    },
    recovery: {
      state: 'user_review_required',
      reason,
      nextAction: 'review',
    },
  };
}

function confirmationQueueItem(task) {
  const controlState = taskControlPolicy.buildTaskControlState(task);
  const confirmation = controlState.confirmation || {};
  const plan = workflowStore.getPlanForTask(task.id);
  const waitingEvent = workflowStore.listEvents(task.id).find((event) => event.status === 'waiting_for_approval') || null;
  return {
    kind: 'task_confirmation',
    id: task.id,
    taskId: task.id,
    itemId: task.itemId,
    itemName: task.itemName || '',
    targetGate: task.taskTarget && task.taskTarget.targetGate || task.targetGate || '',
    workflowClassification: plan && plan.classification || '',
    currentEvent: waitingEvent ? { eventId: waitingEvent.eventId, capability: waitingEvent.capability, status: waitingEvent.status } : null,
    source: task.source || '',
    status: task.status,
    phase: task.phase || '',
    retryCount: Number(task.retryCount || 0) || 0,
    priority: task.priority,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    itemInfo: taskListItemInfo(task.itemInfo),
    confirmation: {
      required: !!confirmation.required,
      gateId: confirmation.gateId || '',
      message: confirmation.message || '',
      options: Array.isArray(confirmation.options) ? confirmation.options : [],
      effect: confirmation.effect || '',
      whyRequired: confirmation.gateId || confirmation.message
        ? 'flow_gate_requires_user_decision'
        : 'task_is_waiting_for_user_confirmation',
    },
    confirmAction: controlState.actions && controlState.actions.confirm,
    recovery: controlState.recovery,
    controlState,
  };
}

function compactFaceForUi(face, opts = {}) {
  if (!face || typeof face !== 'object') return face;
  const { embedding, vector, descriptor, ...rest } = face;
  if (!opts.includeSampleImage) delete rest.sampleImageBase64;
  return rest;
}

function compactAdultMetadataForUi(metadata, opts = {}) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const allowedKeys = [
    'adultId',
    'idConfidence',
    'title',
    'originalTitle',
    'source',
    'sourceUrl',
    'scrapeStatus',
    'reviewStatus',
    'region',
    'scraperType',
    'posterPath',
    'fanartPath',
    'nfoPath',
    'fileNfoPath',
    'markerPath',
    'organized',
    'originalFolder',
    'studio',
    'director',
    'premiered',
    'actors',
    'protagonist',
    'scrapeError',
    'scrapeFailedAt',
    'generatedTitle',
    'generatedDescription',
  ];
  const compact = {};
  for (const key of allowedKeys) {
    if (metadata[key] !== undefined) compact[key] = metadata[key];
  }
  if (Array.isArray(metadata.faceClusters)) {
    compact.faceClusters = opts.includeFaces
      ? metadata.faceClusters.map((face) => compactFaceForUi(face, opts))
      : [];
  }
  if (Array.isArray(metadata.unknownFaces)) {
    compact.unknownFaces = opts.includeFaces
      ? metadata.unknownFaces.map((face) => compactFaceForUi(face, opts))
      : [];
  }
  return compact;
}

function buildDashboardAutomation(config) {
  const subLibraries = Array.isArray(config.subLibraries) ? config.subLibraries : [];
  return {
    libraryAutomation: {
      autoLibraries: subLibraries.filter((item) => item.libraryAutomationMode === 'auto').length,
      manualLibraries: subLibraries.filter((item) => item.libraryAutomationMode !== 'auto').length,
      status: libraAutomationEngine.getHealth().status || 'starting',
    },
    maintenanceAutomation: {
      autoLibraries: subLibraries.filter((item) => item.maintenanceAutomationMode === 'auto').length,
      manualLibraries: subLibraries.filter((item) => item.maintenanceAutomationMode !== 'auto').length,
      status: kairoxAutomationRunner.getHealth().status || 'starting',
    },
  };
}

const DASHBOARD_HEALTH_LABELS = {
  api: 'Service API',
  scheduler: 'Task Scheduler',
  libraryAutomation: 'Library Automation',
  transcode: 'Transcode Runtime',
  emby: 'Emby',
  douban: 'Douban',
  upgrade: 'MoviePilot',
};

function aggregateDashboardStatus(items) {
  const statuses = (items || []).map((item) => item && item.status).filter(Boolean);
  if (statuses.includes('red')) return 'red';
  if (statuses.includes('yellow')) return 'yellow';
  return 'green';
}

function dashboardHealthCheckItem(key, item = {}) {
  return {
    key,
    label: DASHBOARD_HEALTH_LABELS[key] || key,
    status: item.status || 'green',
    message: item.message || '',
  };
}

function buildDashboardServiceProjection(health) {
  const checks = health && health.checks && typeof health.checks === 'object' ? health.checks : {};
  const serviceKeys = ['scheduler', 'libraryAutomation', 'transcode'];
  const externalKeys = ['emby', 'douban', 'upgrade'];
  const serviceChecks = [
    dashboardHealthCheckItem('api', { status: 'green', message: 'Admin API is responding' }),
    ...serviceKeys
      .filter((key) => checks[key])
      .map((key) => dashboardHealthCheckItem(key, checks[key])),
  ];
  const externalChecks = externalKeys
    .filter((key) => checks[key])
    .map((key) => dashboardHealthCheckItem(key, checks[key]));
  const serviceAvailability = {
    status: aggregateDashboardStatus(serviceChecks),
    checks: serviceChecks,
    generatedAt: health && health.timestamp ? health.timestamp : null,
  };
  const externalIntegrations = {
    status: aggregateDashboardStatus(externalChecks),
    checks: externalChecks,
    generatedAt: health && health.timestamp ? health.timestamp : null,
  };
  return {
    status: aggregateDashboardStatus([serviceAvailability, externalIntegrations]),
    serviceAvailability,
    externalIntegrations,
  };
}

function buildDashboardHealthSignals(mediaStats, taskStats, config, automation = {}) {
  const signals = [];
  const push = (level, code, label, count, detail = '') => {
    if (!count) return;
    signals.push({ level, code, label, count, detail });
  };

  push('red', 'failed_tasks', '失败任务', taskStats.failedTasks, '先到任务中心查看实现路径和 event 历史');
  push('red', 'blocked_maintenance_runs', '维护运行故障', mediaStats.blockedRunItems, '请在高级日志中查看最终失败证据');
  push('yellow', 'awaiting_confirmation', '等待确认', taskStats.awaitingConfirmationTasks, '需要人工确认后才能继续');
  push('yellow', 'metadata_incomplete', '元数据未完成', mediaStats.metadataIncompleteItems, '会阻断当前维护目标');
  push('yellow', 'pending_optimization', '等待优化', mediaStats.pendingOptimizationItems, '推荐动作仍未闭环');
  push('yellow', 'open_lifecycle', '未闭环媒体', mediaStats.openItems, '仍有业务桥需要推进');

  return signals.slice(0, 10);
}

function queryDashboardMediaStatsFromHelix() {
  const items = getHelixServices().libraService.queryLibraryProjections({}).items;
  return {
    totalItems: items.length,
    activeItems: items.filter((item) => item.helix.membership.status === 'active').length,
    closedItems: items.filter((item) => item.helix.membership.status === 'closed').length,
    quarantinedItems: items.filter((item) => item.helix.quarantine.status !== 'none').length,
    metadataIncompleteItems: items.filter((item) => !item.metadataComplete).length,
    pendingOptimizationItems: items.filter((item) => item.helix.maintenance.nextTargetGate === 'optimize').length,
    openItems: items.filter((item) => !item.maintenanceComplete && item.helix.membership.status === 'active').length,
    maintenanceCompleteItems: items.filter((item) => item.maintenanceComplete).length,
    blockedRunItems: items.filter((item) => item.helix.maintenance.run && item.helix.maintenance.run.status === 'blocked').length,
    offboardingCandidateItems: items.filter((item) => item.helix.maintenance.disposalRecommendation).length,
    totalBytes: items.reduce((sum, item) => sum + (Number(item.size) || 0), 0),
  };
}

function dashboardBusinessStatus(signals) {
  if ((signals || []).some((signal) => signal.level === 'red')) return 'red';
  if ((signals || []).some((signal) => signal.level === 'yellow')) return 'yellow';
  return 'green';
}

const DASHBOARD_ACTION_LABELS = {
  basedata: '基础信息',
  scrape: '刮削',
  transcode: '转码压缩',
  upgrade: '洗版',
};

const DASHBOARD_TASK_EVENT_LABELS = {
  'task.created': '任务创建',
  'flow.planned': '路径规划',
  'flow.dispatched': '开始执行',
  'flow.failed': '执行失败',
  'scrape.metadata_gate_failed': '元数据完整性未满足',
  'task.confirmed': '用户确认',
  'task.execute_requested': '请求执行',
  'task.pause_requested': '请求暂停',
  'task.cancel_requested': '请求取消',
  'task.status_changed': '状态变化',
  'task.manual_execute_requested': '手动启动',
  'task.paused': '已暂停',
  'task.resumed': '已恢复',
  'task.awaiting_confirmation': '等待确认',
  'task.failed': '任务失败',
  'task.retry_requested': '请求重试',
  'task.retry_recorded': '重试入队',
  'task.restart_interrupted': '重启中断',
  'task.restart_recovery_queued': '恢复入队',
  'task.restart_recovery_failed': '恢复失败',
  'task.deleted': '任务删除',
};

function dashboardEventSeverityFromTaskEvent(event) {
  const status = event && event.eventStatus ? String(event.eventStatus) : '';
  const type = event && event.eventType ? String(event.eventType) : '';
  if (status === 'failed_hard' || status === 'failed_soft' || type.includes('failed')) return 'red';
  if (status === 'interrupted' || type.includes('interrupted')) return 'yellow';
  if (status === 'awaiting_user_confirm' || type.includes('confirmation')) return 'yellow';
  if (status === 'done' || type.includes('recovery_queued') || type.includes('retry')) return 'green';
  return 'neutral';
}

function dashboardActivitySeverity(entry) {
  const source = entry && entry.source ? String(entry.source) : '';
  const message = entry && entry.message ? String(entry.message) : '';
  if (/失败|异常|error|failed/i.test(message)) return 'red';
  if (/等待|跳过|未启用|warning|warn/i.test(message)) return 'yellow';
  if (source === 'health' && /恢复/.test(message)) return 'green';
  return 'neutral';
}

function dashboardActivitySourceLabel(source) {
  switch (source) {
    case 'media_library': return '媒体库';
    case 'adult_library': return '成人库';
    case 'douban': return '豆瓣';
    case 'strategy_engine':
    case 'optimize_target_projection':
      return '优化目标';
    case 'smart_task_engine': return '自动入队';
    case 'task': return '任务';
    case 'health': return '健康';
    case 'user_action': return '用户';
    default: return source || '系统';
  }
}

function dashboardTaskEventMessage(event) {
  const label = DASHBOARD_TASK_EVENT_LABELS[event.eventType] || event.eventType || '任务事件';
  const targetGate = event.payload && event.payload.taskTarget && event.payload.taskTarget.targetGate || '';
  const action = DASHBOARD_ACTION_LABELS[targetGate] || targetGate || '任务';
  const resource = event.resourceLabel || event.resourceType || '';
  if (resource) return `${label}：${action} · ${resource}`;
  return `${label}：${action}`;
}

function countDashboardEventSources(events) {
  const bySource = {};
  for (const event of events || []) {
    const key = event.source || 'system';
    bySource[key] = (bySource[key] || 0) + 1;
  }
  return bySource;
}

function buildDashboardEvents(limit = 15) {
  const eventLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 15));
  const activityEvents = activityLog.getRecent(eventLimit).map((entry, index) => ({
    id: `activity:${entry.ts || index}:${entry.source || 'system'}`,
    kind: 'activity',
    source: entry.source || 'system',
    sourceLabel: dashboardActivitySourceLabel(entry.source || 'system'),
    ts: entry.ts,
    severity: dashboardActivitySeverity(entry),
    message: entry.message || '',
    detail: entry.detail && typeof entry.detail === 'object' ? entry.detail : undefined,
  }));
  const taskEvents = (typeof taskStore.queryRecentTaskEvents === 'function'
    ? taskStore.queryRecentTaskEvents({ pageSize: eventLimit })
    : taskStore.queryTaskEvents({}, { pageSize: eventLimit, orderDir: 'desc' }).events
  ).map((event) => ({
    id: `task_event:${event.id}`,
    kind: 'task_event',
    source: 'task_event',
    sourceLabel: '任务事件',
    ts: event.createdAt,
    severity: dashboardEventSeverityFromTaskEvent(event),
    message: dashboardTaskEventMessage(event),
    taskId: event.taskId || '',
    itemId: event.itemId || '',
    eventType: event.eventType || '',
    eventStatus: event.eventStatus || '',
    resourceType: event.resourceType || '',
    resourceKey: event.resourceKey || '',
    resourceLabel: event.resourceLabel || '',
  }));
  const recent = [...activityEvents, ...taskEvents]
    .filter((event) => event.ts && event.message)
    .sort((a, b) => {
      const bTime = Date.parse(b.ts || '') || 0;
      const aTime = Date.parse(a.ts || '') || 0;
      if (bTime !== aTime) return bTime - aTime;
      return String(b.id).localeCompare(String(a.id));
    })
    .slice(0, eventLimit);
  return {
    latestAt: recent[0] ? recent[0].ts : null,
    bySource: countDashboardEventSources(recent),
    recent,
  };
}

function isTaskIntentValidationReason(reason) {
  return [
    'missing_task_intent',
    'invalid_gate',
    'invalid_bridge_kind',
    'invalid_target_gate',
    'missing_item_id',
    'delete_is_not_optimize',
  ].includes(reason);
}

function compactAdmissionOptimizeGate(gate) {
  if (!gate || typeof gate !== 'object') return undefined;
  const result = {
    gate: gate.gate || 'optimize',
    status: gate.status || '',
    reason: gate.reason || '',
    operation: gate.operation || '',
    target: gate.target,
    observed: gate.observed,
    failureReasons: gate.failureReasons,
    evidenceLevel: gate.evidenceLevel || '',
  };
  Object.keys(result).forEach((key) => {
    if (result[key] === undefined || result[key] === null || result[key] === '') delete result[key];
    if (Array.isArray(result[key]) && result[key].length === 0) delete result[key];
  });
  return result;
}

function compactAdmissionReject(admission = {}) {
  const result = {
    targetGate: admission.targetGate || '',
    reason: admission.reason || '',
    supportedEntry: admission.supportedEntry || '',
    supportedFlows: admission.supportedFlows || admission.supportedOperations,
    metadataMissingReasons: admission.metadataMissingReasons,
    activeTaskId: admission.activeTaskId || '',
    activeTaskTargetGate: admission.activeTaskBridge || '',
    optimizeGate: compactAdmissionOptimizeGate(admission.optimizeGate),
    failureHandling: admission.failureHandling,
    mediaFreeze: admission.mediaFreeze,
    frozenUntil: admission.frozenUntil,
    freezeReason: admission.freezeReason,
    sourceTaskId: admission.sourceTaskId,
    sourceTargetGate: admission.sourceTargetGate,
    sourceFlowKind: admission.sourceFlowKind,
  };
  Object.keys(result).forEach((key) => {
    if (result[key] === undefined || result[key] === null || result[key] === '') delete result[key];
    if (Array.isArray(result[key]) && result[key].length === 0) delete result[key];
  });
  return result;
}

function taskAdmissionRejectMessage(admission = {}) {
  if (admission.reason === 'media_frozen') {
    return `媒体冻结中，等待外部系统完成后处理。冻结至 ${admission.frozenUntil || '稍后'}`;
  }
  return admission.reason || 'task_admission_rejected';
}

function compactAdmissionAccept(admission = {}) {
  const result = {
    allowed: true,
    targetGate: admission.targetGate || '',
    reason: admission.reason || 'allowed',
    intentMode: admission.intentMode || '',
    requestedIntent: admission.requestedIntent,
    taskTarget: admission.taskTarget,
  };
  Object.keys(result).forEach((key) => {
    if (result[key] === undefined || result[key] === null || result[key] === '') delete result[key];
    if (Array.isArray(result[key]) && result[key].length === 0) delete result[key];
  });
  return result;
}

function taskAdmissionRejectPayload(code, message, admission, item, itemInfo, config, tasks, extra = {}) {
  const subject = item
    ? { ...item, ...(itemInfo || {}) }
    : (itemInfo || null);
  return {
    error: { code, message },
    admission: compactAdmissionReject(admission),
    lifecycleProjection: subject ? lifecycleProjection.resolveLifecycle(subject, config) : null,
    ...extra,
  };
}

function latestTaskEvent(taskId) {
  if (!taskId) return null;
  const result = taskStore.queryTaskEvents({ taskId }, { pageSize: 1, orderDir: 'desc' });
  return result.events && result.events[0] ? result.events[0] : null;
}

function taskDetailView(task, opts = {}) {
  if (!task || typeof task !== 'object') return task;
  const itemInfo = task.itemInfo && typeof task.itemInfo === 'object'
    ? {
      ...task.itemInfo,
      adultMetadata: compactAdultMetadataForUi(task.itemInfo.adultMetadata, {
        includeFaces: false,
        includeSampleImage: false,
      }),
    }
    : task.itemInfo;
  const latestEvent = opts.latestEvent === undefined ? latestTaskEvent(task.id) : opts.latestEvent;
  return {
    ...task,
    itemInfo,
    latestEvent,
  };
}

function taskActionResponse(task) {
  const fresh = task && task.id ? (taskStore.getTask(task.id) || task) : task;
  return {
    id: fresh.id,
    status: fresh.status,
    updatedAt: fresh.updatedAt,
    controlState: taskControlPolicy.buildTaskControlState(fresh, { latestEvent: latestTaskEvent(fresh.id) }),
  };
}

function taskActionReject(reply, task, actionName, code, message, extra = {}) {
  const fresh = task && task.id ? (taskStore.getTask(task.id) || task) : task;
  const latestEvent = fresh && fresh.id ? latestTaskEvent(fresh.id) : null;
  const controlState = fresh ? taskControlPolicy.buildTaskControlState(fresh, { latestEvent }) : null;
  const action = controlState && controlState.actions ? controlState.actions[actionName] : null;
  return reply.code(409).send({
    error: { code, message },
    task: fresh ? taskListSummary(fresh) : null,
    actionName,
    action: action || null,
    controlState,
    recovery: controlState ? controlState.recovery : null,
    ...extra,
  });
}

function activeTaskConflictFor(itemId, excludeTaskId) {
  if (!itemId) return null;
  return taskStore.queryTaskSummaries({ itemId }, {
    includeHistory: false,
    includeAll: true,
    orderBy: 'updatedAt',
    orderDir: 'desc',
  }).tasks.find((t) => t.id !== excludeTaskId) || null;
}

function activeTaskAdmissionSummary(itemId, activeTaskId) {
  if (!itemId) return null;
  const activeTasks = taskStore.queryTaskSummaries({ itemId }, {
    includeHistory: false,
    includeAll: true,
    orderBy: 'updatedAt',
    orderDir: 'desc',
  }).tasks;
  const active = activeTaskId
    ? activeTasks.find((t) => t.id === activeTaskId)
    : activeTasks[0];
  return active ? taskListSummary(active) : null;
}

function activeTaskSummariesForItem(itemId) {
  if (!itemId) return [];
  return activeTaskSummariesForItems([itemId]);
}

function activeTaskSummariesForItems(itemIds) {
  const ids = [...new Set((itemIds || []).map((itemId) => String(itemId || '').trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  return taskStore.queryTaskSummaries({ itemIds: ids }, {
    includeHistory: false,
    includeAll: true,
    orderBy: 'updatedAt',
    orderDir: 'desc',
  }).tasks;
}

function activeTaskItemIds() {
  return new Set(taskStore.queryTaskSummaries({}, {
    includeHistory: false,
    includeAll: true,
    orderBy: 'updatedAt',
    orderDir: 'desc',
  }).tasks.map((task) => task.itemId).filter(Boolean));
}

function getTaskActionOrReject(reply, task, actionName) {
  const action = taskControlPolicy.getTaskAction(task, actionName);
  if (!action.enabled) {
    taskActionReject(reply, task, actionName, 'TASK_ACTION_REJECTED', action.reason || 'action_not_available');
    return null;
  }
  return action;
}

function appendTaskControlEvent(task, actionName, action, payload = {}) {
  if (!task || !task.id || !actionName) return null;
  return taskStore.appendTaskEvent(task, `task.${actionName}_requested`, {
    requestedBy: 'user',
    actionName,
    actionEffect: action && action.effect || '',
    fromStatus: task.status || '',
    ...payload,
  });
}

function diagnosticMatchesFailureEvent(log, event, task) {
  if (!log || !event) return false;
  const payload = log.payload && typeof log.payload === 'object' ? log.payload : {};
  if (payload.taskId && payload.taskId === event.taskId) return true;
  if (payload.itemId && payload.itemId === event.itemId) return true;
  if (task && payload.taskId && payload.taskId === task.id) return true;
  if (task && payload.itemId && payload.itemId === task.itemId) return true;
  if (log.resourceKey && event.resourceKey && log.resourceKey === event.resourceKey) return true;
  if (log.resourceType && event.resourceType && log.resourceType === event.resourceType && log.status === 'failed') return true;
  return false;
}

function compactFailureDiagnostic(log) {
  if (!log) return null;
  const payload = log.payload && typeof log.payload === 'object' ? log.payload : {};
  return {
    logId: log.logId || log.id || '',
    scope: log.scope || '',
    operation: log.operation || '',
    component: log.component || '',
    status: log.status || '',
    resourceType: log.resourceType || '',
    resourceKey: log.resourceKey || '',
    endedAt: log.endedAt || '',
    error: payload.error || payload.reason || '',
  };
}

function latestTaskErrorSummary(task) {
  const logs = Array.isArray(task && task.logs) ? task.logs : [];
  const latestError = [...logs].reverse().find((entry) => {
    const level = String(entry && entry.level || '').toLowerCase();
    return level === 'error' || level === 'fatal';
  });
  if (!latestError) return null;
  return {
    message: String(latestError.msg || latestError.message || ''),
    level: String(latestError.level || ''),
    ts: String(latestError.ts || latestError.at || ''),
    source: 'task_log',
  };
}

function compactFailureSummary(event, diagnostic, task) {
  const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
  const embedded = payload.failureSummary && typeof payload.failureSummary === 'object'
    ? payload.failureSummary
    : null;
  const taskLogSummary = latestTaskErrorSummary(task);
  const diagnosticPayload = diagnostic && diagnostic.payload && typeof diagnostic.payload === 'object'
    ? diagnostic.payload
    : {};
  const message = (embedded && embedded.message)
    || (taskLogSummary && taskLogSummary.message)
    || payload.errorMessage
    || payload.message
    || payload.error
    || payload.reason
    || diagnosticPayload.error
    || diagnosticPayload.reason
    || '';
  const level = (embedded && embedded.level) || (message ? 'error' : '');
  const ts = (embedded && embedded.ts) || (taskLogSummary && taskLogSummary.ts) || (event && event.createdAt) || (diagnostic && diagnostic.endedAt) || '';
  const source = (embedded && embedded.source)
    || (taskLogSummary && taskLogSummary.source)
    || (payload.errorMessage ? 'flow_event' : '')
    || (payload.message || payload.error || payload.reason ? 'event_payload' : '')
    || (diagnostic ? 'diagnostic_log' : '');
  return {
    message: String(message || ''),
    level: String(level || ''),
    ts: String(ts || ''),
    source: String(source || ''),
    errorName: payload.errorName || '',
  };
}

function enrichFailureEvent(event, config, diagnosticRows = []) {
  const task = event && event.taskId ? taskStore.getTask(event.taskId) : null;
  const latestEvent = event || null;
  const controlState = task ? taskControlPolicy.buildTaskControlState(task, { latestEvent }) : null;
  const taskResource = task ? resourceProjection.resourceForTask(task, config) : null;
  const diagnostic = diagnosticRows.find((log) => diagnosticMatchesFailureEvent(log, event, task));
  const recovery = controlState && controlState.recovery ? controlState.recovery : {
    state: 'task_not_found',
    reason: 'task_record_missing',
    nextAction: 'inspect_event',
  };
  return {
    ...event,
    task: task ? {
      id: task.id,
      itemId: task.itemId,
      itemName: task.itemName || '',
      status: task.status,
      phase: task.phase || '',
      retryCount: Number(task.retryCount || 0) || 0,
      targetGate: task.taskTarget && task.taskTarget.targetGate || task.targetGate || '',
      workflowClassification: workflowStore.getPlanForTask(task.id)?.classification || '',
    } : null,
    resourceContext: {
      resourceType: event.resourceType || (taskResource && taskResource.resourceType) || '',
      resourceKey: event.resourceKey || (taskResource && taskResource.resourceKey) || '',
      resourceLabel: event.resourceLabel || (taskResource && taskResource.resourceLabel) || '',
    },
    recovery,
    controlState,
    diagnosticSummary: compactFailureDiagnostic(diagnostic),
    failureSummary: compactFailureSummary(event, diagnostic, task),
  };
}

function enrichFailureEvents(events, config, diagnosticRows = []) {
  return (events || []).map((event) => enrichFailureEvent(event, config, diagnosticRows));
}

async function fetchImageAsBase64(url) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('imageUrl must be http(s)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(u, { signal: controller.signal });
    if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.startsWith('image/')) throw new Error(`URL did not return an image (${ct})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('Image download returned empty body');
    if (buf.length > 8 * 1024 * 1024) throw new Error('Image is too large');
    return { base64: buf.toString('base64'), contentType: ct || 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

function getEmbyServerConfig(embyServerId) {
  const cfg = configStore.loadConfig();
  const servers = cfg.embyServers || {};
  if (embyServerId) return servers[embyServerId] || null;
  const first = Object.keys(servers)[0];
  return first ? servers[first] : null;
}

function resolveEmbyConfigForLibrary(subLibraryId) {
  const cfg = configStore.loadConfig();
  const subLibs = cfg.subLibraries || [];
  let subLib;
  if (subLibraryId) {
    subLib = subLibs.find((s) => s.uuid === subLibraryId);
    if (!subLib) return { error: { code: 'NOT_FOUND', message: 'SubLibrary not found' } };
  } else {
    subLib = subLibs[0];
    if (!subLib) return { error: { code: 'NOT_FOUND', message: 'No subLibraries configured' } };
  }
  const servers = cfg.embyServers || {};
  const serverConfig = servers[subLib.embyServerId];
  if (!serverConfig || !serverConfig.baseUrl) {
    return { error: { code: 'EMBY_UNREACHABLE', message: 'Emby server not configured for this subLibrary' } };
  }
  return { subLib, serverConfig };
}

function resolveEmbyConfigForItem(itemId, subLibraryId) {
  const library = getHelixServices().libraService.queryLibraryProjections({ itemId }, { limit: 1 });
  const libItem = library.items[0] || null;
  const descriptor = libItem && libItem.helix && libItem.helix.source && libItem.helix.source.sourceAccessDescriptor || {};
  const identity = descriptor.identityPayload || {};
  const resolvedSubLibraryId = subLibraryId || (libItem && libItem.subLibraryId) || descriptor.subLibraryId || '';
  if (resolvedSubLibraryId) {
    const resolved = resolveEmbyConfigForLibrary(resolvedSubLibraryId);
    if (!resolved.error) {
      resolved.libItem = libItem || null;
      resolved.embyItemId = identity.embyItemId || descriptor.locator && descriptor.locator.sourceRefId || '';
      if (!resolved.embyItemId) return { error: { code: 'NOT_FOUND', message: 'Emby SourceBinding is unavailable for this item' } };
    }
    return resolved;
  }
  return { error: { code: 'NOT_FOUND', message: 'Cannot determine subLibrary for this item' } };
}

// ── Route Registration ──────────────────────────────────────────────────────

function registerRoutes(app) {
  // ── Health ──────────────────────────────────────────────────────────────

  app.get('/v1/health', async () => {
    return healthCheck.getPublicResult();
  });

  // ── Tasks ───────────────────────────────────────────────────────────────

  app.post('/v1/admin/library/actions/onboard', async (req, reply) => {
    const body = req.body || {};
    if (!body.idempotencyKey || !body.sourceReference) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'idempotencyKey and sourceReference are required');
    }
    try {
      const result = await Promise.resolve(getHelixServices().libraService.acceptSource({
        itemId: body.itemId,
        idempotencyKey: body.idempotencyKey,
        sourceReference: body.sourceReference,
        requestedBy: 'admin_api',
      }));
      return reply.code(202).send(result);
    } catch (error) {
      return apiError(reply, error.code === 'LIBRA_IDEMPOTENCY_CONFLICT' ? 409 : 400, error.code || 'HELIX_ONBOARDING_FAILED', error.message);
    }
  });

  async function maintenanceIntentRoute(req, reply, method, acceptedStatus = 202) {
    const body = req.body || {};
    if (!body.idempotencyKey) return apiError(reply, 400, 'VALIDATION_ERROR', 'idempotencyKey is required');
    if (['targetGate', 'gateObjective', 'flowKind', 'executor'].some((field) => body[field] !== undefined)) {
      return apiError(reply, 400, 'KAIROX_MAINTENANCE_INTENT_INVALID', 'Maintenance intent does not accept Gate or Flow fields');
    }
    try {
      const result = await Promise.resolve(getHelixServices().libraService[method]({
        itemId: req.params.itemId,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason || '',
      }));
      kairoxAutomationRunner.wake({ itemId: req.params.itemId, kind: method });
      libraAutomationEngine.wake();
      return reply.code(acceptedStatus).send(result);
    } catch (error) {
      const statusCode = error.code === 'LIBRA_ITEM_NOT_FOUND' ? 404
        : error.code === 'KAIROX_MAINTENANCE_INTENT_INVALID' || error.code === 'LIBRA_IDEMPOTENCY_KEY_REQUIRED' ? 400 : 409;
      return apiError(reply, statusCode, error.code || 'KAIROX_MAINTENANCE_INTENT_REJECTED', error.message);
    }
  }

  app.post('/v1/admin/library/items/:itemId/actions/start-maintenance', async (req, reply) => (
    maintenanceIntentRoute(req, reply, 'requestMaintenanceRun')
  ));

  app.post('/v1/admin/library/items/:itemId/actions/prioritize-maintenance', async (req, reply) => (
    maintenanceIntentRoute(req, reply, 'setMaintenancePriority')
  ));

  app.post('/v1/admin/library/items/:itemId/actions/cancel-maintenance-priority', async (req, reply) => (
    maintenanceIntentRoute(req, reply, 'clearMaintenancePriority')
  ));

  app.post('/v1/admin/library/items/:itemId/actions/offboard', async (req, reply) => {
    const body = req.body || {};
    if (!body.idempotencyKey) return apiError(reply, 400, 'VALIDATION_ERROR', 'idempotencyKey is required');
    try {
      const result = await getHelixServices().libraService.requestOffboarding({
        itemId: req.params.itemId,
        idempotencyKey: body.idempotencyKey,
        cleanupMode: body.cleanupMode || 'retain_source',
        reason: body.reason || '',
        destructiveAuthorization: body.destructiveAuthorization === true,
      });
      return reply.code(202).send(result);
    } catch (error) {
      const statusCode = error.code === 'LIBRA_ITEM_NOT_FOUND' ? 404 : 409;
      return apiError(reply, statusCode, error.code || 'HELIX_OFFBOARDING_FAILED', error.message);
    }
  });

  app.get('/v1/tasks', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    applyTaskTargetQuery(filter, req.query);
    const includeHistory = req.query.includeHistory === '1' || req.query.includeHistory === 'true';
    const activeOnly = !includeHistory || req.query.activeOnly === '1' || req.query.activeOnly === 'true';
    if (activeOnly) {
      const tasks = taskStore.queryTaskSummaries(filter, {
        includeHistory: false,
        includeAll: true,
        orderBy: 'updatedAt',
        orderDir: 'desc',
      }).tasks;
      return { tasks: tasks.map(taskListSummary) };
    }
    const tasks = taskStore.getTasks(filter);
    return { tasks: tasks.map((task) => ({ ...task, controlState: taskControlPolicy.buildTaskControlState(task) })) };
  });

  app.get('/v1/tasks/:id/events', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50));
    return taskStore.queryTaskEvents({ taskId: task.id }, { page, pageSize, orderDir: 'asc' });
  });

  app.get('/v1/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const detail = taskDetailView(task);
    if (req.query.includeEvents === '1' || req.query.includeEvents === 'true') {
      detail.events = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 200 }).events;
    }
    return detail;
  });

  app.get('/v1/tasks/:id/report', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const plan = workflowStore.getPlanForTask(task.id);
    const capabilities = plan ? plan.nodes.map((node) => node.capability) : [];
    if (task.status !== 'done' && task.status !== 'failed_hard') {
      return apiError(reply, 400, 'BAD_REQUEST', 'Task not completed yet');
    }

    const info = task.itemInfo || {};
    const vr = task.verifyResult || {};
    const logs = task.logs || [];
    const firstTs = logs.length > 0 ? new Date(logs[0].ts) : null;
    const lastTs = logs.length > 0 ? new Date(logs[logs.length - 1].ts) : null;
    const elapsedSec = firstTs && lastTs ? Math.round((lastTs.getTime() - firstTs.getTime()) / 1000) : null;

    // Find encoder info from logs
    const encoderLog = logs.find((l) => l.msg && l.msg.startsWith('Encoder:'));
    const encoder = encoderLog ? encoderLog.msg.replace('Encoder: ', '') : null;

    const report = {
      taskId: task.id,
      itemId: task.itemId,
      itemName: (info.type === 'season' && info.seriesName && info.seasonNumber != null
        ? `${info.seriesName} 第${info.seasonNumber}季`
        : (task.itemName || task.itemId)),
      workflowClassification: plan && plan.classification || '',
      capabilities,
      elapsedSec,
      encoder,
    };

    if (capabilities.includes('media.transcode')) {
      report.original = {
        sizeBytes: info.originalSizeBytes || info.size,
        videoCodec: info.originalVideoCodec || info.codec || '?',
        bitrate: info.originalBitrate || info.bitrate || 0,
        width: info.originalWidth,
        height: info.originalHeight,
        audioCodec: info.originalAudioCodec,
      };
      report.output = {
        sizeBytes: vr.sizeBytes,
        videoCodec: vr.videoCodec,
        bitrate: vr.bitrate,
        width: vr.width,
        height: vr.height,
      };
      report.bytesSaved = vr.bytesSaved || ((report.original.sizeBytes || 0) - (report.output.sizeBytes || 0));
    } else if (capabilities.includes('source.upgrade.request')) {
      report.original = {
        sizeBytes: info.originalSizeBytes || info.size,
        videoCodec: info.originalVideoCodec || info.codec || '?',
        bitrate: info.originalBitrate || info.bitrate || 0,
        width: info.originalWidth,
        height: info.originalHeight,
        resolution: info.resolution,
        audioCodec: info.originalAudioCodec,
      };
      report.output = {
        sizeBytes: vr.sizeBytes,
        videoCodec: vr.videoCodec,
        bitrate: vr.bitrate,
        width: vr.width,
        height: vr.height,
      };
      const up = task.upgradePreview;
      if (up) {
        report.bytesSaved = up.bytesSaved || ((report.original.sizeBytes || 0) - (report.output.sizeBytes || 0));
        report.tmdbVerified = up.tmdbVerified;
      }
    } else if (task.taskTarget && task.taskTarget.targetGate === 'metadata') {
      const projection = getHelixServices().libraService.getLibraryProjection(task.itemId);
      const maintenance = projection && projection.maintenance || {};
      const metadataFacts = maintenance.metadataFacts || {};
      report.metadata = {
        itemId: task.itemId,
        name: metadataFacts.title || metadataFacts.name || task.itemName || '',
        source: projection && projection.source && projection.source.sourceAccessDescriptor && projection.source.sourceAccessDescriptor.sourceType || '',
        mediaPath: maintenance.basedataFacts && maintenance.basedataFacts.path || '',
        metadataStatus: maintenance.metadataPassed ? 'complete' : 'missing',
        metadataMissingReasons: maintenance.metadataGate && maintenance.metadataGate.missingReasons || [],
      };
      report.metadataFacts = metadataFacts;
    }

    return report;
  });

  app.get('/v1/tasks/:id/preview', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task || !task.verifyResult || !task.verifyResult.previewPath) {
      return apiError(reply, 404, 'NOT_FOUND', 'Preview not available');
    }
    const filePath = task.verifyResult.previewPath;
    let stat;
    try { stat = fs.statSync(filePath); } catch {
      return apiError(reply, 404, 'NOT_FOUND', 'Preview file not found');
    }
    const fileSize = stat.size;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace('bytes=', '').split('-');
      const start = parseInt(parts[0], 10) || 0;
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(filePath, { start, end });
      reply.raw.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      stream.pipe(reply.raw);
      return;
    }

    reply.header('Content-Type', 'video/mp4');
    reply.header('Content-Length', fileSize);
    reply.header('Accept-Ranges', 'bytes');
    return reply.send(fs.createReadStream(filePath));
  });

  app.post('/v1/tasks/:id/actions/confirm', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const { confirmData } = req.body || {};
    const action = getTaskActionOrReject(reply, task, 'confirm');
    if (!action) return;

    // Store user selection data (e.g. selectedIndex for upgrade flow)
    if (confirmData) {
      taskStore.updateTask(task.id, { confirmData });
    }

    resourceRuntime.confirmTask(taskStore.getTask(task.id) || task);
    const updated = taskStore.getTask(task.id);
    if (updated) {
      taskStore.appendTaskEvent(updated, 'task.confirmed', {
        requestedBy: 'user',
        actionName: 'confirm',
        actionEffect: action.effect || '',
        fromStatus: task.status || '',
        toStatus: updated.status || '',
        gateId: task.approval && task.approval.gateId || '',
        confirmDataKeys: confirmData && typeof confirmData === 'object' ? Object.keys(confirmData) : [],
      });
    }
    return taskActionResponse(updated);
  });

  // ── Library ─────────────────────────────────────────────────────────────

  function parseLibraryQuery(query = {}) {
    const filter = {};
    if (query.source) filter.source = query.source;
    if (query.type) filter.type = query.type;
    if (query.subLibraryId) filter.subLibraryId = query.subLibraryId;
    if (query.search) filter.search = query.search;
    if (query.resolution) filter.resolution = query.resolution;
    if (query.codec) filter.codec = query.codec;
    if (query.watched === 'watched') filter.watched = true;
    if (query.watched === 'unwatched') filter.watched = false;
    if (query.bluRay === 'disc') filter.isBluRayDisc = true;
    if (query.bluRay === 'not_disc') filter.isBluRayDisc = false;
    if (query.douban === 'none') filter.doubanStars = null;
    else if (query.douban) filter.doubanStars = Number(query.douban);
    if (query.userRating === 'none') filter.userRating = null;
    else if (query.userRating) filter.userRating = Number(query.userRating);
    if (query.task === 'active' || query.task === 'none') {
      filter.taskState = query.task;
      filter.activeTaskIds = activeTaskItemIds();
    }
    const metadataQuery = query.metadata || query.metadataStatus || query.scrape;
    if (metadataQuery) {
      const metadataStatus = String(metadataQuery).toLowerCase();
      const allowedMetadataFilters = new Set(['done', 'pending', 'failed', 'complete', 'missing', 'ambiguous', 'needs_review']);
      if (allowedMetadataFilters.has(metadataStatus)) filter.metadataStatus = metadataStatus;
    }
    if (query.lifecycle) filter.lifecycle = query.lifecycle;
    const rawPageSize = Number(query.pageSize);
    const rawPage = Number(query.page);
    const rawLimit = Number(query.limit);
    const rawOffset = Number(query.offset);
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.min(500, Math.floor(rawPageSize)) : null;
    const pageNumber = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
    const limit = pageSize || (Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(500, Math.floor(rawLimit)) : null);
    const offset = pageSize
      ? (pageNumber - 1) * pageSize
      : (Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0);
    return { filter, page: { limit, offset } };
  }

  function compactLibraryRouteFilter(filter = {}) {
    return {
      source: filter.source || '',
      type: filter.type || '',
      subLibraryId: filter.subLibraryId || '',
      resolution: filter.resolution || '',
      codec: filter.codec || '',
      watched: filter.watched === undefined ? undefined : !!filter.watched,
      isBluRayDisc: filter.isBluRayDisc === undefined ? undefined : !!filter.isBluRayDisc,
      hasSearch: !!filter.search,
      hasDoubanStarsFilter: filter.doubanStars !== undefined,
      hasUserRatingFilter: filter.userRating !== undefined,
      taskState: filter.taskState || '',
      activeTaskItemCount: filter.activeTaskIds instanceof Set ? filter.activeTaskIds.size : undefined,
      metadataStatus: filter.metadataStatus || '',
      lifecycle: filter.lifecycle || '',
    };
  }

  function truthyQueryFlag(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  function falseQueryFlag(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off';
  }

  function libraryProjectionFromQuery(query = {}, fallback = 'summary') {
    const raw = String(query.projection || fallback || 'summary').trim().toLowerCase();
    const projection = ['manage', 'full', 'compat'].includes(raw) ? raw : 'summary';
    const heavy = projection === 'manage' || projection === 'full' || projection === 'compat';
    return {
      projection,
      includeOptimizationStatus: heavy || truthyQueryFlag(query.includeOptimizationStatus),
      includeBusinessFlow: heavy || truthyQueryFlag(query.includeBusinessFlow),
    };
  }

  function libraryRouteDiagnostic(route, filter, page, projection, fn) {
    return diagnosticLog.track({
      category: 'api',
      scope: `route.${route}`,
      operation: 'http_get',
      component: 'admin-web-api',
      resourceType: 'service_api',
      resourceKey: route,
      slowMs: 250,
      payload: {
        route,
        filter: compactLibraryRouteFilter(filter),
        page: {
          limit: page.limit || null,
          offset: page.offset || 0,
          pageSize: page.limit || null,
        },
        projection: {
          name: projection.projection,
          includeOptimizationStatus: !!projection.includeOptimizationStatus,
          includeBusinessFlow: !!projection.includeBusinessFlow,
          compactAdultMetadata: true,
        },
      },
      successPayload: (result) => ({
        rowCount: result && Array.isArray(result.items) ? result.items.length : 0,
        total: result && typeof result.total === 'number' ? result.total : undefined,
      }),
    }, fn);
  }

  app.get('/v1/library', async (req) => {
    const { filter, page } = parseLibraryQuery(req.query);
    const projection = libraryProjectionFromQuery(req.query, 'summary');
    return libraryRouteDiagnostic('/v1/library', filter, page, projection, () => runtimeResourceTracker.trackEvent({
      eventType: 'library.query',
      component: 'admin-web-api',
      resourceType: 'service_api',
      resourceKey: 'service:library.query',
      resourceLabel: 'Library query',
      subLibraryId: filter.subLibraryId || '',
      payload: { route: '/v1/library', filter, page },
      successPayload: (result) => ({
        itemCount: result && Array.isArray(result.items) ? result.items.length : 0,
        total: result && typeof result.total === 'number' ? result.total : undefined,
      }),
    }, () => {
      const result = getHelixServices().libraService.queryLibraryProjections(filter, page);
      // Attach embyWebUrl for desktop play button
      const cfg = configStore.loadConfig();
      const servers = cfg.embyServers || {};
      const subLibs = cfg.subLibraries || [];
      for (const item of result.items) {
        const sl = subLibs.find((s) => s.uuid === item.subLibraryId);
        if (sl && servers[sl.embyServerId] && servers[sl.embyServerId].baseUrl) {
          const embyItemId = item.embyItemId;
          if (embyItemId) {
            item.embyWebUrl = `${String(servers[sl.embyServerId].baseUrl).replace(/\/+$/, '')}/web/index.html#!/item?id=${embyItemId}`;
          }
        }
      }
      return result;
    }));
  });

  app.get('/v1/library/queries/manage', async (req) => {
    const { filter, page } = parseLibraryQuery(req.query);
    const projection = libraryProjectionFromQuery(req.query, 'manage');
    return libraryRouteDiagnostic('/v1/library/queries/manage', filter, page, projection, () => runtimeResourceTracker.trackEvent({
      eventType: 'library.query',
      component: 'admin-web-api',
      resourceType: 'service_api',
      resourceKey: 'service:library.query',
      resourceLabel: 'Library query',
      subLibraryId: filter.subLibraryId || '',
      payload: { route: '/v1/library/queries/manage', filter, page },
      successPayload: (result) => ({
        itemCount: result && Array.isArray(result.items) ? result.items.length : 0,
        total: result && typeof result.total === 'number' ? result.total : undefined,
      }),
    }, () => {
      return getHelixServices().libraService.queryLibraryProjections(filter, page);
    }));
  });

  app.get('/v1/library/items/:itemId', async (req, reply) => {
    const result = getHelixServices().libraService.queryLibraryProjections({ itemId: req.params.itemId }, { limit: 1 });
    if (!result.items[0]) return apiError(reply, 404, 'NOT_FOUND', 'Item not found');
    return result.items[0];
  });

  app.patch('/v1/admin/library/items/:itemId/perception', async (req, reply) => {
    const { userRating } = req.body || {};
    if (typeof userRating !== 'number' && userRating !== null) return apiError(reply, 400, 'VALIDATION_ERROR', 'userRating is required');
    if (userRating !== null && (userRating < 1 || userRating > 5)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'userRating must be 1-5');
    }
    try {
      const perception = getHelixServices().libraService.updateUserPerception({
        itemId: req.params.itemId,
        facts: { userRating },
        evidence: { source: 'admin_user_rating' },
      });
      return { ok: true, perception };
    } catch (e) {
      const statusCode = e.code === 'LIBRA_ITEM_NOT_FOUND' ? 404 : 409;
      return apiError(reply, statusCode, e.code || 'USER_PERCEPTION_REJECTED', e.message);
    }
  });

  app.get('/v1/admin/tasks/:taskId/workflow', async (req, reply) => {
    const task = taskStore.getTask(req.params.taskId);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const plan = workflowStore.getPlanForTask(task.id);
    if (!plan) return apiError(reply, 404, 'NOT_FOUND', 'Workflow not planned');
    return { plan, events: workflowStore.listEvents(task.id) };
  });

  app.get('/v1/admin/diagnostics/events', async (req) => ({
    events: workflowStore.queryEvents({ taskId: req.query.taskId, capability: req.query.capability, status: req.query.status }, { limit: req.query.limit }),
  }));

  app.get('/v1/admin/diagnostics/event-performance', async () => ({ groups: workflowStore.performanceSnapshot() }));

  app.get('/v1/library/status', async () => {
    const cfg = configStore.loadConfig();
    return {
      subLibraries: (cfg.subLibraries || []).map((subLibrary) => ({
        uuid: subLibrary.uuid,
        name: subLibrary.name,
        enabled: subLibrary.enabled !== false,
        source: subLibrary.source || 'emby',
        mediaType: subLibrary.mediaType || 'movie',
        libraryAutomationMode: subLibrary.libraryAutomationMode,
        maintenanceAutomationMode: subLibrary.maintenanceAutomationMode,
      })),
      libraAutomation: libraAutomationEngine.getHealth(),
    };
  });

  app.get('/v1/admin/automation', async () => ({
    libraryAutomation: libraAutomationEngine.getHealth(),
    maintenanceAutomation: kairoxAutomationRunner.getHealth(),
    resources: resourceGovernor.snapshot(),
  }));

  app.get('/v1/admin/cleanup-recommendations', async () => {
    const items = getHelixServices().libraService.queryLibraryProjections({}).items;
    const candidates = items
      .filter((item) => item.helix && item.helix.maintenance && item.helix.maintenance.disposalRecommendation)
      .map((item) => ({
        itemId: item.itemId,
        itemName: item.name || item.title || item.itemId,
        subLibraryId: item.subLibraryId || '',
        membership: item.helix.membership,
        phase: item.helix.phase,
        recommendation: item.helix.maintenance.disposalRecommendation,
      }));
    return { candidates, total: candidates.length };
  });

  // ── Scoped Admin Settings ───────────────────────────────────────────────

  app.get('/v1/admin/settings/resources', async () => {
    const cfg = configStore.loadConfig();
    return {
      resourceLimits: cfg.resourceLimits,
      workspace: {
        transcodeTempRoot: cfg.transcodeTempRoot || '',
        upgradeStagingLocalPath: cfg.upgradeStagingLocalPath || '',
        metadataArtifacts: cfg.workspaces && cfg.workspaces.metadataArtifacts || '',
      },
      compute: {
        transcodeEncodingDevices: cfg.transcodeEncodingDevices || [],
        transcodeCpuParticipationStrategy: cfg.transcodeCpuParticipationStrategy || 'normal',
      },
      internal: resourceGovernor.snapshot(),
    };
  });

  app.patch('/v1/admin/settings/resources', async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const current = configStore.loadConfig();
    const limits = { ...(current.resourceLimits || {}), ...((body.resourceLimits && typeof body.resourceLimits === 'object') ? body.resourceLimits : {}) };
    for (const [key, value] of Object.entries(limits)) {
      if (!['embyApiPerServer', 'filesystemPerVolume', 'localFfmpeg', 'workerPerNode'].includes(key)
        || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 64) {
        return apiError(reply, 400, 'RESOURCE_LIMIT_INVALID', `Invalid resource limit: ${key}`);
      }
      limits[key] = Number(value);
    }
    const patch = { resourceLimits: limits };
    if (body.workspace && typeof body.workspace === 'object') {
      if (body.workspace.transcodeTempRoot !== undefined) patch.transcodeTempRoot = String(body.workspace.transcodeTempRoot || '').trim();
      if (body.workspace.upgradeStagingLocalPath !== undefined) patch.upgradeStagingLocalPath = String(body.workspace.upgradeStagingLocalPath || '').trim();
      if (body.workspace.metadataArtifacts !== undefined) {
        const metadataArtifacts = String(body.workspace.metadataArtifacts || '').trim();
        const nextConfig = { ...current, workspaces: { ...(current.workspaces || {}), metadataArtifacts } };
        const probe = require('./metadataArtifactWorkspace').probeWorkspace(nextConfig);
        patch.workspaces = { ...(current.workspaces || {}), metadataArtifacts };
        patch.metadataArtifactsProbe = probe;
      }
    }
    if (body.compute && typeof body.compute === 'object') {
      if (body.compute.transcodeEncodingDevices !== undefined) patch.transcodeEncodingDevices = body.compute.transcodeEncodingDevices;
      if (body.compute.transcodeCpuParticipationStrategy !== undefined) patch.transcodeCpuParticipationStrategy = body.compute.transcodeCpuParticipationStrategy;
    }
    const updated = configStore.patchConfig(patch);
    return {
      resourceLimits: updated.resourceLimits,
      workspace: { transcodeTempRoot: updated.transcodeTempRoot || '', upgradeStagingLocalPath: updated.upgradeStagingLocalPath || '', metadataArtifacts: updated.workspaces && updated.workspaces.metadataArtifacts || '' },
      metadataArtifacts: require('./metadataArtifactWorkspace').probeWorkspace(updated),
      compute: { transcodeEncodingDevices: updated.transcodeEncodingDevices || [], transcodeCpuParticipationStrategy: updated.transcodeCpuParticipationStrategy || 'normal' },
      internal: resourceGovernor.snapshot(),
    };
  });

  app.get('/v1/admin/settings/security', async () => {
    const cfg = configStore.loadConfig();
    return { apiKeyConfigured: !!cfg.apiKey, apiKey: cfg.apiKey ? MASKED_SECRET : '', environmentManaged: !!(process.env.MEDIA_SERVICE_API_KEY || process.env.CONTROL_PLANE_API_KEY) };
  });

  app.patch('/v1/admin/settings/security', async (req, reply) => {
    if (process.env.MEDIA_SERVICE_API_KEY || process.env.CONTROL_PLANE_API_KEY) {
      return apiError(reply, 409, 'SECURITY_ENVIRONMENT_MANAGED', 'API key is managed by the deployment environment');
    }
    const apiKey = String(req.body && req.body.apiKey || '').trim();
    if (apiKey && apiKey.length < 16) return apiError(reply, 400, 'SECURITY_API_KEY_TOO_SHORT', 'API key must contain at least 16 characters');
    configStore.patchConfig({ apiKey });
    return { apiKeyConfigured: !!apiKey, apiKey: apiKey ? MASKED_SECRET : '', environmentManaged: false, restartRequired: true };
  });

  app.get('/v1/admin/policies/maintenance', async () => {
    const cfg = configStore.loadConfig();
    return { approvalPolicy: cfg.approvalPolicy };
  });

  app.patch('/v1/admin/policies/maintenance', async (req) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patch = {};
    if (body.approvalPolicy !== undefined) patch.approvalPolicy = body.approvalPolicy;
    const updated = configStore.patchConfig(patch);
    return { approvalPolicy: updated.approvalPolicy };
  });

  // ── Activity Log ────────────────────────────────────────────────────────

  app.get('/v1/activity-log', async (req) => {
    const count = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    return { entries: activityLog.getRecent(count) };
  });

  // ── Space Stats ───────────────────────────────────────────────────────────

  app.get('/v1/space-stats', async () => {
    const library = getHelixServices().libraService.queryLibraryProjections({});
    const tasks = typeof taskStore.querySpaceStatTaskRows === 'function'
      ? taskStore.querySpaceStatTaskRows()
      : taskStore.loadTasks();
    const config = configStore.loadConfig();
    return spaceStats.computeSpaceStats(library, tasks, config);
  });

  // ── Douban Integration ──────────────────────────────────────────────────

  app.get('/v1/admin/integrations/douban', async () => {
    const session = doubanService.getSession(configStore.loadConfig());
    return { ...session, cookieHeader: session.cookieHeader ? MASKED_SECRET : '' };
  });

  app.put('/v1/admin/integrations/douban', async (req) => {
    const session = doubanService.saveSession(req.body || {});
    return { ...session, cookieHeader: session.cookieHeader ? MASKED_SECRET : '' };
  });

  // ── Admin: Emby ─────────────────────────────────────────────────────────

  app.get('/v1/admin/emby/servers', async () => {
    const cfg = configStore.loadConfig();
    const servers = cfg.embyServers || {};
    const list = Object.entries(servers).map(([uuid, s]) => ({
      uuid,
      serverName: s.serverName || '',
      baseUrl: s.baseUrl || '',
      username: s.username || '',
      userId: s.userId || '',
      credentialConfigured: !!s.accessToken,
    }));
    return { servers: list };
  });

  async function resolveEmbyConnectionInput(input = {}, current = null) {
    const baseUrl = String(input.baseUrl !== undefined ? input.baseUrl : current && current.baseUrl || '').trim().replace(/\/+$/, '');
    const username = String(input.username !== undefined ? input.username : current && current.username || '').trim();
    const password = String(input.password || '');
    if (!baseUrl) throw Object.assign(new Error('baseUrl is required'), { code: 'VALIDATION_ERROR', statusCode: 400 });
    if (!username || !password) throw Object.assign(new Error('username and password are required'), { code: 'VALIDATION_ERROR', statusCode: 400 });

    let accessToken = '';
    let authenticatedUserId = '';
    try {
      const auth = await embyService.authenticateByUsername(baseUrl, username, password);
      accessToken = auth.token;
      authenticatedUserId = auth.userId;
    } catch (error) {
      throw Object.assign(error, { code: 'EMBY_AUTH_FAILED', statusCode: 502 });
    }
    const serverConfig = { baseUrl, accessToken, userId: authenticatedUserId };
    try {
      const [serverInfo, users] = await Promise.all([
        embyService.testConnection(serverConfig),
        embyService.getUsers(serverConfig),
      ]);
      return { baseUrl, accessToken, username, authenticatedUserId, serverInfo, users };
    } catch (error) {
      throw Object.assign(error, { code: error.code || 'EMBY_UNREACHABLE', statusCode: error.statusCode || 502 });
    }
  }

  app.post('/v1/admin/emby/connections/test', async (req, reply) => {
    try {
      const result = await resolveEmbyConnectionInput(req.body || {});
      return {
        ok: true,
        serverInfo: result.serverInfo,
        users: result.users,
        suggestedUserId: result.authenticatedUserId || '',
      };
    } catch (error) {
      return apiError(reply, error.statusCode || 502, error.code || 'EMBY_UNREACHABLE', error.message);
    }
  });

  app.post('/v1/admin/emby/servers', async (req, reply) => {
    const selectedUserId = String(req.body && req.body.userId || '').trim();
    if (!selectedUserId) return apiError(reply, 400, 'EMBY_USER_REQUIRED', 'Select an Emby user before saving the connection');
    try {
      const result = await resolveEmbyConnectionInput(req.body || {});
      if (!result.users.some((user) => user.id === selectedUserId)) {
        return apiError(reply, 400, 'EMBY_USER_INVALID', 'The selected Emby user is not available on this server');
      }
      const cfg = configStore.loadConfig();
      const servers = { ...(cfg.embyServers || {}) };
      if (Object.values(servers).some((server) => String(server.baseUrl || '').replace(/\/+$/, '') === result.baseUrl)) {
        return apiError(reply, 409, 'EMBY_SERVER_ALREADY_EXISTS', 'This Emby server is already configured');
      }
      const uuid = crypto.randomUUID();
      servers[uuid] = {
        serverName: result.serverInfo.serverName || result.baseUrl,
        baseUrl: result.baseUrl,
        username: result.username,
        accessToken: result.accessToken,
        userId: selectedUserId,
      };
      configStore.patchConfig({ embyServers: servers });
      return reply.code(201).send({ uuid, serverName: servers[uuid].serverName, baseUrl: result.baseUrl, userId: selectedUserId });
    } catch (error) {
      return apiError(reply, error.statusCode || 502, error.code || 'EMBY_UNREACHABLE', error.message);
    }
  });

  app.patch('/v1/admin/emby/servers/:serverId', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const servers = { ...(cfg.embyServers || {}) };
    const current = servers[req.params.serverId];
    if (!current) return apiError(reply, 404, 'NOT_FOUND', 'Emby server not found');
    const selectedUserId = String(req.body && req.body.userId || current.userId || '').trim();
    if (!selectedUserId) return apiError(reply, 400, 'EMBY_USER_REQUIRED', 'Select an Emby user before saving the connection');
    try {
      const result = await resolveEmbyConnectionInput(req.body || {}, current);
      if (!result.users.some((user) => user.id === selectedUserId)) {
        return apiError(reply, 400, 'EMBY_USER_INVALID', 'The selected Emby user is not available on this server');
      }
      servers[req.params.serverId] = {
        ...current,
        serverName: result.serverInfo.serverName || result.baseUrl,
        baseUrl: result.baseUrl,
        username: result.username,
        accessToken: result.accessToken,
        userId: selectedUserId,
      };
      configStore.patchConfig({ embyServers: servers });
      return { uuid: req.params.serverId, serverName: servers[req.params.serverId].serverName, baseUrl: result.baseUrl, userId: selectedUserId };
    } catch (error) {
      return apiError(reply, error.statusCode || 502, error.code || 'EMBY_UNREACHABLE', error.message);
    }
  });

  app.delete('/v1/admin/emby/servers/:serverId', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const servers = { ...(cfg.embyServers || {}) };
    if (!servers[req.params.serverId]) return apiError(reply, 404, 'NOT_FOUND', 'Emby server not found');
    if ((cfg.subLibraries || []).some((library) => library.embyServerId === req.params.serverId)) {
      return apiError(reply, 409, 'EMBY_SERVER_IN_USE', 'Remove or reconfigure media libraries that use this connection first');
    }
    delete servers[req.params.serverId];
    configStore.patchConfig({ embyServers: servers });
    return { ok: true, serverId: req.params.serverId };
  });

  app.get('/v1/admin/emby/users', async (req, reply) => {
    const embyServerId = req.query.embyServerId;
    if (!embyServerId) return apiError(reply, 400, 'VALIDATION_ERROR', 'embyServerId is required');
    const server = getEmbyServerConfig(embyServerId);
    if (!server) return apiError(reply, 404, 'NOT_FOUND', 'Server not found');
    try {
      const users = await embyService.getUsers(server);
      return { users };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_UNREACHABLE', e.message);
    }
  });

  app.get('/v1/admin/emby/media-folders', async (req, reply) => {
    const embyServerId = req.query.embyServerId;
    if (!embyServerId) return apiError(reply, 400, 'VALIDATION_ERROR', 'embyServerId is required');
    const server = getEmbyServerConfig(embyServerId);
    if (!server) return apiError(reply, 404, 'NOT_FOUND', 'Server not found');
    try {
      const folders = await embyService.getMediaFolders(server);
      return { folders };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_UNREACHABLE', e.message);
    }
  });

  // ── Admin: SubLibraries ─────────────────────────────────────────────────

  app.get('/v1/admin/sublibraries', async () => {
    const cfg = configStore.loadConfig();
    const summaries = await getHelixServices().libraService.getLibraryMaintenanceSummaries();
    return {
      subLibraries: (cfg.subLibraries || []).map((library) => ({
        ...library,
        maintenanceSummary: summaries[library.uuid] || {
          total: 0,
          basedataPassed: 0,
          metadataPassed: 0,
          optimizePassed: 0,
          maintenanceComplete: 0,
          directionCounts: { none: 0, transcode: 0, upgrade: 0, undetermined: 0, blocked: 0 },
        },
      })),
    };
  });

  app.get('/v1/admin/log', async (req, reply) => {
    const logger = require('./logger');
    const lines = parseInt(req.query.lines || '500', 10);
    reply.type('text/plain; charset=utf-8');
    return logger.tail(Math.min(lines, 2000)) || '(log file is empty)\n';
  });

  app.post('/v1/admin/sublibraries', async (req, reply) => {
    const automationError = validateAutomationModePatch(reply, req.body || {});
    if (automationError) return automationError;
    const {
      name, embyServerId, sectionId, source, doubanEnabled, ruleTemplateId,
      upgradeSmartSelect, mediaType,
      adultRegion, scraperType, watchRoot, japaneseJav, western,
      allowedCapabilities, capabilityParameters,
      libraryAutomationMode, maintenanceAutomationMode, approvalPolicy, metadataGate,
    } = req.body || {};
    if (!name) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'name is required');
    }
    const isFolderAdult = source === 'folder' && mediaType === 'adult';
    if (!isFolderAdult && (!embyServerId || !sectionId)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'name, embyServerId, and sectionId are required');
    }
    if (isFolderAdult && !watchRoot) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'watchRoot is required for adult folder libraries');
    }
    if (libraryAutomationMode !== undefined && !['auto', 'manual'].includes(libraryAutomationMode)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'libraryAutomationMode must be auto or manual');
    }
    if (maintenanceAutomationMode !== undefined && !['auto', 'manual'].includes(maintenanceAutomationMode)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'maintenanceAutomationMode must be auto or manual');
    }
    const cfg = configStore.loadConfig();
    if (!isFolderAdult && !(cfg.embyServers || {})[embyServerId]) {
      return apiError(reply, 404, 'NOT_FOUND', 'Emby server not found');
    }
    const gateError = validateSubLibraryMetadataGateInput(reply, {
      ruleTemplateId: defaultRuleTemplateIdForSubLibrary({ ruleTemplateId, mediaType, adultRegion }),
      metadataGate,
    }, cfg);
    if (gateError) return gateError;
    const created = getHelixServices().libraService.createSubLibrary({
      name, embyServerId, sectionId, source, doubanEnabled, ruleTemplateId,
      upgradeSmartSelect, mediaType,
      adultRegion, scraperType, watchRoot, japaneseJav, western,
      allowedCapabilities: allowedCapabilities && typeof allowedCapabilities === 'object' ? allowedCapabilities : {
        metadata: isFolderAdult ? ['metadata.sidecar.render', 'metadata.image.acquire'] : [],
        optimize: isFolderAdult ? ['media.transcode', 'media.replace', 'source.organize', 'metadata.artifacts.materialize'] : ['media.transcode', 'source.upgrade.request', 'media.replace'],
      },
      capabilityParameters: capabilityParameters && typeof capabilityParameters === 'object' ? capabilityParameters : isFolderAdult ? { 'metadata.image.acquire': { kinds: ['poster', 'fanart'] } } : {},
      capabilityPolicyRevision: '1',
      libraryAutomationMode, maintenanceAutomationMode, approvalPolicy, metadataGate,
    });
    if (created.observationWork) libraAutomationEngine.wake();
    return reply.code(201).send({ ...created.subLibrary, observationWork: created.observationWork, userPerceptionSyncWork: created.userPerceptionSyncWork });
  });

  app.post('/v1/admin/sublibraries/:uuid/actions/observe', async (req, reply) => {
    const body = req.body || {};
    if (!body.idempotencyKey) return apiError(reply, 400, 'VALIDATION_ERROR', 'idempotencyKey is required');
    try {
      const work = getHelixServices().libraService.requestLibraryObservation({
        subLibraryId: req.params.uuid,
        idempotencyKey: body.idempotencyKey,
        requestedBy: 'admin_api',
      });
      libraAutomationEngine.wake();
      return reply.code(202).send({ workId: work.workId, work });
    } catch (error) {
      return apiError(reply, error.code === 'LIBRA_LIBRARY_NOT_FOUND' ? 404 : 409, error.code || 'LIBRA_OBSERVATION_REJECTED', error.message);
    }
  });

  app.post('/v1/admin/sublibraries/:uuid/actions/sync-user-perception', async (req, reply) => {
    const body = req.body || {};
    if (!body.idempotencyKey) return apiError(reply, 400, 'VALIDATION_ERROR', 'idempotencyKey is required');
    try {
      const work = getHelixServices().libraService.requestUserPerceptionSync({
        subLibraryId: req.params.uuid,
        idempotencyKey: body.idempotencyKey,
        requestedBy: 'admin_api',
      });
      libraAutomationEngine.wake();
      return reply.code(202).send({ workId: work.workId, work });
    } catch (error) {
      return apiError(reply, error.code === 'LIBRA_LIBRARY_NOT_FOUND' ? 404 : 409, error.code || 'DOUBAN_SYNC_REJECTED', error.message);
    }
  });

  app.post('/v1/admin/sublibraries/:uuid/actions/offboard', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const subLib = (cfg.subLibraries || []).find((entry) => entry.uuid === req.params.uuid);
    if (!subLib) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    const body = req.body || {};
    if (!body.idempotencyKey) return apiError(reply, 400, 'VALIDATION_ERROR', 'idempotencyKey is required');
    if (body.cleanupMode && body.cleanupMode !== 'retain_source') {
      return apiError(reply, 409, 'LIBRA_SUBLIBRARY_RETAIN_SOURCE_REQUIRED', 'Sub-library removal only supports retain_source');
    }
    const library = getHelixServices().libraService.queryLibraryProjections({ subLibraryId: req.params.uuid });
    const result = await getHelixServices().libraService.requestOffboardingBatch({
      itemIds: library.items.map((item) => item.itemId),
      cleanupMode: 'retain_source',
      reason: body.reason || 'sub_library_removed',
      idempotencyKey: body.idempotencyKey,
    });
    if (!result.completed) {
      return reply.code(409).send({
        error: { code: 'LIBRA_SUBLIBRARY_OFFBOARDING_INCOMPLETE', message: 'One or more library items could not be offboarded' },
        result,
      });
    }
    return reply.code(202).send({ ok: true, uuid: req.params.uuid, cleanupMode: 'retain_source', result });
  });

  app.delete('/v1/admin/sublibraries/:uuid', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const subLib = (cfg.subLibraries || []).find((entry) => entry.uuid === req.params.uuid);
    if (!subLib) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    const library = getHelixServices().libraService.queryLibraryProjections({ subLibraryId: req.params.uuid });
    const notClosed = library.items.filter((item) => !item.helix || item.helix.membership.status !== 'closed');
    if (notClosed.length > 0) {
      return reply.code(409).send({
        error: {
          code: 'LIBRA_SUBLIBRARY_OFFBOARDING_REQUIRED',
          message: 'All library memberships must be closed with retain_source before removing the sub-library',
        },
        itemCount: library.items.length,
        notClosedCount: notClosed.length,
      });
    }
    const ok = getHelixServices().libraService.deleteSubLibrary(req.params.uuid);
    if (!ok) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return { ok: true, uuid: req.params.uuid };
  });

  app.patch('/v1/admin/sublibraries/:uuid', async (req, reply) => {
    const automationError = validateAutomationModePatch(reply, req.body || {});
    if (automationError) return automationError;
    const cfg = configStore.loadConfig();
    const current = (cfg.subLibraries || []).find((s) => s.uuid === req.params.uuid);
    if (!current) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    const gateError = validateSubLibraryMetadataGateInput(reply, { ...current, ...(req.body || {}) }, cfg);
    if (gateError) return gateError;
    const updated = getHelixServices().libraService.updateSubLibrary(req.params.uuid, req.body || {});
    if (!updated) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return updated;
  });

  // Manual rescrape of a single adult folder item (resets prior failure state).
  // Optional body { adultId } overrides the detected 番号 (useful for ambiguous items).
  app.post('/v1/admin/adult/items/:itemId/actions/rescrape', async (req, reply) => {
    try {
      const body = req.body || {};
      if (!body.idempotencyKey) return apiError(reply, 400, 'VALIDATION_ERROR', 'idempotencyKey is required');
      const result = getHelixServices().libraService.requestMetadataRefresh({
        itemId: req.params.itemId,
        idempotencyKey: body.idempotencyKey,
        adultId: typeof body.adultId === 'string' ? body.adultId.trim() : '',
        reason: 'adult_rescrape',
      });
      kairoxAutomationRunner.wake({ itemId: req.params.itemId, kind: 'metadata_refresh_requested' });
      activityLog.addActivity('adult_library', '成人媒体已请求重新获取元数据', { itemId: req.params.itemId });
      return reply.code(202).send({ ok: true, ...result });
    } catch (e) {
      const status = e.code === 'LIBRA_ITEM_NOT_FOUND' ? 404 : 409;
      return apiError(reply, status, e.code || 'RESCRAPE_FAILED', e.message);
    }
  });

  app.get('/v1/admin/people', async (req) => {
    const includeReferenceFaces = req.query.includeReferenceFaces === '1' || req.query.includeReferenceFaces === 'true';
    return peopleStore.listPeople({
      search: req.query.search || req.query.q,
      contentKind: req.query.contentKind,
      preference: req.query.preference,
      limit: req.query.limit,
      offset: req.query.offset,
      includeArtifacts: includeReferenceFaces,
    });
  });

  app.get('/v1/admin/people/merge-candidates', async () => ({ candidates: peopleStore.getMergeCandidates() }));

  app.post('/v1/admin/people/actions/merge', async (req, reply) => {
    try {
      const result = peopleStore.mergePeople(req.body || {});
      for (const itemId of result.affectedItemIds) kairoxSignalBus.publish({ kind: 'person_preference_changed', itemId });
      return result;
    } catch (error) {
      return apiError(reply, 400, error.code || 'KAIROX_PERSON_MERGE_INVALID', error.message);
    }
  });

  app.get('/v1/admin/people/:personId', async (req, reply) => {
    const person = peopleStore.getPerson(req.params.personId, { includeArtifacts: true });
    if (!person) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    return person;
  });

  app.get('/v1/admin/people/:personId/media', async (req, reply) => {
    const person = peopleStore.getPerson(req.params.personId);
    if (!person) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    const itemIds = peopleStore.getRelatedItemIds(req.params.personId);
    const projections = getHelixServices().libraService.getLibraryProjections(itemIds);
    return { personId: person.personId, items: itemIds.map((itemId) => projections[itemId]).filter(Boolean) };
  });

  app.get('/v1/admin/people/:personId/reference-image', async (req, reply) => {
    const person = peopleStore.getPerson(req.params.personId, { includeArtifacts: true });
    if (!person) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    const face = (person.referenceFaces || []).find((f) => f && f.sampleImageBase64);
    if (!face) return apiError(reply, 404, 'NOT_FOUND', 'Reference image not found');
    try {
      const buffer = Buffer.from(String(face.sampleImageBase64), 'base64');
      const image = await referenceImageBuffer(buffer, {
        thumbnail: req.query.thumbnail === '1' || req.query.thumbnail === 'true',
      });
      reply.header('Cache-Control', 'private, max-age=300');
      reply.type(image.contentType);
      return image.buffer;
    } catch (e) {
      return apiError(reply, 500, 'REFERENCE_IMAGE_INVALID', 'Reference image cannot be decoded');
    }
  });

  app.get('/v1/admin/people/search-images', async (req, reply) => {
    try {
      const config = configStore.loadConfig();
      const result = await adultActorImageSearchService.searchActorImages({
        name: req.query.name,
        config,
        limit: req.query.limit,
      });
      return result;
    } catch (e) {
      return apiError(reply, 400, 'ACTOR_IMAGE_SEARCH_FAILED', e.message);
    }
  });

  app.post('/v1/admin/people', async (req, reply) => {
    try {
      const person = peopleStore.createPerson(req.body || {});
      return reply.code(201).send(person);
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  app.post('/v1/admin/people/from-image', async (req, reply) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      if (!name) return apiError(reply, 400, 'VALIDATION_ERROR', 'name is required');

      let imageBase64 = String(body.imageBase64 || '').trim();
      let contentType = 'image/jpeg';
      if (!imageBase64 && body.imageUrl) {
        const downloaded = await fetchImageAsBase64(body.imageUrl);
        imageBase64 = downloaded.base64;
        contentType = downloaded.contentType;
      }
      if (!imageBase64) return apiError(reply, 400, 'VALIDATION_ERROR', 'imageUrl or imageBase64 is required');

      const config = configStore.loadConfig();
      const western = ((config.adultLibrary || {}).western) || {};
      const face = await westernAdultLocalAiService.createReferenceFace({
        western,
        imageBase64,
        referenceId: body.referenceId || crypto.randomUUID(),
      });
      const referenceFace = peopleStore.normalizeReferenceFace({
        faceId: face.faceId || body.referenceId || crypto.randomUUID(),
        embedding: face.embedding || [],
        sampleImageBase64: imageBase64,
        confidence: face.detectionScore || 0,
        sourceItemId: 'actor_reference_image',
        sourceAssetId: body.imageUrl || body.source || '',
      });

      let person;
      if (body.personId) {
        const current = peopleStore.getPerson(body.personId, { includeArtifacts: true });
        if (!current) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
        peopleStore.updatePerson(body.personId, {
          name,
          aliases: body.aliases !== undefined ? body.aliases : current.aliases,
        });
        person = peopleStore.addReferenceFace(body.personId, referenceFace);
      } else {
        person = peopleStore.createPerson({
          name,
          aliases: body.aliases,
          adultRegion: body.adultRegion || 'western_adult',
          referenceAssetIds: body.imageUrl ? [String(body.imageUrl)] : [],
          referenceFaces: [referenceFace],
        });
      }
      return reply.code(body.personId ? 200 : 201).send({
        ...person,
        referenceFaceQuality: {
          faceCount: face.faceCount || 0,
          detectionScore: face.detectionScore || 0,
          bbox: face.bbox || null,
        },
      });
    } catch (e) {
      const status = /No face detected/i.test(e.message) ? 422 : 400;
      return apiError(reply, status, 'REFERENCE_FACE_FAILED', e.message);
    }
  });

  app.post('/v1/admin/people/from-face', async (req, reply) => {
    try {
      const body = req.body || {};
      if (!body.itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');
      const projection = getHelixServices().libraService.getLibraryProjection(String(body.itemId));
      if (!projection) return apiError(reply, 404, 'NOT_FOUND', 'Library item not found');
      const metadata = projection.maintenance && projection.maintenance.metadataFacts || {};
      const clusters = Array.isArray(metadata.faceClusters)
        ? metadata.faceClusters
        : [];
      const unknowns = Array.isArray(metadata.unknownFaces)
        ? metadata.unknownFaces
        : [];
      const pool = clusters.length ? clusters : unknowns;
      const face = body.clusterId
        ? pool.find((f) => String(f.clusterId || f.faceId || '') === String(body.clusterId))
        : pool.find((f) => !(f.status === 'named')) || pool[0];
      if (!face) return apiError(reply, 404, 'NOT_FOUND', 'Face cluster not found');
      const referenceFace = peopleStore.normalizeReferenceFace({
        ...face,
        sourceItemId: projection.itemId,
        sourceAssetId: projection.source && projection.source.sourceAccessDescriptor && projection.source.sourceAccessDescriptor.sourceId || '',
      });
      const person = peopleStore.createPerson({
        name: body.name,
        aliases: body.aliases,
        adultRegion: body.adultRegion || 'western_adult',
        referenceAssetIds: [projection.itemId],
        referenceFaces: [referenceFace],
      });
      return reply.code(201).send(person);
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  // Dismiss a face cluster: record its embedding on a dismissed person so future
  // scrapes drop it (blacklist). This is how male/supporting faces are excluded
  // from protagonist selection. Remediation of past items is via rescrape.
  app.post('/v1/admin/adult/items/:itemId/faces/:clusterId/dismiss', async (req, reply) => {
    try {
      const projection = getHelixServices().libraService.getLibraryProjection(String(req.params.itemId));
      if (!projection) return apiError(reply, 404, 'NOT_FOUND', 'Library item not found');
      const metadata = projection.maintenance && projection.maintenance.metadataFacts || {};
      const clusters = Array.isArray(metadata.faceClusters)
        ? metadata.faceClusters
        : metadata.unknownFaces || [];
      const face = clusters.find((f) => String(f.clusterId || f.faceId || '') === String(req.params.clusterId));
      if (!face) return apiError(reply, 404, 'NOT_FOUND', 'Face cluster not found');
      const emb = (face.embedding || []).map(Number).filter((x) => Number.isFinite(x));
      if (!emb.length) return apiError(reply, 400, 'VALIDATION_ERROR', 'Cluster has no embedding to blacklist');
      const person = peopleStore.createPerson({
        name: `_dismissed_${face.clusterId || face.faceId || Date.now()}`,
        adultRegion: 'western_adult',
        dismissed: true,
        referenceAssetIds: [projection.itemId],
        referenceFaces: [{
          faceId: face.clusterId || face.faceId || '',
          embedding: emb,
          sampleImageBase64: face.sampleImageBase64 || '',
          sourceItemId: projection.itemId,
          sourceAssetId: projection.source && projection.source.sourceAccessDescriptor && projection.source.sourceAccessDescriptor.sourceId || '',
        }],
      });
      return reply.code(201).send({ ok: true, personId: person.personId, dismissed: true });
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  app.patch('/v1/admin/people/:personId', async (req, reply) => {
    const before = peopleStore.getPerson(req.params.personId);
    const person = peopleStore.updatePerson(req.params.personId, req.body || {});
    if (!person) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    if (before && before.preference !== person.preference) {
      for (const itemId of peopleStore.getRelatedItemIds(person.personId)) kairoxSignalBus.publish({ kind: 'person_preference_changed', itemId });
    }
    return person;
  });

  app.delete('/v1/admin/people/:personId/reference-faces/:artifactId', async (req, reply) => {
    const ok = peopleStore.deleteReferenceFace(req.params.personId, req.params.artifactId);
    if (!ok) return apiError(reply, 404, 'NOT_FOUND', 'Reference face not found');
    return { ok: true, artifactId: req.params.artifactId };
  });

  app.delete('/v1/admin/people/:personId', async (req, reply) => {
    try {
      const ok = peopleStore.deletePerson(req.params.personId);
      if (!ok) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
      return { ok: true, personId: req.params.personId };
    } catch (error) {
      return apiError(reply, 409, error.code || 'KAIROX_PERSON_IN_USE', error.message);
    }
  });

  // ── Admin: Rule Templates ────────────────────────────────────────────────

  app.get('/v1/admin/rule-templates', async () => {
    const cfg = configStore.loadConfig();
    return { ruleTemplates: cfg.ruleTemplates || [] };
  });

  app.get('/v1/admin/rule-templates/:id', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const tpl = (cfg.ruleTemplates || []).find((t) => t.id === req.params.id);
    if (!tpl) return apiError(reply, 404, 'NOT_FOUND', 'Rule template not found');
    return tpl;
  });

  app.post('/v1/admin/rule-templates', async (req, reply) => {
    const { id, name, description, rules, tag } = req.body || {};
    if (!id || !name) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'id and name are required');
    }
    if (tag && tag.type === 'default') {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Cannot create a default template');
    }
    const cfg = configStore.loadConfig();
    const list = cfg.ruleTemplates || [];
    if (list.find((t) => t.id === id)) {
      return apiError(reply, 409, 'CONFLICT', 'Template id already exists');
    }
    const tpl = configStore.normalizeRuleTemplate({ id, name, description: description || '', rules: rules || [], tag: { type: 'user' } });
    cfg.ruleTemplates = [...list, tpl];
    configStore.saveConfig(cfg);
    return reply.code(201).send(tpl);
  });

  app.put('/v1/admin/rule-templates/:id', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const list = cfg.ruleTemplates || [];
    const idx = list.findIndex((t) => t.id === req.params.id);
    if (idx < 0) return apiError(reply, 404, 'NOT_FOUND', 'Rule template not found');

    const existing = list[idx];
    if (existing.tag && existing.tag.type === 'default') {
      return apiError(reply, 403, 'FORBIDDEN', 'Default templates are read-only');
    }

    const { name, description, rules } = req.body || {};
    list[idx] = configStore.normalizeRuleTemplate({
      ...existing,
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(rules !== undefined ? { rules } : {}),
    });
    cfg.ruleTemplates = list;
    configStore.saveConfig(cfg);
    return list[idx];
  });

  app.delete('/v1/admin/rule-templates/:id', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const list = cfg.ruleTemplates || [];
    const idx = list.findIndex((t) => t.id === req.params.id);
    if (idx < 0) return apiError(reply, 404, 'NOT_FOUND', 'Rule template not found');
    if (list[idx].tag && list[idx].tag.type === 'default') {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'Cannot delete a default template');
    }
    list.splice(idx, 1);
    cfg.ruleTemplates = list;
    configStore.saveConfig(cfg);
    return { ok: true, id: req.params.id };
  });

  // ── Admin: Adult Libraries ──────────────────────────────────────────────

  function sanitizeAdultLibraryForAdmin(adultLibrary = {}) {
    const out = maskAdultLibrarySecrets(adultLibrary || {});
    delete out.scanIntervalMinutes;
    delete out.western.faceEmbeddingsUrl;
    delete out.western.faceApiKey;
    return out;
  }

  function normalizeAdultWesternPatch(currentWestern = {}, requestedWestern = {}) {
    const next = { ...(requestedWestern || {}) };
    delete next.faceEmbeddingsUrl;
    delete next.faceApiKey;
    for (const key of ADULT_WESTERN_SECRET_KEYS) {
      if (next[key] === MASKED_SECRET) delete next[key];
    }
    return {
      ...(currentWestern || {}),
      ...next,
    };
  }

  app.get('/v1/admin/adult/config', async () => {
    const cfg = configStore.loadConfig();
    return sanitizeAdultLibraryForAdmin(cfg.adultLibrary || {});
  });

  app.patch('/v1/admin/adult/config', async (req) => {
    const current = configStore.loadConfig();
    const adultLibrary = {
      ...(current.adultLibrary || {}),
      ...(req.body || {}),
      japaneseJav: {
        ...((current.adultLibrary && current.adultLibrary.japaneseJav) || {}),
        ...((req.body && req.body.japaneseJav) || {}),
      },
      western: normalizeAdultWesternPatch(
        (current.adultLibrary && current.adultLibrary.western) || {},
        (req.body && req.body.western) || {},
      ),
    };
    delete adultLibrary.western.faceEmbeddingsUrl;
    delete adultLibrary.western.faceApiKey;
    delete adultLibrary.scanIntervalMinutes;
    const updated = configStore.patchConfig({ adultLibrary });
    return sanitizeAdultLibraryForAdmin(updated.adultLibrary || {});
  });

  // ── Admin: Transcode ────────────────────────────────────────────────────

  app.post('/v1/admin/transcode/actions/probe-devices', async () => {
    const cfg = configStore.loadConfig();
    return transcodeService.probeEncodeDevices(cfg);
  });

  app.get('/v1/admin/transcode/device-pool', async () => {
    const cfg = configStore.loadConfig();
    const slotUsage = transcodeService.getDeviceSlotUsage();

    // Local devices
    const localDevices = (cfg.transcodeEncodingDevices || []).map((dev) => {
      const inUse = slotUsage[dev.stableKey] || 0;
      const maxSlots = dev.maxSlots || 1;
      const [backend = '', index = ''] = String(dev.stableKey || '').split(':');
      const labels = {
        cpu: 'CPU · libx265（软件）',
        nvenc: `NVIDIA NVENC（CUDA ${index || '0'}）`,
        qsv: 'Intel Quick Sync（QSV）',
        amf: 'AMD AMF',
      };
      return {
        ...dev,
        label: labels[backend] || dev.stableKey,
        backend,
        remote: false,
        status: inUse >= maxSlots ? 'busy' : inUse > 0 ? 'busy' : 'idle',
        activeSlots: inUse,
      };
    });

    // Remote node devices (all nodes, not just online — show offline too)
    const allNodes = nodeStore.loadNodes();
    const remoteDevices = [];
    for (const node of allNodes) {
      for (const dev of (node.capabilities && node.capabilities.devices || [])) {
        const deviceId = `node:${node.id}:${dev.stableKey}`;
        const inUse = slotUsage[deviceId] || 0;
        const inPool = dev.inPool !== false; // default true for backward compat
        remoteDevices.push({
          stableKey: dev.stableKey,
          deviceId,
          nodeId: node.id,
          nodeName: node.name,
          nodeStatus: node.status,
          label: dev.label,
          backend: dev.backend,
          gpuIndex: dev.gpuIndex,
          inPool: node.status === 'online' && inPool,
          remote: true,
          priority: dev.priority || 150,
          maxSlots: dev.maxSlots || 1,
          status: node.status === 'offline' ? 'error'
            : !inPool ? 'idle'
            : inUse > 0 ? 'busy' : 'idle',
          activeSlots: inUse,
        });
      }
    }

    const devices = [...localDevices, ...remoteDevices];
    const totalDevices = devices.length;
    const idleDevices = devices.filter((d) => d.status === 'idle').length;
    const totalSlots = devices.reduce((s, d) => s + (d.maxSlots || 1), 0);
    const usedSlots = devices.reduce((s, d) => s + (d.activeSlots || 0), 0);
    return {
      devices,
      summary: { totalDevices, idleDevices, totalAvailableSlots: totalSlots, usedSlots },
    };
  });

  // ── Admin: Transcode Nodes ────────────────────────────────────────────────

  app.get('/v1/admin/nodes', async () => {
    const nodes = nodeStore.loadNodes();
    const tasks = taskStore.queryTaskSummaries({ statuses: ['executing'] }, {
      includeHistory: false,
      pageSize: 1000,
      maxPageSize: 1000,
    }).tasks;
    const nodeList = nodes.map((n) => {
      const activeJobCount = tasks.filter((t) => t.nodeId === n.id && t.status === 'executing').length;
      return { ...n, apiKey: '********', activeJobCount };
    });
    return { nodes: nodeList };
  });

  app.get('/v1/admin/nodes/:id', async (req) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return { error: { code: 'NOT_FOUND', message: 'Node not found' } };
    const tasks = taskStore.queryTaskSummaries({ statuses: ['executing'] }, {
      includeHistory: false,
      pageSize: 1000,
      maxPageSize: 1000,
    }).tasks;
    const activeJobCount = tasks.filter((t) => t.nodeId === node.id && t.status === 'executing').length;
    return { ...node, apiKey: '********', activeJobCount };
  });

  app.post('/v1/admin/nodes', async (req, reply) => {
    const { name, address, apiKey } = req.body || {};
    if (!name || !address || !apiKey) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name, address, apiKey required' } });
    }

    // Validate address format
    const addr = String(address).trim();
    if (!/^[\w.-]+:\d+$/.test(addr) && !/^[\w.-]+:\d+$/.test(addr.replace(/^https?:\/\//, ''))) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid address format (host:port)' } });
    }

    // Check for duplicate address
    const existing = nodeStore.loadNodes().find((n) => n.address === addr);
    if (existing) {
      return reply.code(409).send({ error: { code: 'CONFLICT', message: 'A node with this address already exists' } });
    }

    // Probe worker
    const node = { address: addr, apiKey: String(apiKey) };
    let capabilities;
    try {
      const health = await nodeService.checkHealth(node);
      if (!health.ok) throw new Error('Worker health check failed');
      capabilities = await nodeService.getCapabilities(node);
    } catch (err) {
      return reply.code(502).send({ error: { code: 'WORKER_UNREACHABLE', message: `Cannot reach worker: ${err.message}` } });
    }

    const created = nodeStore.addNode({ name: String(name).trim(), address: addr, apiKey: String(apiKey), capabilities });
    return reply.code(201).send({ ...created, apiKey: '********' });
  });

  app.delete('/v1/admin/nodes/:id', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    const force = req.query && req.query.force === 'true';
    const activeTasks = activeNodeTaskSummaries(req.params.id);
    const activeCount = activeTasks.length;

    if (activeCount > 0 && !force) {
      return reply.code(409).send({
        error: { code: 'NODE_HAS_ACTIVE_JOBS', message: 'node_has_active_jobs' },
        node: publicNodeSummary(node),
        resourceContext: nodeResourceContext(node),
        activeJobCount: activeCount,
        activeTasks,
        forceDelete: {
          available: true,
          query: 'force=true',
          effect: 'mark_active_tasks_failed_hard_then_delete_node',
        },
      });
    }

    if (force && activeCount > 0) {
      // Cancel all active tasks on this node
      for (const t of activeTasks) {
        try { await resourceRuntime.cancelTask(t); } catch (_) {}
        taskStore.updateTask(t.id, { status: 'failed_hard', logs: [{ ts: new Date().toISOString(), level: 'error', msg: `Node ${node.name} deleted by admin` }] });
      }
    }

    nodeStore.deleteNode(req.params.id);
    return {
      ok: true,
      node: publicNodeSummary(node),
      resourceContext: nodeResourceContext(node),
      forceDelete: force ? {
        applied: activeCount > 0,
        effect: activeCount > 0 ? 'marked_active_tasks_failed_hard_then_deleted_node' : 'deleted_node_without_active_tasks',
        affectedTaskIds: activeTasks.map((task) => task.id),
      } : undefined,
    };
  });

  app.patch('/v1/admin/nodes/:id', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    const { name, apiKey } = req.body || {};
    const patch = {};
    if (name !== undefined) {
      if (!String(name).trim()) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'name must not be empty' } });
      patch.name = String(name).trim();
    }
    if (apiKey !== undefined) {
      if (!String(apiKey).trim()) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'apiKey must not be empty' } });
      patch.apiKey = String(apiKey).trim();
    }
    if (Object.keys(patch).length === 0) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'At least one of name or apiKey required' } });
    }

    const updated = nodeStore.updateNode(req.params.id, patch);
    const tasks = taskStore.loadTasks({ includeHistory: false });
    const activeJobCount = tasks.filter((t) => t.nodeId === updated.id && t.status === 'executing').length;
    return { ...updated, apiKey: '********', activeJobCount };
  });

  app.post('/v1/admin/nodes/:id/actions/probe', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    try {
      const capabilities = await nodeService.getCapabilities(node);
      nodeStore.mergeCapabilities(req.params.id, capabilities.devices || []);
      nodeStore.updateNode(req.params.id, { lastSeenAt: new Date().toISOString(), consecutiveFailures: 0, status: 'online' });
      const updated = nodeStore.getNode(req.params.id);
      return { ok: true, capabilities: updated.capabilities };
    } catch (err) {
      return reply.code(502).send({ error: { code: 'WORKER_UNREACHABLE', message: err.message } });
    }
  });

  // Update a node device pool config (inPool, priority, maxSlots)
  app.patch('/v1/admin/nodes/:id/devices', async (req, reply) => {
    const node = nodeStore.getNode(req.params.id);
    if (!node) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Node not found' } });

    const { stableKey, inPool, priority, maxSlots } = req.body || {};
    if (!stableKey) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'stableKey required' } });

    const extra = {};
    if (typeof priority === 'number') extra.priority = priority;
    if (typeof maxSlots === 'number') extra.maxSlots = maxSlots;

    const ok = nodeStore.setDeviceInPool(req.params.id, String(stableKey), !!inPool, extra);
    if (!ok) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Device not found on node' } });

    const updated = nodeStore.getNode(req.params.id);
    return { ok: true, capabilities: updated.capabilities };
  });

  // ── Admin: Upgrade (MoviePilot) ──────────────────────────────────────────

  app.get('/v1/admin/upgrade/config', async () => {
    const cfg = configStore.loadConfig();
    const mp = cfg.moviepilot || {};
    return {
      moviepilot: { ...mp, apiKey: mp.apiKey ? '********' : '' },
      upgradeStagingLocalPath: cfg.upgradeStagingLocalPath || '',
    };
  });

  app.patch('/v1/admin/upgrade/config', async (req) => {
    const current = configStore.loadConfig();
    const patch = {};
    if (req.body && req.body.moviepilot !== undefined) {
      const requested = req.body.moviepilot && typeof req.body.moviepilot === 'object' ? req.body.moviepilot : {};
      patch.moviepilot = {
        ...(current.moviepilot || {}),
        ...requested,
        apiKey: requested.apiKey === MASKED_SECRET ? current.moviepilot && current.moviepilot.apiKey || '' : String(requested.apiKey || ''),
      };
    }
    if (req.body && req.body.upgradeStagingLocalPath !== undefined) patch.upgradeStagingLocalPath = req.body.upgradeStagingLocalPath;
    const updated = configStore.patchConfig(patch);
    return {
      moviepilot: { ...(updated.moviepilot || {}), apiKey: updated.moviepilot && updated.moviepilot.apiKey ? MASKED_SECRET : '' },
      upgradeStagingLocalPath: updated.upgradeStagingLocalPath || '',
    };
  });

  // ── Admin: MoviePilot Sites ───────────────────────────────────────────

  // Get MoviePilot download directories for user selection
  app.get('/v1/admin/upgrade/directories', async () => {
    const cfg = configStore.loadConfig();
    const mp = cfg.moviepilot || {};
    if (!mp.baseUrl || !mp.apiKey) return [];
    try {
      return await moviepilotService.fetchDirectories(mp);
    } catch (e) {
      console.error('[admin] fetchDirectories error:', e.message);
      return [];
    }
  });

  app.get('/v1/admin/moviepilot/sites', async () => {
    const cfg = configStore.loadConfig();
    const mp = cfg.moviepilot || {};
    if (!mp.baseUrl || !mp.apiKey) return [];
    try {
      const sites = await moviepilotService.listSites(mp);
      if (!Array.isArray(sites)) return [];
      return sites.map((s) => ({ id: s.id, name: s.name, domain: s.domain, is_active: s.is_active }));
    } catch (e) {
      console.error('[admin] listSites error:', e.message);
      return [];
    }
  });

  // ── Admin: Tasks ────────────────────────────────────────────────────────

  app.get('/v1/admin/confirmations', async (req, reply) => {
    const kind = String(req.query.kind || 'all');
    if (!['all', 'task'].includes(kind)) {
      reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'invalid kind' } };
    }
    const filter = { statuses: ['awaiting_user_confirm'] };
    applyTaskTargetQuery(filter, req.query);
    if (req.query.q) filter.q = req.query.q;
    const includeTasks = true;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const taskResult = !includeTasks
      ? { tasks: [], page, pageSize, total: 0 }
      : taskStore.queryTaskSummaries(filter, {
      page,
      pageSize,
      orderBy: 'updatedAt',
      orderDir: 'desc',
    });
    const summaryTasks = !includeTasks
      ? []
      : taskStore.queryTaskSummaries(filter, {
      includeAll: true,
      orderBy: 'updatedAt',
      orderDir: 'desc',
    }).tasks;
    const taskConfirmations = taskResult.tasks.map(confirmationQueueItem);
    const adultReviews = [];
    const items = [...taskConfirmations].sort((a, b) => {
      const bTime = Date.parse(b.updatedAt || '') || 0;
      const aTime = Date.parse(a.updatedAt || '') || 0;
      if (bTime !== aTime) return bTime - aTime;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    const taskSummary = summarizeConfirmationQueue(summaryTasks);
    const adultReviewSummary = summarizeAdultReviewQueue([]);
    return {
      items,
      confirmations: taskConfirmations,
      reviews: adultReviews,
      summary: {
        ...taskSummary,
        total: taskSummary.total + adultReviewSummary.total,
        taskConfirmations: taskSummary,
        adultReviews: adultReviewSummary,
      },
      page,
      pageSize,
      total: taskSummary.total + adultReviewSummary.total,
      taskTotal: taskResult.total,
      reviewTotal: 0,
    };
  });

  app.get('/v1/admin/tasks', async (req, reply) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.statuses) {
      filter.statuses = String(req.query.statuses)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    applyTaskTargetQuery(filter, req.query);
    if (req.query.q) filter.q = req.query.q;
    const attention = req.query.attention ? String(req.query.attention).trim() : '';
    if (attention && !TASK_ATTENTION_QUEUES[attention]) {
      return apiError(reply, 400, 'VALIDATION_ERROR', `unknown attention queue: ${attention}`);
    }
    const includeAttentionSummary = !falseQueryFlag(req.query.includeAttentionSummary || req.query.includeAttention);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    return diagnosticLog.track({
      category: 'api',
      scope: 'route./v1/admin/tasks',
      operation: 'http_get',
      component: 'admin-web-api',
      resourceType: 'service_api',
      resourceKey: '/v1/admin/tasks',
      slowMs: 250,
      payload: {
        route: '/v1/admin/tasks',
        filter: compactTaskRouteFilter(filter),
        page,
        pageSize,
        attention: attention || '',
        projection: {
          includeTaskSummaries: !attention,
          includeAttentionSummary: attention ? true : includeAttentionSummary,
          includeFullPayload: false,
        },
      },
      successPayload: (result) => ({
        rowCount: result && Array.isArray(result.tasks) ? result.tasks.length : 0,
        total: result && typeof result.total === 'number' ? result.total : undefined,
        attention: result && result.attention || '',
      }),
    }, () => {
      if (attention) {
        const baseTasks = sortTasksForAdminList(queryAttentionTasks(filter));
        const filteredTasks = baseTasks.filter((task) => taskMatchesAttention(task, attention));
        return {
          tasks: paginateTasks(filteredTasks, page, pageSize).map(taskListSummary),
          summary: {
            total: filteredTasks.length,
            byStatus: buildStatusSummary(filteredTasks),
            attention: buildAttentionSummary(baseTasks),
          },
          page,
          pageSize,
          total: filteredTasks.length,
          attention,
        };
      }
      const result = taskStore.queryTaskSummaries(filter, { page, pageSize, orderBy: 'updatedAt', orderDir: 'desc' });
      const summaryBaseTasks = includeAttentionSummary ? queryAttentionTasks(filter) : [];
      return {
        tasks: result.tasks.map(taskListSummary),
        summary: {
          total: result.total,
          byStatus: result.byStatus,
          ...(includeAttentionSummary ? { attention: buildAttentionSummary(summaryBaseTasks) } : {}),
        },
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      };
    });
  });

  app.get('/v1/admin/tasks/lifecycle-audit', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.statuses) {
      filter.statuses = String(req.query.statuses)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    applyTaskTargetQuery(filter, req.query);
    if (req.query.q) filter.q = req.query.q;
    const config = configStore.loadConfig();
    const allTasks = taskStore.queryTaskLifecycleAuditFacts(filter, {
      orderBy: 'updatedAt',
      orderDir: 'desc',
    });
    const subLibraryId = req.query.subLibraryId ? String(req.query.subLibraryId).trim() : '';
    const mediaType = req.query.mediaType ? String(req.query.mediaType).trim() : '';
    const subLibrariesById = new Map((config.subLibraries || []).map((sl) => [sl.uuid, sl]));
    const filteredTasks = allTasks.filter((task) => {
      const context = taskLibraryContext(task, subLibrariesById);
      if (subLibraryId && context.subLibraryId !== subLibraryId) return false;
      if (mediaType && context.mediaType !== mediaType) return false;
      return true;
    });
    const audit = buildTaskLifecycleAudit(filteredTasks, config, {
      sampleLimit: req.query.sampleLimit,
    });
    return {
      generatedAt: new Date().toISOString(),
      filters: {
        status: filter.status || '',
        statuses: filter.statuses || undefined,
        targetGate: filter.targetGate || '',
        subLibraryId,
        mediaType,
        q: filter.q || '',
      },
      ...audit,
    };
  });

  app.get('/v1/admin/dashboard/health', async () => {
    return diagnosticLog.track({
      category: 'api',
      scope: 'route./v1/admin/dashboard/health',
      operation: 'http_get',
      component: 'admin-web-api',
      resourceType: 'service_api',
      resourceKey: '/v1/admin/dashboard/health',
      slowMs: 250,
      payload: {
        route: '/v1/admin/dashboard/health',
        projection: {
          includeMediaStats: true,
          includeTaskStats: true,
          includeAttentionSummary: true,
          includeDashboardEvents: true,
        },
      },
      successPayload: (result) => ({
        status: result && result.status || '',
        mediaTotal: result && result.media ? result.media.totalItems : undefined,
        taskTotal: result && result.tasks ? result.tasks.totalTasks : undefined,
        activeTasks: result && result.tasks ? result.tasks.activeTasks : undefined,
        eventCount: result && result.events && Array.isArray(result.events.recent) ? result.events.recent.length : undefined,
        signalCount: result && result.diagnostics && Array.isArray(result.diagnostics.signals) ? result.diagnostics.signals.length : undefined,
      }),
    }, () => {
      const config = configStore.loadConfig();
      const media = queryDashboardMediaStatsFromHelix();
      const tasks = typeof taskStore.queryDashboardTaskStats === 'function'
        ? taskStore.queryDashboardTaskStats()
        : {};
      const taskSummaryFacts = queryAttentionTasks({});
      const attention = buildAttentionSummary(taskSummaryFacts);
      const automation = buildDashboardAutomation(config);
      const signals = buildDashboardHealthSignals(media, tasks, config, automation);
      const serviceProjection = buildDashboardServiceProjection(healthCheck.getLastResult());
      return {
        status: serviceProjection.status === 'red' || signals.some((signal) => signal.level === 'red') ? 'red' : serviceProjection.status,
        generatedAt: new Date().toISOString(),
        serviceAvailability: serviceProjection.serviceAvailability,
        externalIntegrations: serviceProjection.externalIntegrations,
        businessStatus: {
          status: dashboardBusinessStatus(signals),
          signals,
        },
        media,
        tasks: {
          ...tasks,
          attention,
          primaryAttention: primaryAttentionQueue(attention),
        },
        automation,
        events: buildDashboardEvents(15),
        diagnostics: {
          signals,
          storage: [
            taskStore.getStorageMetrics(),
          ],
        },
      };
    });
  });

  app.get('/v1/admin/tasks/:id/events', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50));
    return taskStore.queryTaskEvents({ taskId: task.id }, { page, pageSize, orderDir: 'asc' });
  });

  app.get('/v1/admin/resources', async (req) => {
    const detail = String(req.query.detail || '').trim().toLowerCase();
    const includeFullDetail = detail === 'full'
      || truthyQueryFlag(req.query.full)
      || truthyQueryFlag(req.query.includeDiagnostics)
      || truthyQueryFlag(req.query.includeFailureEvents)
      || truthyQueryFlag(req.query.includeStorageMetrics)
      || truthyQueryFlag(req.query.includeBackgroundIo);
    const projectionName = includeFullDetail ? 'full' : 'summary';
    return diagnosticLog.track({
      category: 'api',
      scope: 'route./v1/admin/resources',
      operation: 'http_get',
      component: 'admin-web-api',
      resourceType: 'service_api',
      resourceKey: '/v1/admin/resources',
      slowMs: 250,
      payload: {
        route: '/v1/admin/resources',
        projection: {
          detail: projectionName,
          includeRuntimeEvents: true,
          includeSchedulerTasks: true,
          includeDiagnosticLogs: includeFullDetail,
          includeFailureEvents: includeFullDetail,
          includeStorageMetrics: includeFullDetail,
          includeBackgroundIo: includeFullDetail,
        },
      },
      successPayload: (result) => ({
        resourceCount: result && Array.isArray(result.resources) ? result.resources.length : 0,
        totalTasks: result && result.summary ? result.summary.totalTasks : undefined,
        totalEvents: result && result.summary ? result.summary.totalEvents : undefined,
        failedEvents: result && result.diagnostics && Array.isArray(result.diagnostics.failedEvents) ? result.diagnostics.failedEvents.length : undefined,
        dependencyCount: result && result.diagnostics && Array.isArray(result.diagnostics.dependencies) ? result.diagnostics.dependencies.length : undefined,
        bottleneckCount: result && result.diagnostics && Array.isArray(result.diagnostics.bottlenecks) ? result.diagnostics.bottlenecks.length : undefined,
      }),
    }, () => {
      const config = configStore.loadConfig();
      const runtimeEvents = runtimeResourceTracker.listEvents({ recentLimit: includeFullDetail ? 100 : 40 }).events;
      const tasks = typeof taskStore.querySchedulerTasks === 'function'
        ? taskStore.querySchedulerTasks()
        : taskStore.loadTasks({ includeHistory: false });
      const view = resourceProjection.buildResourceView(tasks, config, {
        slotUsage: transcodeService.getDeviceSlotUsage(),
        runtimeEvents,
      });
      const diagnostics = includeFullDetail
        ? diagnosticLog.list({ limit: 120 })
        : { logs: [], summary: null };
      const health = healthCheck.getLastResult();
      const dependencies = health && health.checks && typeof health.checks === 'object'
        ? Object.entries(health.checks).map(([key, value]) => ({ key, ...(value || {}) }))
        : [];
      const bottlenecks = (view.resources || [])
        .filter((bucket) => (bucket.waiting > 0 || bucket.blocked > 0) && bucket.configuredSlots > 0 && bucket.running >= bucket.configuredSlots)
        .map((bucket) => ({
          resourceType: bucket.resourceType,
          resourceKey: bucket.resourceKey,
          resourceLabel: bucket.resourceLabel,
          configuredSlots: bucket.configuredSlots,
          running: bucket.running,
          waiting: bucket.waiting,
          blocked: bucket.blocked,
        }));
      const diagnosticSummary = includeFullDetail
        ? diagnostics.summary
        : {
          totalLogs: 0,
          slowLogs: 0,
          failedLogs: 0,
          byStatus: {},
          byCategory: {},
          generatedAt: new Date().toISOString(),
        };
      return {
        ...view,
        governor: resourceGovernor.snapshot(),
        detail: projectionName,
        diagnostics: {
          logs: includeFullDetail ? diagnostics.logs : [],
          summary: diagnosticSummary,
          dependencies,
          failedEvents: includeFullDetail
            ? enrichFailureEvents(taskStore.queryRecentFailureEvents({ pageSize: 20 }), config, diagnostics.logs)
            : [],
          bottlenecks,
          ...(includeFullDetail ? {
            metrics: {
              storage: [
                taskStore.getStorageMetrics(),
              ],
            },
          } : {}),
        },
      };
    });
  });

  app.get('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const detail = taskDetailView(task);
    if (req.query.includeEvents === '1' || req.query.includeEvents === 'true') {
      detail.events = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 200 }).events;
      detail.controlState = taskControlPolicy.buildTaskControlState(task, {
        latestEvent: detail.events && detail.events.length ? detail.events[detail.events.length - 1] : null,
      });
    }
    return detail;
  });

  // ── Admin: System Info ────────────────────────────────────────────────────

  app.get('/v1/admin/system/info', async () => {
    return { platform: process.platform };
  });

  // ── Admin: Health ───────────────────────────────────────────────────────

  app.get('/v1/admin/health', async () => {
    const result = healthCheck.getLastResult();
    return result || healthCheck.runAllChecks();
  });

  app.get('/v1/admin/diagnostics/performance', async () => ({
    ...operationalMetrics.snapshot(),
    taskStore: typeof taskStore.queryAutomationInvariantSnapshot === 'function'
      ? taskStore.queryAutomationInvariantSnapshot()
      : null,
    resources: resourceGovernor.snapshot(),
  }));
}

// ── Build App ───────────────────────────────────────────────────────────────

async function buildApp(opts = {}) {
  process.env.CONTROL_PLANE_DATA_DIR =
    opts.dataDir ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    process.env.CONTROL_PLANE_DATA_DIR ||
    require('path').join(__dirname, '..', 'data');

  const API_KEY =
    opts.apiKey !== undefined
      ? opts.apiKey
      : process.env.MEDIA_SERVICE_API_KEY || process.env.CONTROL_PLANE_API_KEY || configStore.loadConfig().apiKey || '';

  const app = Fastify({ logger: opts.logger !== undefined ? opts.logger : true });
  await app.register(cors, { origin: true });

  app.addHook('onRequest', (req, _reply, done) => {
    req.shelfdeckRequestStartedAt = process.hrtime.bigint();
    done();
  });
  app.addHook('onResponse', (req, reply, done) => {
    if (req.url.startsWith('/v1/') && req.shelfdeckRequestStartedAt) {
      operationalMetrics.recordHttp({
        method: req.method,
        route: req.routeOptions && req.routeOptions.url || req.url.split('?')[0],
        statusCode: reply.statusCode,
        durationMs: Number(process.hrtime.bigint() - req.shelfdeckRequestStartedAt) / 1e6,
      });
    }
    done();
  });

  // Serve built React admin app
  const distAdminPath = path.join(__dirname, '..', 'dist', 'admin');
  await app.register(fastifyStatic, {
    root: distAdminPath,
    prefix: '/',
    decorateReply: false,
  });

  // SPA fallback: redirect unmatched paths to index.html (but not API routes)
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/v1/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    // Try serving index.html for SPA routes
    const indexPath = path.join(distAdminPath, 'index.html');
    try {
      const fs = require('fs');
      const html = fs.readFileSync(indexPath, 'utf8');
      reply.type('text/html').send(html);
    } catch {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
  });

  // Auth hook
  app.addHook('onRequest', (req, reply, done) => {
    const url = req.url;
    // Public routes
    if (url.startsWith('/v1/health')) return done();
    if (!url.startsWith('/v1/')) return done(); // static files, SPA routes

    if (!API_KEY) return done();
    const k = req.headers['x-api-key'];
    if (k !== API_KEY) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Api-Key' } });
    }
    done();
  });

  registerRoutes(app);

  app.addHook('onClose', async () => {
    taskScheduler.stopScheduler();
    healthCheck.stopHealthCheckTimer();
    libraAutomationEngine.stop();
    kairoxAutomationRunner.stop();
    resourceGovernor.resetForTests();
    runtimeResourceTracker.resetForTests();
    diagnosticLog.resetForTests();
    operationalMetrics.resetForTests();
  });

  // Clean up orphan ffmpeg processes and temp dirs from previous run
  // Must run BEFORE scheduler starts dispatching tasks
  const startupCfg = configStore.loadConfig();
  resourceGovernor.configure(() => configStore.loadConfig());
  if (startupCfg.transcodeTempRoot) {
    await transcodeService.cleanupOrphans(startupCfg);
  }
  try {
    const artifactWorkspace = require('./metadataArtifactWorkspace');
    const kairoxStore = require('./kairoxStore');
    artifactWorkspace.cleanupUnreferenced(startupCfg, [
      ...kairoxStore.listMetadataArtifactReferences(),
      ...workflowStore.activeMetadataArtifactReferences(),
    ]);
  } catch (error) {
    diagnosticLog.record({ category: 'storage', scope: 'metadataArtifactWorkspace.cleanup', operation: 'cleanup_unreferenced_artifacts', component: 'metadataArtifactWorkspace', status: 'failed', payload: { error: error.message } });
  }
  // Clean Helix runtime starts only durable task dispatch and Libra recovery.
  // Library and maintenance automation runners are wired in their dedicated
  // Automation clocks must not recreate mixed media_items state after clean initialization.
  taskScheduler.startScheduler();
  libraAutomationEngine.start(getHelixServices().libraService, configStore);
  kairoxAutomationRunner.start(getHelixServices().kairoxService);
  healthCheck.startHealthCheckTimer();

  const errorHandler = (err, req, reply) => {
    req.log.error(err);
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(statusCode).send({
      error: {
        code: err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR',
        message: err.message || 'Internal error',
      },
    });
  };
  app.setErrorHandler(errorHandler);

  serverReady = true;
  return app;
}

module.exports = { buildApp };
