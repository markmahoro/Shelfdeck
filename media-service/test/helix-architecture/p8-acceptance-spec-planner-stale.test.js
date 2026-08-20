'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcceptanceSpecPlanner } = require('../../src/helix/domains/libra/planning/acceptance-spec-planner');

const digest = (character) => character.repeat(64);

function request(basisDigest = digest('a')) {
  return Object.freeze({
    workId: 'work-1',
    workAttemptId: 'attempt-1',
    ownerDomain: 'libra',
    processType: 'libra_acceptance_spec',
    processId: 'subject-1',
    workKind: 'acceptance_spec_basis',
    executionBasisDigest: basisDigest,
  });
}

function planner(context) {
  return createAcceptanceSpecPlanner({
    contextReader: { read: () => context },
    registry: { snapshot: Object.freeze([]) },
    policyRegistry: { digest: digest('b') },
  });
}

test('stale Acceptance Spec planning basis becomes a durable terminal Plan instead of throwing', () => {
  const plan = planner(Object.freeze({
    kind: 'ready',
    inputSet: Object.freeze({ inputSetDigest: digest('c') }),
  })).plan(request());

  assert.equal(plan.resolution, 'contract_unplannable');
  assert.equal(plan.diagnosticClassification, 'P8_ACCEPTANCE_SPEC_PLANNING_BASIS_STALE');
  assert.equal(plan.executionBasisDigest, digest('a'));
  assert.deepEqual(plan.nodes, []);
});

test('Acceptance Spec context that is no longer ready closes the obsolete Work', () => {
  const plan = planner(Object.freeze({ kind: 'current' })).plan(request());
  assert.equal(plan.resolution, 'contract_unplannable');
  assert.equal(plan.diagnosticClassification, 'P8_ACCEPTANCE_SPEC_PLANNING_BASIS_STALE');
});
