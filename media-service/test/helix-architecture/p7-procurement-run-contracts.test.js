'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { activeTriageRule, createDefaultTriageRuleRegistry, createProcurementRunExecutionBasis,
  createSelectedFieldMaterialSet } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');

const MATERIAL = 'a'.repeat(64);
const DIGEST = 'b'.repeat(64);
function controlSnapshot() {
  const evidence = { schema:'foundation.material-control-evidence@1', materialKey:MATERIAL, resultKind:'available',
    controlRevision:0, controlState:'uncontrolled' };
  const basis = { materialKey:MATERIAL, resultKind:'available', controlRevision:0, controlState:'uncontrolled',
    regionProjection:'uncontrolled', evidenceDigest:canonicalDigest(evidence) };
  return { ...basis, projectionDigest:canonicalDigest(basis) };
}
function member(overrides = {}) {
  const value = { ordinal:0, materialKey:MATERIAL, selectionRole:'triage_input', bindingRevision:1, eligibilityRevision:2,
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
