'use strict';
const {canonicalDigest:D}=require('../../../contracts/canonical-json');
const {AUDIT,RECLAIM,EVIDENCE,RECEIPT}=require('../../../contracts/people-artifact-reclamation');
function workFor({artifactHandle,boot,previous=null,sequence,phase}){
  const basis={schema:'people.reference-artifact-work@1',artifactHandleDigest:D(artifactHandle),boot,previous,sequence,phase},digest=D(basis),
    capability=phase==='audit'?AUDIT:RECLAIM,scope=D({artifactHandle,boot});
  return {schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:'people-gc-work-'+digest,
    ownerDomain:'people',processType:'people_artifact_reclamation',processId:'people-gc-'+scope,
    workKind:phase==='audit'?'reference_artifact_audit':'reference_artifact_reclaim',workObjectiveTypeRef:'helix://people/work/reference-artifact-'+phase+'/v1',workObjectiveVersion:1,
    executionBasisId:'people-gc-basis-'+digest,executionBasisDigest:digest,priorityClass:'background_observation',priorityRevision:1,
    capabilityCatalogScope:'people',workspaceMaterialScope:[],idempotencyKey:'people-gc/'+digest,concurrencyScope:'people-reference-artifact/'+artifactHandle.artifactHandleId,
    outputContractRef:phase==='audit'?EVIDENCE:RECEIPT,dependencyRefs:[
      {ownerDomain:'people',objectType:'reference_artifact',objectId:artifactHandle.artifactHandleId,revision:artifactHandle.referenceRevision,digest:D(artifactHandle)},
      {ownerDomain:'people',objectType:'reference_audit_boot',objectId:boot.bootId,revision:1,digest:boot.rootFenceDigest},
      {ownerDomain:'people',objectType:'reference_audit_sequence',objectId:String(sequence),revision:1,digest:D(sequence)},
      ...(previous?[{ownerDomain:'people',objectType:'reference_audit_predecessor',objectId:previous.workId,revision:1,digest:previous.resultDigest}]:[])]};
}
module.exports=Object.freeze({workFor});
