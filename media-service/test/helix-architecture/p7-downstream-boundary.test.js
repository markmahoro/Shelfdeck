'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { CandidateDeliveryPort } = require('../../src/helix/domains/procurement/public');
const { buildAcceptanceBasis, buildOffer, MANIFEST_SCHEMA, PACKAGE_SCHEMA } =
  require('../../src/helix/domains/procurement/model/candidate-publication-contracts');
const { buildQuery, createCandidateDeliveryService } =
  require('../../src/helix/domains/procurement/application/candidate-delivery-service');

const D = (value) => canonicalDigest({ value });
const without = (value, ...fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));

function ownerRows() {
  const primaryIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,mountScopeId:'mount-primary',inode:'41',contentHashAlgorithm:'sha256',contentHash:D('primary-content'),materialKey:''};
  primaryIdentity.materialKey=canonicalDigest({schema:'physical-material-identity@1',mountScopeId:primaryIdentity.mountScopeId,inode:primaryIdentity.inode,contentHashAlgorithm:'sha256',contentHash:primaryIdentity.contentHash});
  const materialKey=primaryIdentity.materialKey;
  const memberBase={ ordinal:0,materialKey,role:'primary_payload',physicalIdentity:primaryIdentity,sizeBytes:100,bindingRevision:1,admittedControlRevision:1,
    admittedControlProjectionDigest:D('control'),episodeClaims:[] };
  const member={ ...memberBase,memberDigest:canonicalDigest(memberBase) };
  const membersDigest=canonicalDigest({ schema:'procurement.primary-input-manifest-members@1',items:[memberBase] });
  const manifest={ schemaRef:MANIFEST_SCHEMA,schemaVersion:1,manifestId:'manifest-1',manifestKind:'primary_input_manifest',
    ownerDomain:'procurement',memberCount:1,membersDigest,manifestDigest:'',publishedAtMs:100,structureKind:'single',members:[member] };
  manifest.manifestDigest=canonicalDigest(without(manifest,'manifestDigest'));
  const identity={ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,mountScopeId:'mount-related',
    inode:'42',contentHashAlgorithm:'sha256',contentHash:D('related-content'),materialKey:'' };
  identity.materialKey=canonicalDigest({ schema:'physical-material-identity@1',mountScopeId:identity.mountScopeId,inode:identity.inode,
    contentHashAlgorithm:'sha256',contentHash:identity.contentHash });
  const reference={ referenceId:'',primaryMaterialKey:materialKey,role:'nfo',identity,endpointId:'endpoint-1',location:'/field/movie.nfo',
    checksumAlgorithm:'sha256',checksumHex:identity.contentHash,associationEvidenceDigest:D('association'),referenceDigest:'' };
  reference.referenceId=canonicalDigest({ schema:'procurement.related-material-reference-id@1',primaryMaterialKey:materialKey,
    role:reference.role,relatedMaterialKey:identity.materialKey,endpointId:reference.endpointId,location:reference.location });
  reference.referenceDigest=canonicalDigest(without(reference,'referenceDigest'));
  const relatedReferenceSetDigest=canonicalDigest({ schema:'procurement.related-reference-set@1',items:[reference] });
  const continuityDigest=canonicalDigest({ schema:'season-continuity-claim-set@1',items:[] });
  const metadata={ claimedTitle:'Movie',contentProfileHint:'movie',sourceHints:[],metadataDigest:D('metadata') };
  const claim={ schemaRef:'helix://contracts/types/IdentityClaim/v1',schemaVersion:1,claimDigest:D('claim') };
  const candidatePackage={ schemaRef:PACKAGE_SCHEMA,schemaVersion:1,manifestId:'candidate-1',manifestKind:'candidate_package',
    ownerDomain:'procurement',memberCount:1,membersDigest,manifestDigest:'',publishedAtMs:100,candidatePackageId:'candidate-1',
    packageRevision:1,procurementRunId:'run-1',runBasisDigest:D('run'),
    triageRule:{ ruleRef:'procurement.triage.default',revision:1,authorityDigest:D('authority') },
    materialFieldContextRef:{ fieldId:'field-1',accessRevision:1,contextDigest:D('context') },mediaType:'single',contentProfile:'movie',
    displayIdentity:'Movie',identityMetadata:metadata,identityClaim:claim,
    structureEvidenceRef:{ evidenceId:'structure-1',payloadDigest:D('structure'),unitId:D('unit-id'),unitDigest:D('unit') },
    seasonContinuityClaims:[],seasonContinuityClaimSetDigest:continuityDigest,
    primaryInputManifestRef:{ manifestId:manifest.manifestId,manifestDigest:manifest.manifestDigest,memberCount:1 },
    relatedReferences:[reference],relatedReferenceSetDigest,memberControlEvidenceSetDigest:D('controls'),packageDigest:'' };
  candidatePackage.packageDigest=canonicalDigest(without(candidatePackage,'manifestDigest','packageDigest'));
  candidatePackage.manifestDigest=candidatePackage.packageDigest;
  const basis=buildAcceptanceBasis(candidatePackage); const offer=buildOffer(candidatePackage,basis).message;
  return { offer, rows:{
    delivery:{ offer_id:offer.offerId,candidate_package_id:'candidate-1',package_digest:candidatePackage.packageDigest,
      acceptance_basis_digest:basis.acceptanceBasisDigest,state:'accepted',handoff_receipt_id:'receipt-1',offered_at_ms:100,closed_at_ms:200 },
    candidatePackage:{ candidate_package_id:'candidate-1',procurement_run_id:'run-1',package_revision:1,field_id:'field-1',
      field_access_revision:1,field_context_digest:D('context'),media_type:'single',content_profile:'movie',structure_kind:'single',
      display_identity:'Movie',identity_metadata_schema_ref:'metadata@1',identity_metadata_json:JSON.stringify(metadata),
      identity_metadata_digest:metadata.metadataDigest,identity_claim_schema_ref:claim.schemaRef,identity_claim_json:JSON.stringify(claim),
      identity_claim_digest:claim.claimDigest,structure_evidence_id:'structure-1',structure_evidence_payload_digest:D('structure'),
      structure_unit_id:D('unit-id'),structure_unit_digest:D('unit'),triage_rule_ref:'procurement.triage.default',triage_rule_revision:1,
      triage_rule_authority_digest:D('authority'),primary_input_manifest_id:'manifest-1',manifest_digest:manifest.manifestDigest,
      related_reference_set_digest:relatedReferenceSetDigest,member_control_evidence_set_digest:D('controls'),
      package_digest:candidatePackage.packageDigest,state:'published',published_at_ms:100 },
    run:{ procurement_run_id:'run-1',run_basis_digest:D('run') },continuity:[],
    primaries:[{ ordinal:0,material_key:materialKey,role:'primary_payload',mount_scope_id:primaryIdentity.mountScopeId,inode:primaryIdentity.inode,
      content_hash_algorithm:'sha256',content_hash:primaryIdentity.contentHash,size_bytes:100,binding_revision:1,admitted_control_revision:1,
      admitted_control_projection_digest:D('control'),member_digest:member.memberDigest }],episodes:[],
    related:[{ reference_id:reference.referenceId,primary_ordinal:0,role:reference.role,material_key:identity.materialKey,
      mount_scope_id:identity.mountScopeId,inode:identity.inode,content_hash_algorithm:'sha256',content_hash:identity.contentHash,
      endpoint_id:reference.endpointId,location:reference.location,checksum_algorithm:'sha256',checksum_hex:identity.contentHash,
      association_evidence_digest:reference.associationEvidenceDigest,reference_digest:reference.referenceDigest }],
    runMembers:[{ ordinal:0,material_key:materialKey,mount_scope_id:primaryIdentity.mountScopeId,inode:primaryIdentity.inode,
      content_hash_algorithm:'sha256',content_hash:primaryIdentity.contentHash,size_bytes:100,binding_revision:1,last_snapshot_digest:D('snapshot'),endpoint_id:'endpoint-1',
      location:'/field/movie.mkv',reality_digest:D('reality'),provenance_digest:D('provenance'),admitted_control_revision:1,
      admitted_control_projection_digest:D('control'),selection_state:'transferred',candidate_package_id:'candidate-1' }]
  } };
}

