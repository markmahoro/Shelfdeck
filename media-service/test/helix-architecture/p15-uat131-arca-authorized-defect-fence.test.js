'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  buildAuthorizedDefectManifest,
  buildDefectAdmissionCandidate,
} = require('../../src/helix/domains/libra/model/defect-admission-contracts');
const {
  acceptsProductionAttestation,
} = require('../../src/helix/domains/arca/model/authorized-defect-manifest');

const D = (value) => canonicalDigest({ value });
const PACKAGE_ID = D('package-131');
const SPEC_DIGEST = D('spec');
const RUN_STATE_DIGEST = D('active-run-state');
const RUN_BASIS_DIGEST = D('run-basis');

function manifest(runId = 'run-131') {
  const run = Object.freeze({ libraRunId:runId, state:'frozen', stateRevision:3,
    stateDigest:D('frozen-' + runId) });
  const work = Object.freeze({ workId:'work-131',
    failureCode:'product_metadata_required_cast_missing',
    capabilityRef:'libra.product_metadata.fetch@1', failureClass:'business_unachievable',
    terminalEvidenceDigest:D('terminal-131') });
  const body = { blockedWorks:[work] };
  const candidate = buildDefectAdmissionCandidate({ run, terminalEvidence:Object.freeze({
    ...body, evidenceDigest:canonicalDigest(body),
  }) });
  return buildAuthorizedDefectManifest({ candidate, actorId:'admin',
    idempotencyKey:'uat-131', acknowledged:true, decidedAtMs:131 });
}

function attestation(overrides = {}) {
  const body = {
    attestationId:'',
    libraRunId:'run-131',
    onDeckPackageId:PACKAGE_ID,
    acceptanceSpecId:'spec-131',
    acceptanceSpecRecordDigest:SPEC_DIGEST,
    productConformanceEvidenceId:D('conformance-id'),
    productConformanceEvidenceDigest:D('conformance'),
    evaluatedRequirementSetDigest:D('requirements'),
    productSnapshotDigest:D('snapshot'),
    unmetRequirementCount:1,
    unmetRequirementCodes:['metadata_field_unmet'],
    acceptanceKind:'accepted_with_defects',
    authorizedDefectManifest:manifest(),
    attestedAtMs:132,
    ...overrides,
  };
  body.attestationId = canonicalDigest({ schema:'libra.production-attestation-id@1',
    libraRunId:body.libraRunId, onDeckPackageId:body.onDeckPackageId,
    productConformanceEvidenceId:body.productConformanceEvidenceId,
    productConformanceEvidenceDigest:body.productConformanceEvidenceDigest });
  return Object.freeze({ ...body, attestationDigest:canonicalDigest(body) });
}

function ordinaryAttestation(overrides = {}) {
  return attestation({ unmetRequirementCount:0, unmetRequirementCodes:[],
    acceptanceKind:'accepted', authorizedDefectManifest:null, ...overrides });
}

function packageValue(productionAttestation, overrides = {}) {
  const baseProvenanceBody = {
    libraRunId:'run-131',
    runExecutionBasisDigest:RUN_BASIS_DIGEST,
    acceptanceSpecRecordDigest:SPEC_DIGEST,
    workflowPlanRefs:[],
    productVerificationRefs:[{
      verificationId:productionAttestation.productConformanceEvidenceId,
      verificationDigest:productionAttestation.productConformanceEvidenceDigest,
    }],
    externalRealityObservationRefs:[],
  };
  const baseProvenance = { ...baseProvenanceBody,
    provenanceDigest:canonicalDigest(baseProvenanceBody) };
  const requestedProvenance = overrides.productionProvenance || baseProvenance;
  const provenanceBody = Object.fromEntries(Object.entries(requestedProvenance)
    .filter(([name]) => name !== 'provenanceDigest'));
  const productionProvenance = { ...provenanceBody,
    provenanceDigest:canonicalDigest(provenanceBody) };
  const body = {
    schemaRef:'helix://contracts/types/OnDeckProductPackage/v1',
    schemaVersion:1,
    onDeckPackageId:PACKAGE_ID,
    libraRunId:'run-131',
    runStateRevision:4,
    runStateDigest:RUN_STATE_DIGEST,
    runExecutionBasisDigest:RUN_BASIS_DIGEST,
    acceptanceSpecRef:{ id:'spec-131', recordDigest:SPEC_DIGEST },
    productionProvenance,
    productionAttestation,
    ...overrides,
    productionProvenance,
  };
  const packageDigest = canonicalDigest(body);
  return Object.freeze({ ...body, manifestDigest:packageDigest,
    publishedAtMs:200, packageDigest });
}

