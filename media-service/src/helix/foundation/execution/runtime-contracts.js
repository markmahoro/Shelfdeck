'use strict';

const BUSINESS_OWNERS = Object.freeze(['procurement', 'libra', 'arca', 'perception', 'people']);
const PRIORITY_CLASSES = Object.freeze([
  'safety_liveness', 'handoff_acceptance', 'expedited_formation', 'normal_foreground', 'background_observation'
]);
const EFFECT_CLASSES = Object.freeze([
  'pure_observation', 'workspace_write', 'external_request', 'domain_fact_commit',
  'responsibility_control_commit', 'material_commit', 'destructive_commit'
]);
const PLAN_RESOLUTIONS = Object.freeze([
  'planned', 'no_effect_required', 'temporarily_unplannable', 'contract_unplannable'
]);

const STATE_MACHINES = Object.freeze({
  supporting_work: Object.freeze({
    admitted: ['ready', 'blocked', 'cancelled'],
    ready: ['running', 'blocked', 'cancelled'],
    running: ['blocked', 'succeeded', 'failed', 'cancelled'],
    blocked: ['ready', 'failed', 'cancelled'],
    succeeded: [], failed: [], cancelled: []
  }),
  work_attempt: Object.freeze({
    ready: ['running', 'blocked', 'cancelled'],
    running: ['blocked', 'succeeded', 'failed', 'cancelled'],
    blocked: ['ready', 'failed', 'cancelled'],
    succeeded: [], failed: [], cancelled: []
  }),
  workflow_event: Object.freeze({
    pending: ['ready', 'skipped', 'cancelled'],
    ready: ['waiting_for_resource', 'waiting_for_external', 'waiting_for_approval', 'executing', 'skipped', 'cancelled'],
    waiting_for_resource: ['ready', 'executing', 'failed', 'cancelled'],
    waiting_for_external: ['ready', 'executing', 'failed', 'cancelled'],
    waiting_for_approval: ['ready', 'executing', 'failed', 'cancelled'],
    executing: ['ready', 'waiting_for_external', 'succeeded', 'failed', 'cancelled'],
    succeeded: [], skipped: [], failed: [], cancelled: []
  }),
  event_attempt: Object.freeze({ executing: ['completed'], completed: [] }),
  effect_journal: Object.freeze({
    intended: ['effect_observed', 'committed', 'reconcile_required', 'failed'],
    effect_observed: ['committed', 'reconcile_required', 'failed'],
    committed: [],
    reconcile_required: ['effect_observed', 'committed', 'failed'],
    failed: []
  }),
  resource_defer: Object.freeze({ waiting: ['released', 'cancelled', 'expired'], released: [], cancelled: [], expired: [] }),
  circuit: Object.freeze({ closed: ['open'], open: ['recovering'], recovering: ['closed', 'open'] })
});

class RuntimeContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RuntimeContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new RuntimeContractError(code, message, details);
}

function assertState(kind, state) {
  const machine = STATE_MACHINES[kind];
  if (!machine) fail('P4_RUNTIME_UNKNOWN_STATE_MACHINE', 'Runtime state machine is not registered.', { kind });
  if (!Object.prototype.hasOwnProperty.call(machine, state)) fail('P4_RUNTIME_UNKNOWN_STATE', 'Runtime state is not registered.', { kind, state });
  return state;
}

function assertTransition(kind, from, to) {
  assertState(kind, from);
  assertState(kind, to);
  if (!STATE_MACHINES[kind][from].includes(to)) fail('P4_RUNTIME_ILLEGAL_TRANSITION', 'Runtime state transition is forbidden.', { kind, from, to });
  return Object.freeze({ kind, from, to });
}

function assertEffectClass(effectClass) {
  if (!EFFECT_CLASSES.includes(effectClass)) fail('P4_RUNTIME_UNKNOWN_EFFECT_CLASS', 'Effect Class is not one of the seven SSOT classes.', { effectClass });
  return effectClass;
}

