'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAttemptPolicyController, createExecutionPolicyRegistry,
  createWorkAttemptPolicyController } = require('../../src/helix/foundation/execution/execution-policy');
const { createTimeoutController } = require('../../src/helix/foundation/execution/timeout-controller');

const OBSERVE = 'libra.fixture.observe@1';
const REQUEST = 'libra.fixture.request@1';
const CLEANUP = 'libra.fixture.cleanup@1';

function registry() {
  return createExecutionPolicyRegistry({
    expectedCapabilityRefs: [OBSERVE, REQUEST, CLEANUP],
    retryPolicies: [
      { ref: 'helix://foundation/retry-policies/pure-observation/v1', effectClass: 'pure_observation',
        maxFailureAttempts: 3, backoffMs: [1000, 5000], retryableFailureClasses: ['integration', 'timeout'] },
      { ref: 'helix://foundation/retry-policies/external-request/v1', effectClass: 'external_request',
        maxFailureAttempts: 2, backoffMs: [2000], retryableFailureClasses: ['integration', 'timeout'] },
      { ref: 'helix://foundation/retry-policies/workspace-write/v1', effectClass: 'workspace_write',
        maxFailureAttempts: 2, backoffMs: [1000], retryableFailureClasses: ['system'] }
    ],
    timeoutPolicies: [
      { ref: 'helix://foundation/timeout-policies/short-observation/v1', timeoutMs: 10000,
        minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null },
      { ref: 'helix://foundation/timeout-policies/external-job/v1', timeoutMs: 5000,
        minObservationCadenceMs: 3000, maxObservationElapsedMs: 30000, maxObservationCount: 5 },
      { ref: 'helix://foundation/timeout-policies/workspace-cleanup/v1', timeoutMs: 15000,
        minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null }
    ],
    compensationContracts: [{ ref: 'helix://foundation/compensation/workspace-cleanup/v1',
      targetEffectClasses: ['workspace_write'], compensationCapabilityRefs: [CLEANUP], requiredDecision: 'compensate' }],
    capabilityBindings: [
      { capabilityRef: OBSERVE, effectClass: 'pure_observation',
        retryPolicyRef: 'helix://foundation/retry-policies/pure-observation/v1',
        timeoutPolicyRef: 'helix://foundation/timeout-policies/short-observation/v1', compensationContractRefs: [] },
      { capabilityRef: REQUEST, effectClass: 'external_request',
        retryPolicyRef: 'helix://foundation/retry-policies/external-request/v1',
        timeoutPolicyRef: 'helix://foundation/timeout-policies/external-job/v1', compensationContractRefs: [] },
      { capabilityRef: CLEANUP, effectClass: 'workspace_write',
        retryPolicyRef: 'helix://foundation/retry-policies/workspace-write/v1',
        timeoutPolicyRef: 'helix://foundation/timeout-policies/workspace-cleanup/v1',
        compensationContractRefs: ['helix://foundation/compensation/workspace-cleanup/v1'] }
    ]
  });
}

function controller(effect = 'pure_observation') {
  let current = 100000;
  const value = createAttemptPolicyController({ registry: registry(), now: () => current });
  const capabilityRef = effect === 'pure_observation' ? OBSERVE : REQUEST;
  const retryPolicyRef = effect === 'pure_observation'
    ? 'helix://foundation/retry-policies/pure-observation/v1' : 'helix://foundation/retry-policies/external-request/v1';
  const timeoutPolicyRef = effect === 'pure_observation'
    ? 'helix://foundation/timeout-policies/short-observation/v1' : 'helix://foundation/timeout-policies/external-job/v1';
  return { value, setNow(next) { current = next; }, base: { capabilityRef, effectClass: effect, retryPolicyRef, timeoutPolicyRef } };
}

test('registry freezes exact Capability coverage and versioned policy bindings', () => {
  const value = registry();
  assert.match(value.digest, /^[0-9a-f]{64}$/);
  assert.equal(value.retryFor(OBSERVE, 'pure_observation').maxFailureAttempts, 3);
  assert.equal(value.compensation('helix://foundation/compensation/workspace-cleanup/v1').requiredDecision, 'compensate');
  assert.throws(() => value.bindingFor(OBSERVE, 'external_request'), { code: 'P4_POLICY_CAPABILITY_BINDING_MISMATCH' });
});

test('registry rejects missing Capability, wrong Effect policy, incomplete observation, and arbitrary compensation', () => {
  const base = {
    expectedCapabilityRefs: [OBSERVE], retryPolicies: [{ ref: 'helix://foundation/retry/a/v1', effectClass: 'pure_observation',
      maxFailureAttempts: 1, backoffMs: [], retryableFailureClasses: [] }],
    timeoutPolicies: [{ ref: 'helix://foundation/timeout/a/v1', timeoutMs: 1,
      minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null }], compensationContracts: []
  };
  assert.throws(() => createExecutionPolicyRegistry({ ...base, capabilityBindings: [] }), { code: 'P4_POLICY_CAPABILITY_SET_MISMATCH' });
  assert.throws(() => createExecutionPolicyRegistry({ ...base, timeoutPolicies: [{ ...base.timeoutPolicies[0], minObservationCadenceMs: 1 }],
    capabilityBindings: [] }), { code: 'P4_OBSERVATION_POLICY_INCOMPLETE' });
  assert.throws(() => createExecutionPolicyRegistry({ ...base, compensationContracts: [{ ref: 'helix://foundation/comp/a/v1',
    targetEffectClasses: ['workspace_write'], compensationCapabilityRefs: [OBSERVE], requiredDecision: 'safe_retry' }],
    capabilityBindings: [] }), { code: 'P4_COMPENSATION_DECISION_INVALID' });
});

