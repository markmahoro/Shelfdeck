'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { EFFECT_CLASSES, assertEffectClass } = require('./runtime-contracts');

const VERSIONED_REF = /^helix:\/\/[A-Za-z0-9._/-]+\/v1$/;
const CAPABILITY_REF = /^[a-z][a-z0-9_.-]+@1$/;
const DECISIONS = new Set(['safe_retry', 'safe_retry_before_intent', 'already_failed', 'continue_forward', 'compensate', 'already_committed', 'terminal_failure']);

class ExecutionPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExecutionPolicyError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new ExecutionPolicyError(code, message, details); }

function exact(value, fields, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(
    code, 'Execution policy object must match its nominal shape exactly.', { actual: value && Object.keys(value), expected: fields }
  );
  return value;
}

function ref(value, field) {
  if (typeof value !== 'string' || !VERSIONED_REF.test(value)) fail('P4_POLICY_REF_INVALID', 'Execution policy ref must be versioned.', { field });
  return value;
}

function capabilityRef(value, field) {
  if (typeof value !== 'string' || !CAPABILITY_REF.test(value)) fail('P4_POLICY_CAPABILITY_REF_INVALID', 'Capability ref must be exact @1.', { field });
  return value;
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) fail('P4_POLICY_INTEGER_INVALID', 'Execution policy integer is invalid.', { field });
  return value;
}

function unique(values, field) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) fail('P4_POLICY_LIST_INVALID', 'Execution policy list must be unique.', { field });
  return Object.freeze([...values]);
}

