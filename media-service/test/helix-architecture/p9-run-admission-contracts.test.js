'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  activeRunScopeSetDigest, buildOutputRequirement, buildProductionMaterialManifest, buildRunAdmissionDecision,
  buildRunExecutionBasis, buildRunExecutionBasisRecord, runScopeDigest
} = require('../../src/helix/domains/libra/model/run-admission-contracts');

const D = (value) => canonicalDigest({ value });
function identity(inode, content) {
  const physicalIdentity = { mountScopeId: 'mount-1', inode, contentHashAlgorithm: 'sha256', contentHash: D(content) };
  const materialKey = canonicalDigest({ schema: 'physical-material-identity@1', ...physicalIdentity });
  return { physicalIdentity, materialKey };
}
function member(material, episodeClaims = []) {
  return { materialKey: material.materialKey, role: 'primary_payload', physicalIdentity: material.physicalIdentity,
    sizeBytes: 100, location: { locationKind: 'domain_binding', endpointId: 'endpoint-1', location: '/library/input.mkv' },
    bindingKind: 'libra_material_binding', bindingRevision: 1, bindingEvidenceDigest: D('binding'),
    originCandidateDeliveryRef: { intakeDecisionId: 'intake-1', offerId: 'offer-1', candidatePackageId: 'candidate-1',
      packageRevision: 1, packageDigest: D('package'), candidateDeliverySnapshotDigest: D('delivery'),
      relatedReferenceSetDigest: D('related') }, admittedControlRevision: 2,
    admittedControlProjectionDigest: D('control'), episodeClaims };
}
function acceptanceSpec(structureKind = 'single') {
  const episodeKeys = structureKind === 'season' ? ['S01E01'] : [];
  const scopeKind = structureKind === 'season' ? 'episode_manifest' : 'single';
  const productScopeDigest = canonicalDigest({ schema: 'libra.product-scope@1', subjectId: 'subject-1', scopeKind,
    subjectIntakeRevision: 1, episodeKeys });
  return { acceptanceSpecId: 'spec-1', specRevision: 1, specDigest: D('spec'), recordDigest: D('record'),
    productScopeDigest, productScope: { subjectId: 'subject-1', scopeKind, subjectIntakeRevision: 1, episodeKeys,
      scopeDigest: productScopeDigest }, shelfId: 'shelf-1', requirements: {
      identity: {}, structure: { structureKind }, metadata: {}, mandatoryMedia: {}, space: {}, inventory: {}
    } };
}
function basisFor({ subjectId = 'subject-1', headRevision = 0, structureKind = 'single', members } = {}) {
  const admissionRevision = headRevision + 1;
  const libraRunId = canonicalDigest({ schema: 'libra.run-id@1', subjectId, admissionRevision });
  const spec = acceptanceSpec(structureKind);
  const manifest = buildProductionMaterialManifest({ manifestRole: 'run_input', manifestRevision: 1, libraRunId,
    scopeKind: structureKind === 'single' ? 'single' : 'episode_delivery', members }, spec);
  return buildRunExecutionBasis({
    subjectSnapshot: { subjectId, intakeRevision: 1, structureKind, contentProfile: structureKind === 'single' ? 'movie' : 'series',
      continuitySetDigest: D('continuity'), episodeScopeDigest: manifest.episodeScopeDigest },
    decisionHeadSnapshot: { subjectId, headState: 'present', headRevision: 4, headDigest: D('head'),
      currentRoutingDecisionId: 'routing-1', currentDecisionBasisId: 'basis-1', currentAcceptanceSpecId: 'spec-1', snapshotDigest: D('head-snapshot') },
    acceptanceSpec: spec,
    shelfProjection: { routingProjectionRevision: 1, projectionDigest: D('projection'), standardRevision: 1, standardDigest: D('standard') },
    productionMaterialManifest: manifest
  });
}

test('freezes a run-owned manifest and compact Execution Basis record without upstream aliases', () => {
  const material = identity('11', 'a');
  const basis = basisFor({ members: [member(material)] });
  assert.equal(basis.productionMaterialManifest.members[0].ordinal, 0);
  assert.equal(basis.productionMaterialManifest.manifestRole, 'run_input');
  assert.equal(basis.productionMaterialManifest.members[0].originCandidateDeliveryRef.candidatePackageId, 'candidate-1');
  const record = buildRunExecutionBasisRecord(basis);
  assert.equal(record.productionMaterialManifest, undefined);
  assert.equal(record.productionMaterialManifestRef.manifestDigest, basis.productionMaterialManifest.manifestDigest);
  assert.equal(record.executionBasisDigest, basis.executionBasisDigest);
  assert.equal(runScopeDigest(basis).length, 64);
});