test('failure budget retries only frozen technical action and non-pure retry requires safe recovery', () => {
  const pure = controller();
  const failed = { kind: 'failed', failureClass: 'integration', retryDirective: 'contract_policy' };
  assert.deepEqual(pure.value.decideFailure({ ...pure.base, failureAttemptCount: 1, outcome: failed, recoveryDecision: null }),
    { decision: 'retry', retryAtMs: 101000 });
  assert.deepEqual(pure.value.decideFailure({ ...pure.base, failureAttemptCount: 3, outcome: failed, recoveryDecision: null }),
    { decision: 'terminal_failure' });
  assert.deepEqual(pure.value.decideFailure({ ...pure.base, failureAttemptCount: 1,
    outcome: { ...failed, retryDirective: 'never' }, recoveryDecision: null }), { decision: 'terminal_failure' });
  const external = controller('external_request');
  assert.deepEqual(external.value.decideFailure({ ...external.base, failureAttemptCount: 1, outcome: failed, recoveryDecision: null }),
    { decision: 'reconcile_required' });
  assert.deepEqual(external.value.decideFailure({ ...external.base, failureAttemptCount: 1, outcome: failed, recoveryDecision: 'safe_retry' }),
    { decision: 'retry', retryAtMs: 102000 });
});

test('deferred observation budget is separate from failure attempts and enforces cadence, elapsed, and count', () => {
  const external = controller('external_request');
  assert.deepEqual(external.value.decideDeferred({ ...external.base, observationCount: 1, firstObservedAtMs: 99000, retryAfterMs: 100 }),
    { decision: 'observe', retryAtMs: 103000 });
  assert.deepEqual(external.value.decideDeferred({ ...external.base, observationCount: 5, firstObservedAtMs: 99000, retryAfterMs: 100 }),
    { decision: 'terminal_failure', code: 'OBSERVATION_BUDGET_EXHAUSTED' });
  external.setNow(130000);
  assert.deepEqual(external.value.decideDeferred({ ...external.base, observationCount: 2, firstObservedAtMs: 100000, retryAfterMs: 100 }),
    { decision: 'terminal_failure', code: 'OBSERVATION_BUDGET_EXHAUSTED' });
  const pure = controller();
  assert.deepEqual(pure.value.decideDeferred({ ...pure.base, observationCount: 1, firstObservedAtMs: 99000, retryAfterMs: 1 }),
    { decision: 'terminal_failure', code: 'DEFERRED_NOT_DECLARED' });
});

test('prepare derives deadline from exact immutable Plan policy refs', () => {
  const pure = controller();
  assert.deepEqual(pure.value.prepare({ ...pure.base, startedAtMs: 5000 }), { deadlineAtMs: 15000 });
  assert.throws(() => pure.value.prepare({ ...pure.base, timeoutPolicyRef: 'helix://foundation/timeout-policies/other/v1', startedAtMs: 5000 }),
    { code: 'P4_ATTEMPT_FROZEN_POLICY_MISMATCH' });
});

test('Work Attempt replan budget is independent and Basis change always returns to Domain Owner', () => {
  const value = createWorkAttemptPolicyController({ maxWorkAttempts: 2 });
  const basis = 'a'.repeat(64);
  assert.deepEqual(value.decide({ completedWorkAttemptCount: 1, currentBasisDigest: basis,
    requestedBasisDigest: basis, ownerDirective: 'replan_same_basis' }), { decision: 'new_work_attempt' });
  assert.deepEqual(value.decide({ completedWorkAttemptCount: 1, currentBasisDigest: basis,
    requestedBasisDigest: 'b'.repeat(64), ownerDirective: 'replan_same_basis' }), { decision: 'return_to_domain_owner' });
  assert.deepEqual(value.decide({ completedWorkAttemptCount: 2, currentBasisDigest: basis,
    requestedBasisDigest: basis, ownerDirective: 'replan_same_basis' }), { decision: 'terminal_failure' });
  assert.deepEqual(value.decide({ completedWorkAttemptCount: 0, currentBasisDigest: basis,
    requestedBasisDigest: basis, ownerDirective: 'stop' }), { decision: 'terminal_failure' });
});

test('timeout controller requires isolator termination before surfacing timeout', async () => {
  const calls = [];
  const controllerValue = createTimeoutController({ now: () => 100,
    isolation: { async run() { throw Object.assign(new Error('deadline'), { code: 'P4_ISOLATION_DEADLINE_EXCEEDED' }); },
      async terminateAndIsolate(handle) { calls.push(handle); } } });
  await assert.rejects(controllerValue.execute({ executionHandleId: 'attempt', deadlineAtMs: 200, operation: async () => 'never' }),
    { code: 'P4_EXECUTION_TIMEOUT' });
  assert.deepEqual(calls, ['attempt']);
});

test('timeout controller passes success and does not convert executor crash into timeout', async () => {
  const controllerValue = createTimeoutController({ now: () => 100,
    isolation: { async run(request) { return request.operation(); }, async terminateAndIsolate() { throw new Error('unexpected'); } } });
  assert.equal(await controllerValue.execute({ executionHandleId: 'attempt', deadlineAtMs: 200, operation: async () => 'ok' }), 'ok');
  await assert.rejects(controllerValue.execute({ executionHandleId: 'attempt', deadlineAtMs: 200,
    operation: async () => { throw new Error('executor crash'); } }), /executor crash/);
});
