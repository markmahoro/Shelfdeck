'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {buildDefectAdmissionCandidate,buildAuthorizedDefectManifest,coversRequirementGaps}=require('../../src/helix/domains/libra/model/defect-admission-contracts');
const {acceptsProductionAttestation,acceptsMetadataFields}=require('../../src/helix/domains/arca/model/authorized-defect-manifest');
const run={libraRunId:'uat251-run',state:'frozen',stateRevision:3,stateDigest:D('run')};
const blocker=(failureCode,capabilityRef='libra.product_metadata.fetch@1')=>({workId:failureCode,capabilityRef,failureClass:'business_unachievable',failureCode,terminalEvidenceDigest:D(failureCode)});
const terminal=items=>({blockedWorks:items,evidenceDigest:D(items)});
const scope={ownerDomain:'libra',processId:run.libraRunId,productRevision:3,acceptanceSpecId:'spec',acceptanceSpecRecordDigest:D('spec'),requirementsDigest:D('requirements'),productEvidenceDigest:D('media'),
  gaps:[{requirementCode:'metadata_field_unmet',targetKind:'metadata_field',targetId:'actor',evidenceDigest:D('actor'),requiredValueDigest:D('actor-required')}]};
test('UAT-251 exact metadata grant does not authorize another field with the same generic gap code',()=>{
  const candidate=buildDefectAdmissionCandidate({run,terminalEvidence:terminal([blocker('product_metadata_required_cast_missing')]),missingMetadataFields:['actor'],gapScope:scope});
  const manifest=buildAuthorizedDefectManifest({candidate,actorId:'admin',idempotencyKey:'grant',acknowledged:true,decidedAtMs:12});
  const evidence={acceptanceSpecId:'spec',acceptanceSpecRecordDigest:D('spec'),missingMetadataFields:['actor']};
  assert.equal(coversRequirementGaps(manifest,['metadata_field_unmet'],evidence),true);
  for(const fields of [['plot'],['actor','plot'],[]]) {
    assert.equal(coversRequirementGaps(manifest,['metadata_field_unmet'],{...evidence,missingMetadataFields:fields}),false);
    assert.equal(acceptsMetadataFields(manifest,fields),false);
    assert.equal(acceptsProductionAttestation({...evidence,missingMetadataFields:fields,unmetRequirementCount:1,
      unmetRequirementCodes:['metadata_field_unmet'],acceptanceKind:'accepted_with_defects',authorizedDefectManifest:manifest}),false);
  }
  assert.equal(coversRequirementGaps(manifest,['metadata_field_unmet'],{...evidence,acceptanceSpecRecordDigest:D('changed')}),false);
});
test('UAT-251 rejects non-actor metadata, missing artifacts, and technical-failure bypasses',()=>{
  for(const fields of [['plot'],['actor','director'],['tmdb_movie_id']])
    assert.throws(()=>buildDefectAdmissionCandidate({run,terminalEvidence:terminal([blocker('product_metadata_required_cast_missing')]),missingMetadataFields:fields}),{code:'P9_DEFECT_ADMISSION_NONWAIVABLE'});
  const item=blocker('required_artifact_missing','shared.artifact.manifest.verify@1');
  for(const kind of ['poster','nfo','fanart'])
    assert.throws(()=>buildDefectAdmissionCandidate({run,terminalEvidence:terminal([item]),missingArtifactKindsByWork:{[item.workId]:[kind]}}),{code:'P9_DEFECT_ADMISSION_NONWAIVABLE'});
  for(const path of ['media','metadata']){
    const failure={...blocker('provider_timeout'),failureClass:'integration_failure'};
    assert.throws(()=>buildDefectAdmissionCandidate({run,terminalEvidence:terminal([failure]),productGapPaths:{[failure.workId]:path},missingMetadataFields:['actor']}),{code:'P9_DEFECT_ADMISSION_INELIGIBLE'});
  }
  assert.throws(()=>buildDefectAdmissionCandidate({run,terminalEvidence:terminal([blocker('product_metadata_required_cast_missing')]),gapScope:{...scope,padding:'x'.repeat(65536)}}),{code:'P9_DEFECT_ADMISSION_TOO_LARGE'});
});
