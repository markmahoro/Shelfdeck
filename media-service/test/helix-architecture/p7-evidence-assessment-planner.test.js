'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry, activeTriageRule } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createEvidenceAssessmentPlanner, createProbeBatchProjection } = require('../../src/helix/domains/procurement/planning/evidence-assessment-planner');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');
const refs = [
  'shared.material.media.probe@1',
  'procurement.triage.playability.inspect@1',
  'procurement.triage.structure.inspect@1',
];
const manifests = Object.fromEntries(refs.map((ref) => {
  const relative = ref.replace('@1', '').split('.');
  return [ref, require(path.join(contractsRoot, 'capabilities', ...relative, 'v1', 'manifest.json'))];
}));
const registry = Object.freeze({
  snapshot: Object.freeze(refs.map((capabilityRef) => Object.freeze({ capabilityRef, contractVersion:1 }))),
  resolve(capabilityRef, ownerDomain) {
    assert.equal(ownerDomain, 'procurement');
    return Object.freeze({ manifest:manifests[capabilityRef] });
  },
});
const policyRegistry = Object.freeze({
  digest:'a'.repeat(64),
  bindingFor() { return Object.freeze({ retryPolicyRef:'helix://test/retry/v1', timeoutPolicyRef:'helix://test/timeout/v1' }); },
});

function snapshot(memberCount) {
  const triageRule = activeTriageRule(createDefaultTriageRuleRegistry());
  const materials = Array.from({ length:memberCount }, (_, ordinal) => {
    const materialKey = canonicalDigest({ ordinal });
    const identity = Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
      materialKey, mountScopeId:'mount-1', inode:String(ordinal + 1), sizeBytes:1,
      fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:canonicalDigest({ bytes:ordinal }) });
    const readHandle = Object.freeze({ handleId:'handle-'+ordinal, identity, bindingRevision:1 });
    return Object.freeze({ identity, readHandle, member:Object.freeze({ material_key:materialKey, selection_role:'triage_input',
      expected_control_state:'controlled', expected_control_revision:1, expected_control_owner_domain:'procurement',
      expected_control_owner_scope_type:'procurement_run', expected_control_owner_scope_id:'run-1',
      expected_control_region_projection:'procurement', expected_control_evidence_digest:'b'.repeat(64),
      expected_control_projection_digest:'c'.repeat(64), size_bytes:1, binding_revision:1, eligibility_revision:1,
      eligibility_basis_digest:'d'.repeat(64), last_snapshot_digest:'e'.repeat(64), last_observation_id:'observation-'+ordinal,
      endpoint_id:'endpoint-1', location:'Z:/Film/movie-'+String(ordinal).padStart(3,'0')+'.mkv', reality_digest:'f'.repeat(64),
      provenance_digest:'1'.repeat(64), admission_control_action:'acquired', basis_member_digest:'2'.repeat(64),
      admitted_control_revision:1, admitted_control_projection_digest:'3'.repeat(64) }) });
  });
  return Object.freeze({ run:Object.freeze({ procurement_run_id:'run-1', field_id:'field-1', state:'active',
    run_basis_digest:'4'.repeat(64), access_revision:1, access_digest:'5'.repeat(64), profile_hint_revision:1,
    content_profile_hint:'movie', profile_hint_digest:'6'.repeat(64), triage_rule_ref:triageRule.ruleRef,
    triage_rule_revision:triageRule.revision, triage_rule_authority_digest:triageRule.authorityDigest }),
    access:Object.freeze({ root_location:'Z:/Film' }), materials:Object.freeze(materials) });
}

for (const memberCount of [100, 101, 256]) {
  test(`Evidence Assessment Plan keeps ${memberCount} member Probe Batch bindings below 16 KiB`, () => {
    const value = snapshot(memberCount);
    const planner = createEvidenceAssessmentPlanner({ registry, policyRegistry, triageReader:{ read:()=>value },
      triageRuleRegistry:createDefaultTriageRuleRegistry(), workResultReader:{ read:()=>[] } });
    const plan = planner.plan({ processId:'run-1', workId:'work-1', workAttemptId:'attempt-1', executionBasisDigest:'7'.repeat(64) });
    const playability = plan.nodes.filter((node) => node.capabilityRef === 'procurement.triage.playability.inspect@1');
    assert.deepEqual(playability.map((node) => node.dependsOn.length), memberCount === 100 ? [100] : memberCount === 101 ? [100,1] : [100,100,56]);
    for (const node of plan.nodes) assert.ok(Buffer.byteLength(canonicalJson(node.inputBindings), 'utf8') <= 16384,
      `${node.nodeId} exceeds the durable Plan binding limit`);
    for (const node of playability) {
      const binding = node.inputBindings.bindings.find((item) => item.portName === 'triageMaterialProbeBatch');
      assert.equal(binding.bindingKind, 'projected_work_results');
      assert.equal(Object.hasOwn(binding, 'eventResults'), false);
      assert.equal(binding.parameters.batchSize, node.dependsOn.length);
    }
  });
}

test('compact Probe Batch projection reconstructs the exact ordinal range from durable Work Results', () => {
  const value = snapshot(101);
  const projection = createProbeBatchProjection({ triageReader:{ read:()=>value } });
  const sourceResults = value.materials.map((material, ordinal) => Object.freeze({
    eventId:'probe-'+ordinal,
    resultSchemaRef:manifests['shared.material.media.probe@1'].resultSchemaRef,
    result:Object.freeze({ sourceHandleDigest:canonicalDigest(material.readHandle), evidenceId:'probe-evidence-'+ordinal }),
  })).reverse();
  const batch = projection.project({ sourceResults, parameters:{ runId:'run-1', startOrdinal:1, batchSize:100,
    batchOrdinal:0, runBasisDigest:value.run.run_basis_digest } });
  assert.equal(batch.members.length, 100);
  assert.deepEqual(batch.members.map((member) => member.selectionOrdinal), Array.from({length:100},(_unused,index)=>index+1));
  assert.equal(batch.members[0].mediaProbe.evidenceId, 'probe-evidence-1');
  assert.equal(batch.members.at(-1).mediaProbe.evidenceId, 'probe-evidence-100');
});
