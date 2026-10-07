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


test('Acceptance Spec Planner reads the immutable Run scope dependency and rejects foreign or rewritten Work scope',()=>{
  const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
  const req=request(),ref={ownerDomain:'libra',objectType:'libra_run',objectId:'run-1',revision:1,
    digest:canonicalDigest({schema:'libra.spec-delivery-scope@1',subjectId:req.processId,libraRunId:'run-1'})};
  const definition={ownerDomain:'libra',processType:'libra_acceptance_spec',processId:req.processId,
    executionBasisDigest:req.executionBasisDigest,dependencyRefs:[ref]};
  let received;
  const options={contextReader:{read:(...args)=>{received=args;return {kind:'unresolved'};},readScopeRef:(_subject,runId)=>({digest:runId==='run-1'?canonicalDigest({schema:'libra.spec-delivery-scope@1',subjectId:req.processId,libraRunId:'run-1'}):digest('e')})},
    registry:{snapshot:Object.freeze([])},policyRegistry:{digest:digest('b')},workResultReader:{readDefinition:()=>({definition})}};
  assert.equal(createAcceptanceSpecPlanner(options).plan(req).resolution,'contract_unplannable');
  assert.deepEqual(received,['subject-1','run-1']);
  ref.objectId='foreign-run';
  assert.throws(()=>createAcceptanceSpecPlanner(options).plan(req),/invalid frozen Run scope dependency/);
  ref.objectId='run-1';definition.processId='foreign-subject';
  assert.throws(()=>createAcceptanceSpecPlanner(options).plan(req),/invalid frozen Run scope dependency/);
});
