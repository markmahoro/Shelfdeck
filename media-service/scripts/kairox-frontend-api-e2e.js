#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_PRODUCTION_URL = 'http://192.168.12.230:18080';
const DEFAULT_LIBRARY_NAME = '公共 国产剧库';
const STAGE_ORDER = [
  'stage0',
  'stage1',
  'stage2',
  'stage3',
  'stage4',
  'stage5',
  'stage6',
  'stage7',
  'stage8',
  'stage9',
  'stage10',
  'stage11',
];
const FORBIDDEN_METADATA_REASONS = new Set([
  'decision.rating',
  'decision.watched',
  'decision.userRating',
  'decision.doubanRating',
  'userRating',
  'doubanRating',
  'watched',
  'playCount',
]);

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.SHELFDECK_BASE_URL || 'http://127.0.0.1:18080',
    frontendUrl: process.env.SHELFDECK_FRONTEND_URL || '',
    apiKey: process.env.SHELFDECK_API_KEY || process.env.MEDIA_SERVICE_API_KEY || process.env.CONTROL_PLANE_API_KEY || '',
    mode: 'readonly',
    allowProduction: false,
    confirmDestructive: false,
    libraryName: process.env.SHELFDECK_E2E_LIBRARY_NAME || DEFAULT_LIBRARY_NAME,
    canaryItemId: process.env.SHELFDECK_E2E_CANARY_ITEM_ID || '',
    out: '../docs/v3/KAIROX_FRONTEND_API_E2E.md',
    state: '../docs/v3/.kairox_frontend_api_e2e_state.json',
    stage: '',
    pageSize: 200,
    maxWaitMs: 180000,
  };
  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length);
    else if (arg.startsWith('--frontend-url=')) args.frontendUrl = arg.slice('--frontend-url='.length);
    else if (arg.startsWith('--api-key=')) args.apiKey = arg.slice('--api-key='.length);
    else if (arg.startsWith('--mode=')) args.mode = arg.slice('--mode='.length);
    else if (arg === '--allow-production') args.allowProduction = true;
    else if (arg === '--confirm-destructive-e2e') args.confirmDestructive = true;
    else if (arg.startsWith('--library-name=')) args.libraryName = arg.slice('--library-name='.length);
    else if (arg.startsWith('--canary-item-id=')) args.canaryItemId = arg.slice('--canary-item-id='.length);
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
    else if (arg.startsWith('--state=')) args.state = arg.slice('--state='.length);
    else if (arg.startsWith('--stage=')) args.stage = arg.slice('--stage='.length);
    else if (arg.startsWith('--page-size=')) args.pageSize = Number(arg.slice('--page-size='.length)) || args.pageSize;
    else if (arg.startsWith('--max-wait-ms=')) args.maxWaitMs = Number(arg.slice('--max-wait-ms='.length)) || args.maxWaitMs;
  }
  args.baseUrl = String(args.baseUrl || '').replace(/\/+$/, '');
  args.frontendUrl = String(args.frontendUrl || args.baseUrl).replace(/\/+$/, '');
  return args;
}

function assertSafety(args) {
  if (!['readonly', 'destructive'].includes(args.mode)) {
    throw new Error('--mode must be readonly or destructive');
  }
  if (args.stage && !STAGE_ORDER.includes(args.stage)) {
    throw new Error(`--stage must be one of: ${STAGE_ORDER.join(', ')}`);
  }
  const isProduction = args.baseUrl.replace(/\/+$/, '') === DEFAULT_PRODUCTION_URL;
  if (isProduction && !args.allowProduction) {
    throw new Error('Production E2E requires --allow-production');
  }
  if (args.mode === 'destructive') {
    if (!args.confirmDestructive) throw new Error('Destructive E2E requires --confirm-destructive-e2e');
    if (!args.libraryName) throw new Error('Destructive E2E requires --library-name');
  }
}

function nowIso() {
  return new Date().toISOString();
}

function redact(value) {
  if (!value) return '';
  return '********';
}