test('UAT-131 Arca accepts only a digest-valid Manifest bound to the Package Run', () => {
  const authorized = attestation();
  assert.equal(acceptsProductionAttestation(authorized,
    packageValue(authorized)), true);
  const foreignRun = attestation({ libraRunId:'run-other' });
  assert.equal(acceptsProductionAttestation(foreignRun,
    packageValue(foreignRun)), false);
  const foreignManifest = attestation({ authorizedDefectManifest:manifest('run-other') });
  assert.equal(acceptsProductionAttestation(foreignManifest,
    packageValue(foreignManifest)), false);
  assert.equal(acceptsProductionAttestation(authorized,
    packageValue(authorized, { onDeckPackageId:D('another-package') })), false);
  assert.equal(acceptsProductionAttestation(authorized,
    packageValue(authorized, { runStateRevision:3 })), false);
  assert.equal(acceptsProductionAttestation(authorized,
    packageValue(authorized, { runStateRevision:5 })), false);
});

test('UAT-131 Arca requires the exact unique actual unmet set', () => {
  const duplicate = attestation({
    unmetRequirementCount:2,
    unmetRequirementCodes:['metadata_field_unmet','metadata_field_unmet'],
  });
  assert.equal(acceptsProductionAttestation(duplicate,
    packageValue(duplicate)), false);
  const wider = attestation({
    unmetRequirementCount:2,
    unmetRequirementCodes:['metadata_field_unmet','container_unmet'],
  });
  assert.equal(acceptsProductionAttestation(wider, packageValue(wider)), false);
});

test('UAT-131 Arca does not trust an ordinary-pass mutation', () => {
  const authorized = attestation();
  const forged = Object.freeze({ ...authorized, unmetRequirementCount:0,
    unmetRequirementCodes:[], acceptanceKind:'accepted', authorizedDefectManifest:null });
  assert.equal(acceptsProductionAttestation(forged, packageValue(forged)), false);

  const ordinary = ordinaryAttestation();
  assert.equal(acceptsProductionAttestation(ordinary, packageValue(ordinary)), true);
});

test('UAT-131 Arca binds ordinary and defect attestations to Spec, Run digest, and one exact Evidence ref', () => {
  for (const value of [ordinaryAttestation(), attestation()]) {
    const exact = packageValue(value);
    assert.equal(acceptsProductionAttestation(value, exact), true);
    assert.equal(acceptsProductionAttestation(value, {
      ...exact, runStateDigest:D('drifted-run-state'),
    }), false);
    assert.equal(acceptsProductionAttestation(value, packageValue(value, {
      acceptanceSpecRef:{ id:'foreign-spec', recordDigest:SPEC_DIGEST },
    })), false);
    assert.equal(acceptsProductionAttestation(value, packageValue(value, {
      productionProvenance:{ ...exact.productionProvenance,
        productVerificationRefs:[] },
    })), false);
    assert.equal(acceptsProductionAttestation(value, packageValue(value, {
      productionProvenance:{ ...exact.productionProvenance,
        productVerificationRefs:[{ verificationId:value.productConformanceEvidenceId,
          verificationDigest:D('wrong-evidence') }] },
    })), false);
  }
});

test('UAT-131 production callers use the independent mandatory observation fence', () => {
  const coordinator = fs.readFileSync(path.join(__dirname, '../../src/helix/domains/arca/application/movie-ondeck-coordinator.js'), 'utf8');
  const capabilities = fs.readFileSync(path.join(__dirname, '../../src/helix/domains/arca/capabilities/on-deck-capability-ports.js'), 'utf8');
  assert.match(coordinator,
    /await observeMandatoryMedia\(\{/);
  assert.match(capabilities,
    /await observeMandatoryMedia\(\{/);
});
