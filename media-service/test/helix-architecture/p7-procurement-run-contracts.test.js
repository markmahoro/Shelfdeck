'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { activeTriageRule, createDefaultTriageRuleRegistry, createProcurementRunExecutionBasis,
  createSelectedFieldMaterialSet } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { retryHeadStaleReason, retryMemberStaleReason } = require('../../src/helix/domains/procurement/model/procurement-retry-contracts');

const DIGEST = 'b'.repeat(64);
const IDENTITY = {schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,mountScopeId:'mount-1',inode:'42',contentHashAlgorithm:'sha256',contentHash:DIGEST};
IDENTITY.materialKey=canonicalDigest({schema:'physical-material-identity@1',mountScopeId:IDENTITY.mountScopeId,inode:IDENTITY.inode,contentHashAlgorithm:'sha256',contentHash:IDENTITY.contentHash});
const MATERIAL = IDENTITY.materialKey;
function controlSnapshot() {
  const evidence = { schema:'foundation.material-control-evidence@1', materialKey:MATERIAL, resultKind:'available',
    controlRevision:0, controlState:'uncontrolled' };
  const basis = { materialKey:MATERIAL, resultKind:'available', controlRevision:0, controlState:'uncontrolled',
    regionProjection:'uncontrolled', evidenceDigest:canonicalDigest(evidence) };
  return { ...basis, projectionDigest:canonicalDigest(basis) };
}
function member(overrides = {}) {
  const value = { ordinal:0, materialKey:MATERIAL, selectionRole:'triage_input', physicalIdentity:IDENTITY,sizeBytes:100,bindingRevision:1, eligibilityRevision:2,
    eligibilityBasisDigest:DIGEST, lastSnapshotDigest:DIGEST, lastObservationId:'observation-1', endpointId:'endpoint-1',
    location:'/field/title.mkv', realityDigest:DIGEST, provenanceDigest:DIGEST, controlSnapshot:controlSnapshot(),
    admissionControlAction:'acquire', ...overrides };
  return { ...value, basisMemberDigest:canonicalDigest(value) };
}
function selection(overrides = {}) {
  const value = { procurementRunId:'run-1', fieldId:'field-1', members:[member()], ...overrides };
  return { ...value, selectionDigest:canonicalDigest({ schema:'procurement.selected-field-material-set@1', ...value }) };
}
function basis(registry, overrides = {}) {
  const value = { procurementRunId:'run-1', fieldId:'field-1', fieldStatus:'active', fieldAccess:{ revision:1, digest:DIGEST },
    terminalObservation:{ revision:2, fieldObservationWorkId:'work-1' }, extractionPolicy:{ policyId:'policy-1', revision:3, digest:DIGEST },
    triageRule:activeTriageRule(registry), selectedFieldMaterialSet:selection(), ...overrides };
  return { ...value, basisDigest:canonicalDigest(value) };
}

test('binary Triage Registry resolves one digest-verified active immutable rule', () => {
  const registry = createDefaultTriageRuleRegistry();
  assert.equal(registry.registryVersion, 1);
  assert.equal(activeTriageRule(registry).ruleRef, 'procurement.triage.default');
  assert.throws(() => activeTriageRule({ ...registry, registryDigest:DIGEST }), (error) => error.code === 'P7_TRIAGE_REGISTRY_INVALID');
});

test('Selected Field Material Set freezes complete sorted members and action-specific Control snapshots', () => {
  assert.equal(createSelectedFieldMaterialSet(selection()).members.length, 1);
  const invalidMember = member({ admissionControlAction:'assert_same_field' });
  assert.throws(() => createSelectedFieldMaterialSet(selection({ members:[invalidMember] })),
    (error) => error.code === 'P7_RUN_MEMBER_INVALID');
  assert.throws(() => createSelectedFieldMaterialSet({ ...selection(), selectionDigest:DIGEST }),
    (error) => error.code === 'P7_RUN_SELECTION_DIGEST');
});

test('Run Execution Basis binds current Field heads, active Rule authority, and complete Selection', () => {
  const registry = createDefaultTriageRuleRegistry();
  assert.equal(createProcurementRunExecutionBasis(basis(registry), registry).basisDigest, basis(registry).basisDigest);
  const wrongRule = { ...activeTriageRule(registry), authorityDigest:DIGEST };
  assert.throws(() => createProcurementRunExecutionBasis(basis(registry, { triageRule:wrongRule }), registry),
    (error) => error.code === 'P7_TRIAGE_RULE_INVALID');
  assert.throws(() => createProcurementRunExecutionBasis(basis(registry, { fieldStatus:'deregistered' }), registry),
    (error) => error.code === 'P7_RUN_FIELD_INACTIVE');
});

test('Retry stale classifier applies the closed SSOT precedence before lower-level member drift',()=>{
  const registry=createDefaultTriageRuleRegistry(),rule=activeTriageRule(registry);const expectedHead={fieldStatus:'active',fieldAccess:{revision:1,digest:DIGEST},terminalObservation:{resultKind:'available',revision:1,fieldObservationWorkId:'work-1'},extractionPolicy:{policyId:'policy-1',revision:1,digest:DIGEST},triageRule:rule};
  assert.equal(retryHeadStaleReason(expectedHead,{...expectedHead,fieldStatus:'deregistered',fieldAccess:{revision:2,digest:'c'.repeat(64)}}),'field_status_changed');
  const expected={expectedBindingRevision:1,expectedEligibilityRevision:2,expectedEligibilityBasisDigest:DIGEST,expectedSelectionBasisDigest:DIGEST,expectedControlSnapshot:controlSnapshot()};
  const actual={materialState:'missing',currentSelection:{hasConflict:true,selectionBasisDigest:'c'.repeat(64)},currentControlSnapshot:{resultKind:'unavailable'}};
  assert.equal(retryMemberStaleReason(expected,actual,'field-1','triage_rule_changed'),'triage_rule_changed');
  assert.equal(retryMemberStaleReason(expected,actual,'field-1'),'material_not_present');
});
