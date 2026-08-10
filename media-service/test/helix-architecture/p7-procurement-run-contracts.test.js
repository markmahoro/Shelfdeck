'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { activeTriageRule, createDefaultTriageRuleRegistry, createProcurementRunExecutionBasis,
  createSelectedFieldMaterialSet } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { retryHeadStaleReason, retryMemberStaleReason } = require('../../src/helix/domains/procurement/model/procurement-retry-contracts');

const DIGEST = 'b'.repeat(64);
const PROFILE_HINT = Object.freeze({
  fieldId:'field-1',
  revision:1,
  contentProfileHint:'mixed',
  hintDigest:canonicalDigest({
    schema:'procurement.material-field-profile-hint@1',
    fieldId:'field-1',
    revision:1,
    contentProfileHint:'mixed',
  }),
});
const IDENTITY = {schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'mount-1',inode:'42',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:DIGEST};
IDENTITY.materialKey=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:IDENTITY.mountScopeId,inode:IDENTITY.inode,sizeBytes:IDENTITY.sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:IDENTITY.contentFingerprint});
const MATERIAL = IDENTITY.materialKey;
function controlSnapshot(materialKey = MATERIAL) {
  const evidence = { schema:'foundation.material-control-evidence@1', materialKey, resultKind:'available',
    controlRevision:0, controlState:'uncontrolled' };
  const basis = { materialKey, resultKind:'available', controlRevision:0, controlState:'uncontrolled',
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
function selectionWithCount(count) {
  const members = Array.from({ length: count }, (_, index) => {
    const physicalIdentity = {
      schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2, mountScopeId:'mount-1',
      inode:String(index + 1), sizeBytes:100, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:index.toString(16).padStart(64, '0'),
    };
    physicalIdentity.materialKey = canonicalDigest({
      schema:'physical-material-identity@2', mountScopeId:physicalIdentity.mountScopeId, inode:physicalIdentity.inode,
      sizeBytes:physicalIdentity.sizeBytes, fingerprintAlgorithm:physicalIdentity.fingerprintAlgorithm,
      fingerprintVersion:physicalIdentity.fingerprintVersion, contentFingerprint:physicalIdentity.contentFingerprint,
    });
    return { materialKey:physicalIdentity.materialKey, physicalIdentity };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.materialKey), Buffer.from(right.materialKey)))
    .map(({ materialKey, physicalIdentity }, ordinal) => {
      const value = { ordinal, materialKey, selectionRole:'triage_input', physicalIdentity, sizeBytes:100,
        bindingRevision:1, eligibilityRevision:2, eligibilityBasisDigest:DIGEST, lastSnapshotDigest:DIGEST,
        lastObservationId:'observation-1', endpointId:'endpoint-1', location:`/field/${ordinal}.mkv`,
        realityDigest:DIGEST, provenanceDigest:DIGEST, controlSnapshot:controlSnapshot(materialKey),
        admissionControlAction:'acquire' };
      return { ...value, basisMemberDigest:canonicalDigest(value) };
    });
  return selection({ members });
}
function basis(registry, overrides = {}) {
  const value = { procurementRunId:'run-1', fieldId:'field-1', fieldStatus:'active', fieldAccess:{ revision:1, digest:DIGEST },
    profileHintSnapshot:PROFILE_HINT, terminalObservation:{ revision:2, fieldObservationWorkId:'work-1', profileHintSnapshot:PROFILE_HINT }, extractionPolicy:{ policyId:'policy-1', revision:3, digest:DIGEST },
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

test('Selected Field Material Set accepts the 1024-member physical bound and rejects 1025', () => {
  assert.equal(createSelectedFieldMaterialSet(selectionWithCount(1024)).members.length, 1024);
  assert.throws(() => createSelectedFieldMaterialSet(selectionWithCount(1025)),
    (error) => error.code === 'P7_RUN_SELECTION_BOUNDS');
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
  const registry=createDefaultTriageRuleRegistry(),rule=activeTriageRule(registry);const expectedHead={fieldStatus:'active',profileHintSnapshot:PROFILE_HINT,fieldAccess:{revision:1,digest:DIGEST},terminalObservation:{resultKind:'available',revision:1,fieldObservationWorkId:'work-1',profileHintSnapshot:PROFILE_HINT},extractionPolicy:{policyId:'policy-1',revision:1,digest:DIGEST},triageRule:rule};
  assert.equal(retryHeadStaleReason(expectedHead,{...expectedHead,fieldStatus:'deregistered',fieldAccess:{revision:2,digest:'c'.repeat(64)}}),'field_status_changed');
  const westernHint={fieldId:'field-1',revision:2,contentProfileHint:'western_adult',hintDigest:canonicalDigest({
    schema:'procurement.material-field-profile-hint@1',fieldId:'field-1',revision:2,contentProfileHint:'western_adult',
  })};
  assert.equal(retryHeadStaleReason(expectedHead,{...expectedHead,profileHintSnapshot:westernHint}),'field_profile_hint_changed');
  const expected={expectedBindingRevision:1,expectedEligibilityRevision:2,expectedEligibilityBasisDigest:DIGEST,expectedSelectionBasisDigest:DIGEST,expectedControlSnapshot:controlSnapshot()};
  const actual={materialState:'missing',currentSelection:{hasConflict:true,selectionBasisDigest:'c'.repeat(64)},currentControlSnapshot:{resultKind:'unavailable'}};
  assert.equal(retryMemberStaleReason(expected,actual,'field-1','triage_rule_changed'),'triage_rule_changed');
  assert.equal(retryMemberStaleReason(expected,actual,'field-1'),'material_not_present');
});
