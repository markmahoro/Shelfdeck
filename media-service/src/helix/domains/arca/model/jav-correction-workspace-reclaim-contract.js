'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const CAPABILITY='arca.jav_correction.workspace.reclaim@1',SCOPE_SCHEMA='helix://contracts/domain-types/JavCorrectionWorkspaceReclaimScope/v1',
  RESULT_SCHEMA='helix://contracts/types/JavCorrectionWorkspaceReclaimReceipt/v1';
const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
  object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),integer=minimum=>({type:'integer',minimum,maximum:Number.MAX_SAFE_INTEGER});
function buildWorkspaceReclaimScope(record,plan){
  if(record?.state!=='committed'||!['pending','active','attention_required'].includes(record.cleanupState)||
      plan?.correctionId!==record.correctionId||plan.shelfEntryId!==record.shelfEntryId||plan.committedContextDigest!==record.committedContext?.contextDigest||
      plan.commitReceiptDigest!==record.committedContext?.receiptDigest)throw Object.assign(new Error('Workspace reclaim scope lost its committed cleanup responsibility.'),
        {code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_SCOPE_STALE'});
  const body={schemaRef:SCOPE_SCHEMA,schemaVersion:1,objectId:record.correctionId,revision:record.stateRevision,objectKind:'jav-correction-workspace-reclaim-scope',
    correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,committedContextDigest:plan.committedContextDigest,commitReceiptDigest:plan.commitReceiptDigest,
    reclaimPlanDigest:plan.planDigest,guardDigest:plan.guardDigest};return Object.freeze({...body,digest:canonicalDigest(body)});
}
function workspaceReclaimScopeSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCOPE_SCHEMA,title:'JavCorrectionWorkspaceReclaimScope@1',
  'x-helix-ssotRefs':['8.6.19'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':4096,
  ...object({schemaRef:{const:SCOPE_SCHEMA},schemaVersion:{const:1},objectId:text(),revision:integer(1),objectKind:{const:'jav-correction-workspace-reclaim-scope'},
    correctionId:text(),shelfEntryId:text(),committedContextDigest:digest(),commitReceiptDigest:digest(),reclaimPlanDigest:digest(),guardDigest:digest(),digest:digest()})};}
function workspaceReclaimReceiptSchema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:RESULT_SCHEMA,title:'JavCorrectionWorkspaceReclaimReceipt@1',
  'x-helix-ssotRefs':['8.6.19'],'x-helix-envelopeRef':'helix://contracts/types/ReceiptEnvelope/v1','x-helix-maxCanonicalBytes':16384,
  ...object({schemaRef:{const:RESULT_SCHEMA},schemaVersion:{const:1},receiptId:text(),receiptKind:{const:'jav_correction_workspace_reclaimed'},ownerDomain:{const:'arca'},
    scopeType:{const:'jav_identity_correction'},scopeId:text(),scopeDigest:digest(),effectReceiptRef:text(),committedAtMs:integer(0),correctionId:text(),shelfEntryId:text(),
    committedContextDigest:digest(),commitReceiptDigest:digest(),reclaimPlanDigest:digest(),guardDigest:digest(),handleSetDigest:digest(),reclaimedHandleCount:{const:4},
    reclaimedArtifactCount:{const:3},reclaimedBytes:integer(1),workspaceDisposition:{const:'absent'},realityDigest:digest(),
    executionReference:object({workId:text(),eventId:text(),eventAttemptId:text(),idempotencyKey:text()})})};}
function workspaceReclaimWorkId(scope,record=null){const base='arca-jav-workspace-reclaim-work-'+scope.digest.slice(0,40);
  return record?require('./jav-correction-recovery').recoveryWorkId(record,'jav_correction_workspace_reclaim',base):base;}
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function workspaceReclaimOutcome(result){const execution=result.executionReference,evidence={evidenceId:stable('arca-jav-reclaim-evidence-',{result}),
  evidenceKind:'jav_identity_correction',producerRef:CAPABILITY,basisDigest:result.scopeDigest,payloadDigest:canonicalDigest(result),observedAtMs:result.committedAtMs};
  return {kind:'succeeded',resultSchemaRef:RESULT_SCHEMA,result,evidenceSchemaRef:'helix://contracts/capabilities/arca.jav_correction.workspace.reclaim/v1/evidence',evidence,
    effectReceipt:{schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId:result.effectReceiptRef,
      effectId:canonicalDigest(['workspace_write',execution.idempotencyKey]),effectClass:'workspace_write',idempotencyKey:execution.idempotencyKey,
      commitMarker:stable('arca-jav-reclaim-marker-',{eventId:execution.eventId}),externalReceiptRef:null,outputDigest:canonicalDigest(result),
      verificationEvidenceDigest:canonicalDigest(evidence),committedAtMs:result.committedAtMs}};
}
module.exports=Object.freeze({CAPABILITY,SCOPE_SCHEMA,RESULT_SCHEMA,buildWorkspaceReclaimScope,workspaceReclaimScopeSchema,workspaceReclaimReceiptSchema,workspaceReclaimWorkId,workspaceReclaimOutcome});
