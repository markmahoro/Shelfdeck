'use strict';

const taskStore = require('./taskStore');
const workflowStore = require('./workflowStore');

const TARGETS = ['basedata', 'metadata', 'optimize'];
let tripped = null;

function gateLimit(config = {}, targetGate = '') {
  const admission = config.taskAdmission || {};
  const byGate = admission.maxQueuedByTargetGate || {};
  const value = Number(byGate[targetGate] ?? admission.defaultMaxQueued);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function evaluate(config = {}) {
  const snapshot = taskStore.queryAutomationInvariantSnapshot({ windowMs: 60000 });
  const workflow = workflowStore.invariantSnapshot();
  const violations = [];
  const remainingByTargetGate = {};
  for (const targetGate of TARGETS) {
    const count = Number(snapshot.activeByTargetGate[targetGate] || 0);
    const limit = gateLimit(config, targetGate);
    remainingByTargetGate[targetGate] = limit == null ? null : Math.max(0, limit - count);
    if (limit != null && count > limit) violations.push({ code: 'gate_supply_cap_exceeded', targetGate, count, limit });
  }
  const maxEventsPerMinute = Math.max(100, Number(process.env.SHELFDECK_MAX_TASK_EVENTS_PER_MINUTE) || 2000);
  if (snapshot.eventCount > maxEventsPerMinute) {
    violations.push({ code: 'task_event_write_rate_exceeded', count: snapshot.eventCount, limit: maxEventsPerMinute });
  }
  if (snapshot.churnTasks.length > 0) {
    violations.push({ code: 'task_state_churn_detected', tasks: snapshot.churnTasks });
  }
  if (workflow.duplicateCommits.length > 0) violations.push({ code: 'workflow_duplicate_commit', commits: workflow.duplicateCommits });
  if (workflow.deadlockedTasks.length > 0) violations.push({ code: 'workflow_graph_deadlock', tasks: workflow.deadlockedTasks });
  if (workflow.stuckEvents.length > 0) violations.push({ code: 'workflow_event_stuck', events: workflow.stuckEvents });
  if (violations.length > 0 && !tripped) {
    tripped = { trippedAt: new Date().toISOString(), violations, snapshot };
  }
  return { ...getHealth(), currentSnapshot: { ...snapshot, workflow }, remainingByTargetGate };
}

function getHealth() {
  if (!tripped) return { status: 'green', circuitOpen: false, violations: [] };
  return { status: 'red', circuitOpen: true, ...tripped };
}

function resetForTests() { tripped = null; }

module.exports = { evaluate, getHealth, resetForTests };
