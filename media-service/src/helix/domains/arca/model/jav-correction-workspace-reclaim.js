'use strict';
const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertJavCorrectionCommittedContext}=require('./jav-correction-committed-context');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionWorkspaceReclaimPlan/v1';
const ROOT_FIELDS=['rootId','rootHandleRef','endpointId','mountScopeId','resolvedRoot','configRevision','snapshotDigest'];
const fail=message=>{throw Object.assign(new TypeError(message),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_INVALID'});};
function buildJavCorrectionWorkspaceReclaimPlan({record,committedContext,prepared,formalRetirementResult,registry,rootSnapshot}) {
  assertJavCorrectionCommittedContext(committedContext,record);
  const filePlan=committedContext.filePlan,root=Object.fromEntries(ROOT_FIELDS.map(key=>[key,rootSnapshot?.[key]])),
    payloadFields=['correctionId','admissionDigest','confirmedProposalDigest','actualProposalDigest','sourceObservationDigest','metadataFactDigest','metadataHandle','artifacts'],
    payload=Object.fromEntries(payloadFields.map(key=>[key,prepared?.[key]])),retired=formalRetirementResult;
  if(!['pending','active','attention_required'].includes(record.cleanupState)||!root.rootId||!root.rootHandleRef||!root.endpointId||!root.mountScopeId||
      typeof root.resolvedRoot!=='string'||!path.isAbsolute(root.resolvedRoot)||!Number.isSafeInteger(root.configRevision)||root.configRevision<1||
      !/^[a-f0-9]{64}$/.test(root.snapshotDigest||'')||
      prepared?.schemaRef!=='helix://contracts/types/JavCorrectionAssetsPrepared/v1'||prepared.correctionId!==record.correctionId||
      prepared.admissionDigest!==record.admissionDigest||prepared.payloadDigest!==canonicalDigest(payload)||prepared.payloadDigest!==filePlan.preparedAssetsPayloadDigest||
      prepared.basisDigest!==filePlan.scopeDigest||retired?.schemaRef!=='helix://contracts/types/JavCorrectionFormalRetirementReceipt/v1'||
      retired.receiptKind!=='jav_correction_formal_retirement'||retired.ownerDomain!=='arca'||retired.scopeType!=='jav_identity_correction'||
      retired.scopeId!==record.correctionId||retired.correctionId!==record.correctionId||retired.shelfEntryId!==record.shelfEntryId||
      retired.committedContextDigest!==committedContext.contextDigest||retired.commitReceiptDigest!==committedContext.receiptDigest||retired.stageDisposition!=='absent'||
      registry?.registryExists!==true||registry.members?.length!==4||registry.artifacts?.length!==3||prepared.artifacts?.length!==3)
    fail('Reclaim requires committed ownership, original prepared bytes, exact root and successful formal retirement provenance.');
  const members=[prepared.metadataHandle,...prepared.artifacts.map(item=>item.workspaceMaterialHandle)].sort((a,b)=>a.relativePath.localeCompare(b.relativePath)),
    artifacts=prepared.artifacts.map(item=>item.artifactHandle).sort((a,b)=>a.artifactKind.localeCompare(b.artifactKind)),
    actualMembers=[...registry.members].sort((a,b)=>a.relativePath.localeCompare(b.relativePath)),actualArtifacts=[...registry.artifacts].sort((a,b)=>a.artifactKind.localeCompare(b.artifactKind));
  if(members.map(item=>item.relativePath).join(',')!=='fanart/fanart.jpg,metadata/metadata.json,nfo/movie.nfo,poster/poster.jpg'||
      artifacts.map(item=>item.artifactKind).join(',')!=='fanart,nfo,poster'||canonicalDigest(members)!==canonicalDigest(actualMembers)||
      canonicalDigest(artifacts)!==canonicalDigest(actualArtifacts))fail('Reclaim must cover the original complete registered set without foreign or missing members.');
  for(const member of members){
    const {fenceDigest,...handleBody}=member,physical=member.physicalIdentity;
    if(member.ownerDomain!=='arca'||member.processId!==record.correctionId||member.workspaceId!==record.correctionId+'-assets'||
        member.rootHandleRef!==root.rootHandleRef||member.endpointId!==root.endpointId||physical.mountScopeId!==root.mountScopeId||
        physical.sizeBytes!==member.sizeBytes||member.digestAlgorithm!=='sha256'||fenceDigest!==canonicalDigest(handleBody)||
        member.materialKey!==canonicalDigest({schema:'physical-material-identity@2',...physical}))fail('Reclaim Handle differs from exact registered correction ownership.');
    if(member.relativePath.startsWith('metadata/'))continue;
    const item=filePlan.members.find(item=>item.source?.workspaceMaterialHandle?.handleId===member.handleId),artifact=artifacts.find(item=>item.artifactKind===member.relativePath.split('/')[0]);
    if(!item||canonicalDigest(item.source.workspaceMaterialHandle)!==canonicalDigest(member)||canonicalDigest(item.source.artifactHandle)!==canonicalDigest(artifact)||
        artifact.ownerDomain!=='arca'||artifact.ownerScope.scopeType!=='jav_identity_correction'||artifact.ownerScope.scopeId!==record.correctionId||
        artifact.storageRef!==path.resolve(root.resolvedRoot,member.workspaceId,...member.relativePath.split('/')).split(path.sep).join('/')||
        artifact.provenanceRef.digest!==record.admissionDigest||artifact.provenanceRef.objectType!=='jav_identity_correction'||artifact.provenanceRef.objectId!==record.correctionId||
        artifact.digestHex!==member.digestHex||artifact.sizeBytes!==member.sizeBytes)fail('Reclaim Artifact must be the exact committed File Plan replacement.');
  }
  const body={schemaRef:SCHEMA,schemaVersion:1,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,
    committedContextDigest:committedContext.contextDigest,commitReceiptDigest:committedContext.receiptDigest,filePlanDigest:filePlan.planDigest,
    assetsPayloadDigest:prepared.payloadDigest,formalRetirementResultDigest:canonicalDigest(retired),root,members,artifacts,
    handleSetDigest:canonicalDigest({members,artifacts})},guardDigest=canonicalDigest(body),value={...body,guardDigest};
  if(Buffer.byteLength(canonicalJson(value))>256*1024)fail('Reclaim Plan exceeds its exact four-member budget.');
  return Object.freeze({...value,planDigest:canonicalDigest(value)});
}
function javCorrectionWorkspaceReclaimSchema(){
  const text=max=>({type:'string',minLength:1,maxLength:max}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
  return object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},correctionId:text(256),shelfEntryId:text(256),admissionDigest:digest(),
    committedContextDigest:digest(),commitReceiptDigest:digest(),filePlanDigest:digest(),assetsPayloadDigest:digest(),formalRetirementResultDigest:digest(),
    root:object({rootId:text(256),rootHandleRef:text(256),endpointId:text(256),mountScopeId:text(256),resolvedRoot:text(4096),configRevision:{type:'integer',minimum:1},snapshotDigest:digest()}),
    members:{type:'array',minItems:4,maxItems:4,items:{$ref:'helix://contracts/types/WorkspaceMaterialHandle/v1'}},
    artifacts:{type:'array',minItems:3,maxItems:3,items:{$ref:'helix://contracts/types/ArtifactHandle/v1'}},handleSetDigest:digest(),guardDigest:digest(),planDigest:digest()});
}
module.exports=Object.freeze({SCHEMA,buildJavCorrectionWorkspaceReclaimPlan,javCorrectionWorkspaceReclaimSchema});
