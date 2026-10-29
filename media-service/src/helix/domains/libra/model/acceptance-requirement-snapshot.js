'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildCustomAcceptanceHandoff}=require('../../../contracts/custom-acceptance-handoff');

function buildAcceptanceRequirementSnapshot(spec){
  if(!spec||spec.targetKind!==undefined&&spec.targetKind!=='user_custom')
    throw Object.assign(new TypeError('Acceptance Spec target variant is invalid.'),{code:'LIBRA_ACCEPTANCE_TARGET_INVALID'});
  const body={schemaRef:'helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1',schemaVersion:1,
    acceptanceSpecId:spec.acceptanceSpecId,acceptanceSpecRecordDigest:spec.recordDigest,targetShelfId:spec.targetShelfId,
    contentProfile:spec.contentProfile,structureKind:spec.structureKind,shelfStandardRevision:spec.shelfStandardRevision,
    shelfStandardDigest:spec.shelfStandardDigest,requirements:spec.requirements,
    ...(spec.targetKind==='user_custom'?{customAcceptanceHandoff:buildCustomAcceptanceHandoff(spec)}:{})};
  const result=Object.freeze({...body,snapshotDigest:canonicalDigest(body)});
  if(Buffer.byteLength(canonicalJson(result),'utf8')>64*1024)
    throw new Error('Acceptance Requirement Snapshot exceeds its canonical size bound.');
  return result;
}
module.exports=Object.freeze({buildAcceptanceRequirementSnapshot});
