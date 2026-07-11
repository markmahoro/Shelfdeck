'use strict';

const crypto = require('crypto');

const SCHEMA_VERSION = 'kairox-workflow-v1';
const CONDITION_VERSION = 'kairox-condition-v1';
const OPERATORS = new Set(['and', 'or', 'not', 'exists', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in']);
const ROOTS = new Set(['task', 'facts', 'policy', 'events']);

function text(value) { return String(value == null ? '' : value).trim(); }

function assertPath(path) {
  const parts = text(path).split('.').filter(Boolean);
  if (parts.length < 2 || !ROOTS.has(parts[0]) || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    const error = new Error(`Condition path is not allowed: ${path}`);
    error.code = 'KAIROX_CONDITION_PATH_INVALID';
    throw error;
  }
  return parts;
}

function readPath(context, path) {
  return assertPath(path).reduce((value, part) => value == null ? undefined : value[part], context);
}

function evaluateCondition(condition, context = {}) {
  if (condition == null || condition === true) return true;
  if (condition === false) return false;
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    const error = new Error('Workflow condition must be a declarative object');
    error.code = 'KAIROX_CONDITION_INVALID';
    throw error;
  }
  const op = text(condition.op).toLowerCase();
  if (!OPERATORS.has(op)) {
    const error = new Error(`Condition operator is not allowed: ${op}`);
    error.code = 'KAIROX_CONDITION_OPERATOR_INVALID';
    throw error;
  }
  if (op === 'and') return (condition.conditions || []).every((entry) => evaluateCondition(entry, context));
  if (op === 'or') return (condition.conditions || []).some((entry) => evaluateCondition(entry, context));
  if (op === 'not') return !evaluateCondition(condition.condition, context);
  const actual = readPath(context, condition.path);
  if (op === 'exists') return actual !== undefined && actual !== null;
  const expected = condition.value;
  if (op === 'eq') return actual === expected;
  if (op === 'neq') return actual !== expected;
  if (op === 'gt') return actual > expected;
  if (op === 'gte') return actual >= expected;
  if (op === 'lt') return actual < expected;
  if (op === 'lte') return actual <= expected;
  if (op === 'in') return Array.isArray(expected) && expected.includes(actual);
  return false;
}

function validateGraph(plan, registry) {
  if (!plan || plan.schemaVersion !== SCHEMA_VERSION || !Array.isArray(plan.nodes) || plan.nodes.length === 0) {
    const error = new Error('Workflow plan is missing a supported non-empty graph');
    error.code = 'KAIROX_WORKFLOW_GRAPH_INVALID';
    throw error;
  }
  const ids = new Set();
  for (const node of plan.nodes) {
    if (!text(node.eventId) || ids.has(node.eventId)) {
      const error = new Error(`Workflow event id is missing or duplicated: ${node.eventId || ''}`);
      error.code = 'KAIROX_WORKFLOW_EVENT_ID_INVALID';
      throw error;
    }
    ids.add(node.eventId);
    if (!text(node.capability) || registry && !registry.has(node.capability)) {
      const error = new Error(`Workflow capability is not registered: ${node.capability || ''}`);
      error.code = 'KAIROX_WORKFLOW_CAPABILITY_UNKNOWN';
      throw error;
    }
    const definition = registry && registry.get(node.capability);
    if (definition && definition.allowedTargetGates.length > 0 && !definition.allowedTargetGates.includes(plan.targetGate)) {
      const error = new Error(`Workflow capability ${node.capability} is not allowed for ${plan.targetGate}`);
      error.code = 'KAIROX_CAPABILITY_GATE_VIOLATION';
      throw error;
    }
    if (node.when != null) evaluateCondition(node.when, { task: {}, facts: {}, policy: {}, events: {} });
  }
  for (const node of plan.nodes) {
    for (const dependency of node.dependsOn || []) {
      if (!ids.has(dependency) || dependency === node.eventId) {
        const error = new Error(`Workflow dependency is invalid: ${node.eventId} -> ${dependency}`);
        error.code = 'KAIROX_WORKFLOW_DEPENDENCY_INVALID';
        throw error;
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(plan.nodes.map((node) => [node.eventId, node]));
  function visit(id) {
    if (visiting.has(id)) {
      const error = new Error(`Workflow graph contains a cycle at ${id}`);
      error.code = 'KAIROX_WORKFLOW_CYCLE';
      throw error;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  return plan;
}

function buildPlan(input = {}, nodes = []) {
  return {
    planId: input.planId || crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    conditionVersion: CONDITION_VERSION,
    plannerVersion: input.plannerVersion || 'kairox-planner-v1',
    taskId: text(input.taskId || input.id),
    itemId: text(input.itemId),
    targetGate: text(input.targetGate || input.taskTarget && input.taskTarget.targetGate),
    objectiveRevision: text(input.objectiveRevision || input.objectiveRevisionSnapshot),
    sourceRevision: text(input.sourceRevision || input.helixAdmission && input.helixAdmission.sourceRevision),
    policyRevision: text(input.policyRevision || input.helixAdmission && input.helixAdmission.policyRevision),
    capabilityPolicyRevision: text(input.capabilityPolicyRevision),
    classification: text(input.classification || input.targetGate),
    plannedAt: input.plannedAt || new Date().toISOString(),
    explanation: input.explanation || {},
    nodes: nodes.map((node, index) => ({
      eventId: text(node.eventId) || `${text(input.taskId || input.id)}:${index + 1}`,
      capability: text(node.capability),
      inputBindings: node.inputBindings || {},
      dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : [],
      when: node.when == null ? true : node.when,
      resourceRequest: node.resourceRequest || null,
      approvalRequirement: node.approvalRequirement || null,
      retryPolicy: node.retryPolicy || { maxAttempts: 1 },
      timeoutPolicy: node.timeoutPolicy || null,
      fencingPolicy: node.fencingPolicy || null,
      outputContract: node.outputContract || {},
    })),
  };
}

module.exports = { SCHEMA_VERSION, CONDITION_VERSION, buildPlan, validateGraph, evaluateCondition, readPath };
