'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { CandidateDeliveryPort } = require('../../src/helix/domains/procurement/public');
const { buildAcceptanceBasis, buildOffer, PACKAGE_SCHEMA } =
  require('../../src/helix/domains/procurement/model/candidate-publication-contracts');
const { createCandidateDeliveryService } =
  require('../../src/helix/domains/procurement/application/candidate-delivery-service');

function candidatePackage(id = 'candidate-1', revision = 1) {
  const value = {
    schemaRef:PACKAGE_SCHEMA, schemaVersion:1, manifestId:id, manifestKind:'candidate_package', ownerDomain:'procurement',
    memberCount:1, membersDigest:canonicalDigest({ members:['material-1'] }), manifestDigest:'', publishedAtMs:100,
    candidatePackageId:id, packageRevision:revision, procurementRunId:'run-1', runBasisDigest:canonicalDigest({ run:'run-1' }),
    triageRule:{ ruleRef:'rule-1', revision:1, authorityDigest:canonicalDigest({ rule:'rule-1' }) },
    materialFieldContextRef:{ fieldId:'field-1', accessRevision:1, contextDigest:canonicalDigest({ field:'field-1' }) },
    mediaType:'single', contentProfile:'movie', displayIdentity:'Example', identityMetadata:{ metadataDigest:canonicalDigest({}) },
    identityClaim:{ claimDigest:canonicalDigest({ claim:'example' }) },
    structureEvidenceRef:{ evidenceId:'structure-1', payloadDigest:canonicalDigest({ structure:1 }),
      unitId:'unit-1', unitDigest:canonicalDigest({ unit:1 }) },
    seasonContinuityClaims:[], seasonContinuityClaimSetDigest:canonicalDigest({ schema:'season-continuity-claim-set@1', items:[] }),
    primaryInputManifestRef:{ manifestId:'manifest-1', manifestDigest:canonicalDigest({ manifest:1 }), memberCount:1 },
    relatedReferences:[], relatedReferenceSetDigest:canonicalDigest({ schema:'procurement.related-reference-set@1', items:[] }),
    memberControlEvidenceSetDigest:canonicalDigest({ controls:['material-1'] }), packageDigest:''
  };
  value.packageDigest = canonicalDigest(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['manifestDigest','packageDigest'].includes(key))));
  value.manifestDigest = value.packageDigest;
  return value;
}

function syntheticLibraConsumer(candidateDeliveryPort, message) {
  return candidateDeliveryPort.deliverCandidatePackage(message);
}

test('synthetic Libra reads one detached immutable Candidate through CandidateDeliveryPort only', () => {
  const source = candidatePackage();
  const message = buildOffer(source, buildAcceptanceBasis(source)).message;
  const reads = [];
  const service = createCandidateDeliveryService({
    candidatePackageReader:{ getCandidatePackage(query) { reads.push(query); return source; } },
    contractValidator:{ validate() {} }
  });
  const port = CandidateDeliveryPort(service);
  const first = syntheticLibraConsumer(port, message);
  const duplicate = syntheticLibraConsumer(port, message);
  assert.deepEqual(first, source);
  assert.deepEqual(duplicate, first);
  assert.notEqual(first, source);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.primaryInputManifestRef), true);
  assert.deepEqual(reads, [
    { candidatePackageId:'candidate-1', packageRevision:1, packageDigest:source.packageDigest },
    { candidatePackageId:'candidate-1', packageRevision:1, packageDigest:source.packageDigest }
  ]);
  assert.throws(() => { first.displayIdentity = 'mutated-by-libra'; }, TypeError);
  assert.equal(source.displayIdentity, 'Example');
});

test('rejects package drift and an Offer that was not derived from the delivered Package', () => {
  const source = candidatePackage();
  const message = buildOffer(source).message;
  const service = createCandidateDeliveryService({ candidatePackageReader:{ getCandidatePackage() { return source; } },
    contractValidator:{ validate() {} } });
  assert.throws(() => service.deliverCandidatePackage({ ...message, acceptanceBasisDigest:canonicalDigest({ wrong:true }) }),
    (error) => error.code === 'P7_CANDIDATE_OFFER_MISMATCH');
  const drifted = { ...source, displayIdentity:'Changed' };
  const driftService = createCandidateDeliveryService({ candidatePackageReader:{ getCandidatePackage() { return drifted; } },
    contractValidator:{ validate() {} } });
  assert.throws(() => driftService.deliverCandidatePackage(message),
    (error) => error.code === 'P7_CANDIDATE_PACKAGE_MISMATCH');
});

test('downstream boundary has no Procurement Store, Subject, Control transfer, Runtime, or signal-bus authority', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/procurement/application/candidate-delivery-service.js'), 'utf8');
  assert.doesNotMatch(source, /require\([^)]*(persistence|store|libra|subject|runtime|event-emitter|eventemitter)/i);
  assert.doesNotMatch(source, /\b(insert|update|delete|accept|reject|transferControl|createSubject)\s*\(/);
});
