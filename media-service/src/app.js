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
const libraryStore = require('./libraryStore');
const taskScheduler = require('./taskScheduler');
const healthCheck = require('./healthCheck');
const mediaLibraryService = require('./mediaLibraryService');
const embyService = require('./services/embyService');
const doubanService = require('./services/doubanService');
const transcodeService = require('./services/transcodeService');
const moviepilotService = require('./services/moviepilotService');
const strategyEngine = require('./strategyEngine');
const smartTaskEngine = require('./smartTaskEngine');
const priorityEngine = require('./priorityEngine');
const taskAdmission = require('./taskAdmission');
const activityLog = require('./activityLog');
const spaceStats = require('./spaceStats');
const nodeStore = require('./nodeStore');
const nodeService = require('./nodeService');
const assetIdentity = require('./assetIdentity');
const adultLibraryService = require('./adultLibraryService');
const adultColdArtifactStore = require('./adultColdArtifactStore');
const peopleStore = require('./peopleStore');
const adultActorImageSearchService = require('./services/adultActorImageSearchService');
const westernAdultLocalAiService = require('./services/westernAdultLocalAiService');
const scrapeVerification = require('./scrapeVerification');
const metadataStatus = require('./metadataStatus');
const resourceProjection = require('./resourceProjection');
const runtimeResourceTracker = require('./runtimeResourceTracker');
const diagnosticLog = require('./diagnosticLog');
const backgroundIoGuard = require('./backgroundIoGuard');
const businessFlowPolicy = require('./businessFlowPolicy');
const taskControlPolicy = require('./taskControlPolicy');
const deleteCandidateService = require('./deleteCandidateService');

let serverReady = false;

// ── Playback log ─────────────────────────────────────────────────────────────

function playbackLogPath() {
  return path.join(configStore.resolveDataDir(), 'playback-log.json');
}

