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
    const fieldRelativeLocation = 'movie-'+String(ordinal).padStart(3,'0')+'.mkv';
    const scopeKey = 'standalone-file:' + fieldRelativeLocation;
    const scopeMemberSetDigest = canonicalDigest({ schema:'procurement.selection-scope-members@1', items:[{
      materialKey, fieldRelativeLocation, scopeMemberOrdinal:0,
    }] });
    const scopeDigest = canonicalDigest({ schema:'procurement.selection-scope@1', scopeKind:'standalone_file',
      scopeKey, scopeRootRelativeLocation:fieldRelativeLocation, memberCount:1, memberSetDigest:scopeMemberSetDigest });
    const identity = Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
      materialKey, mountScopeId:'mount-1', inode:String(ordinal + 1), sizeBytes:1,
      fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:canonicalDigest({ bytes:ordinal }) });
    const readHandle = Object.freeze({ handleId:'handle-'+ordinal, identity, bindingRevision:1 });
    return Object.freeze({ identity, readHandle, member:Object.freeze({ material_key:materialKey, selection_role:'triage_input',
      field_relative_location:fieldRelativeLocation, selection_scope_kind:'standalone_file', selection_scope_key:scopeKey,
      selection_scope_root_relative_location:fieldRelativeLocation, selection_scope_ordinal:ordinal, scope_member_ordinal:0,
      selection_scope_member_count:1, selection_scope_member_set_digest:scopeMemberSetDigest, selection_scope_digest:scopeDigest,
      expected_control_state:'controlled', expected_control_revision:1, expected_control_owner_domain:'procurement',
      expected_control_owner_scope_type:'procurement_run', expected_control_owner_scope_id:'run-1',
      expected_control_region_projection:'procurement', expected_control_evidence_digest:'b'.repeat(64),
      expected_control_projection_digest:'c'.repeat(64), size_bytes:1, binding_revision:1, eligibility_revision:1,
      eligibility_basis_digest:'d'.repeat(64), last_snapshot_digest:'e'.repeat(64), last_observation_id:'observation-'+ordinal,
      endpoint_id:'endpoint-1', location:'Z:/Film/'+fieldRelativeLocation, reality_digest:'f'.repeat(64),
      provenance_digest:'1'.repeat(64), admission_control_action:'acquired', basis_member_digest:'2'.repeat(64),
      admitted_control_revision:1, admitted_control_projection_digest:'3'.repeat(64) }) });
  });
  const selectionScopes = materials.map(({ member }) => Object.freeze({ scopeOrdinal:member.selection_scope_ordinal,
    scopeKind:member.selection_scope_kind, scopeKey:member.selection_scope_key,
    scopeRootRelativeLocation:member.selection_scope_root_relative_location, memberCount:member.selection_scope_member_count,
    memberSetDigest:member.selection_scope_member_set_digest, scopeDigest:member.selection_scope_digest }));
  const scopeSetDigest=canonicalDigest({schema:'procurement.selection-scope-set@1',scopes:selectionScopes});
  return Object.freeze({ run:Object.freeze({ procurement_run_id:'run-1', field_id:'field-1', state:'active',
    run_basis_digest:'4'.repeat(64), access_revision:1, access_digest:'5'.repeat(64), profile_hint_revision:1,
    content_profile_hint:'movie', profile_hint_digest:'6'.repeat(64), triage_rule_ref:triageRule.ruleRef,
    triage_rule_revision:triageRule.revision, triage_rule_authority_digest:triageRule.authorityDigest,
    selected_material_count:memberCount, selection_scope_count:memberCount, selection_scope_set_digest:scopeSetDigest }),
    access:Object.freeze({ root_location:'Z:/Film' }), selectionScopes:Object.freeze(selectionScopes), materials:Object.freeze(materials) });
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
  const sourceResults = value.materials.map((material, ordinal) => Object.freeze({
    eventId:'probe-'+ordinal,
    resultSchemaRef:manifests['shared.material.media.probe@1'].resultSchemaRef,
    result:Object.freeze({ sourceHandleDigest:canonicalDigest(material.readHandle), evidenceId:'probe-evidence-'+ordinal }),
    inputBindings:Object.freeze({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,
      bindings:Object.freeze([Object.freeze({portName:'physicalMaterialReadHandleOrWorkspaceMaterialHandle',
        bindingKind:'literal',value:material.readHandle})])}),
  })).reverse();
  const changedHandle=Object.freeze({...value.materials[1].readHandle,
    fingerprintVerifiedAtMs:value.materials[1].readHandle.fingerprintVerifiedAtMs+1});
  const current=Object.freeze({...value,materials:Object.freeze(value.materials.map((material,ordinal)=>
    ordinal===1?Object.freeze({...material,readHandle:changedHandle}):material))});
  const projection = createProbeBatchProjection({ triageReader:{ read:()=>current } });
  const batch = projection.project({ sourceResults, parameters:{ runId:'run-1', startOrdinal:1, batchSize:100,
    batchOrdinal:0, runBasisDigest:value.run.run_basis_digest } });
  assert.equal(batch.members.length, 100);
  assert.deepEqual(batch.members.map((member) => member.selectionOrdinal), Array.from({length:100},(_unused,index)=>index+1));
  assert.equal(batch.members[0].mediaProbe.evidenceId, 'probe-evidence-1');
  assert.deepEqual(batch.members[0].readHandle,value.materials[1].readHandle,
    'projection must retain the Probe Event frozen handle when current verification time changes');
  assert.equal(batch.members.at(-1).mediaProbe.evidenceId, 'probe-evidence-100');
});