test('derives Output Requirement from immutable Spec, role, and Episode scope', () => {
  const material = identity('10', 'requirement');
  const spec = acceptanceSpec('season');
  const requirement = buildOutputRequirement({ acceptanceSpec: spec, manifestRole: 'run_input',
    materialKey: material.materialKey, materialRole: 'primary_payload', episodeKeys: ['S01E01'] });
  assert.equal(requirement.applicationScope.kind, 'episode_subset');
  assert.equal(requirement.acceptanceSpecRef.productScopeDigest, spec.productScopeDigest);
  const forged = member(material, [{ episodeKey: 'S01E01', seasonClaimDigest: D('season') }]);
  forged.outputRequirementDigest = D('forged');
  assert.throws(() => basisFor({ structureKind: 'season', members: [forged] }),
    (error) => error.code === 'P9_RUN_REQUIREMENT_DIGEST');
});

test('initial admission derives stable Run identity and fixed normal priority', () => {
  const material = identity('12', 'b'), basis = basisFor({ members: [member(material)] });
  const emptySet = activeRunScopeSetDigest('subject-1', []);
  const priorityIntentDigest = canonicalDigest({ schema: 'libra.priority-intent-empty@1' });
  const value = { admissionKind: 'initial', subjectId: 'subject-1', expectedRunAdmissionHead: {
    headState: 'absent', headRevision: 0, activeScopeSetDigest: emptySet }, runExecutionBasis: basis,
    initialPriority: { priorityClass: 'normal', priorityIntentDigest } };
  const first = buildRunAdmissionDecision(value), second = buildRunAdmissionDecision(value);
  assert.deepEqual(first, second);
  assert.equal(first.admissionRevision, 1);
  assert.equal(first.libraRunId, basis.productionMaterialManifest.libraRunId);
  assert.equal(first.replacementOfRunRef, undefined);
});

test('season Manifest preserves N:M Episode claims and rejects conflicting duplicates', () => {
  const claim = { episodeKey: 'S01E01', seasonClaimDigest: D('season') };
  claim.claimDigest = canonicalDigest({ schema: 'libra.production-material-episode-claim@1',
    episodeKey: claim.episodeKey, seasonClaimDigest: claim.seasonClaimDigest });
  const a = identity('13', 'c'), b = identity('14', 'd');
  const sorted = [member(a, [claim]), member(b, [claim])].sort((left, right) => Buffer.from(left.materialKey).compare(Buffer.from(right.materialKey)));
  const basis = basisFor({ structureKind: 'season', members: sorted });
  assert.equal(basis.productionMaterialManifest.members.length, 2);
  const conflicting = { ...claim, seasonClaimDigest: D('other') };
  conflicting.claimDigest = canonicalDigest({ schema: 'libra.production-material-episode-claim@1',
    episodeKey: conflicting.episodeKey, seasonClaimDigest: conflicting.seasonClaimDigest });
  const bad = [member(a, [claim]), member(b, [conflicting])].sort((left, right) => Buffer.from(left.materialKey).compare(Buffer.from(right.materialKey)));
  assert.throws(() => basisFor({ structureKind: 'season', members: bad }), (error) => error.code === 'P9_RUN_EPISODE_CONFLICT');
});

test('rejects unsorted, duplicate, structural Episode and replacement-authority drift', () => {
  const a = identity('15', 'e'), b = identity('16', 'f');
  const descending = [member(a), member(b)].sort((left, right) => Buffer.from(right.materialKey).compare(Buffer.from(left.materialKey)));
  assert.throws(() => basisFor({ members: descending }), (error) => error.code === 'P9_RUN_MEMBER_ORDER');
  assert.throws(() => basisFor({ members: [member(a), member(a)] }), (error) => ['P9_RUN_MEMBER_DUPLICATE', 'P9_RUN_MEMBER_ORDER'].includes(error.code));
  const basis = basisFor({ members: [member(a)] }), emptySet = activeRunScopeSetDigest('subject-1', []);
  assert.throws(() => buildRunAdmissionDecision({ admissionKind: 'initial', subjectId: 'subject-1',
    expectedRunAdmissionHead: { headState: 'absent', headRevision: 0, activeScopeSetDigest: emptySet }, runExecutionBasis: basis,
    initialPriority: { priorityClass: 'expedited', priorityIntentDigest: D('escalate') } }),
  (error) => error.code === 'P9_RUN_INITIAL_PRIORITY');
});