function indexed(items, field, validate) {
  if (!Array.isArray(items)) fail('P4_POLICY_SET_REQUIRED', 'Execution policy set is required.', { field });
  const result = new Map();
  for (const item of items) {
    validate(item);
    if (result.has(item.ref)) fail('P4_POLICY_DUPLICATE_REF', 'Execution policy refs must be unique.', { ref: item.ref });
    result.set(item.ref, Object.freeze({ ...item }));
  }
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function createExecutionPolicyRegistry(options) {
  if (!options || !Array.isArray(options.expectedCapabilityRefs)) fail(
    'P4_POLICY_REGISTRY_INPUT_REQUIRED', 'Execution Policy Registry requires exact Capability refs and policy sets.'
  );
  const expected = [...unique(options.expectedCapabilityRefs, 'expectedCapabilityRefs')].sort();
  expected.forEach((value) => capabilityRef(value, 'expectedCapabilityRefs'));
  const retryPolicies = indexed(options.retryPolicies, 'retryPolicies', (policy) => {
    exact(policy, ['ref', 'effectClass', 'maxFailureAttempts', 'backoffMs', 'retryableFailureClasses'], 'P4_RETRY_POLICY_SHAPE_INVALID');
    ref(policy.ref, 'retry.ref'); assertEffectClass(policy.effectClass); integer(policy.maxFailureAttempts, 'maxFailureAttempts', 1);
    unique(policy.backoffMs, 'backoffMs').forEach((value) => integer(value, 'backoffMs'));
    unique(policy.retryableFailureClasses, 'retryableFailureClasses').forEach((value) => {
      if (typeof value !== 'string' || !value) fail('P4_RETRY_FAILURE_CLASS_INVALID', 'Retry failure class is invalid.');
    });
    if (policy.backoffMs.length !== policy.maxFailureAttempts - 1) fail(
      'P4_RETRY_BACKOFF_BUDGET_MISMATCH', 'Retry backoff count must equal the retries available after the first failure.'
    );
  });
  const timeoutPolicies = indexed(options.timeoutPolicies, 'timeoutPolicies', (policy) => {
    exact(policy, ['ref', 'timeoutMs', 'minObservationCadenceMs', 'maxObservationElapsedMs', 'maxObservationCount'], 'P4_TIMEOUT_POLICY_SHAPE_INVALID');
    ref(policy.ref, 'timeout.ref'); integer(policy.timeoutMs, 'timeoutMs', 1);
    const observation = [policy.minObservationCadenceMs, policy.maxObservationElapsedMs, policy.maxObservationCount];
    if (observation.some((value) => value !== null) && observation.some((value) => value === null)) fail(
      'P4_OBSERVATION_POLICY_INCOMPLETE', 'Deferred observation limits must be all null or all present.'
    );
    if (observation[0] !== null) {
      integer(policy.minObservationCadenceMs, 'minObservationCadenceMs', 1);
      integer(policy.maxObservationElapsedMs, 'maxObservationElapsedMs', policy.minObservationCadenceMs);
      integer(policy.maxObservationCount, 'maxObservationCount', 1);
    }
  });
  const compensationContracts = indexed(options.compensationContracts, 'compensationContracts', (contract) => {
    exact(contract, ['ref', 'targetEffectClasses', 'compensationCapabilityRefs', 'requiredDecision'], 'P4_COMPENSATION_CONTRACT_SHAPE_INVALID');
    ref(contract.ref, 'compensation.ref');
    unique(contract.targetEffectClasses, 'targetEffectClasses').forEach(assertEffectClass);
    unique(contract.compensationCapabilityRefs, 'compensationCapabilityRefs').forEach((value) => capabilityRef(value, 'compensationCapabilityRef'));
    if (contract.requiredDecision !== 'compensate') fail('P4_COMPENSATION_DECISION_INVALID', 'Compensation contract can only require compensate.');
  });
  if (!Array.isArray(options.capabilityBindings)) fail('P4_POLICY_BINDINGS_REQUIRED', 'Capability policy bindings are required.');
  const bindings = new Map();
  for (const binding of options.capabilityBindings) {
    exact(binding, ['capabilityRef', 'effectClass', 'retryPolicyRef', 'timeoutPolicyRef', 'compensationContractRefs'], 'P4_POLICY_BINDING_SHAPE_INVALID');
    capabilityRef(binding.capabilityRef, 'capabilityRef'); assertEffectClass(binding.effectClass);
    const retry = retryPolicies.get(ref(binding.retryPolicyRef, 'retryPolicyRef'));
    const timeout = timeoutPolicies.get(ref(binding.timeoutPolicyRef, 'timeoutPolicyRef'));
    const compensationRefs = unique(binding.compensationContractRefs, 'compensationContractRefs');
    if (!retry || retry.effectClass !== binding.effectClass || !timeout ||
        compensationRefs.some((contractRef) => !compensationContracts.has(contractRef))) fail(
      'P4_POLICY_BINDING_TARGET_MISMATCH', 'Capability binding references an absent or wrong Effect policy.'
    );
    if (bindings.has(binding.capabilityRef)) fail('P4_POLICY_DUPLICATE_CAPABILITY', 'Capability may have one policy binding.');
    bindings.set(binding.capabilityRef, Object.freeze({ ...binding, compensationContractRefs: compensationRefs }));
  }
  const actual = [...bindings.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('P4_POLICY_CAPABILITY_SET_MISMATCH', 'Policy bindings must cover the exact Capability set.', {
    missing: expected.filter((value) => !bindings.has(value)), unknown: actual.filter((value) => !expected.includes(value))
  });
  const snapshotValue = actual.map((capabilityRef) => bindings.get(capabilityRef));
  const byRef = (map) => [...map.values()].sort((left, right) => left.ref.localeCompare(right.ref));

  function bindingFor(capabilityRef, effectClass) {
    const binding = bindings.get(capabilityRef);
    if (!binding || binding.effectClass !== effectClass) fail(
      'P4_POLICY_CAPABILITY_BINDING_MISMATCH', 'Capability and Effect Class do not have one exact policy binding.', { capabilityRef, effectClass }
    );
    return binding;
  }

  return Object.freeze({
    digest: digest(JSON.stringify(canonical({ bindings: snapshotValue, retryPolicies: byRef(retryPolicies),
      timeoutPolicies: byRef(timeoutPolicies), compensationContracts: byRef(compensationContracts) }))),
    bindingFor,
    compensation(contractRef) {
      const contract = compensationContracts.get(contractRef);
      if (!contract) fail('P4_COMPENSATION_CONTRACT_UNKNOWN', 'Compensation contract is not registered.', { contractRef });
      return contract;
    },
    retryFor(capabilityRef, effectClass) { return retryPolicies.get(bindingFor(capabilityRef, effectClass).retryPolicyRef); },
    timeoutFor(capabilityRef, effectClass) { return timeoutPolicies.get(bindingFor(capabilityRef, effectClass).timeoutPolicyRef); }
  });
}

function createAttemptPolicyController(options) {
  if (!options || !options.registry || typeof options.registry.bindingFor !== 'function' || typeof options.now !== 'function') fail(
    'P4_ATTEMPT_POLICY_DEPENDENCIES_REQUIRED', 'Attempt Policy Controller requires exact policy registry and clock.'
  );
  function now() {
    const value = options.now(); integer(value, 'now'); return value;
  }
  function exactBinding(request) {
    const binding = options.registry.bindingFor(request.capabilityRef, request.effectClass);
    if (binding.retryPolicyRef !== request.retryPolicyRef || binding.timeoutPolicyRef !== request.timeoutPolicyRef) fail(
      'P4_ATTEMPT_FROZEN_POLICY_MISMATCH', 'Attempt policy refs differ from the immutable Plan.'
    );
    return binding;
  }
  return Object.freeze({
    bindingFor(capabilityRef, effectClass) { return options.registry.bindingFor(capabilityRef, effectClass); },
    prepare(request) {
      exact(request, ['capabilityRef', 'effectClass', 'retryPolicyRef', 'timeoutPolicyRef', 'startedAtMs'], 'P4_ATTEMPT_PREPARE_SHAPE_INVALID');
      exactBinding(request); integer(request.startedAtMs, 'startedAtMs');
      const policy = options.registry.timeoutFor(request.capabilityRef, request.effectClass);
      return Object.freeze({ deadlineAtMs: request.startedAtMs + policy.timeoutMs });
    },
    decideFailure(request) {
      exact(request, ['capabilityRef', 'effectClass', 'retryPolicyRef', 'timeoutPolicyRef', 'failureAttemptCount', 'outcome', 'recoveryDecision'],
        'P4_ATTEMPT_FAILURE_SHAPE_INVALID');
      exactBinding(request); integer(request.failureAttemptCount, 'failureAttemptCount', 1);
      const policy = options.registry.retryFor(request.capabilityRef, request.effectClass);
      const outcome = request.outcome;
      if (!outcome || outcome.kind !== 'failed') fail('P4_ATTEMPT_FAILURE_OUTCOME_INVALID', 'Retry policy accepts only failed Outcome.');
      if (request.recoveryDecision !== null && !DECISIONS.has(request.recoveryDecision)) fail(
        'P4_ATTEMPT_RECOVERY_DECISION_INVALID', 'Recovery decision is invalid.'
      );
      if (request.effectClass !== 'pure_observation' && request.recoveryDecision !== 'safe_retry') return Object.freeze({ decision: 'reconcile_required' });
      if (outcome.retryDirective !== 'contract_policy' || !policy.retryableFailureClasses.includes(outcome.failureClass) ||
          request.failureAttemptCount >= policy.maxFailureAttempts) return Object.freeze({ decision: 'terminal_failure' });
      return Object.freeze({ decision: 'retry', retryAtMs: now() + policy.backoffMs[request.failureAttemptCount - 1] });
    },
    decideDeferred(request) {
      exact(request, ['capabilityRef', 'effectClass', 'retryPolicyRef', 'timeoutPolicyRef', 'observationCount', 'firstObservedAtMs', 'retryAfterMs'],
        'P4_ATTEMPT_DEFERRED_SHAPE_INVALID');
      exactBinding(request); integer(request.observationCount, 'observationCount', 1);
      integer(request.firstObservedAtMs, 'firstObservedAtMs'); integer(request.retryAfterMs, 'retryAfterMs');
      const policy = options.registry.timeoutFor(request.capabilityRef, request.effectClass);
      if (policy.maxObservationCount === null) return Object.freeze({ decision: 'terminal_failure', code: 'DEFERRED_NOT_DECLARED' });
      const current = now();
      if (request.observationCount >= policy.maxObservationCount || current - request.firstObservedAtMs >= policy.maxObservationElapsedMs) {
        return Object.freeze({ decision: 'terminal_failure', code: 'OBSERVATION_BUDGET_EXHAUSTED' });
      }
      return Object.freeze({ decision: 'observe', retryAtMs: current + Math.max(request.retryAfterMs, policy.minObservationCadenceMs) });
    }
  });
}

function createWorkAttemptPolicyController(options) {
  if (!options || !Number.isSafeInteger(options.maxWorkAttempts) || options.maxWorkAttempts < 1) fail(
    'P4_WORK_ATTEMPT_POLICY_INVALID', 'Work Attempt policy requires a positive independent budget.'
  );
  return Object.freeze({
    decide(request) {
      exact(request, ['completedWorkAttemptCount', 'currentBasisDigest', 'requestedBasisDigest', 'ownerDirective'],
        'P4_WORK_ATTEMPT_DECISION_SHAPE_INVALID');
      integer(request.completedWorkAttemptCount, 'completedWorkAttemptCount');
      if (!/^[0-9a-f]{64}$/.test(request.currentBasisDigest || '') || !/^[0-9a-f]{64}$/.test(request.requestedBasisDigest || '') ||
          !['replan_same_basis', 'stop'].includes(request.ownerDirective)) fail(
        'P4_WORK_ATTEMPT_DECISION_INVALID', 'Work Attempt decision requires exact Basis and Owner directive.'
      );
      if (request.ownerDirective === 'stop' || request.completedWorkAttemptCount >= options.maxWorkAttempts) {
        return Object.freeze({ decision: 'terminal_failure' });
      }
      if (request.currentBasisDigest !== request.requestedBasisDigest) return Object.freeze({ decision: 'return_to_domain_owner' });
      return Object.freeze({ decision: 'new_work_attempt' });
    }
  });
}

module.exports = Object.freeze({
  ExecutionPolicyError, createAttemptPolicyController, createExecutionPolicyRegistry, createWorkAttemptPolicyController
});
