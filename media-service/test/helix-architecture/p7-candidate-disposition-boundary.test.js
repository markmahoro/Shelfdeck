'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCandidateAssemblyPlanner } = require('../../src/helix/domains/procurement/planning/candidate-assembly-planner');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');

function relatedReference(ordinal) {
  return Object.freeze({ referenceId: `related-${String(ordinal).padStart(4, '0')}` });
}

test('Candidate Planner closes an unrepresentable Related disposition scope before Capability execution', () => {
  const run = Object.freeze({
    procurement_run_id: 'run-related-overflow',
    run_basis_digest: canonicalDigest({ run: 'run-related-overflow' }),
  });
  const unit = Object.freeze({ unitId: 'unit-related-overflow' });
  let contextReads = 0;
  const planner = createCandidateAssemblyPlanner({
    registry: Object.freeze({ snapshot: Object.freeze([]) }),
    policyRegistry: Object.freeze({ digest: '0'.repeat(64) }),
    triageReader: Object.freeze({ readRunHeader: () => run }),
    evidenceIndex: Object.freeze({
      findCandidate: () => Object.freeze({
        structure: Object.freeze({ payloadDigest: canonicalDigest({ structure: 1 }) }),
        unit,
        ordinal: 0,
      }),
    }),
    candidateContextReader: Object.freeze({
      read: () => {
        contextReads += 1;
        return Object.freeze({
          relatedReferences: Object.freeze(Array.from({ length: 1025 }, (_, ordinal) => relatedReference(ordinal))),
        });
      },
    }),
    triageRuleRegistry: createDefaultTriageRuleRegistry(),
  });

  const plan = planner.plan(Object.freeze({
    workAttemptId: 'candidate-overflow-attempt-1',
    workId: 'candidate-overflow-work',
    ownerDomain: 'procurement',
    processType: 'procurement_run',
    processId: run.procurement_run_id,
    workKind: 'candidate_assembly',
    executionBasisDigest: canonicalDigest({ work: 'candidate-overflow-work' }),
    idempotencyKey: 'candidate-overflow-key',
  }));

  assert.equal(contextReads, 1);
  assert.equal(plan.resolution, 'contract_unplannable');
  assert.equal(plan.diagnosticClassification, 'candidate_disposition_scope_unrepresentable');
  assert.deepEqual(plan.nodes, []);
});