function loadPlaybackLog() {
  try {
    const p = playbackLogPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return [];
}

function savePlaybackLog(logs) {
  fs.writeFileSync(playbackLogPath(), JSON.stringify(logs, null, 2));
}

function addPlaybackEntry(entry) {
  const logs = loadPlaybackLog();
  const idx = logs.findIndex((e) => e.itemId === entry.itemId);
  if (idx >= 0) {
    // Aggregate: update timestamp, increment play count
    const existing = logs[idx];
    logs.splice(idx, 1);
    logs.unshift({
      ...existing,
      ...entry,
      playedAt: new Date().toISOString(),
      playCount: (existing.playCount || 1) + 1,
    });
  } else {
    logs.unshift({ ...entry, playedAt: new Date().toISOString(), playCount: 1 });
  }
  savePlaybackLog(logs);
}

function removePlaybackEntry(itemId) {
  const logs = loadPlaybackLog();
  const filtered = logs.filter((e) => e.itemId !== itemId);
  savePlaybackLog(filtered);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiError(reply, status, code, message) {
  return reply.code(status).send({ error: { code, message } });
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
      servers[k] = { ...v, apiKey: MASKED_SECRET, embyUserPassword: v.embyUserPassword ? MASKED_SECRET : '' };
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
  return {
    id: task.id,
    itemId: task.itemId,
    itemName: task.itemName,
    operationKind: task.operationKind,
    taskTarget: task.taskTarget,
    taskBridge: task.taskBridge,
    flowPlan: task.flowPlan,
    source: task.source,
    status: task.status,
    progress: task.progress,
    phase: task.phase,
    resumePoint: task.resumePoint,
    retryCount: Number(task.retryCount || 0) || 0,
    nodeId: task.nodeId,
    approval: task.approval,
    priority: task.priority,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    itemInfo: taskListItemInfo(task.itemInfo),
    verifyResult: task.verifyResult,
    confirmData: task.confirmData,
    metadataStatus: task.itemInfo && task.itemInfo.metadataStatus,
    metadataMissingReasons: task.itemInfo && task.itemInfo.metadataMissingReasons,
    controlState: taskControlPolicy.buildTaskControlState(task),
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

function compactTaskRouteFilter(filter = {}) {
  return {
    status: filter.status || '',
    statuses: Array.isArray(filter.statuses) ? filter.statuses.length : undefined,
    bridgeKind: filter.bridgeKind || '',
    operationKind: filter.operationKind || '',
    hasSearch: !!filter.q,
  };
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
    byBridgeKind: {},
    byOperationKind: {},
    bySource: {},
    active: 0,
    terminal: 0,
    failed: 0,
    awaitingUser: 0,
  };
}

function addTaskToLifecycleBucket(bucket, task, stage) {
  const status = task.status || 'unknown';
  const bridgeKind = task.taskBridge && task.taskBridge.kind || task.flowPlan && task.flowPlan.bridgeKind || 'unknown';
  const operationKind = task.flowPlan && task.flowPlan.operationKind || task.operationKind || 'unknown';
  bucket.total += 1;
  inc(bucket.byStatus, status);
  inc(bucket.byLifecycleStage, stage);
  inc(bucket.byBridgeKind, bridgeKind);
  inc(bucket.byOperationKind, operationKind);
  inc(bucket.bySource, task.source || 'unknown');
  if (!['done', 'skipped', 'failed_hard', 'cancelled'].includes(status)) bucket.active += 1;
  else bucket.terminal += 1;
  if (status === 'failed_hard' || status === 'cancelled') bucket.failed += 1;
  if (status === 'awaiting_user_confirm') bucket.awaitingUser += 1;
}

function taskSubLibraryId(task) {
  return task && task.itemInfo && task.itemInfo.subLibraryId
    || task && task.taskBridge && task.taskBridge.subLibraryId
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
  const bridgeKind = task.taskBridge && task.taskBridge.kind || task.flowPlan && task.flowPlan.bridgeKind || '';
  const operationKind = task.flowPlan && task.flowPlan.operationKind || task.operationKind || '';
  const primaryResourceType = task.flowPlan && task.flowPlan.primaryResourceType || '';
  const resourceTypes = Array.isArray(task.flowPlan && task.flowPlan.resourceTypes) ? task.flowPlan.resourceTypes : [];
  const confirmationRequired = controlState && controlState.confirmation && controlState.confirmation.required;

  if (!context.subLibraryId) {
    signals.push({ severity: 'warn', code: 'missing_sub_library_context', message: 'Task has no subLibraryId in its lightweight facts.' });
  } else if (!context.found) {
    signals.push({ severity: 'warn', code: 'unknown_sub_library', message: 'Task references a sub-library that is not present in config.' });
  }
  if (!bridgeKind || !operationKind) {
    signals.push({ severity: 'warn', code: 'missing_bridge_or_operation', message: 'Task cannot be explained by bridge/operation facts.' });
  }
  if (!primaryResourceType) {
    signals.push({ severity: 'warn', code: 'missing_primary_resource', message: 'Task has no primary resource type for lifecycle/resource diagnosis.' });
  }
  if (context.mediaType !== 'adult' && operationKind === 'scrape') {
    const isEmbyRepair = primaryResourceType === 'emby' || resourceTypes.includes('emby');
    if (!isEmbyRepair) {
      const terminal = ['done', 'skipped', 'failed_hard', 'cancelled'].includes(status);
      signals.push({
        severity: terminal ? 'warn' : 'error',
        code: terminal ? 'legacy_standard_media_scrape_task' : 'standard_media_scrape_wrong_resource',
        message: terminal
          ? 'Standard media scrape task predates the Emby metadata repair resource model.'
          : 'Active standard media scrape must use the Emby metadata repair resource.',
        expectedResourceType: 'emby',
        actualResourceType: primaryResourceType || '',
      });
    }
  }
  if (context.mediaType === 'adult' && bridgeKind === 'metadata' && !['ingest', 'scrape'].includes(operationKind)) {
    signals.push({ severity: 'warn', code: 'adult_metadata_unexpected_operation', message: 'Adult metadata bridge should use ingest or scrape operation.' });
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
        bridgeKind: task.taskBridge && task.taskBridge.kind || task.flowPlan && task.flowPlan.bridgeKind || '',
        operationKind: task.flowPlan && task.flowPlan.operationKind || task.operationKind || '',
        primaryResourceType: task.flowPlan && task.flowPlan.primaryResourceType || '',
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
  const byBridgeKind = {};
  const byOperationKind = {};
  for (const task of tasks || []) {
    const control = taskControlPolicy.buildTaskControlState(task);
    const gate = control.confirmation && control.confirmation.gateId || 'unknown';
    const bridge = task.taskBridge && task.taskBridge.kind || 'unknown';
    const operation = task.flowPlan && task.flowPlan.operationKind || task.operationKind || 'unknown';
    byGate[gate] = (byGate[gate] || 0) + 1;
    byBridgeKind[bridge] = (byBridgeKind[bridge] || 0) + 1;
    byOperationKind[operation] = (byOperationKind[operation] || 0) + 1;
  }
  return {
    total: tasks.length,
    byGate,
    byBridgeKind,
    byOperationKind,
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
    taskBridge: {
      kind: 'metadata',
      from: 'ingested',
      to: 'metadata_ready',
      reason,
      operationKind: 'scrape',
      source: item.source || 'adult_folder',
      itemId: item.itemId,
      subLibraryId: item.subLibraryId || '',
    },
    flowPlan: {
      version: 'v3',
      bridgeKind: 'metadata',
      direction: 'metadata.scrape',
      operationKind: 'scrape',
      executor: 'scrapeFlow',
      primaryResourceType: item.adultRegion === 'western_adult' ? 'local_ai' : 'scraper',
      operationKind: 'scrape',
      source: item.source || 'adult_folder',
      resourceTypes: item.adultRegion === 'western_adult'
        ? ['local_ai', 'filesystem']
        : ['scraper', 'filesystem'],
      steps: [],
      plannedAt: item.updatedAt || '',
    },
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
      resumePoint: 'adult_review',
      effect: 'user_must_review_adult_metadata_before_metadata_ready',
      whyRequired: reason,
    },
    confirmAction: {
      enabled: false,
      reason: 'adult_review_requires_dedicated_action',
      label: 'review',
      endpoint: `/v1/admin/adult/items/${encodeURIComponent(item.itemId)}`,
      method: 'GET',
      effect: 'open_adult_item_review',
    },
    recovery: {
      state: 'user_review_required',
      reason,
      resumePoint: 'adult_review',
      nextAction: 'review',
    },
  };
}

function confirmationQueueItem(task) {
  const controlState = taskControlPolicy.buildTaskControlState(task);
  const confirmation = controlState.confirmation || {};
  return {
    kind: 'task_confirmation',
    id: task.id,
    taskId: task.id,
    itemId: task.itemId,
    itemName: task.itemName || '',
    operationKind: task.operationKind,
    taskBridge: task.taskBridge,
    flowPlan: task.flowPlan,
    source: task.source || '',
    status: task.status,
    phase: task.phase || '',
    resumePoint: task.resumePoint || '',
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
      resumePoint: confirmation.resumePoint || '',
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

function libraryListItemView(item) {
  if (!item || typeof item !== 'object') return item;
  if (!item.adultMetadata || typeof item.adultMetadata !== 'object') return item;
  return {
    ...item,
    adultMetadata: compactAdultMetadataForUi(item.adultMetadata, {
      includeFaces: false,
      includeSampleImage: false,
    }),
  };
}

function decorateLibraryItemsForUi(items, config) {
  const itemIds = (items || []).map((item) => item && item.itemId);
  const activeTasks = activeTaskSummariesForItems(itemIds);
  const latestFailureEventsByItem = taskStore.queryLatestFailureEventsByItemIds(itemIds);
  return businessFlowPolicy
    .decorateItems(items, { config, tasks: activeTasks, latestFailureEventsByItem })
    .map(libraryListItemView);
}

function projectLibraryItemsForUi(items, config, projection = {}) {
  if (projection.includeBusinessFlow) return decorateLibraryItemsForUi(items, config);
  return (items || []).map(libraryListItemView);
}

function compactSmartTaskScanSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  return {
    status: summary.status || '',
    startedAt: summary.startedAt || null,
    finishedAt: summary.finishedAt || null,
    enabledActions: Array.isArray(summary.enabledActions) ? summary.enabledActions : [],
    libraryItems: Number(summary.libraryItems || 0) || 0,
    candidateCount: Number(summary.candidateCount || 0) || 0,
    evaluatedCandidates: Number(summary.evaluatedCandidates || 0) || 0,
    enqueued: Number(summary.enqueued || 0) || 0,
    candidatesByAction: summary.candidatesByAction || {},
    enqueuedByAction: summary.enqueuedByAction || {},
    admissionRejected: Number(summary.admissionRejected || 0) || 0,
    admissionRejectedByReason: summary.admissionRejectedByReason || {},
    skippedByQueueCap: Number(summary.skippedByQueueCap || 0) || 0,
    skippedByQueueCapByAction: summary.skippedByQueueCapByAction || {},
    deferredByActiveBacklog: !!summary.deferredByActiveBacklog,
    activeBacklog: Number(summary.activeBacklog || 0) || 0,
    maxPerRunReached: !!summary.maxPerRunReached,
    reason: summary.reason || '',
    error: summary.error || '',
  };
}

function buildDashboardAutomation(config) {
  const health = smartTaskEngine.getHealth ? (smartTaskEngine.getHealth() || {}) : {};
  return {
    enabledOperations: businessFlowPolicy.resolveAutoEnabledActions(config),
    smartTask: {
      status: health.status || '',
      enabled: !!health.enabled,
      disabledReason: health.disabledReason || '',
      message: health.message || '',
      lastRunAt: health.lastRunAt || null,
      lastError: health.lastError || '',
      lastScanSummary: compactSmartTaskScanSummary(health.lastScanSummary),
    },
  };
}

const DASHBOARD_HEALTH_LABELS = {
  api: 'Service API',
  scheduler: 'Task Scheduler',
  smartTask: 'Task Creator',
  mediaLib: 'Library Store',
  strategy: 'Optimize Targets',
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
  const serviceKeys = ['scheduler', 'smartTask', 'mediaLib', 'strategy', 'transcode'];
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

function adultSubLibraryIds(config = {}) {
  return (Array.isArray(config.subLibraries) ? config.subLibraries : [])
    .filter((sl) => sl && (sl.mediaType === 'adult' || sl.adultRegion))
    .map((sl) => String(sl.uuid || '').trim())
    .filter(Boolean);
}

function buildDashboardHealthSignals(mediaStats, taskStats, config, automation = {}) {
  const signals = [];
  const push = (level, code, label, count, detail = '') => {
    if (!count) return;
    signals.push({ level, code, label, count, detail });
  };

  push('red', 'failed_tasks', '失败任务', taskStats.failedTasks, '先到任务中心查看实现路径和 event 历史');
  push('yellow', 'awaiting_confirmation', '等待确认', taskStats.awaitingConfirmationTasks, '需要人工确认后才能继续');
  push('yellow', 'metadata_incomplete', '元数据未完成', mediaStats.metadataIncompleteItems, '会阻断转码、洗版、删除等优化入口');
  push('yellow', 'pending_optimization', '等待优化', mediaStats.pendingOptimizationItems, '推荐动作仍未闭环');
  push('yellow', 'open_lifecycle', '未闭环媒体', mediaStats.openItems, '仍有业务桥需要推进');

  const autoActions = Array.isArray(config.smartTaskEnabledActions) ? config.smartTaskEnabledActions : [];
  if (autoActions.length === 0) {
    signals.push({
      level: 'yellow',
      code: 'auto_actions_disabled',
      label: '后台自动推进未启用',
      count: 1,
      detail: 'SmartTask 只能生成被全局 allow-list 放行的任务',
    });
  }

  const scan = automation.smartTask && automation.smartTask.lastScanSummary;
  if (scan && scan.status === 'failed') {
    push('red', 'smart_task_scan_failed', '自动入队扫描失败', 1, scan.error || '查看 Resource diagnostics');
  }
  if (scan && scan.admissionRejected > 0) {
    push('yellow', 'smart_task_admission_rejected', '自动入队被策略拒绝', scan.admissionRejected, '查看 admission rejected reason 分布');
  }
  if (scan && scan.skippedByQueueCap > 0) {
    push('yellow', 'smart_task_queue_cap', '自动入队队列已满', scan.skippedByQueueCap, '等待现有任务推进或调整队列上限');
  }
  if (scan && scan.deferredByActiveBacklog) {
    push('yellow', 'smart_task_active_backlog', '自动入队等待现有队列', scan.activeBacklog || 1, '已有任务在推进，下一轮扫描会重新评估');
  }
  if (scan && scan.maxPerRunReached) {
    push('yellow', 'smart_task_max_per_run', '自动入队达到单轮上限', 1, '下一轮扫描会继续处理剩余候选');
  }

  return signals.slice(0, 8);
}

function dashboardBusinessStatus(signals) {
  if ((signals || []).some((signal) => signal.level === 'red')) return 'red';
  if ((signals || []).some((signal) => signal.level === 'yellow')) return 'yellow';
  return 'green';
}

const DASHBOARD_ACTION_LABELS = {
  ingest: '入库',
  scrape: '刮削',
  transcode: '转码压缩',
  upgrade: '洗版',
  delete: '删除',
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
  const action = DASHBOARD_ACTION_LABELS[event.operationKind] || event.operationKind || '任务';
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
    operationKind: event.operationKind || '',
    eventType: event.eventType || '',
    eventStatus: event.eventStatus || '',
    resourceType: event.resourceType || '',
    resourceKey: event.resourceKey || '',
    resourceLabel: event.resourceLabel || '',
    bridgeKind: event.bridgeKind || '',
    operationKind: event.operationKind || '',
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
    'invalid_operation_kind',
    'invalid_bridge_kind',
    'invalid_preferred_operation',
    'preferred_operation_bridge_mismatch',
    'conflicting_task_intent',
    'preferred_operation_required',
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
    operation: admission.operation || admission.operationKind || '',
    reason: admission.reason || '',
    bridgeKind: admission.bridgeKind || '',
    preferredOperation: admission.preferredOperation || '',
    supportedEntry: admission.supportedEntry || '',
    supportedOperations: admission.supportedOperations,
    metadataMissingReasons: admission.metadataMissingReasons,
    activeTaskId: admission.activeTaskId || '',
    activeTaskBridge: admission.activeTaskBridge || '',
    activeFlowOperation: admission.activeFlowOperation || '',
    optimizeGate: compactAdmissionOptimizeGate(admission.optimizeGate),
    failureHandling: admission.failureHandling,
  };
  Object.keys(result).forEach((key) => {
    if (result[key] === undefined || result[key] === null || result[key] === '') delete result[key];
    if (Array.isArray(result[key]) && result[key].length === 0) delete result[key];
  });
  return result;
}

function compactAdmissionAccept(admission = {}) {
  const result = {
    allowed: true,
    operation: admission.operation || admission.operationKind || '',
    reason: admission.reason || 'allowed',
    bridgeKind: admission.bridgeKind || '',
    preferredOperation: admission.preferredOperation || '',
    intentMode: admission.intentMode || '',
    requestedIntent: admission.requestedIntent,
    taskTarget: admission.taskTarget,
    taskBridge: admission.taskBridge,
    flowPlan: admission.flowPlan,
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
    businessFlowDecision: subject
      ? businessFlowPolicy.buildItemDecision({ item: subject, config, tasks })
      : null,
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
    controlState: taskControlPolicy.buildTaskControlState(task, { latestEvent }),
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

const PRIORITY_EDITABLE_STATUSES = ['created', 'pending_manual', 'queued', 'interrupted', 'paused'];

function priorityAdjustmentState(task, requestedPriority) {
  const status = task && task.status || '';
  const editable = PRIORITY_EDITABLE_STATUSES.includes(status);
  return {
    enabled: editable,
    reason: editable ? 'available' : 'status_not_priority_editable',
    effect: editable ? 'override_queue_priority' : 'priority_locked_after_dispatch_or_terminal_state',
    requestedPriority: requestedPriority === undefined ? null : requestedPriority,
    currentPriority: task && typeof task.priority === 'number' ? task.priority : 100,
    editableStatuses: PRIORITY_EDITABLE_STATUSES,
  };
}

function priorityAdjustmentReject(reply, task, statusCode, code, message, requestedPriority, extra = {}) {
  const fresh = task && task.id ? (taskStore.getTask(task.id) || task) : task;
  const latestEvent = fresh && fresh.id ? latestTaskEvent(fresh.id) : null;
  const controlState = fresh ? taskControlPolicy.buildTaskControlState(fresh, { latestEvent }) : null;
  return reply.code(statusCode).send({
    error: { code, message },
    task: fresh ? taskListSummary(fresh) : null,
    controlState,
    priorityAdjustment: priorityAdjustmentState(fresh, requestedPriority),
    ...extra,
  });
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
    resumePoint: task.resumePoint || '',
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
    resumePoint: event && event.resumePoint || '',
    nextAction: 'inspect_event',
  };
  return {
    ...event,
    task: task ? {
      id: task.id,
      itemId: task.itemId,
      itemName: task.itemName || '',
      operationKind: task.operationKind,
      status: task.status,
      phase: task.phase || '',
      resumePoint: task.resumePoint || '',
      retryCount: Number(task.retryCount || 0) || 0,
      bridgeKind: task.taskBridge && task.taskBridge.kind || '',
      flowDirection: task.flowPlan && task.flowPlan.direction || '',
      operationKind: task.flowPlan && task.flowPlan.operationKind || '',
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

function markScrapeVerificationSource(verification, source) {
  if (!verification || typeof verification !== 'object') return verification;
  return {
    ...verification,
    source,
  };
}

function addScrapeReportWarning(verification, warning) {
  if (!verification || typeof verification !== 'object' || !warning) return verification;
  const warnings = Array.isArray(verification.warnings) ? verification.warnings.slice() : [];
  warnings.push(warning);
  return { ...verification, warnings };
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
  const libItem = mediaLibraryService.getLibraryItem(itemId);
  const resolvedSubLibraryId = subLibraryId || (libItem && libItem.subLibraryId) || '';
  if (resolvedSubLibraryId) {
    const resolved = resolveEmbyConfigForLibrary(resolvedSubLibraryId);
    if (!resolved.error) {
      resolved.libItem = libItem || null;
      resolved.embyItemId = libItem ? assetIdentity.getEmbyItemId(libItem) : itemId;
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

  app.post('/v1/tasks', async (req, reply) => {
    const body = req.body || {};
    const { itemId } = body;
    if (!itemId) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');
    }

    const cfg = configStore.loadConfig();

    // Populate itemInfo from media library
    const libItem = mediaLibraryService.getLibraryItem(itemId);
    const meta = libItem ? metadataStatus.resolveMetadataStatus(libItem, cfg) : null;
    const itemInfo = libItem ? {
      name: libItem.name,
      itemId: libItem.itemId,
      source: libItem.source,
      embyItemId: assetIdentity.getEmbyItemId(libItem),
      path: libItem.path,
      subLibraryId: libItem.subLibraryId,
      assetKey: libItem.assetKey,
      assetRootPath: libItem.assetRootPath,
      externalRefs: libItem.externalRefs,
      resolution: libItem.resolution,
      codec: libItem.codec,
      videoCodec: libItem.videoCodec,
      originalVideoCodec: libItem.originalVideoCodec,
      audioCodecs: libItem.audioCodecs,
      bitrate: libItem.bitrate,
      size: libItem.size,
      duration: libItem.duration,
      type: libItem.type,
      isDiscLike: !!libItem.isDiscLike,
      doubanRating: libItem.doubanRating,
      userRating: libItem.userRating,
      watched: libItem.watched,
      tmdbId: libItem.tmdbId,
      providerIds: libItem.providerIds,
      seriesName: libItem.seriesName,
      seasonNumber: libItem.seasonNumber,
      targetBitrate: libItem.targetBitrate,
      targetCodec: libItem.targetCodec,
      seedPreferences: libItem.seedPreferences,
      maxSizeGB: libItem.maxSizeGB,
      equivalentBitrate: libItem.equivalentBitrate,
      scraped: !!libItem.scraped,
      adultMetadata: libItem.adultMetadata,
      ...(meta || {}),
    } : null;

    const admissionItemInfo = itemInfo || { itemId };
    const activeAdmissionTasks = activeTaskSummariesForItem(itemId);
    const admission = taskAdmission.canCreateManualIntent({
      item: libItem,
      itemInfo: admissionItemInfo,
      operationKind: body.operationKind,
      bridgeKind: body.bridgeKind,
      preferredOperation: body.preferredOperation,
      intent: body.intent,
      config: cfg,
      tasks: activeAdmissionTasks,
    });
    const operationKind = admission.operationKind || admission.operation || body.operationKind;
    if (!admission.allowed) {
      diagnosticLog.record({
        category: 'admission',
        scope: 'taskAdmission.manual',
        operation: 'reject_task',
        component: 'taskAdmission',
        resourceType: 'task',
        resourceKey: `task:${operationKind}`,
        status: 'rejected',
        payload: {
          itemId,
          operationKind,
          bridgeKind: body.bridgeKind || (body.intent && body.intent.bridgeKind) || '',
          preferredOperation: body.preferredOperation || (body.intent && body.intent.preferredOperation) || '',
          source: 'manual',
          reason: admission.reason,
          supportedEntry: admission.supportedEntry,
          supportedOperations: admission.supportedOperations,
          metadataMissingReasons: admission.metadataMissingReasons,
        },
      });
      if (isTaskIntentValidationReason(admission.reason)) {
        return reply.code(400).send(taskAdmissionRejectPayload(
          'VALIDATION_ERROR',
          admission.reason,
          admission,
          libItem,
          admissionItemInfo,
          cfg,
          activeAdmissionTasks,
        ));
      }
      if (admission.reason === 'active_task_exists') {
        return reply.code(409).send(taskAdmissionRejectPayload(
          'TASK_CONFLICT',
          `Item ${itemId} already has an active task (${admission.activeTaskId})`,
          admission,
          libItem,
          admissionItemInfo,
          cfg,
          activeAdmissionTasks,
          {
            activeTask: activeTaskAdmissionSummary(itemId, admission.activeTaskId),
          },
        ));
      }
      return reply.code(409).send(taskAdmissionRejectPayload(
        'TASK_ADMISSION_REJECTED',
        admission.reason,
        admission,
        libItem,
        admissionItemInfo,
        cfg,
        activeAdmissionTasks,
      ));
    }

    const schedule = itemInfo && itemInfo.subLibraryId
      ? configStore.resolveSubLibSchedule(itemInfo, cfg)
      : { autoExecute: cfg.executionMode === 'auto' };
    const status = schedule.autoExecute ? 'created' : 'pending_manual';
    const priorityBreakdown = priorityEngine.explainTaskPriority({
      source: 'manual',
      taskTarget: admission.taskTarget,
      itemInfo,
      config: cfg,
      operationKind,
    });

    const task = taskStore.createTask({
      itemId,
      itemName: libItem ? libItem.name : undefined,
      operationKind,
      source: 'manual',
      status,
      priority: priorityBreakdown.priority,
      priorityModelVersion: priorityEngine.TASK_PRIORITY_MODEL_VERSION,
      priorityBreakdown,
      taskTarget: admission.taskTarget,
      taskBridge: admission.taskBridge,
      flowPlan: admission.flowPlan,
      requestedIntent: admission.requestedIntent,
      itemInfo,
      logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Task created by user action' }],
    });

    const response = taskDetailView(task, { latestEvent: latestTaskEvent(task.id) });
    response.admission = compactAdmissionAccept(admission);
    return reply.code(201).send(response);
  });

  app.get('/v1/admin/delete-candidates', async (req) => {
    return deleteCandidateService.listCandidates({
      includeDecided: req.query.includeDecided === '1' || req.query.includeDecided === 'true',
    });
  });

  app.post('/v1/admin/delete-candidates/:itemId/actions/keep-archived', async (req, reply) => {
    const candidate = deleteCandidateService.keepArchived(req.params.itemId);
    if (!candidate) return apiError(reply, 404, 'NOT_FOUND', 'Delete candidate item not found');
    return { candidate };
  });

  app.post('/v1/admin/delete-candidates/:itemId/actions/snooze', async (req, reply) => {
    const candidate = deleteCandidateService.snooze(req.params.itemId, req.body || {});
    if (!candidate) return apiError(reply, 404, 'NOT_FOUND', 'Delete candidate item not found');
    return { candidate };
  });

  app.post('/v1/admin/delete-candidates/:itemId/actions/suppress', async (req, reply) => {
    const candidate = deleteCandidateService.suppress(req.params.itemId);
    if (!candidate) return apiError(reply, 404, 'NOT_FOUND', 'Delete candidate item not found');
    return { candidate };
  });

  app.post('/v1/admin/delete-candidates/:itemId/actions/confirm-delete', async (req, reply) => {
    const itemId = req.params.itemId;
    const candidate = deleteCandidateService.confirmDelete(itemId);
    if (!candidate) return apiError(reply, 404, 'NOT_FOUND', 'Delete candidate item not found');

    const cfg = configStore.loadConfig();
    const libItem = mediaLibraryService.getLibraryItem(itemId);
    if (!libItem) return apiError(reply, 404, 'NOT_FOUND', 'Delete candidate item not found');
    const activeAdmissionTasks = activeTaskSummariesForItem(itemId);
    const admission = taskAdmission.canCreateManualIntent({
      item: libItem,
      itemInfo: libItem,
      operationKind: 'delete',
      bridgeKind: 'delete',
      preferredOperation: 'delete',
      intent: {
        bridgeKind: 'delete',
        preferredOperation: 'delete',
        entryPoint: 'delete_candidate_confirm',
      },
      config: cfg,
      tasks: activeAdmissionTasks,
    });
    if (!admission.allowed) {
      return reply.code(409).send(taskAdmissionRejectPayload(
        admission.reason === 'active_task_exists' ? 'TASK_CONFLICT' : 'TASK_ADMISSION_REJECTED',
        admission.reason,
        admission,
        libItem,
        libItem,
        cfg,
        activeAdmissionTasks,
      ));
    }

    const priorityBreakdown = priorityEngine.explainTaskPriority({
      source: 'manual',
      taskTarget: admission.taskTarget,
      itemInfo: libItem,
      config: cfg,
      operationKind: 'delete',
    });
    const task = taskStore.createTask({
      itemId,
      itemName: libItem.name,
      operationKind: 'delete',
      source: 'manual',
      status: 'created',
      priority: priorityBreakdown.priority,
      priorityModelVersion: priorityEngine.TASK_PRIORITY_MODEL_VERSION,
      priorityBreakdown,
      taskTarget: admission.taskTarget,
      taskBridge: admission.taskBridge,
      flowPlan: admission.flowPlan,
      requestedIntent: admission.requestedIntent,
      itemInfo: libItem,
      logs: [{ ts: new Date().toISOString(), level: 'info', msg: 'Delete task created from delete candidate confirmation' }],
    });
    const updatedCandidate = deleteCandidateService.attachTask(itemId, task.id) || candidate;
    const response = taskDetailView(task, { latestEvent: latestTaskEvent(task.id) });
    response.candidate = updatedCandidate;
    response.admission = compactAdmissionAccept(admission);
    return reply.code(201).send(response);
  });

  app.get('/v1/tasks', async (req) => {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.operationKind) filter.operationKind = req.query.operationKind;
    if (req.query.bridgeKind) filter.bridgeKind = req.query.bridgeKind;
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
      detail.controlState = taskControlPolicy.buildTaskControlState(task, {
        latestEvent: detail.events && detail.events.length ? detail.events[detail.events.length - 1] : null,
      });
    }
    return detail;
  });

  app.get('/v1/tasks/:id/report', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    if (task.status !== 'done' && !(task.status === 'failed_hard' && task.operationKind === 'scrape')) {
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
      operationKind: task.operationKind,
      elapsedSec,
      encoder,
    };

    if (task.operationKind === 'transcode') {
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
    } else if (task.operationKind === 'delete') {
      report.bytesFreed = vr.bytesSaved || info.size || info.originalSizeBytes || 0;
      report.delete = {
        targetPath: vr.deletedPath || info.deleteTargetPath || info.path || '',
        targetKind: vr.deletedKind || info.deleteTargetKind || (info.embyItemId ? 'emby_item' : ''),
      };
    } else if (task.operationKind === 'upgrade') {
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
    } else if (task.operationKind === 'scrape') {
      const cfg = configStore.loadConfig();
      const liveItem = mediaLibraryService.getLibraryItem(task.itemId);
      const scrapeInfo = liveItem || { ...info, itemId: task.itemId };
      const currentVerification = scrapeVerification.verifyScrapedItem(scrapeInfo, {
        config: cfg,
        subLib: (cfg.subLibraries || []).find((sl) => sl.uuid === scrapeInfo.subLibraryId) || null,
        scrapeTaskId: task.id,
      });
      if (scrapeInfo.source !== 'adult_folder') {
        report.metadata = {
          itemId: scrapeInfo.itemId || task.itemId,
          name: scrapeInfo.name || task.itemName || '',
          source: scrapeInfo.source || '',
          mediaPath: scrapeInfo.path || '',
          metadataStatus: currentVerification.metadataStatus || (info && info.metadataStatus) || '',
          metadataMissingReasons: currentVerification.metadataMissingReasons || (info && info.metadataMissingReasons) || [],
        };
        report.scrapeVerification = task.scrapeVerification && typeof task.scrapeVerification === 'object'
          ? markScrapeVerificationSource(task.scrapeVerification, 'completion_snapshot')
          : markScrapeVerificationSource(currentVerification, 'current_library_state');
        return report;
      }
      const scrapeInfoWithCold = adultColdArtifactStore.mergeColdArtifacts(scrapeInfo);
      const meta = scrapeInfoWithCold.adultMetadata || {};
      const subLib = (cfg.subLibraries || []).find((sl) => sl.uuid === scrapeInfo.subLibraryId) || null;
      report.scrape = {
        adultId: meta.adultId || scrapeInfo.sourceId || '',
        title: meta.title || scrapeInfo.name || task.itemName || '',
        source: meta.source || '',
        sourceUrl: meta.sourceUrl || '',
        scrapeStatus: meta.scrapeStatus || '',
        posterPath: meta.posterPath || '',
        fanartPath: meta.fanartPath || '',
        nfoPath: meta.nfoPath || '',
        fileNfoPath: meta.fileNfoPath || '',
        markerPath: meta.markerPath || '',
        organized: !!meta.organized,
        originalFolder: meta.originalFolder || '',
        mediaPath: scrapeInfo.path || '',
        actors: meta.actors || [],
        protagonist: meta.protagonist || null,
        faceClusters: Array.isArray(meta.faceClusters)
          ? meta.faceClusters.map((face) => compactFaceForUi(face, { includeSampleImage: true }))
          : [],
        unknownFaces: Array.isArray(meta.unknownFaces)
          ? meta.unknownFaces.map((face) => compactFaceForUi(face, { includeSampleImage: true }))
          : [],
        actorConfidence: meta.actorConfidence || {},
      };
      report.assets = {
        poster: !!meta.posterPath,
        fanart: !!meta.fanartPath,
        nfo: !!meta.nfoPath,
        marker: !!meta.markerPath,
      };
      if (task.scrapeVerification && typeof task.scrapeVerification === 'object') {
        report.scrapeVerification = markScrapeVerificationSource(task.scrapeVerification, 'completion_snapshot');
        if (currentVerification.ok !== task.scrapeVerification.ok || (currentVerification.failures || []).length > 0) {
          report.currentScrapeVerification = markScrapeVerificationSource(currentVerification, 'current_filesystem');
        }
      } else {
        report.scrapeVerification = markScrapeVerificationSource(currentVerification, 'current_filesystem');
        if (task.status === 'done') {
          report.scrapeVerification = addScrapeReportWarning(report.scrapeVerification, {
            code: 'snapshot.missing',
            message: '这条历史刮削执行结束时尚未保存验收快照；此处展示的是当前文件系统复核结果，不代表当时的文件状态。',
          });
        }
      }
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

  app.patch('/v1/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const { confirmed, confirmData } = req.body || {};
    if (!confirmed) return apiError(reply, 400, 'VALIDATION_ERROR', 'confirmed must be true');
    const action = getTaskActionOrReject(reply, task, 'confirm');
    if (!action) return;

    // Store user selection data (e.g. selectedIndex for upgrade flow)
    if (confirmData) {
      taskStore.updateTask(task.id, { confirmData });
    }

    // Call Flow.confirmReceived
    const flow = getFlow(task.operationKind);
    if (flow) flow.confirmReceived(task.id);

    // Re-queue for scheduler, mark as just-confirmed to bypass awaiting guard
    taskScheduler.markConfirmed(task.id);
    const updated = taskStore.updateTask(task.id, { status: 'queued', manualExecuteRequested: true });
    if (updated) {
      taskStore.appendTaskEvent(updated, 'task.confirmed', {
        requestedBy: 'user',
        actionName: 'confirm',
        actionEffect: action.effect || '',
        fromStatus: task.status || '',
        toStatus: updated.status || '',
        gateId: task.approval && task.approval.gateId || '',
        resumePoint: task.resumePoint || '',
        confirmDataKeys: confirmData && typeof confirmData === 'object' ? Object.keys(confirmData) : [],
      });
    }
    return taskActionResponse(updated);
  });

  app.post('/v1/tasks/:id/actions/execute', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const action = getTaskActionOrReject(reply, task, 'execute');
    if (!action) return;

    if (action.effect === 'queue_for_scheduler_dispatch' || action.effect === 'resume_after_interruption' || action.effect === 'resume_from_pause') {
      appendTaskControlEvent(task, 'execute', action);
      taskScheduler.markConfirmed(task.id);
      const updated = taskStore.updateTask(task.id, { status: 'queued', manualExecuteRequested: true });
      return taskActionResponse(updated);
    }
    if (action.effect === 'clear_pause_request') {
      // Clear pause request — hash acquisition loop will fall back to normal polling
      appendTaskControlEvent(task, 'execute', action);
      const updated = taskStore.updateTask(task.id, { pausingRequested: false, status: 'executing' });
      return taskActionResponse(updated);
    }
    return taskActionReject(reply, task, 'execute', 'TASK_ACTION_REJECTED', action.reason || 'unsupported_execute_transition');
  });

  app.post('/v1/tasks/:id/actions/retry', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const plan = taskControlPolicy.buildTaskRecoveryPlan(task);
    if (!plan.available || plan.action !== 'retry') {
      return taskActionReject(reply, task, 'retry', 'TASK_RECOVERY_REJECTED', plan.reason || 'recovery_not_available', {
        recoveryPlan: plan,
      });
    }

    const activeConflict = activeTaskConflictFor(task.itemId, task.id);
    if (activeConflict) {
      return taskActionReject(reply, task, 'retry', 'TASK_RECOVERY_REJECTED', 'active_task_conflict', {
        recoveryPlan: { ...plan, available: false, reason: 'active_task_conflict' },
        activeTask: taskListSummary(activeConflict),
      });
    }

    taskScheduler.markConfirmed(task.id);
    const updates = {
      status: 'queued',
      manualExecuteRequested: true,
      retryCount: Number(task.retryCount || 0) + 1,
      phase: null,
      progress: 0,
    };
    if (plan.resumePoint && plan.resumePoint !== task.resumePoint) updates.resumePoint = plan.resumePoint;
    const updated = taskStore.updateTask(task.id, updates);
    taskStore.deleteProgress(task.id);
    if (updated) {
      taskStore.appendTaskEvent(updated, 'task.retry_requested', {
        fromStatus: task.status,
        toStatus: updated.status,
        retryCount: updated.retryCount || 0,
        recovery: {
          reason: plan.reason,
          effect: plan.effect,
          resumePoint: plan.resumePoint || '',
        },
      });
    }
    return taskActionResponse(updated || taskStore.getTask(task.id) || task);
  });

  app.post('/v1/tasks/:id/actions/pause', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const action = getTaskActionOrReject(reply, task, 'pause');
    if (!action) return;

    if (action.effect === 'move_waiting_task_to_paused') {
      appendTaskControlEvent(task, 'pause', action);
      const updated = taskStore.updateTask(task.id, { status: 'paused' });
      return taskActionResponse(updated);
    }
    if (action.effect === 'request_runtime_pause_and_cleanup_partial_work') {
      appendTaskControlEvent(task, 'pause', action);
      const flow = getFlow(task.operationKind);
      if (flow) await flow.pause(task.id);
      return taskActionResponse(taskStore.getTask(task.id) || { ...task, status: 'paused' });
    }

    return taskActionReject(reply, task, 'pause', 'TASK_ACTION_REJECTED', action.reason || 'unsupported_pause_transition');
  });

  app.delete('/v1/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const action = getTaskActionOrReject(reply, task, 'cancel');
    if (!action) return;

    const flow = getFlow(task.operationKind);
    if (flow && taskNeedsFlowCancel(task)) await flow.cancel(task.id);

    appendTaskControlEvent(task, 'cancel', action);
    taskStore.deleteTask(task.id);
    return { ok: true, id: task.id };
  });

  // ── Library ─────────────────────────────────────────────────────────────

  function parseLibraryQuery(query = {}) {
    const filter = {};
    if (query.source) filter.source = query.source;
    if (query.type) filter.type = query.type;
    if (query.action) filter.action = query.action;
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
      action: filter.action || '',
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
      const result = mediaLibraryService.getLibrary(filter, { includeOptimizationStatus: projection.includeOptimizationStatus, ...page });
      // Attach embyWebUrl for desktop play button
      const cfg = configStore.loadConfig();
      const servers = cfg.embyServers || {};
      const subLibs = cfg.subLibraries || [];
      for (const item of result.items) {
        const sl = subLibs.find((s) => s.uuid === item.subLibraryId);
        if (sl && servers[sl.embyServerId] && servers[sl.embyServerId].baseUrl) {
          const embyItemId = assetIdentity.getEmbyItemId(item);
          if (embyItemId) {
            item.embyWebUrl = `${String(servers[sl.embyServerId].baseUrl).replace(/\/+$/, '')}/web/index.html#!/item?id=${embyItemId}`;
          }
        }
      }
      result.items = projectLibraryItemsForUi(result.items, cfg, projection);
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
      const result = mediaLibraryService.getLibrary(filter, { includeOptimizationStatus: projection.includeOptimizationStatus, ...page });
      const cfg = configStore.loadConfig();
      return { ...result, items: projectLibraryItemsForUi(result.items, cfg, projection) };
    }));
  });

  app.get('/v1/library/items/:itemId', async (req, reply) => {
    const item = mediaLibraryService.getLibraryItem(req.params.itemId);
    if (!item) return apiError(reply, 404, 'NOT_FOUND', 'Item not found');
    const cfg = configStore.loadConfig();
    const activeTasks = activeTaskSummariesForItem(req.params.itemId);
    const latestFailureEventsByItem = taskStore.queryLatestFailureEventsByItemIds([req.params.itemId]);
    return libraryListItemView(businessFlowPolicy.decorateItem(item, {
      config: cfg,
      tasks: activeTasks,
      latestFailureEventsByItem,
    }));
  });

  app.patch('/v1/library/ratings', async (req, reply) => {
    const { itemId, userRating } = req.body || {};
    if (!itemId || (typeof userRating !== 'number' && userRating !== null)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId and userRating are required');
    }
    if (userRating !== null && (userRating < 1 || userRating > 5)) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'userRating must be 1-5');
    }
    try {
      mediaLibraryService.updateUserRating(itemId, userRating);
      return { ok: true };
    } catch (e) {
      return apiError(reply, 404, 'NOT_FOUND', e.message);
    }
  });

  async function triggerLibraryIngest(req, reply) {
    const { subLibraryId } = req.body || {};
    if (!subLibraryId) return apiError(reply, 400, 'VALIDATION_ERROR', 'subLibraryId is required');
    try {
      mediaLibraryService.triggerIngest(subLibraryId);
      return reply.code(202).send({ ok: true, message: 'Ingest triggered' });
    } catch (e) {
      return apiError(reply, 404, 'NOT_FOUND', e.message);
    }
  }

  app.post('/v1/library/actions/ingest', async (req, reply) => {
    return triggerLibraryIngest(req, reply);
  });

  app.post('/v1/library/actions/refresh', async (req, reply) => {
    return triggerLibraryIngest(req, reply);
  });

  function recomputeOptimizeTargets() {
    const result = strategyEngine.runOnce();
    return { ok: true, changed: result.changed };
  }

  app.post('/v1/library/actions/recompute-optimize-targets', async () => {
    return recomputeOptimizeTargets();
  });

  app.post('/v1/library/actions/recompute-strategy', async () => {
    return recomputeOptimizeTargets();
  });

  app.get('/v1/library/status', async () => {
    return mediaLibraryService.getLibraryStatus();
  });

  app.post('/v1/library/cache', async (req) => {
    const { subLibraryId, items } = req.body || {};
    if (!subLibraryId || !Array.isArray(items)) {
      return { ok: true, upserted: 0, removed: 0 };
    }
    const result = mediaLibraryService.upsertItems(subLibraryId, items, { fullSync: true });
    return { ok: true, ...result };
  });

  // ── Library: mark played / unplayed ─────────────────────────────────────

  app.post('/v1/library/actions/mark-played', async (req, reply) => {
    const { itemId, subLibraryId } = req.body || {};
    if (!itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');

    const resolved = resolveEmbyConfigForItem(itemId, subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      const embyItemId = resolved.embyItemId || itemId;
      await embyService.markPlayed(resolved.serverConfig, embyItemId);

      // Fetch single item from Emby to get updated watched status
      const fetchedItem = await embyService.getItem(resolved.serverConfig, embyItemId);
      mediaLibraryService.upsertItems(resolved.subLib.uuid, [fetchedItem]);

      activityLog.addActivity('user_action', `「${fetchedItem.name || itemId}」已标记为已看`);
      return { ok: true };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
  });

  app.post('/v1/library/actions/mark-unplayed', async (req, reply) => {
    const { itemId, subLibraryId } = req.body || {};
    if (!itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');

    const resolved = resolveEmbyConfigForItem(itemId, subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      const embyItemId = resolved.embyItemId || itemId;
      await embyService.markUnplayed(resolved.serverConfig, embyItemId);

      // Fetch single item from Emby to get updated watched status
      const fetchedItem = await embyService.getItem(resolved.serverConfig, embyItemId);
      mediaLibraryService.upsertItems(resolved.subLib.uuid, [fetchedItem]);

      return { ok: true };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
  });

  // ── Local playback log ──────────────────────────────────────────────────

  app.get('/v1/library/playback-log', async (req) => {
    const logs = loadPlaybackLog();
    const filterSubLib = (req.query && req.query.subLibraryId) || '';
    const filtered = filterSubLib ? logs.filter((e) => e.subLibraryId === filterSubLib) : logs;
    return filtered;
  });

  app.post('/v1/library/playback-log/record', async (req) => {
    const { itemId, subLibraryId, itemName, type, posterUrl, path, embyWebUrl, sectionName } = req.body || {};
    if (!itemId || !subLibraryId) {
      return { ok: false, error: 'itemId and subLibraryId are required' };
    }
    addPlaybackEntry({
      itemId,
      subLibraryId,
      itemName: itemName || '',
      type: type || 'movie',
      posterUrl: posterUrl || '',
      path: path || '',
      embyWebUrl: embyWebUrl || '',
      sectionName: sectionName || '',
    });
    return { ok: true };
  });

  // v1 backward compat — redirect queries/played to playback-log
  app.post('/v1/library/queries/played', async (req) => {
    const logs = loadPlaybackLog();
    const filterSubLib = (req.body && req.body.subLibraryId) || '';
    const filtered = filterSubLib ? logs.filter((e) => e.subLibraryId === filterSubLib) : logs;
    return filtered;
  });

  app.post('/v1/library/queries/unplayed', async (req, reply) => {
    const { subLibraryId, sectionId } = req.body || {};
    const resolved = resolveEmbyConfigForLibrary(subLibraryId || '');
    if (resolved.error) return apiError(reply, 404, resolved.error.code, resolved.error.message);

    try {
      const items = await embyService.getUnplayedItems(
        resolved.serverConfig,
        sectionId || resolved.subLib.sectionId,
      );
      return items;
    } catch (e) {
      return apiError(reply, 502, 'EMBY_ERROR', e.message);
    }
  });

  // ── Config ──────────────────────────────────────────────────────────────

  app.get('/v1/config', async () => {
    return maskSensitive(configStore.loadConfig());
  });

  app.patch('/v1/config', async (req, reply) => {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    try {
      const updated = configStore.patchConfig(patch);
      return maskSensitive(updated);
    } catch (err) {
      if (err && err.code === 'METADATA_GATE_CONTRACT_BROKEN') {
        return reply.code(400).send({
          error: {
            code: err.code,
            message: err.message,
            details: err.details || {},
          },
        });
      }
      throw err;
    }
  });

  // ── Activity Log ────────────────────────────────────────────────────────

  app.get('/v1/activity-log', async (req) => {
    const count = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    return { entries: activityLog.getRecent(count) };
  });

  // ── Space Stats ───────────────────────────────────────────────────────────

  app.get('/v1/space-stats', async () => {
    const library = typeof mediaLibraryService.getSpaceStatLibrary === 'function'
      ? mediaLibraryService.getSpaceStatLibrary()
      : mediaLibraryService.getLibrary();
    const tasks = typeof taskStore.querySpaceStatTaskRows === 'function'
      ? taskStore.querySpaceStatTaskRows()
      : taskStore.loadTasks();
    const config = configStore.loadConfig();
    return spaceStats.computeSpaceStats(library, tasks, config);
  });

  // ── Douban Integration ──────────────────────────────────────────────────

  app.get('/v1/integrations/douban/fetch/ratings', async (req, reply) => {
    const subLibraryId = req.query.subLibraryId;
    if (!subLibraryId) return apiError(reply, 400, 'VALIDATION_ERROR', 'subLibraryId is required');
    try {
      mediaLibraryService.triggerDoubanSync(subLibraryId);
      return reply.code(202).send({ ok: true, message: 'Douban sync triggered' });
    } catch (e) {
      if (e.message.includes('not found')) return apiError(reply, 404, 'NOT_FOUND', e.message);
      return apiError(reply, 502, 'DOUBAN_UNREACHABLE', e.message);
    }
  });

  app.get('/v1/integrations/douban/session', async () => {
    return doubanService.getSession();
  });

  app.put('/v1/integrations/douban/session', async (req) => {
    return doubanService.saveSession(req.body || {});
  });

  // ── Admin: Emby ─────────────────────────────────────────────────────────

  app.get('/v1/admin/emby/servers', async () => {
    const cfg = configStore.loadConfig();
    const servers = cfg.embyServers || {};
    const list = Object.entries(servers).map(([uuid, s]) => ({
      uuid,
      serverName: s.serverName || '',
      baseUrl: s.baseUrl || '',
      apiKey: '********',
      userId: s.userId || '',
      embyUserPassword: s.embyUserPassword ? '********' : '',
    }));
    return { servers: list };
  });

  app.post('/v1/admin/emby/test', async (req, reply) => {
    const { baseUrl, apiKey, userId, username, password } = req.body || {};
    let effectiveApiKey = apiKey || '';
    let resolvedUserId = userId || '';

    // If username+password provided, authenticate and get access token + userId
    if (!effectiveApiKey && username && password && baseUrl) {
      try {
        const auth = await embyService.authenticateByUsername(baseUrl, username, password);
        effectiveApiKey = auth.token;
        resolvedUserId = resolvedUserId || auth.userId;
      } catch (e) {
        return apiError(reply, 502, 'EMBY_AUTH_FAILED', e.message);
      }
    }

    if (!baseUrl || !effectiveApiKey) {
      return apiError(reply, 400, 'VALIDATION_ERROR', 'baseUrl and apiKey (or username+password) are required');
    }
    try {
      const serverInfo = await embyService.testConnection({ baseUrl, apiKey: effectiveApiKey, userId: resolvedUserId });
      // Inline register
      const cfg = configStore.loadConfig();
      const servers = cfg.embyServers || {};
      let embyServerId = Object.keys(servers).find((k) => servers[k].baseUrl === baseUrl);
      if (!embyServerId) {
        embyServerId = crypto.randomUUID();
        servers[embyServerId] = {
          serverName: serverInfo.serverName || baseUrl,
          baseUrl,
          apiKey: effectiveApiKey,
          userId: resolvedUserId,
          embyUserPassword: password || '',
        };
        configStore.patchConfig({ embyServers: servers });
      } else {
        if (effectiveApiKey) servers[embyServerId].apiKey = effectiveApiKey;
        if (password) servers[embyServerId].embyUserPassword = password;
        if (resolvedUserId) servers[embyServerId].userId = resolvedUserId;
        configStore.patchConfig({ embyServers: servers });
      }
      return { ok: true, message: 'Emby connection successful', serverInfo, embyServerId, userId: resolvedUserId };
    } catch (e) {
      return apiError(reply, 502, 'EMBY_UNREACHABLE', e.message);
    }
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

  // Deprecated emby config endpoints (compatibility)
  app.get('/v1/admin/emby/config', async () => {
    const cfg = configStore.loadConfig();
    const first = Object.entries(cfg.embyServers || {})[0];
    return first ? { baseUrl: first[1].baseUrl, apiKey: '********', userId: first[1].userId } : { baseUrl: '', apiKey: '', userId: '' };
  });

  app.patch('/v1/admin/emby/config', async (req) => {
    const cfg = configStore.loadConfig();
    const servers = cfg.embyServers || {};
    const firstKey = Object.keys(servers)[0];
    if (firstKey) {
      servers[firstKey] = { ...servers[firstKey], ...req.body };
    } else {
      const uuid = crypto.randomUUID();
      servers[uuid] = { serverName: '', baseUrl: '', apiKey: '', userId: '', embyUserPassword: '', ...req.body };
    }
    configStore.patchConfig({ embyServers: servers });
    return { ok: true };
  });

  // ── Admin: SubLibraries ─────────────────────────────────────────────────

  app.get('/v1/admin/sublibraries', async () => {
    const cfg = configStore.loadConfig();
    return { subLibraries: cfg.subLibraries || [] };
  });

  app.get('/v1/admin/log', async (req, reply) => {
    const logger = require('./logger');
    const lines = parseInt(req.query.lines || '500', 10);
    reply.type('text/plain; charset=utf-8');
    return logger.tail(Math.min(lines, 2000)) || '(log file is empty)\n';
  });

  app.post('/v1/admin/sublibraries', async (req, reply) => {
    const {
      name, embyServerId, sectionId, source, doubanEnabled, ruleTemplateId,
      upgradeSmartSelect, pathMapFrom, pathMapTo, mediaType,
      adultRegion, scraperType, watchRoot, japaneseJav, western,
      automationMode, approvalPolicy, metadataGate,
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
    const cfg = configStore.loadConfig();
    if (!isFolderAdult && !(cfg.embyServers || {})[embyServerId]) {
      return apiError(reply, 404, 'NOT_FOUND', 'Emby server not found');
    }
    const gateError = validateSubLibraryMetadataGateInput(reply, {
      ruleTemplateId: defaultRuleTemplateIdForSubLibrary({ ruleTemplateId, mediaType, adultRegion }),
      metadataGate,
    }, cfg);
    if (gateError) return gateError;
    const subLib = mediaLibraryService.addSubLibrary({
      name, embyServerId, sectionId, source, doubanEnabled, ruleTemplateId,
      upgradeSmartSelect, pathMapFrom, pathMapTo, mediaType,
      adultRegion, scraperType, watchRoot, japaneseJav, western,
      automationMode, approvalPolicy, metadataGate,
    });
    return reply.code(201).send(subLib);
  });

  app.delete('/v1/admin/sublibraries/:uuid', async (req, reply) => {
    const ok = mediaLibraryService.deleteSubLibrary(req.params.uuid);
    if (!ok) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return { ok: true, uuid: req.params.uuid };
  });

  app.patch('/v1/admin/sublibraries/:uuid', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const current = (cfg.subLibraries || []).find((s) => s.uuid === req.params.uuid);
    if (!current) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    const gateError = validateSubLibraryMetadataGateInput(reply, { ...current, ...(req.body || {}) }, cfg);
    if (gateError) return gateError;
    const updated = mediaLibraryService.updateSubLibrary(req.params.uuid, req.body || {});
    if (!updated) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return updated;
  });

  app.post('/v1/admin/sublibraries/:uuid/actions/scan', async (req, reply) => {
    const cfg = configStore.loadConfig();
    const subLib = (cfg.subLibraries || []).find((s) => s.uuid === req.params.uuid);
    if (!subLib) return apiError(reply, 404, 'NOT_FOUND', 'SubLibrary not found');
    return apiError(reply, 410, 'SUBLIBRARY_SCAN_REMOVED', 'Sub-library directory scan has been removed; background work must enter through the unified task admission model.');
  });

  // Manual rescrape of a single adult folder item (resets prior failure state).
  // Optional body { adultId } overrides the detected 番号 (useful for ambiguous items).
  app.post('/v1/admin/adult/items/:itemId/actions/rescrape', async (req, reply) => {
    try {
      const overrideAdultId = typeof req.body === 'object' && req.body ? req.body.adultId : undefined;
      const task = await adultLibraryService.rescrapeItem(
        req.params.itemId,
        typeof overrideAdultId === 'string' ? { overrideAdultId } : {},
      );
      if (!task) {
        const config = configStore.loadConfig();
        const item = mediaLibraryService.getLibraryItem(req.params.itemId);
        const activeTask = activeTaskAdmissionSummary(req.params.itemId);
        const admission = {
          operation: 'scrape',
          operationKind: 'scrape',
          reason: 'active_task_exists',
          bridgeKind: 'metadata',
          preferredOperation: 'scrape',
          supportedEntry: 'POST /v1/admin/adult/items/:itemId/actions/rescrape',
          activeTaskId: activeTask && activeTask.id,
          activeTaskBridge: activeTask && activeTask.taskBridge && activeTask.taskBridge.kind,
          activeFlowOperation: activeTask && activeTask.flowPlan && activeTask.flowPlan.operationKind,
        };
        return reply.code(409).send(taskAdmissionRejectPayload(
          'TASK_CONFLICT',
          'active_task_exists',
          admission,
          item,
          item ? adultLibraryService.itemInfoFromItem(item) : { itemId: req.params.itemId },
          config,
          activeTask ? [activeTask] : [],
          { activeTask },
        ));
      }
      const taskView = taskDetailView(task, { latestEvent: latestTaskEvent(task.id) });
      return reply.code(201).send({
        ok: true,
        taskId: task.id,
        task: taskView,
        taskBridge: taskView.taskBridge,
        flowPlan: taskView.flowPlan,
        requestedIntent: taskView.requestedIntent,
        controlState: taskView.controlState,
      });
    } catch (e) {
      const code = /not found|does not exist|watchRoot/i.test(e.message) ? 'NOT_FOUND' : 'RESCRAPE_FAILED';
      const status = code === 'NOT_FOUND' ? 404 : 500;
      return apiError(reply, status, code, e.message);
    }
  });

  app.get('/v1/admin/adult/people', async (req) => {
    const includeReferenceFaces = req.query.includeReferenceFaces === '1' || req.query.includeReferenceFaces === 'true';
    return peopleStore.listPeople({
      adultRegion: req.query.adultRegion || 'western_adult',
      summary: !includeReferenceFaces,
    });
  });

  app.get('/v1/admin/adult/people/:personId/reference-image', async (req, reply) => {
    const person = peopleStore.getPerson(req.params.personId);
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

  app.get('/v1/admin/adult/people/search-images', async (req, reply) => {
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

  app.post('/v1/admin/adult/people', async (req, reply) => {
    try {
      const person = peopleStore.createPerson(req.body || {});
      return reply.code(201).send(person);
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  app.post('/v1/admin/adult/people/from-image', async (req, reply) => {
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
        const current = peopleStore.loadPeople().people.find((p) => p.personId === body.personId);
        if (!current) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
        person = peopleStore.updatePerson(body.personId, {
          name,
          aliases: body.aliases !== undefined ? body.aliases : current.aliases,
          referenceAssetIds: body.imageUrl ? [String(body.imageUrl)] : current.referenceAssetIds,
          referenceFaces: body.replaceReference === false
            ? [...(current.referenceFaces || []), referenceFace]
            : [referenceFace],
        });
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

  app.post('/v1/admin/adult/people/from-face', async (req, reply) => {
    try {
      const body = req.body || {};
      if (!body.itemId) return apiError(reply, 400, 'VALIDATION_ERROR', 'itemId is required');
      const item = mediaLibraryService.getLibraryItem(String(body.itemId));
      if (!item) return apiError(reply, 404, 'NOT_FOUND', 'Library item not found');
      // Face clusters (post-clustering) are the primary source; fall back to the
      // legacy unknownFaces list for older items.
      const itemWithCold = adultColdArtifactStore.mergeColdArtifacts(item);
      const metadata = itemWithCold.adultMetadata || {};
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
        sourceItemId: item.itemId,
        sourceAssetId: item.assetKey || '',
      });
      const person = peopleStore.createPerson({
        name: body.name,
        aliases: body.aliases,
        adultRegion: body.adultRegion || 'western_adult',
        referenceAssetIds: [item.itemId],
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
      const item = mediaLibraryService.getLibraryItem(String(req.params.itemId));
      if (!item) return apiError(reply, 404, 'NOT_FOUND', 'Library item not found');
      const itemWithCold = adultColdArtifactStore.mergeColdArtifacts(item);
      const metadata = itemWithCold.adultMetadata || {};
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
        referenceAssetIds: [item.itemId],
        referenceFaces: [{
          faceId: face.clusterId || face.faceId || '',
          embedding: emb,
          sampleImageBase64: face.sampleImageBase64 || '',
          sourceItemId: item.itemId,
          sourceAssetId: item.assetKey || '',
        }],
      });
      return reply.code(201).send({ ok: true, personId: person.personId, dismissed: true });
    } catch (e) {
      return apiError(reply, 400, 'VALIDATION_ERROR', e.message);
    }
  });

  app.patch('/v1/admin/adult/people/:personId', async (req, reply) => {
    const person = peopleStore.updatePerson(req.params.personId, req.body || {});
    if (!person) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    return person;
  });

  app.delete('/v1/admin/adult/people/:personId', async (req, reply) => {
    const ok = peopleStore.deletePerson(req.params.personId);
    if (!ok) return apiError(reply, 404, 'NOT_FOUND', 'Person not found');
    return { ok: true, personId: req.params.personId };
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

  app.get('/v1/admin/transcode/config', async () => {
    const cfg = configStore.loadConfig();
    return {
      transcodeTempRoot: cfg.transcodeTempRoot || '',
      transcodeCleanupOrphansOnStartup: cfg.transcodeCleanupOrphansOnStartup !== false,
      transcodeReplaceConfirmRequired: cfg.transcodeReplaceConfirmRequired || false,
      ffmpegPath: cfg.ffmpegPath || 'ffmpeg',
      ffprobePath: cfg.ffprobePath || 'ffprobe',
      transcodeEncodingDevices: cfg.transcodeEncodingDevices || [],
      transcodeCpuParticipationStrategy: cfg.transcodeCpuParticipationStrategy || 'normal',
    };
  });

  app.patch('/v1/admin/transcode/config', async (req) => {
    const allowed = [
      'transcodeTempRoot', 'transcodeReplaceConfirmRequired',
      'transcodeCleanupOrphansOnStartup',
      'ffmpegPath', 'ffprobePath', 'transcodeEncodingDevices',
      'transcodeCpuParticipationStrategy',
    ];
    const patch = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
    }
    return maskSensitive(configStore.patchConfig(patch));
  });

  app.get('/v1/admin/transcode/probe-devices', async () => {
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
      return {
        ...dev,
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
        const flow = getFlow(t.operationKind);
        if (flow) { try { await flow.cancel(t.id); } catch (_) {} }
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
      upgradeReplaceConfirmRequired: cfg.upgradeReplaceConfirmRequired || false,
      upgradeRetryInterval: cfg.upgradeRetryInterval ?? 3600000,
      upgradeMaxRetries: cfg.upgradeMaxRetries ?? 3,
    };
  });

  app.patch('/v1/admin/upgrade/config', async (req) => {
    const allowed = ['moviepilot', 'upgradeStagingLocalPath', 'upgradeReplaceConfirmRequired', 'upgradeRetryInterval', 'upgradeMaxRetries'];
    const patch = {};
    for (const key of allowed) {
      if (req.body && req.body[key] !== undefined) patch[key] = req.body[key];
    }
    return maskSensitive(configStore.patchConfig(patch));
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
    if (!['all', 'task', 'adult_review'].includes(kind)) {
      reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'invalid kind' } };
    }
    const filter = { statuses: ['awaiting_user_confirm'] };
    if (req.query.bridgeKind) filter.bridgeKind = req.query.bridgeKind;
    if (req.query.operationKind) filter.operationKind = req.query.operationKind;
    if (req.query.q) filter.q = req.query.q;
    const reviewFilter = {};
    if (req.query.subLibraryId) reviewFilter.subLibraryId = req.query.subLibraryId;
    if (req.query.reviewStatus) {
      reviewFilter.reviewStatuses = String(req.query.reviewStatus)
        .split(',')
        .map((status) => status.trim())
        .filter(Boolean);
    }
    if (req.query.q) reviewFilter.q = req.query.q;
    const includeTasks = kind !== 'adult_review';
    const includeReviews = kind !== 'task'
      && (!req.query.bridgeKind || req.query.bridgeKind === 'metadata')
      && (!req.query.operationKind || req.query.operationKind === 'scrape');
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
    const reviewResult = !includeReviews
      ? { items: [], page, pageSize, total: 0 }
      : libraryStore.queryAdultReviewSummaries(reviewFilter, {
        page,
        pageSize,
        orderBy: 'updatedAt',
        orderDir: 'desc',
      });
    const summaryReviewItems = !includeReviews
      ? []
      : libraryStore.queryAdultReviewSummaries(reviewFilter, {
        includeAll: true,
        orderBy: 'updatedAt',
        orderDir: 'desc',
      }).items;
    const taskConfirmations = taskResult.tasks.map(confirmationQueueItem);
    const adultReviews = reviewResult.items.map(adultReviewQueueItem);
    const items = [...taskConfirmations, ...adultReviews].sort((a, b) => {
      const bTime = Date.parse(b.updatedAt || '') || 0;
      const aTime = Date.parse(a.updatedAt || '') || 0;
      if (bTime !== aTime) return bTime - aTime;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    const taskSummary = summarizeConfirmationQueue(summaryTasks);
    const adultReviewSummary = summarizeAdultReviewQueue(summaryReviewItems);
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
      reviewTotal: reviewResult.total,
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
    if (req.query.operationKind) filter.operationKind = req.query.operationKind;
    if (req.query.bridgeKind) filter.bridgeKind = req.query.bridgeKind;
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
    if (req.query.operationKind) filter.operationKind = req.query.operationKind;
    if (req.query.bridgeKind) filter.bridgeKind = req.query.bridgeKind;
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
        bridgeKind: filter.bridgeKind || '',
        operationKind: filter.operationKind || '',
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
      const media = typeof libraryStore.queryDashboardMediaStats === 'function'
        ? libraryStore.queryDashboardMediaStats()
        : {};
      const tasks = typeof taskStore.queryDashboardTaskStats === 'function'
        ? taskStore.queryDashboardTaskStats()
        : {};
      const taskSummaryFacts = queryAttentionTasks({});
      const attention = buildAttentionSummary(taskSummaryFacts);
      const automation = buildDashboardAutomation(config);
      const signals = buildDashboardHealthSignals(media, tasks, config, automation);
      const serviceProjection = buildDashboardServiceProjection(healthCheck.getLastResult());
      return {
        status: serviceProjection.status,
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
            libraryStore.getStorageMetrics(),
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
      const payloadSummary = includeFullDetail
        ? libraryStore.getLibraryPayloadHealthSummary({
          includeBuckets: true,
          includeFieldBreakdown: true,
          includeAdultCache: true,
          adultSubLibraryIds: adultSubLibraryIds(config),
        })
        : null;

      return {
        ...view,
        detail: projectionName,
        diagnostics: {
          logs: includeFullDetail ? diagnostics.logs : [],
          summary: diagnosticSummary,
          dependencies,
          failedEvents: includeFullDetail
            ? enrichFailureEvents(taskStore.queryRecentFailureEvents({ pageSize: 20 }), config, diagnostics.logs)
            : [],
          bottlenecks,
          ...(includeFullDetail ? { backgroundIo: backgroundIoGuard.getState({ recentLimit: 40 }) } : {}),
          ...(payloadSummary ? { payloadSummary } : {}),
          ...(includeFullDetail ? {
            metrics: {
              storage: [
                libraryStore.getStorageMetrics(),
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

  app.patch('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');

    const body = req.body || {};

    // Priority adjustment (lower = runs first). Only meaningful before dispatch,
    // so reject once the task is actively executing or in a terminal state.
    if (body.priority !== undefined) {
      const priority = Number(body.priority);
      if (!Number.isFinite(priority) || priority < 0 || !Number.isInteger(priority)) {
        return priorityAdjustmentReject(reply, task, 400, 'VALIDATION_ERROR', 'priority must be a non-negative integer', body.priority, {
          validation: { field: 'priority', reason: 'non_negative_integer_required' },
        });
      }
      const adjustment = priorityAdjustmentState(task, priority);
      if (!adjustment.enabled) {
        return priorityAdjustmentReject(reply, task, 409, 'TASK_PRIORITY_REJECTED', adjustment.reason, priority);
      }
      const updated = taskStore.updateTask(task.id, { priority, priorityManuallyAdjusted: true });
      const response = taskDetailView(updated);
      response.priorityAdjustment = priorityAdjustmentState(updated, priority);
      return response;
    }

    return apiError(reply, 400, 'VALIDATION_ERROR', 'No supported fields to update');
  });

  app.delete('/v1/admin/tasks/:id', async (req, reply) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return apiError(reply, 404, 'NOT_FOUND', 'Task not found');
    const action = getTaskActionOrReject(reply, task, 'cancel');
    if (!action) return;

    const flow = getFlow(task.operationKind);
    if (flow && taskNeedsFlowCancel(task)) await flow.cancel(task.id);

    appendTaskControlEvent(task, 'cancel', action, { endpoint: 'admin' });
    taskStore.deleteTask(task.id);
    return { ok: true, id: task.id };
  });

  // ── Admin: System Info ────────────────────────────────────────────────────

  app.get('/v1/admin/system/info', async () => {
    return { platform: process.platform };
  });

  // ── Admin: Health ───────────────────────────────────────────────────────

  app.get('/v1/admin/health', async () => {
    const result = healthCheck.getLastResult();
    if (!result) {
      // Run fresh check
      const fresh = await healthCheck.runAllChecks();
      return fresh;
    }
    return result;
  });
}

// ── Flow helper ─────────────────────────────────────────────────────────────

function getFlow(operationKind) {
  switch (operationKind) {
    case 'ingest': return require('./ingestFlowExecutor');
    case 'delete': return require('./deleteFlowExecutor');
    case 'transcode': return require('./transcodeFlowExecutor');
    case 'upgrade': return require('./upgradeFlowExecutor');
    case 'scrape': return require('./scrapeFlowExecutor');
    default: return null;
  }
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
    mediaLibraryService.stopAllTimers();
    strategyEngine.stop();
    smartTaskEngine.stop();
    runtimeResourceTracker.resetForTests();
    diagnosticLog.resetForTests();
    backgroundIoGuard.resetForTests();
  });

  // Clean up orphan ffmpeg processes and temp dirs from previous run
  // Must run BEFORE scheduler starts dispatching tasks
  const startupCfg = configStore.loadConfig();
  if (startupCfg.transcodeTempRoot && startupCfg.transcodeCleanupOrphansOnStartup !== false) {
    await transcodeService.cleanupOrphans(startupCfg);
  }
  try {
    adultLibraryService.repairInvalidWesternScrapeState();
  } catch (e) {
    console.warn('[adultLibrary] invalid western scrape repair skipped:', e.message);
  }

  // Start health check timer and subLibrary timers
  healthCheck.startHealthCheckTimer();
  mediaLibraryService.startAllSubLibraryTimers();
  taskScheduler.startScheduler();
  strategyEngine.start(configStore, mediaLibraryService);
  smartTaskEngine.start(configStore, mediaLibraryService, taskStore);

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