function headers(args, hasBody = false) {
  return {
    ...(args.apiKey ? { 'X-Api-Key': args.apiKey } : {}),
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function httpJson(args, label, route, options = {}) {
  const started = performance.now();
  const url = `${args.baseUrl}${route}`;
  const result = {
    label,
    route,
    method: options.method || 'GET',
    status: 0,
    ok: false,
    elapsedMs: 0,
    body: null,
    error: '',
  };
  try {
    const res = await fetch(url, {
      method: result.method,
      headers: headers(args, options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    result.status = res.status;
    const text = await res.text();
    result.body = text ? JSON.parse(text) : null;
    result.ok = res.status >= 200 && res.status < 300;
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
  }
  result.elapsedMs = Math.round(performance.now() - started);
  return result;
}

async function httpText(url, label) {
  const started = performance.now();
  const result = { label, url, status: 0, ok: false, elapsedMs: 0, error: '' };
  try {
    const res = await fetch(url);
    result.status = res.status;
    await res.text();
    result.ok = res.status >= 200 && res.status < 300;
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
  }
  result.elapsedMs = Math.round(performance.now() - started);
  return result;
}

function pass(details = {}) {
  return { ...details, status: 'PASS' };
}

function fail(reason, details = {}) {
  return { ...details, status: 'FAIL', reason };
}

function blocked(reason, details = {}) {
  return { ...details, status: 'BLOCKED', reason };
}

function skipped(reason, details = {}) {
  return { ...details, status: 'SKIPPED', reason };
}

function itemIdOf(item = {}) {
  return item.itemId || item.id || '';
}

function targetGateOf(task = {}) {
  return task.taskTarget && task.taskTarget.targetGate
    || task.targetGate
    || task.taskBridge && task.taskBridge.kind
    || '';
}

function flowKindOf(task = {}) {
  return task.flowPlan && task.flowPlan.flowKind
    || task.taskBridge && task.taskBridge.flowKind
    || '';
}

function gateObjectiveOf(task = {}) {
  return task.taskTarget && task.taskTarget.gateObjective && typeof task.taskTarget.gateObjective === 'object'
    ? task.taskTarget.gateObjective
    : {};
}

function metadataMissingReasons(item = {}) {
  const gate = item.metadataGate || item.lifecycleProjection && item.lifecycleProjection.metadataGate || {};
  return [
    ...(Array.isArray(gate.missingReasons) ? gate.missingReasons : []),
    ...(Array.isArray(item.metadataMissingReasons) ? item.metadataMissingReasons : []),
    ...(Array.isArray(item.metadataStatusReasons) ? item.metadataStatusReasons : []),
  ].map(String);
}

function forbiddenMetadataReasons(item = {}) {
  return metadataMissingReasons(item).filter((reason) => FORBIDDEN_METADATA_REASONS.has(reason));
}

function hasMirexTopLevel(task = {}) {
  return Object.prototype.hasOwnProperty.call(task, 'actionType')
    || Object.prototype.hasOwnProperty.call(task, 'operationKind')
    || Object.prototype.hasOwnProperty.call(task, 'selectedFlow')
    || Object.prototype.hasOwnProperty.call(task, 'SelectedFlow');
}

function hasDeleteAsOptimize(task = {}) {
  const targetGate = targetGateOf(task);
  const flowKind = flowKindOf(task);
  const objective = gateObjectiveOf(task);
  const direction = task.flowPlan && task.flowPlan.direction || '';
  return targetGate === 'optimize'
    && (flowKind === 'delete' || direction === 'optimize.delete' || objective.kind === 'remove_media');
}

function getGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function findSubLibrary(config = {}, status = {}, libraryName = '') {
  const candidates = [
    ...(Array.isArray(config.subLibraries) ? config.subLibraries : []),
    ...(Array.isArray(status.subLibraries) ? status.subLibraries : []),
  ];
  const normalizeName = (value) => String(value || '').replace(/[\s_\-]+/g, '').toLowerCase();
  const expected = normalizeName(libraryName);
  const exact = candidates.find((lib) => normalizeName(lib.name) === expected);
  if (exact) return exact;
  return candidates.find((lib) => normalizeName(lib.name).includes(expected) || expected.includes(normalizeName(lib.name)));
}

function pickCanary(items = [], requestedItemId = '') {
  const alive = items.filter((item) => item && itemIdOf(item) && !item.deleted && !item.removed);
  if (requestedItemId) return alive.find((item) => itemIdOf(item) === requestedItemId) || null;
  const itemLike = alive.filter((item) => !['series'].includes(String(item.type || item.mediaType || '').toLowerCase()));
  const pool = itemLike.length > 0 ? itemLike : alive;
  const available = pool.filter((item) => !(item.activeTask && item.activeTask.id));
  const score = (item) => {
    let value = 0;
    if (item.lifecycleNextTask === 'optimize') value += 100;
    if (item.optimizeGate && item.optimizeGate.passed === false) value += 50;
    if (item.optimizationDirection === 'transcode' || item.optimizeFlowKind === 'transcode') value += 20;
    if (item.metadataComplete || item.metadataStatus === 'complete') value += 10;
    if (item.optimizeObjectiveStatus === 'ready') value += 10;
    if (item.lifecycleNextTask === 'archive') value += 5;
    return value;
  };
  return available.sort((a, b) => score(b) - score(a))[0] || pool[0] || alive[0] || null;
}

function compactItem(item = {}) {
  return {
    itemId: itemIdOf(item),
    name: item.name || item.title || '',
    subLibraryId: item.subLibraryId || '',
    type: item.type || item.mediaType || '',
    userRating: item.userRating ?? null,
    watched: item.watched ?? null,
    metadataComplete: item.metadataComplete ?? null,
    metadataStatus: item.metadataStatus || '',
    optimizeObjectiveStatus: item.optimizeObjectiveStatus || '',
    objectiveHash: item.objectiveHash || '',
    objectiveVersion: item.objectiveVersion || '',
    lifecycleNextTask: item.lifecycleNextTask || '',
    archiveStatus: item.archiveStatus || '',
    deleteStatus: item.deleteStatus || '',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTaskTerminal(args, taskId, maxWaitMs) {
  const terminal = new Set(['done', 'failed_hard', 'cancelled', 'deleted', 'skipped', 'awaiting_user_confirm', 'paused', 'interrupted']);
  const started = Date.now();
  let last = null;
  while (Date.now() - started < maxWaitMs) {
    const detail = await httpJson(args, `task_${taskId}`, `/v1/tasks/${encodeURIComponent(taskId)}`);
    if (!detail.ok) return { detail, terminal: false };
    last = detail.body;
    if (terminal.has(last.status)) return { detail, task: last, terminal: true };
    await sleep(3000);
  }
  return { detail: null, task: last, terminal: false };
}

async function collectInitialContext(args) {
  const routes = [
    ['health', '/v1/health'],
    ['dashboardHealth', '/v1/admin/dashboard/health'],
    ['config', '/v1/config'],
    ['libraryStatus', '/v1/library/status'],
    ['tasksActive', '/v1/tasks?activeOnly=1'],
    ['adminTasks', '/v1/admin/tasks?page=1&pageSize=50'],
    ['deleteCandidates', '/v1/admin/delete-candidates?includeDecided=1'],
  ];
  const results = {};
  for (const [label, route] of routes) {
    results[label] = await httpJson(args, label, route);
  }
  return results;
}

async function stage0(args, context) {
  const initial = await collectInitialContext(args);
  context.initial = initial;
  const failed = Object.values(initial).filter((result) => !result.ok);
  if (failed.length > 0) return fail('production_precheck_api_failed', { failed: failed.map((r) => `${r.label}:${r.status || r.error}`) });

  const config = initial.config.body || {};
  const libraryStatus = initial.libraryStatus.body || {};
  const subLibrary = findSubLibrary(config, libraryStatus, args.libraryName);
  if (!subLibrary) return blocked('test_library_not_found', { libraryName: args.libraryName });
  context.subLibrary = subLibrary;
  const subLibraryId = subLibrary.uuid || subLibrary.id || subLibrary.subLibraryId || '';
  if (!subLibraryId) return blocked('test_library_missing_id', { subLibrary });

  const libraryRoute = `/v1/library/queries/manage?subLibraryId=${encodeURIComponent(subLibraryId)}&page=1&pageSize=${encodeURIComponent(String(args.pageSize))}&projection=manage`;
  const library = await httpJson(args, 'libraryManage', libraryRoute);
  context.initial.libraryManage = library;
  if (!library.ok) return fail('test_library_query_failed', { status: library.status, error: library.error });
  const items = Array.isArray(library.body && library.body.items) ? library.body.items : [];
  if (items.length === 0) return blocked('test_library_empty', { subLibraryId });
  context.canary = pickCanary(items, args.canaryItemId);
  if (!context.canary) return blocked('no_canary_item_available', { subLibraryId, requestedItemId: args.canaryItemId });

  const activeTasks = initial.tasksActive.body && Array.isArray(initial.tasksActive.body.tasks)
    ? initial.tasksActive.body.tasks
    : [];
  const canaryActiveTasks = activeTasks.filter((task) => task.itemId === itemIdOf(context.canary));
  context.canaryActiveTasks = canaryActiveTasks;
  return pass({
    subLibrary: { id: subLibraryId, name: subLibrary.name || '' },
    canary: compactItem(context.canary),
    activeTaskCount: activeTasks.length,
    canaryActiveTaskCount: canaryActiveTasks.length,
  });
}

async function stage1(args) {
  const routes = [
    ['dashboard', '/'],
    ['media', '/media'],
    ['tasks', '/tasks'],
    ['deleteCandidates', '/delete-candidates'],
    ['policiesLibrary', '/policies?tab=library'],
    ['policiesObjectives', '/policies?tab=objectives'],
    ['policiesAutomation', '/policies?tab=automation'],
    ['policiesDisposal', '/policies?tab=disposal'],
    ['advanced', '/advanced?tab=diagnostics'],
  ];
  const results = [];
  for (const [label, route] of routes) {
    results.push(await httpText(`${args.frontendUrl}${route}`, label));
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) return fail('frontend_routes_failed', { failed });
  return pass({ routes: results.map((result) => ({ label: result.label, status: result.status, elapsedMs: result.elapsedMs })) });
}

async function stage2(args, context) {
  const itemId = itemIdOf(context.canary);
  const before = await httpJson(args, 'canaryBeforePerception', `/v1/library/items/${encodeURIComponent(itemId)}`);
  if (!before.ok) return fail('canary_detail_failed', { status: before.status, error: before.error });
  const forbidden = forbiddenMetadataReasons(before.body);
  if (forbidden.length > 0) return fail('metadata_gate_waits_for_perception', { forbiddenReasons: forbidden });

  if (args.mode !== 'destructive') {
    return pass({
      mode: args.mode,
      canary: compactItem(before.body),
      note: 'Readonly mode verified metadata/perception separation without mutating rating.',
    });
  }

  const originalRating = before.body.userRating ?? null;
  const nextRating = originalRating === 2 ? 3 : 2;
  const patch = await httpJson(args, 'patchRating', '/v1/library/ratings', {
    method: 'PATCH',
    body: { itemId, userRating: nextRating },
  });
  if (!patch.ok) return fail('rating_patch_failed', { status: patch.status, body: patch.body, error: patch.error });
  const after = await httpJson(args, 'canaryAfterPerception', `/v1/library/items/${encodeURIComponent(itemId)}`);
  if (!after.ok) return fail('canary_detail_after_rating_failed', { status: after.status, error: after.error });

  const beforeVersion = Number(before.body.perceptionVersion || before.body.userPerceptionFacts && before.body.userPerceptionFacts.perceptionVersion || 0);
  const afterVersion = Number(after.body.perceptionVersion || after.body.userPerceptionFacts && after.body.userPerceptionFacts.perceptionVersion || 0);
  const activeTasks = await httpJson(args, 'activeTasksAfterPerception', `/v1/tasks?activeOnly=1`);
  const directTasks = activeTasks.ok && Array.isArray(activeTasks.body.tasks)
    ? activeTasks.body.tasks.filter((task) => task.itemId === itemId && !context.canaryActiveTasks.some((oldTask) => oldTask.id === task.id))
    : [];
  if (directTasks.length > 0) {
    return fail('perception_writer_created_task_directly', {
      originalRating,
      nextRating,
      directTasks: directTasks.map((task) => ({ id: task.id, targetGate: targetGateOf(task), status: task.status })),
    });
  }
  return pass({
    originalRating,
    nextRating,
    beforeVersion,
    afterVersion,
    ratingChanged: after.body.userRating === nextRating,
    versionAdvanced: afterVersion >= beforeVersion,
  });
}

async function stage3(args, context) {
  const itemId = itemIdOf(context.canary);
  if (args.mode === 'destructive') {
    await httpJson(args, 'recomputeOptimizeTargets', '/v1/library/actions/recompute-optimize-targets', { method: 'POST', body: {} });
  }
  const detail = await httpJson(args, 'canaryObjective', `/v1/library/items/${encodeURIComponent(itemId)}`);
  if (!detail.ok) return fail('objective_detail_failed', { status: detail.status, error: detail.error });
  const item = detail.body || {};
  const objective = item.optimizeObjective && typeof item.optimizeObjective === 'object' ? item.optimizeObjective : null;
  context.latestItem = item;
  context.optimizeObjective = objective;
  if (objective && ['delete', 'remove_media'].includes(String(objective.kind || ''))) {
    return fail('objective_contains_delete_semantics', { objective });
  }
  if (item.optimizeObjectiveStatus === 'pending_metadata' && item.metadataComplete === true) {
    return fail('objective_pending_metadata_despite_metadata_complete', { canary: compactItem(item) });
  }
  return pass({
    canary: compactItem(item),
    hasObjective: !!objective,
    objectiveKind: objective ? objective.kind || '' : '',
    targetFacts: objective && objective.targetMediaFacts || null,
  });
}

async function stage4(args, context) {
  if (args.mode !== 'destructive') return skipped('task_creation_requires_destructive_mode');
  const itemId = itemIdOf(context.canary);
  let gateObjective = context.optimizeObjective && typeof context.optimizeObjective === 'object' ? context.optimizeObjective : null;
  if (!gateObjective) {
    const detail = await httpJson(args, 'canaryObjectiveBeforeCreateTask', `/v1/library/items/${encodeURIComponent(itemId)}`);
    if (!detail.ok) return fail('objective_detail_before_task_create_failed', { httpStatus: detail.status, error: detail.error });
    gateObjective = detail.body && detail.body.optimizeObjective && typeof detail.body.optimizeObjective === 'object'
      ? detail.body.optimizeObjective
      : null;
  }
  if (!gateObjective || Object.keys(gateObjective).length === 0) {
    return fail('optimize_objective_missing_before_task_create', { itemId });
  }
  const create = await httpJson(args, 'createOptimizeTask', '/v1/tasks', {
    method: 'POST',
    body: { itemId, targetGate: 'optimize', gateObjective },
  });
  context.optimizeCreate = create;
  if (create.status === 409 && create.body && create.body.admission) {
    return blocked('optimize_task_admission_rejected', {
      reason: create.body.admission.reason || create.body.error && create.body.error.message || '',
      admission: create.body.admission,
      lifecycleProjection: create.body.lifecycleProjection || null,
    });
  }
  if (!create.ok) return fail('optimize_task_create_failed', { status: create.status, body: create.body, error: create.error });
  const task = create.body || {};
  if (targetGateOf(task) !== 'optimize') return fail('created_task_not_target_gate_optimize', { taskTarget: task.taskTarget });
  if (hasMirexTopLevel(task)) return fail('task_exposes_mirex_identity', { taskKeys: Object.keys(task) });
  if (hasDeleteAsOptimize(task)) return fail('created_optimize_task_is_delete_as_optimize', { flowPlan: task.flowPlan, gateObjective: gateObjectiveOf(task) });

  const duplicate = await httpJson(args, 'createOptimizeTaskDuplicate', '/v1/tasks', {
    method: 'POST',
    body: { itemId, targetGate: 'optimize', gateObjective },
  });
  if (![409, 400].includes(duplicate.status)) {
    return fail('duplicate_prevention_not_enforced', { duplicateStatus: duplicate.status, duplicateBody: duplicate.body });
  }
  context.optimizeTask = task;
  return pass({
    taskId: task.id,
    targetGate: targetGateOf(task),
    gateObjectiveKind: gateObjective.kind || '',
    flowKind: flowKindOf(task),
    admission: task.admission || null,
    duplicateStatus: duplicate.status,
  });
}

async function stage5(args, context) {
  const task = context.optimizeTask || context.optimizeCreate && context.optimizeCreate.body;
  if (!task || !task.id) {
    if (context.optimizeCreate && context.optimizeCreate.status === 409) return blocked('no_optimize_task_due_to_admission_rejection');
    return skipped('no_optimize_task_available_for_flow_planner');
  }
  const flowKind = flowKindOf(task);
  if (!flowKind) return fail('flow_plan_missing_flow_kind', { taskId: task.id, flowPlan: task.flowPlan || null });
  if (flowKind === 'delete' || hasDeleteAsOptimize(task)) return fail('flow_planner_selected_delete_for_optimize', { taskId: task.id, flowPlan: task.flowPlan });
  if (args.mode === 'destructive' && flowKind === 'blocked') {
    return fail('flow_planner_blocked_destructive_optimize', { taskId: task.id, flowPlan: task.flowPlan || null });
  }
  if (args.mode === 'destructive' && flowKind !== 'transcode') {
    return fail('flow_planner_did_not_select_transcode', { taskId: task.id, flowKind, flowPlan: task.flowPlan || null });
  }
  const explanation = task.flowPlan && (task.flowPlan.explanation || task.flowPlan.flowSelection || task.flowPlan.reason) || null;
  return pass({
    taskId: task.id,
    flowKind,
    hasExplanation: !!explanation,
    explanation,
  });
}

async function stage6(args, context) {
  if (args.mode !== 'destructive') return skipped('execution_requires_destructive_mode');
  const task = context.optimizeTask || context.optimizeCreate && context.optimizeCreate.body;
  if (!task || !task.id) return skipped('no_optimize_task_to_execute');
  const detail = await httpJson(args, 'optimizeTaskDetail', `/v1/tasks/${encodeURIComponent(task.id)}`);
  if (!detail.ok) return fail('optimize_task_detail_failed', { status: detail.status, error: detail.error });
  const events = await httpJson(args, 'optimizeTaskEvents', `/v1/tasks/${encodeURIComponent(task.id)}/events?page=1&pageSize=50`);
  const eventCount = events.ok && Array.isArray(events.body.events) ? events.body.events.length : 0;
  const current = detail.body || {};
  const retryAction = current.controlState && current.controlState.actions && current.controlState.actions.retry;
  if (current.status === 'failed_hard' && retryAction && retryAction.enabled) {
    await httpJson(args, 'retryOptimizeTask', `/v1/tasks/${encodeURIComponent(task.id)}/actions/retry`, { method: 'POST', body: {} });
  }
  if (['created', 'pending_manual', 'paused', 'interrupted'].includes(current.status)) {
    await httpJson(args, 'executeOptimizeTask', `/v1/tasks/${encodeURIComponent(task.id)}/actions/execute`, { method: 'POST', body: {} });
  }
  const terminal = await waitForTaskTerminal(args, task.id, args.maxWaitMs);
  context.optimizeTerminal = terminal.task || current;
  if (!terminal.task) return blocked('optimize_task_no_terminal_state_observed', { taskId: task.id });
  if (terminal.task.status === 'failed_hard') return fail('optimize_task_failed_hard', { taskId: task.id, taskStatus: terminal.task.status, controlState: terminal.task.controlState || null });
  return pass({
    taskId: task.id,
    initialStatus: current.status,
    finalStatus: terminal.task.status,
    eventCount,
    controlState: terminal.task.controlState || null,
  });
}

async function stage7(args, context) {
  const itemId = itemIdOf(context.canary);
  const detail = await httpJson(args, 'canaryAfterOptimize', `/v1/library/items/${encodeURIComponent(itemId)}`);
  if (!detail.ok) return fail('canary_after_optimize_detail_failed', { status: detail.status, error: detail.error });
  const item = detail.body || {};
  const gate = item.optimizeGate || item.optimizationGate || null;
  if (!gate && args.mode === 'destructive' && context.optimizeTerminal && context.optimizeTerminal.status === 'done') {
    return fail('optimize_done_without_optimize_gate_facts', { canary: compactItem(item) });
  }
  return pass({
    canary: compactItem(item),
    optimizeGateStatus: gate && (gate.status || gate.reason) || '',
    pendingCanonicalRefresh: item.optimizeGateStatus === 'pending_canonical_refresh' || item.optimizationStatus === 'pending_canonical_refresh',
    gate,
  });
}

async function stage8(args, context) {
  if (args.mode !== 'destructive') return skipped('archive_execution_requires_destructive_mode');
  const itemId = itemIdOf(context.canary);
  const create = await httpJson(args, 'createArchiveTask', '/v1/tasks', {
    method: 'POST',
    body: { itemId, targetGate: 'archive', gateObjective: {} },
  });
  if (create.status === 409) return blocked('archive_task_admission_rejected', { body: create.body });
  if (!create.ok) return fail('archive_task_create_failed', { status: create.status, body: create.body, error: create.error });
  const task = create.body || {};
  if (targetGateOf(task) !== 'archive') return fail('archive_task_wrong_target_gate', { taskTarget: task.taskTarget });
  await httpJson(args, 'executeArchiveTask', `/v1/tasks/${encodeURIComponent(task.id)}/actions/execute`, { method: 'POST', body: {} });
  const terminal = await waitForTaskTerminal(args, task.id, args.maxWaitMs);
  if (terminal.task && terminal.task.status === 'failed_hard') return fail('archive_task_failed_hard', { taskId: task.id, controlState: terminal.task.controlState || null });
  const detail = await httpJson(args, 'canaryAfterArchive', `/v1/library/items/${encodeURIComponent(itemId)}`);
  const item = detail.body || {};
  return pass({
    taskId: task.id,
    finalStatus: terminal.task && terminal.task.status || '',
    archiveStatus: item.archiveStatus || '',
    archiveDoneAt: item.archiveDoneAt || '',
    hasArchiveGate: !!(item.archiveGate),
  });
}

async function stage9(args, context) {
  if (args.mode !== 'destructive') return skipped('delete_candidate_requires_destructive_mode');
  const itemId = itemIdOf(context.canary);
  await httpJson(args, 'setLowRatingForDelete', '/v1/library/ratings', {
    method: 'PATCH',
    body: { itemId, userRating: 1 },
  });
  const candidates = await httpJson(args, 'deleteCandidatesAfterArchive', '/v1/admin/delete-candidates?includeDecided=1');
  if (!candidates.ok) return fail('delete_candidates_query_failed', { status: candidates.status, error: candidates.error });
  const list = Array.isArray(candidates.body.candidates) ? candidates.body.candidates : [];
  const candidate = list.find((entry) => entry.itemId === itemId);
  context.deleteCandidate = candidate || null;
  if (!candidate) {
    return blocked('canary_not_delete_eligible', {
      itemId,
      candidateCount: list.length,
      note: 'Verify deleteGatePolicy for the test library or archive age rule.',
    });
  }
  if (!['pending_review', 'confirmed'].includes(candidate.candidateStatus)) {
    return blocked('delete_candidate_not_pending_review', { candidate });
  }
  const active = await httpJson(args, 'activeDeleteTasksBeforeConfirm', `/v1/tasks?targetGate=delete&activeOnly=1`);
  const activeDelete = active.ok && Array.isArray(active.body.tasks)
    ? active.body.tasks.filter((task) => task.itemId === itemId)
    : [];
  if (candidate.candidateStatus === 'pending_review' && activeDelete.length > 0) {
    return fail('delete_task_created_before_user_confirmation', { activeDelete: activeDelete.map((task) => ({ id: task.id, status: task.status })) });
  }
  return pass({ candidate });
}

async function stage10(args, context) {
  if (args.mode !== 'destructive') return skipped('confirmed_delete_requires_destructive_mode');
  if (!context.deleteCandidate) return skipped('no_delete_candidate_available');
  const itemId = itemIdOf(context.canary);
  const confirm = await httpJson(args, 'confirmDeleteCandidate', `/v1/admin/delete-candidates/${encodeURIComponent(itemId)}/actions/confirm-delete`, {
    method: 'POST',
    body: {},
  });
  if (confirm.status === 409) return blocked('delete_task_admission_rejected', { body: confirm.body });
  if (!confirm.ok) return fail('confirm_delete_failed', { status: confirm.status, body: confirm.body, error: confirm.error });
  const task = confirm.body || {};
  if (targetGateOf(task) !== 'delete') return fail('confirmed_delete_created_wrong_target_gate', { taskTarget: task.taskTarget });
  if (flowKindOf(task) && flowKindOf(task) !== 'delete') return fail('delete_task_wrong_flow_kind', { flowKind: flowKindOf(task), flowPlan: task.flowPlan });
  context.deleteTask = task;
  await httpJson(args, 'executeDeleteTask', `/v1/tasks/${encodeURIComponent(task.id)}/actions/execute`, { method: 'POST', body: {} });
  const terminal = await waitForTaskTerminal(args, task.id, args.maxWaitMs);
  const itemDetail = await httpJson(args, 'canaryAfterDelete', `/v1/library/items/${encodeURIComponent(itemId)}`);
  const item = itemDetail.body || {};
  if (terminal.task && terminal.task.status === 'failed_hard') return fail('delete_task_failed_hard', { taskId: task.id, controlState: terminal.task.controlState || null });
  if (item.optimizeGate && item.optimizeGate.flowKind === 'delete') return fail('delete_overwrote_optimize_gate', { optimizeGate: item.optimizeGate });
  return pass({
    taskId: task.id,
    finalStatus: terminal.task && terminal.task.status || '',
    hasDeleteGate: !!(item.deleteGate || item.deletionGate),
    hasArchiveHistory: !!(item.archiveGate || item.archiveDoneAt),
    deleteStatus: item.deleteStatus || '',
  });
}

async function stage11(args, context) {
  const tasks = context.initial && context.initial.adminTasks && context.initial.adminTasks.body && Array.isArray(context.initial.adminTasks.body.tasks)
    ? context.initial.adminTasks.body.tasks
    : [];
  const activeTasks = context.initial && context.initial.tasksActive && context.initial.tasksActive.body && Array.isArray(context.initial.tasksActive.body.tasks)
    ? context.initial.tasksActive.body.tasks
    : [];
  const allTasks = [...tasks, ...activeTasks, context.optimizeTask, context.deleteTask].filter(Boolean);
  const mirexTasks = allTasks.filter(hasMirexTopLevel);
  const deleteOptimizeTasks = allTasks.filter(hasDeleteAsOptimize);
  const config = context.initial && context.initial.config && context.initial.config.body || {};
  const optimizeAllowedOperations = Array.isArray(config.optimizeAllowedOperations) ? config.optimizeAllowedOperations : [];
  const legacyConfigFields = [];
  if (Object.prototype.hasOwnProperty.call(config, 'smartTaskEnabledActions')) legacyConfigFields.push('smartTaskEnabledActions');
  if (Object.prototype.hasOwnProperty.call(config, 'optimizeAllowedOperations')) legacyConfigFields.push('optimizeAllowedOperations');
  if (config.taskAdmission && Object.prototype.hasOwnProperty.call(config.taskAdmission, 'maxQueuedByAction')) legacyConfigFields.push('taskAdmission.maxQueuedByAction');
  if (config.taskAdmission && Object.prototype.hasOwnProperty.call(config.taskAdmission, 'cooldownHoursByAction')) legacyConfigFields.push('taskAdmission.cooldownHoursByAction');
  if (config.taskPriority && Object.prototype.hasOwnProperty.call(config.taskPriority, 'operationKindWeights')) legacyConfigFields.push('taskPriority.operationKindWeights');
  if (config.taskPriority && Object.prototype.hasOwnProperty.call(config.taskPriority, 'actionTypeWeights')) legacyConfigFields.push('taskPriority.actionTypeWeights');
  if (config.taskPriority && config.taskPriority.optimizeOperationHints && Object.prototype.hasOwnProperty.call(config.taskPriority.optimizeOperationHints, 'delete')) {
    legacyConfigFields.push('taskPriority.optimizeOperationHints.delete');
  }
  if (optimizeAllowedOperations.includes('delete')) {
    return fail('config_allows_delete_as_optimize_operation', { optimizeAllowedOperations });
  }
  if (legacyConfigFields.length > 0) {
    return fail('config_exposes_legacy_mirex_fields', { legacyConfigFields });
  }
  if (mirexTasks.length > 0) {
    return fail('task_api_exposes_mirex_identity', { count: mirexTasks.length, taskIds: mirexTasks.map((task) => task.id) });
  }
  if (deleteOptimizeTasks.length > 0) {
    return fail('delete_as_optimize_task_detected', { count: deleteOptimizeTasks.length, taskIds: deleteOptimizeTasks.map((task) => task.id) });
  }
  return pass({ checkedTaskCount: allTasks.length, optimizeAllowedOperations });
}

function reportMarkdown({ args, run, stages }) {
  const stageRows = stages.map((stage) => (
    `| ${stage.id} | ${stage.name} | ${stage.result.status} | ${stage.result.reason || ''} | ${JSON.stringify(stage.result).replace(/\|/g, '\\|')} |`
  )).join('\n');
  const timingRows = (run.timings || []).map((entry) => (
    `| ${entry.label} | ${entry.method || 'GET'} | ${entry.route || entry.url || ''} | ${entry.status || '-'} | ${entry.elapsedMs} | ${entry.ok ? 'PASS' : 'FAIL'} |`
  )).join('\n');
  const destructiveRows = (run.destructiveActions || []).map((entry) => (
    `| ${entry.stage} | ${entry.action} | ${entry.itemId || ''} | ${entry.taskId || ''} | ${entry.result || ''} |`
  )).join('\n') || '| - | - | - | - | - |';

  return `# Kairox Frontend/API E2E Report

## Run Metadata

- 时间: ${run.startedAt}
- 目标: \`${args.baseUrl}\`
- 前端: \`${args.frontendUrl}\`
- 模式: \`${args.mode}\`
- 测试库: \`${args.libraryName}\`
- Git commit: \`${run.gitCommit || ''}\`
- API key: ${redact(args.apiKey) || '未提供'}
- Canary item: \`${run.canary && run.canary.itemId || ''}\`

## Stage Results

| Stage | Name | Result | Reason | Detail |
| --- | --- | --- | --- | --- |
${stageRows}

## API Timing

| Name | Method | Route | Status | ms | Result |
| --- | --- | --- | ---: | ---: | --- |
${timingRows}

## Destructive Actions

| Stage | Action | Item | Task | Result |
| --- | --- | --- | --- | --- |
${destructiveRows}

## Next Action

${nextAction(stages)}
`;
}

function nextAction(stages) {
  const failed = stages.find((stage) => stage.result.status === 'FAIL');
  if (failed) return `- 修复 \`${failed.id}\`: ${failed.result.reason || '见 Detail'}，修复后从该 stage 重新验收。`;
  const blockedStage = stages.find((stage) => stage.result.status === 'BLOCKED');
  if (blockedStage) return `- 解除 \`${blockedStage.id}\` 的阻塞: ${blockedStage.result.reason || '见 Detail'}，再继续后续 stage。`;
  const skippedStages = stages.filter((stage) => stage.result.status === 'SKIPPED');
  if (skippedStages.length > 0) return `- 已通过可执行阶段；仍有 ${skippedStages.length} 个 stage 因当前模式跳过。需要 destructive 模式才能完成完整业务闭环。`;
  return '- 所有 stage 通过。';
}

function stageIndex(id) {
  const index = STAGE_ORDER.indexOf(id);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function loadState(statePath) {
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertSafety(args);
  const statePath = path.resolve(args.state);
  const savedState = args.stage && args.stage !== 'stage0' ? loadState(statePath) : null;
  const context = savedState && savedState.context && typeof savedState.context === 'object'
    ? savedState.context
    : { initial: {}, destructiveActions: [] };
  context.initial = context.initial || {};
  context.destructiveActions = Array.isArray(context.destructiveActions) ? context.destructiveActions : [];
  const run = {
    startedAt: savedState && savedState.run && savedState.run.startedAt || nowIso(),
    gitCommit: getGitCommit(),
    timings: [],
    destructiveActions: context.destructiveActions,
    canary: null,
  };
  let stages = Array.isArray(savedState && savedState.stages) ? savedState.stages : [];

  async function executeStage(id, name, fn) {
    if (args.stage) {
      stages = stages.filter((stage) => stageIndex(stage.id) < stageIndex(id));
    }
    let result;
    try {
      result = await fn();
    } catch (err) {
      result = fail('stage_exception', { error: err && err.stack ? err.stack : String(err) });
    }
    stages.push({ id, name, result });
    if (context.canary) run.canary = compactItem(context.canary);
    return result;
  }

  async function runStage(id, name, fn) {
    const result = await executeStage(id, name, fn);
    return !['FAIL', 'BLOCKED'].includes(result.status);
  }

  const stageDefinitions = [
    ['stage0', 'Readonly production precheck', () => stage0(args, context)],
    ['stage1', 'Frontend Kairox projection smoke', () => stage1(args)],
    ['stage2', 'Fact ownership and perception separation', () => stage2(args, context)],
    ['stage3', 'Lifecycle objective projection', () => stage3(args, context)],
    ['stage4', 'Task Creator and Admission', () => stage4(args, context)],
    ['stage5', 'Flow Planner selection', () => stage5(args, context)],
    ['stage6', 'Resource Runtime execution', () => stage6(args, context)],
    ['stage7', 'Optimize gate and canonical refresh', () => stage7(args, context)],
    ['stage8', 'Archive gate', () => stage8(args, context)],
    ['stage9', 'Delete candidate review', () => stage9(args, context)],
    ['stage10', 'Confirmed delete', () => stage10(args, context)],
    ['stage11', 'Kairox/Mirex regression checks', () => stage11(args, context)],
  ];

  if (args.stage) {
    const definition = stageDefinitions.find(([id]) => id === args.stage);
    if (args.stage !== 'stage0' && !context.canary) {
      stages.push({ id: args.stage, name: definition[1], result: blocked('stage_state_missing_run_stage0_first', { statePath }) });
    } else {
      await runStage(definition[0], definition[1], definition[2]);
    }
  } else {
    for (const [id, name, fn] of stageDefinitions) {
      const shouldContinue = await runStage(id, name, fn);
      if (!shouldContinue) break;
    }
  }

  function collectTimings(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.elapsedMs === 'number' && value.label) run.timings.push(value);
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') collectTimings(nested);
    }
  }
  collectTimings(context);

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, reportMarkdown({ args, run, stages }), 'utf8');
  if (args.stage) {
    saveState(statePath, { context, run: { startedAt: run.startedAt }, stages });
  }

  const payload = {
    generatedAt: nowIso(),
    report: outPath,
    stages,
    canary: run.canary,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (stages.some((stage) => stage.result.status === 'FAIL')) process.exitCode = 1;
  else if (stages.some((stage) => stage.result.status === 'BLOCKED')) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
