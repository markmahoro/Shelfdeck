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
test('UAT-251 preserves mixed hard blockers and admits concrete missing metadata fields',()=>{
  const candidate=buildDefectAdmissionCandidate({run,terminalEvidence:terminal([blocker('product_metadata_required_fields_missing')]),missingMetadataFields:['plot','actor','director']});
  assert.deepEqual(candidate.defects[0].metadataFieldCodes,['actor','director','plot']);
  assert.equal(candidate.defects[0].defectCode,'metadata_fields_unavailable');
  assert.throws(()=>buildDefectAdmissionCandidate({run,terminalEvidence:terminal([
    blocker('product_metadata_required_cast_missing'),blocker('playback_decode_failed','libra.product_media.verify@1')])}),e=>e.code==='P9_DEFECT_ADMISSION_INELIGIBLE');
  assert.throws(()=>buildDefectAdmissionCandidate({run,terminalEvidence:terminal([blocker('product_metadata_required_fields_missing')]),missingMetadataFields:['tmdb_movie_id']}),e=>e.code==='P9_DEFECT_ADMISSION_NONWAIVABLE');
  assert.throws(()=>buildDefectAdmissionCandidate({run,terminalEvidence:terminal([blocker('product_metadata_required_cast_missing')]),gapScope:{...scope,padding:'x'.repeat(65536)}}),e=>e.code==='P9_DEFECT_ADMISSION_TOO_LARGE');
});

test('UAT-251 product evidence admits a technical path failure without calling it source exhaustion',()=>{
  const item={...blocker('P5_PROVIDER_RESPONSE_INVALID','arbitrary.future.operation@1'),failureClass:'integration_failure'};
  const verification={libraRunId:run.libraRunId,candidateKind:'direct_input',result:'failed',
    verificationId:D('direct-proof'),productMaterialHandleId:'original',reasonCodes:['container_unmet','video_codec_unmet']};
  const input={run,terminalEvidence:terminal([item]),productGapPaths:{[item.workId]:'media'},directMediaVerification:verification};
  const candidate=buildDefectAdmissionCandidate(input);
  assert.equal(candidate.defects[0].defectCode,'media_requirements_unmet');
  assert.equal(candidate.defects[0].sourceFailureCode,item.failureCode);
  assert.deepEqual(candidate.waivedRequirementCodes,verification.reasonCodes);
  assert.throws(()=>buildDefectAdmissionCandidate({...input,directMediaVerification:{...verification,
    reasonCodes:['container_unmet','playback_decode_failed']}}),error=>error.code==='P9_DEFECT_ADMISSION_NONWAIVABLE');
  assert.throws(()=>buildDefectAdmissionCandidate({...input,directMediaVerification:null}),error=>error.code==='P9_DEFECT_ADMISSION_INELIGIBLE');
  const metadata=buildDefectAdmissionCandidate({...input,productGapPaths:{[item.workId]:'metadata'},missingMetadataFields:['plot']});
  assert.deepEqual(metadata.defects[0].metadataFieldCodes,['plot']);
});