test('CandidateDeliveryPort returns the same complete historical snapshot after Offer closure', () => {
  const fixture=ownerRows(); const reads=[]; const validations=[];
  const service=createCandidateDeliveryService({ candidateDeliveryReader:{ readRows(query){ reads.push(query); return fixture.rows; } },
    contractValidator:{ validate(schema){ validations.push(schema); } } });
  const port=CandidateDeliveryPort(service); const query=buildQuery(fixture.offer);
  const first=port.readSnapshot(query); const replay=port.readSnapshot(query);
  assert.equal(first.resultKind,'found'); assert.equal(first.snapshot.offer.offerId,fixture.offer.offerId);
  assert.equal(first.snapshot.candidatePackage.relatedReferences[0].identity.mountScopeId,'mount-related');
  assert.equal(first.snapshot.primaryMaterialDeliveries[0].location,'/field/movie.mkv');
  assert.equal(first.snapshot.deliverySnapshotDigest,replay.snapshot.deliverySnapshotDigest);
  assert.equal(Object.isFrozen(first.snapshot.candidatePackage.relatedReferences[0].identity),true);
  assert.deepEqual(reads,[query,query]); assert.ok(validations.includes('helix://contracts/domain-types/CandidateDeliverySnapshot/v1'));
});

test('returns typed not_found and rejects Related identity drift without fallback', () => {
  const fixture=ownerRows(); const query=buildQuery(fixture.offer);
  const missing=createCandidateDeliveryService({ candidateDeliveryReader:{ readRows(){ return null; } },contractValidator:{ validate(){} } });
  assert.deepEqual(missing.readSnapshot(query),{ queryDigest:query.queryDigest,resultKind:'not_found',reasonCode:'offer_not_found',
    resultDigest:canonicalDigest({ queryDigest:query.queryDigest,resultKind:'not_found',reasonCode:'offer_not_found' }) });
  fixture.rows.related[0].inode='43';
  const corrupt=createCandidateDeliveryService({ candidateDeliveryReader:{ readRows(){ return fixture.rows; } },contractValidator:{ validate(){} } });
  assert.throws(() => corrupt.readSnapshot(query),(error) => error.code === 'P8_CANDIDATE_DELIVERY_RELATED');
});

test('downstream boundary has no Libra Store, Control transfer, Runtime, or signal-bus authority', () => {
  const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/domains/procurement/application/candidate-delivery-service.js'),'utf8');
  assert.doesNotMatch(source,/require\([^)]*(persistence|store|libra|subject|runtime|event-emitter|eventemitter)/i);
  assert.doesNotMatch(source,/\b(insert|update|delete|accept|reject|transferControl|createSubject)\s*\(/);
});
