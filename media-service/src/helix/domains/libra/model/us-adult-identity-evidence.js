'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {originalNameProvenance}=require('../../../contracts/us-adult-presentation');
const without=(value,keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
function originalFromIdentity(identity){
  if(identity?.contentProfile!=='western_adult'||identity.identityKind!=='internal_identity')throw new TypeError('US Adult requires its exact established Subject identity.');
  const entries=new Map(identity.displayIdentity?.entries?.map(item=>[item.key,item.value])),original=originalNameProvenance(entries.get('original_file_name'));
  if(entries.get('original_file_name_digest')!==original.provenanceDigest)throw new TypeError('Established US Adult original filename provenance is invalid.');
  return original;
}
function buildUsAdultIdentityIntent({snapshot,sourceHandle,establishedIdentity=null}){
  const members=snapshot.members.filter(item=>item.role==='primary_payload');
  if(snapshot.spec.contentProfile!=='western_adult'||members.length!==1||snapshot.materialInputForm!=='stream_file'||!sourceHandle?.fenceDigest||
    sourceHandle.ownerDomain!=='libra'||sourceHandle.ownerScope?.scopeId!==snapshot.run.libraRunId||
    canonicalDigest(sourceHandle.identity)!==canonicalDigest(members[0].physicalIdentity))
    throw new TypeError('US Adult identity requires one exact frozen primary file.');
  const fileName=String(members[0].location).split(/[\\/]/).at(-1),originalName=establishedIdentity?originalFromIdentity(establishedIdentity):originalNameProvenance(fileName),
    internalIdentity='us-adult:'+canonicalDigest({schema:'libra.us-adult-subject-identity@1',subjectId:snapshot.run.subjectId}),
    body={libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,runExecutionBasisDigest:snapshot.run.executionBasisDigest,
      contentProfile:'western_adult',sourceKind:'internal_source',internalIdentity,originalName,sourceHandleDigest:canonicalDigest(sourceHandle)},
    intentDigest=canonicalDigest(body);
  if(establishedIdentity&&!establishedIdentity.providerIdentities.some(item=>item.provider==='internal'&&item.namespace==='internal_identity'&&item.providerKey===internalIdentity))
    throw new TypeError('Established US Adult identity does not conserve its Subject.');
  return Object.freeze({intentId:'us-identity-intent-'+intentDigest.slice(0,40),...body,intentDigest});
}
function observeUsAdultIdentity(intent,handle){
  if(intent.contentProfile!=='western_adult'||intent.sourceKind!=='internal_source'||handle?.schemaRef!=='helix://contracts/types/PhysicalMaterialReadHandle/v1'||
    handle.ownerDomain!=='libra'||handle.ownerScope?.scopeId!==intent.libraRunId||
    intent.internalIdentity!=='us-adult:'+canonicalDigest({schema:'libra.us-adult-subject-identity@1',subjectId:intent.subjectId})||
    canonicalDigest(handle)!==intent.sourceHandleDigest||canonicalDigest(without(intent,['intentId','intentDigest']))!==intent.intentDigest||
    originalNameProvenance(intent.originalName?.originalFileName).provenanceDigest!==intent.originalName.provenanceDigest)
    throw new TypeError('US Adult identity Observation differs from its frozen file and original name.');
  return usAdultIdentityObservation(intent);
}
function usAdultIdentityObservation(intent){
  if(canonicalDigest(without(intent,['intentId','intentDigest']))!==intent.intentDigest||
    originalNameProvenance(intent.originalName?.originalFileName).provenanceDigest!==intent.originalName.provenanceDigest)
    throw new TypeError('US Adult identity intent is corrupt.');
  const originalFileName=intent.originalName.originalFileName,finalDot=originalFileName.lastIndexOf('.'),
    identity={provider:'internal',namespace:'internal_identity',providerKey:intent.internalIdentity,
      displayTitle:finalDot>0?originalFileName.slice(0,finalDot):originalFileName,originalTitle:null,releaseYear:null,aliases:[]},
    verifiedIdentity={...identity,identityDigest:canonicalDigest(identity)},
    body={schemaRef:'helix://contracts/types/ProductIdentityEvidenceObservation/v1',schemaVersion:1,
      observationId:'us-identity-observation-'+intent.intentDigest.slice(0,40),intentId:intent.intentId,libraRunId:intent.libraRunId,subjectId:intent.subjectId,
      contentProfile:'western_adult',sourceKind:'internal_source',result:'resolved',reasonCode:null,candidates:[],candidateMatchCount:1,verifiedIdentity,
      originalName:intent.originalName,sourceAssociationDigest:intent.sourceHandleDigest,evidenceDigest:canonicalDigest({intent,sourceHandleDigest:intent.sourceHandleDigest})};
  return Object.freeze({...body,observationDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({buildUsAdultIdentityIntent,observeUsAdultIdentity,originalFromIdentity,usAdultIdentityObservation});
