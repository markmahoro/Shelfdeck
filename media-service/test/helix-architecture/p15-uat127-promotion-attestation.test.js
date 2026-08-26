'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildDomainInputSchemas } = require(
  '../../scripts/helix-architecture/domain-input-schema-builder');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCapabilityContractValidator } = require(
  '../../src/helix/foundation/capability/contract-validator');
const {
  buildAuthorizedDefectManifest,
  buildDefectAdmissionCandidate,
} = require('../../src/helix/domains/libra/model/defect-admission-contracts');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');
const D = (value) => canonicalDigest({ value });

function promotionAttestationSchema() {
  const decision = buildDomainInputSchemas().LibraDeliverablePromotionDecision;
  return Object.freeze({
    $schema:'https://json-schema.org/draft/2020-12/schema',
    $id:'helix://tests/uat-127/ProductionAttestation/v1',
    ...decision.properties.productionAttestation,
  });
}

function commonAttestation() {
  return {
    attestationId:'attestation-127',
    libraRunId:'run-127',
    onDeckPackageId:'package-127',
    acceptanceSpecId:'spec-127',
    acceptanceSpecRecordDigest:D('spec-record'),
    productConformanceEvidenceId:'conformance-127',
    productConformanceEvidenceDigest:D('conformance'),
    evaluatedRequirementSetDigest:D('requirements'),
    productSnapshotDigest:D('product'),
    attestedAtMs:127,
  };
}

function defectManifest() {
  const run = Object.freeze({ libraRunId:'run-127', state:'frozen', stateRevision:3,
    stateDigest:D('frozen') });
  const work = Object.freeze({ workId:'work-127',
    failureCode:'product_metadata_required_cast_missing',
    capabilityRef:'libra.product_metadata.fetch@1',
    failureClass:'business_unachievable',
    terminalEvidenceDigest:D('terminal') });
  const terminalBody = { blockedWorks:[work] };
  const candidate = buildDefectAdmissionCandidate({ run,
    terminalEvidence:Object.freeze({ ...terminalBody,
      evidenceDigest:canonicalDigest(terminalBody) }) });
  return buildAuthorizedDefectManifest({ candidate, actorId:'admin',
    idempotencyKey:'uat-127', acknowledged:true, decidedAtMs:127 });
}

test('UAT-127 keeps Promotion Decision and On-deck Package attestation contracts identical', () => {
  const decisionAttestation = buildDomainInputSchemas()
    .LibraDeliverablePromotionDecision.properties.productionAttestation;
  const packageAttestation = JSON.parse(fs.readFileSync(path.join(contractsRoot,
    'types/OnDeckProductPackage/v1/schema.json'), 'utf8')).properties.productionAttestation;
  assert.deepEqual(decisionAttestation, packageAttestation);
});

test('UAT-127 runtime validation accepts ordinary and authorized-defect Promotion attestations', () => {
  const authorizedDefectSchema = JSON.parse(fs.readFileSync(path.join(contractsRoot,
    'application-types/AuthorizedDefectManifest/v1/schema.json'), 'utf8'));
  const schema = promotionAttestationSchema();
  const validator = createCapabilityContractValidator({
    schemas:[authorizedDefectSchema, schema],
  });
  const ordinaryBody = { ...commonAttestation(), unmetRequirementCount:0,
    unmetRequirementCodes:[], acceptanceKind:'accepted',
    authorizedDefectManifest:null };
  const ordinary = Object.freeze({ ...ordinaryBody,
    attestationDigest:canonicalDigest(ordinaryBody) });
  assert.equal(validator.validate(schema.$id, ordinary), ordinary);

  const manifest = defectManifest();
  const defectBody = { ...commonAttestation(), unmetRequirementCount:1,
    unmetRequirementCodes:['metadata_field_unmet'],
    acceptanceKind:'accepted_with_defects', authorizedDefectManifest:manifest };
  const defect = Object.freeze({ ...defectBody,
    attestationDigest:canonicalDigest(defectBody) });
  assert.equal(validator.validate(schema.$id, defect), defect);
});
