'use strict';

const crypto = require('crypto');
const capabilityContract = require('./capabilityContract');

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
  const nodesById = new Map();
  for (const node of plan.nodes) {
    if (!text(node.eventId) || ids.has(node.eventId)) {
      const error = new Error(`Workflow event id is missing or duplicated: ${node.eventId || ''}`);
      error.code = 'KAIROX_WORKFLOW_EVENT_ID_INVALID';
      throw error;
    }
    ids.add(node.eventId);
    nodesById.set(node.eventId, node);
    if (!text(node.capability) || registry && !registry.has(node.capability)) {
      const error = new Error(`Workflow capability is not registered: ${node.capability || ''}`);
      error.code = 'KAIROX_WORKFLOW_CAPABILITY_UNKNOWN';
      throw error;
    }
    const definition = registry && registry.get(node.capability);
    if (definition && Number(node.capabilityContractVersion) !== Number(definition.contractVersion)) {
      throw Object.assign(new Error(`Workflow capability contract version drift: ${node.capability}`), { code: 'KAIROX_CAPABILITY_CONTRACT_VERSION_DRIFT' });
    }
    if (definition && (JSON.stringify(node.inputContractSnapshot || {}) !== JSON.stringify(definition.inputContract || {}) || JSON.stringify(node.outputContractSnapshot || {}) !== JSON.stringify(definition.outputContract || {}))) {
      throw Object.assign(new Error(`Workflow capability signature drift: ${node.capability}`), { code: 'KAIROX_CAPABILITY_CONTRACT_SIGNATURE_DRIFT' });
    }
    if (definition && definition.allowedTargetGates.length > 0 && !definition.allowedTargetGates.includes(plan.targetGate)) {
      const error = new Error(`Workflow capability ${node.capability} is not allowed for ${plan.targetGate}`);
      error.code = 'KAIROX_CAPABILITY_GATE_VIOLATION';
      throw error;
    }
    if (definition) {
      capabilityContract.assertParameters(definition.parameterContract, node.parameters || {}, node.capability);
      if (node.runWhen) {
        const port = node.runWhen.port;
        if (!definition.inputContract[port] || !(node.inputBindings || {})[port]) throw Object.assign(new Error(`Capability ${node.capability} runWhen references an unbound port`), { code: 'KAIROX_CAPABILITY_RUN_CONDITION_INVALID' });
      }
      const resourceType = node.resourceRequest && node.resourceRequest.resourceType;
      if (resourceType && !definition.resourceContract.types.includes(resourceType)) {
        throw Object.assign(new Error(`Capability ${node.capability} cannot request resource ${resourceType}`), { code: 'KAIROX_CAPABILITY_RESOURCE_CONTRACT_VIOLATION' });
      }
      const approvalAction = node.approvalRequirement && node.approvalRequirement.gateId;
      if (approvalAction && !definition.approvalContract.actions.includes(approvalAction)) {
        throw Object.assign(new Error(`Capability ${node.capability} cannot request approval ${approvalAction}`), { code: 'KAIROX_CAPABILITY_APPROVAL_CONTRACT_VIOLATION' });
      }
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
    if (registry) validateCapabilityBindings(node, nodesById, registry);
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

function validateCapabilityBindings(node, nodesById, registry) {
  const definition = registry.get(node.capability);
  const bindings = node.inputBindings || {};
  for (const [portName, port] of Object.entries(definition.inputContract || {})) {
    const binding = bindings[portName];
    if (!binding) {
      if (!port.optional) throw Object.assign(new Error(`Capability ${node.capability} is missing input binding ${portName}`), { code: 'KAIROX_CAPABILITY_BINDING_MISSING', capability: node.capability, port: portName });
      continue;
    }
    const eventIds = binding.source === 'events' ? binding.eventIds : binding.source === 'event' ? [binding.eventId] : [];
    if (!eventIds.length || (port.many ? binding.source !== 'events' : binding.source !== 'event')) {
      throw Object.assign(new Error(`Capability ${node.capability} has invalid binding for ${portName}`), { code: 'KAIROX_CAPABILITY_BINDING_INVALID', capability: node.capability, port: portName });
    }
    if (eventIds.some((eventId) => !(node.dependsOn || []).includes(eventId))) {
      throw Object.assign(new Error(`Capability ${node.capability} input ${portName} is not a declared dependency`), { code: 'KAIROX_CAPABILITY_BINDING_NOT_DEPENDENCY', capability: node.capability, port: portName });
    }
    for (const eventId of eventIds) {
      const producerNode = nodesById.get(eventId);
      const producer = producerNode && registry.get(producerNode.capability);
      if (!producer || !capabilityContract.compatible(port, producer.outputContract)) {
        throw Object.assign(new Error(`Capability contract mismatch: ${eventId} -> ${node.eventId}.${portName}`), { code: 'KAIROX_CAPABILITY_CONTRACT_MISMATCH', producer: eventId, consumer: node.eventId, port: portName });
      }
    }
  }
  for (const portName of Object.keys(bindings)) {
    if (!definition.inputContract[portName]) throw Object.assign(new Error(`Capability ${node.capability} received unknown input port ${portName}`), { code: 'KAIROX_CAPABILITY_BINDING_UNKNOWN', capability: node.capability, port: portName });
  }
}

function buildPlan(input = {}, nodes = [], registry = null) {
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
    nodes: nodes.map((node, index) => {
      const definition = registry && registry.get(node.capability);
      return ({
      eventId: text(node.eventId) || `${text(input.taskId || input.id)}:${index + 1}`,
      capability: text(node.capability),
      inputBindings: node.inputBindings || {},
      parameters: node.parameters || {},
      dependsOn: Array.isArray(node.dependsOn) ? [...node.dependsOn] : [],
      when: node.when == null ? true : node.when,
      runWhen: node.runWhen || null,
      resourceRequest: node.resourceRequest || null,
      approvalRequirement: node.approvalRequirement || null,
      retryPolicy: node.retryPolicy || { maxAttempts: 1 },
      timeoutPolicy: node.timeoutPolicy || null,
      fencingPolicy: node.fencingPolicy || null,
      outputContract: node.outputContract || {},
      capabilityContractVersion: definition && definition.contractVersion || 0,
      inputContractSnapshot: definition && definition.inputContract || {},
      outputContractSnapshot: definition && definition.outputContract || {},
      effectKindSnapshot: definition && definition.effectKind || '',
    }); }),
  };
}

module.exports = { SCHEMA_VERSION, CONDITION_VERSION, buildPlan, validateGraph, validateCapabilityBindings, evaluateCondition, readPath };
