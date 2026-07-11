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
      plan_id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, item_id TEXT NOT NULL,
      target_gate TEXT NOT NULL, classification TEXT NOT NULL, schema_version TEXT NOT NULL,
      planner_version TEXT NOT NULL, plan_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_events (
      event_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, task_id TEXT NOT NULL, item_id TEXT NOT NULL,
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
      mutation_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, task_id TEXT NOT NULL, event_id TEXT NOT NULL,
      mutation_kind TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT NOT NULL,
      created_at TEXT NOT NULL, consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_events_task_status ON workflow_events(task_id,status,ordinal);
    CREATE INDEX IF NOT EXISTS idx_workflow_events_status_retry ON workflow_events(status,retry_at,updated_at);
    CREATE INDEX IF NOT EXISTS idx_workflow_audit_event_created ON workflow_event_audit(event_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_source_mutations_status_created ON source_mutation_results(status,created_at);
  `);
  dbCache.set(file, connection);
  return connection;
}

function rowEvent(row) {
  if (!row) return null;
  return {
    eventId: row.event_id, planId: row.plan_id, taskId: row.task_id, itemId: row.item_id,
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
      (plan_id,task_id,item_id,target_gate,classification,schema_version,planner_version,plan_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(plan.planId, plan.taskId, plan.itemId, plan.targetGate, plan.classification, plan.schemaVersion, plan.plannerVersion, stringify(plan), now);
    const insert = connection.prepare(`INSERT INTO workflow_events
      (event_id,plan_id,task_id,item_id,capability,ordinal,status,intent_json,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    plan.nodes.forEach((node, ordinal) => insert.run(node.eventId, plan.planId, plan.taskId, plan.itemId, node.capability, ordinal, 'pending', stringify(node), now));
  });
  transaction();
  return plan;
}

function getPlanForTask(taskId) {
  const row = db().prepare('SELECT plan_json FROM workflow_plans WHERE task_id=?').get(String(taskId || ''));
  return row ? parse(row.plan_json, null) : null;
}

function listEvents(taskId) { return db().prepare('SELECT * FROM workflow_events WHERE task_id=? ORDER BY ordinal').all(String(taskId || '')).map(rowEvent); }
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
  return rows.length;
}

function recordMutation(input = {}) {
  const mutationId = input.mutationId || crypto.randomUUID();
  db().prepare(`INSERT OR IGNORE INTO source_mutation_results
    (mutation_id,item_id,task_id,event_id,mutation_kind,status,result_json,created_at)
    VALUES (?,?,?,?,?,'pending',?,?)`).run(mutationId, input.itemId || '', input.taskId || '', input.eventId || '', input.mutationKind || '', stringify(input), input.committedAt || new Date().toISOString());
  return mutationId;
}
function listPendingMutations(limit = 100) { return db().prepare("SELECT * FROM source_mutation_results WHERE status='pending' ORDER BY created_at LIMIT ?").all(Math.max(1, Number(limit) || 100)).map((row) => ({ ...parse(row.result_json, {}), mutationId: row.mutation_id })); }
function markMutationConsumed(mutationId) { return db().prepare("UPDATE source_mutation_results SET status='consumed',consumed_at=? WHERE mutation_id=? AND status='pending'").run(new Date().toISOString(), mutationId).changes > 0; }

function resetForTests() { for (const connection of dbCache.values()) connection.close(); dbCache.clear(); }

module.exports = { TERMINAL, createPlan, getPlanForTask, listEvents, getEvent, transition, recoverInterruptedEvents, recordMutation, listPendingMutations, markMutationConsumed, resetForTests };