function assertPlanResolution(resolution, nodeCount) {
  if (!PLAN_RESOLUTIONS.includes(resolution) || !Number.isSafeInteger(nodeCount) || nodeCount < 0) {
    fail('P4_RUNTIME_INVALID_PLAN_RESOLUTION', 'Plan Resolution and node count are invalid.');
  }
  if ((resolution === 'planned') !== (nodeCount > 0)) fail(
    'P4_RUNTIME_PLAN_RESOLUTION_NODE_MISMATCH', 'Only planned resolution contains a non-empty executable DAG.', { resolution, nodeCount }
  );
  return resolution;
}

function validateSupportingWorkDefinition(value) {
  const required = [
    'schemaRef', 'schemaVersion', 'workId', 'ownerDomain', 'processType', 'processId', 'workKind',
    'workObjectiveTypeRef', 'workObjectiveVersion', 'executionBasisId', 'executionBasisDigest', 'dependencyRefs',
    'priorityClass', 'priorityRevision', 'capabilityCatalogScope', 'workspaceMaterialScope', 'idempotencyKey',
    'concurrencyScope', 'outputContractRef'
  ];
  const optional = ['approvalOrAuthorizationRef'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.schemaRef !== 'helix://foundation/types/SupportingWorkDefinition/v1' || value.schemaVersion !== 1) {
    fail('P4_RUNTIME_INVALID_WORK_DEFINITION', 'Supporting Work Definition nominal identity is invalid.');
  }
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !required.includes(key) && !optional.includes(key));
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (unknown.length || missing.length) fail('P4_RUNTIME_WORK_DEFINITION_SHAPE_MISMATCH', 'Supporting Work Definition is not exact.', { unknown, missing });
  if (!BUSINESS_OWNERS.includes(value.ownerDomain) || !PRIORITY_CLASSES.includes(value.priorityClass) ||
      !Number.isSafeInteger(value.workObjectiveVersion) || value.workObjectiveVersion < 1 ||
      !Number.isSafeInteger(value.priorityRevision) || value.priorityRevision < 1 ||
      !Array.isArray(value.dependencyRefs) || value.dependencyRefs.length > 256 ||
      !Array.isArray(value.workspaceMaterialScope) || value.workspaceMaterialScope.length > 256 ||
      value.capabilityCatalogScope !== value.ownerDomain || !/^[0-9a-f]{64}$/.test(value.executionBasisDigest)) {
    fail('P4_RUNTIME_INVALID_WORK_DEFINITION', 'Supporting Work Definition fields violate the nominal contract.');
  }
  for (const field of required.filter((field) => !['schemaVersion', 'workObjectiveVersion', 'priorityRevision', 'dependencyRefs', 'workspaceMaterialScope'].includes(field))) {
    if (typeof value[field] !== 'string' || value[field].length === 0) fail('P4_RUNTIME_INVALID_WORK_DEFINITION', 'Supporting Work text field is required.', { field });
  }
  for (const [field, entries, expectedKeys] of [
    ['dependencyRefs', value.dependencyRefs, ['ownerDomain', 'objectType', 'objectId', 'revision', 'digest']],
    ['workspaceMaterialScope', value.workspaceMaterialScope, ['handleSchemaRef', 'handleId', 'accessScope', 'fenceDigest']]
  ]) {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...expectedKeys].sort()) ||
          expectedKeys.filter((key) => key !== 'revision').some((key) => typeof entry[key] !== 'string' || entry[key].length === 0) ||
          (field === 'dependencyRefs' && (!Number.isSafeInteger(entry.revision) || entry.revision < 1)) ||
          !/^[0-9a-f]{64}$/.test(entry[field === 'dependencyRefs' ? 'digest' : 'fenceDigest'])) {
        fail('P4_RUNTIME_INVALID_WORK_REFERENCE', 'Supporting Work references must be bounded nominal opaque references.', { field });
      }
    }
  }
  return Object.freeze({ ...value, dependencyRefs: Object.freeze([...value.dependencyRefs]), workspaceMaterialScope: Object.freeze([...value.workspaceMaterialScope]) });
}

module.exports = Object.freeze({
  BUSINESS_OWNERS,
  EFFECT_CLASSES,
  PLAN_RESOLUTIONS,
  PRIORITY_CLASSES,
  RuntimeContractError,
  STATE_MACHINES,
  assertEffectClass,
  assertPlanResolution,
  assertState,
  assertTransition,
  validateSupportingWorkDefinition
});
