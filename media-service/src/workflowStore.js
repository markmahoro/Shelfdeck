'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const workflowGraph = require('./workflowGraph');

const dbCache = new Map();
const TERMINAL = new Set(['succeeded', 'skipped', 'failed', 'cancelled']);

function dataDir() { return process.env.CONTROL_PLANE_DATA_DIR || process.env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data'); }
function dbPath() { return path.join(dataDir(), 'tasks.db'); }
function parse(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; } }
function stringify(value) { return JSON.stringify(value == null ? null : value); }

function db() {
  fs.mkdirSync(dataDir(), { recursive: true });
  const file = dbPath();
  if (dbCache.has(file)) return dbCache.get(file);
  const connection = new Database(file);
  connection.pragma('journal_mode = WAL');
  connection.pragma('synchronous = NORMAL');
  connection.pragma('busy_timeout = 5000');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS workflow_plans (
      plan_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, subject_id TEXT NOT NULL,
      target_gate TEXT NOT NULL, classification TEXT NOT NULL, schema_version TEXT NOT NULL,
      planner_version TEXT NOT NULL, plan_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_events (
      event_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, task_id TEXT NOT NULL, subject_id TEXT NOT NULL,
      capability TEXT NOT NULL, ordinal INTEGER NOT NULL, status TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0, ready_at TEXT, resource_wait_started_at TEXT,
      approval_wait_started_at TEXT, started_at TEXT, finished_at TEXT, retry_at TEXT,
      resource_key TEXT NOT NULL DEFAULT '', executor_version TEXT NOT NULL DEFAULT '',
      intent_json TEXT NOT NULL, input_json TEXT, result_json TEXT, evidence_json TEXT,
      failure_json TEXT, fencing_json TEXT, commit_marker TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_event_audit (
      audit_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, task_id TEXT NOT NULL,
      from_status TEXT NOT NULL DEFAULT '', to_status TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_mutation_results (
      mutation_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, task_id TEXT NOT NULL, event_id TEXT NOT NULL,
      mutation_kind TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT NOT NULL,
      created_at TEXT NOT NULL, consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_events_task_status ON workflow_events(task_id,status,ordinal);
    CREATE INDEX IF NOT EXISTS idx_workflow_events_status_retry ON workflow_events(status,retry_at,updated_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_audit_event_created ON workflow_event_audit(event_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_source_mutations_status_created ON source_mutation_results(status,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_commit_once ON workflow_events(commit_marker) WHERE commit_marker IS NOT NULL AND commit_marker<>'';
  `);
  dbCache.set(file, connection);
  return connection;
}

function rowEvent(row) {
  if (!row) return null;
  return {
    eventId: row.event_id, planId: row.plan_id, taskId: row.task_id, subjectId: row.subject_id,
    capability: row.capability, ordinal: row.ordinal, status: row.status, attempt: row.attempt,
    readyAt: row.ready_at, resourceWaitStartedAt: row.resource_wait_started_at,
    approvalWaitStartedAt: row.approval_wait_started_at, startedAt: row.started_at,
    finishedAt: row.finished_at, retryAt: row.retry_at, resourceKey: row.resource_key,
    executorVersion: row.executor_version, intent: parse(row.intent_json, {}), input: parse(row.input_json, null),
    result: parse(row.result_json, null), evidence: parse(row.evidence_json, null), failure: parse(row.failure_json, null),
    fencing: parse(row.fencing_json, null), commitMarker: row.commit_marker, updatedAt: row.updated_at,
  };
}

function createPlan(plan, registry) {
  workflowGraph.validateGraph(plan, registry);
  const now = new Date().toISOString();
  const connection = db();
  const transaction = connection.transaction(() => {
    connection.prepare(`INSERT INTO workflow_plans
      (plan_id,task_id,subject_id,target_gate,classification,schema_version,planner_version,plan_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(plan.planId, plan.taskId, plan.subjectId, plan.targetGate, plan.classification, plan.schemaVersion, plan.plannerVersion, stringify(plan), now);
    const insert = connection.prepare(`INSERT INTO workflow_events
      (event_id,plan_id,task_id,subject_id,capability,ordinal,status,intent_json,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    plan.nodes.forEach((node, ordinal) => insert.run(node.eventId, plan.planId, plan.taskId, plan.subjectId, node.capability, ordinal, 'pending', stringify(node), now));
  });
  transaction();
  return plan;
}

function getPlanForTask(taskId) {
  const row = db().prepare('SELECT plan_json FROM workflow_plans WHERE task_id=?').get(String(taskId || ''));
  return row ? parse(row.plan_json, null) : null;
}

function listEvents(taskId) { return db().prepare('SELECT * FROM workflow_events WHERE task_id=? ORDER BY ordinal').all(String(taskId || '')).map(rowEvent); }
function queryEvents(filter = {}, options = {}) {
  const clauses = [];
  const params = {};
  if (filter.taskId) { clauses.push('task_id=@taskId'); params.taskId = String(filter.taskId); }
  if (filter.capability) { clauses.push('capability=@capability'); params.capability = String(filter.capability); }
  if (filter.status) { clauses.push('status=@status'); params.status = String(filter.status); }
  const limit = Math.min(1000, Math.max(1, Number(options.limit) || 100));
  return db().prepare(`SELECT * FROM workflow_events ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT ${limit}`).all(params).map(rowEvent);
}
function performanceSnapshot() {
  const rows = db().prepare('SELECT * FROM workflow_events WHERE finished_at IS NOT NULL OR status IN (\'failed\',\'cancelled\')').all().map(rowEvent);
  const groups = new Map();
  const duration = (from, to) => from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : null;
  for (const event of rows) {
    const parameters = event.intent && event.intent.parameters || {};
    const parameterKey = Object.keys(parameters).sort().map((name) => `${name}=${parameters[name]}`).join(',');
    const key = `${event.capability}\0${event.resourceKey}\0${parameterKey}`;
    if (!groups.has(key)) groups.set(key, { capability: event.capability, resourceKey: event.resourceKey, parameters, count: 0, failed: 0, queue: [], resource: [], approval: [], execution: [] });
    const group = groups.get(key); group.count += 1; if (event.status === 'failed') group.failed += 1;
    for (const [name, value] of [['queue', duration(event.readyAt, event.startedAt)], ['resource', duration(event.resourceWaitStartedAt, event.startedAt)], ['approval', duration(event.approvalWaitStartedAt, event.startedAt)], ['execution', duration(event.startedAt, event.finishedAt)]]) if (value != null) group[name].push(value);
  }
  const percentile = (values, p) => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; };
  const stats = (values) => ({ p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99) });
  return [...groups.values()].map((group) => ({ capability: group.capability, resourceKey: group.resourceKey, parameters: group.parameters, count: group.count, failed: group.failed, queueWaitMs: stats(group.queue), resourceWaitMs: stats(group.resource), approvalWaitMs: stats(group.approval), executionMs: stats(group.execution) }));
}
function invariantSnapshot() {
  const connection = db();
  const duplicateCommits = connection.prepare(`SELECT commit_marker AS commitMarker,COUNT(*) AS count
    FROM workflow_events WHERE commit_marker IS NOT NULL AND commit_marker<>''
    GROUP BY commit_marker HAVING COUNT(*)>1`).all();
  const deadlockedTasks = connection.prepare(`SELECT task_id AS taskId,COUNT(*) AS pendingCount
    FROM workflow_events GROUP BY task_id
    HAVING SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)>0
      AND SUM(CASE WHEN status IN ('ready','waiting_for_resource','waiting_for_approval','executing') THEN 1 ELSE 0 END)=0`).all();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stuckEvents = connection.prepare("SELECT event_id AS eventId,task_id AS taskId,capability,started_at AS startedAt FROM workflow_events WHERE status='executing' AND started_at<?").all(cutoff);
  return { duplicateCommits, deadlockedTasks, stuckEvents };
}
function activeMetadataArtifactReferences() {
  return db().prepare(`SELECT DISTINCT e.subject_id AS subjectId,
      COALESCE(NULLIF(json_extract(p.plan_json,'$.objectiveRevision'),''),e.task_id) AS artifactRevision
    FROM workflow_events e JOIN workflow_plans p ON p.plan_id=e.plan_id
    WHERE e.capability IN ('metadata.sidecar.render','metadata.image.acquire','metadata.artifacts.materialize')
      AND e.status NOT IN ('succeeded','skipped','failed','cancelled')`).all();
}
function getEvent(eventId) { return rowEvent(db().prepare('SELECT * FROM workflow_events WHERE event_id=?').get(String(eventId || ''))); }

function transition(eventId, status, patch = {}) {
  const current = getEvent(eventId);
  if (!current) return null;
  if (current.status === status && Object.keys(patch).length === 0) return current;
  const now = new Date().toISOString();
  const next = { ...current, ...patch, status, updatedAt: now };
  const fields = {
    status, attempt: Number(next.attempt) || 0, ready_at: next.readyAt || null,
    resource_wait_started_at: next.resourceWaitStartedAt || null, approval_wait_started_at: next.approvalWaitStartedAt || null,
    started_at: next.startedAt || null, finished_at: next.finishedAt || null, retry_at: next.retryAt || null,
    resource_key: next.resourceKey || '', executor_version: next.executorVersion || '',
    input_json: stringify(next.input), result_json: stringify(next.result), evidence_json: stringify(next.evidence),
    failure_json: stringify(next.failure), fencing_json: stringify(next.fencing), commit_marker: next.commitMarker || null,
    updated_at: now, event_id: current.eventId,
  };
  const connection = db();
  const transaction = connection.transaction(() => {
    connection.prepare(`UPDATE workflow_events SET status=@status,attempt=@attempt,ready_at=@ready_at,
      resource_wait_started_at=@resource_wait_started_at,approval_wait_started_at=@approval_wait_started_at,
      started_at=@started_at,finished_at=@finished_at,retry_at=@retry_at,resource_key=@resource_key,
      executor_version=@executor_version,input_json=@input_json,result_json=@result_json,evidence_json=@evidence_json,
      failure_json=@failure_json,fencing_json=@fencing_json,commit_marker=@commit_marker,updated_at=@updated_at
      WHERE event_id=@event_id`).run(fields);
    if (current.status !== status) connection.prepare(`INSERT INTO workflow_event_audit
      (audit_id,event_id,task_id,from_status,to_status,payload_json,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(crypto.randomUUID(), current.eventId, current.taskId, current.status, status, stringify(patch.audit || {}), now);
  });
  transaction();
  return getEvent(eventId);
}

function recoverInterruptedEvents() {
  const rows = db().prepare("SELECT event_id,status FROM workflow_events WHERE status IN ('executing','waiting_for_resource')").all();
  for (const row of rows) transition(row.event_id, 'ready', { resourceKey: '', resourceWaitStartedAt: null, failure: row.status === 'executing' ? { code: 'PROCESS_RESTARTED', retryable: true } : null });
  return [...new Set(rows.map((row) => getEvent(row.event_id).taskId))];
}

function recordMutation(input = {}) {
  const mutationId = input.mutationId || crypto.randomUUID();
  db().prepare(`INSERT OR IGNORE INTO source_mutation_results
    (mutation_id,subject_id,task_id,event_id,mutation_kind,status,result_json,created_at)
    VALUES (?,?,?,?,?,'pending',?,?)`).run(mutationId, input.subjectId || '', input.taskId || '', input.eventId || '', input.mutationKind || '', stringify(input), input.committedAt || new Date().toISOString());
  return mutationId;
}
function listPendingMutations(limit = 100) { return db().prepare("SELECT * FROM source_mutation_results WHERE status='pending' ORDER BY created_at LIMIT ?").all(Math.max(1, Number(limit) || 100)).map((row) => ({ ...parse(row.result_json, {}), mutationId: row.mutation_id })); }
function markMutationConsumed(mutationId) { return db().prepare("UPDATE source_mutation_results SET status='consumed',consumed_at=? WHERE mutation_id=? AND status='pending'").run(new Date().toISOString(), mutationId).changes > 0; }

function resetForTests() { for (const connection of dbCache.values()) connection.close(); dbCache.clear(); }

module.exports = { TERMINAL, createPlan, getPlanForTask, listEvents, queryEvents, performanceSnapshot, invariantSnapshot, activeMetadataArtifactReferences, getEvent, transition, recoverInterruptedEvents, recordMutation, listPendingMutations, markMutationConsumed, resetForTests };
