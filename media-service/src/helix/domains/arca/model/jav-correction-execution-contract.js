'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {recoveryWorkId,assertJavCorrectionRecoveryReceipt}=require('./jav-correction-recovery');
const CAPABILITY='arca.jav_correction.assets.prepare@1';
const SCOPE_SCHEMA='helix://contracts/domain-types/JavCorrectionScope/v1';
const RESULT_SCHEMA='helix://contracts/types/JavCorrectionAssetsPrepared/v1';
const SOURCE_CAPABILITY='arca.jav_correction.source.verify@1';
const SOURCE_SCHEMA='helix://contracts/types/JavCorrectionSourceVerified/v1';
const STAGE_CAPABILITY='arca.jav_correction.files.stage@1';
const PUBLISH_CAPABILITY='arca.jav_correction.files.publish@1';
const VERIFY_CAPABILITY='arca.jav_correction.files.verify@1';
function javCorrectionVerifyWorkId(scope,filePlanDigest,record=null) {
  const base='arca-jav-correction-verify-work-'+canonicalDigest({correctionId:scope.correctionId,scopeDigest:scope.digest,filePlanDigest}).slice(0,40);
  return record?recoveryWorkId(record,'jav_correction_verify',base):base;
}
function javCorrectionPublishWorkId(scope,filePlanDigest,record=null) {
  const base='arca-jav-correction-publish-work-'+canonicalDigest({correctionId:scope.correctionId,scopeDigest:scope.digest,filePlanDigest}).slice(0,40);
  return record?recoveryWorkId(record,'jav_correction_publish',base):base;
}
function javCorrectionFilesWorkId(scope,filePlanDigest,record=null) {
  const base='arca-jav-correction-files-work-'+canonicalDigest({correctionId:scope.correctionId,scopeDigest:scope.digest,filePlanDigest}).slice(0,40);
  return record?recoveryWorkId(record,'jav_correction_files',base):base;
}
function javCorrectionAssetsWorkId(scope,record=null) {
  const base='arca-jav-correction-assets-work-'+canonicalDigest({correctionId:scope.correctionId,scopeDigest:scope.digest}).slice(0,40);
  return record?recoveryWorkId(record,'jav_correction_assets',base):base;
}
const text=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
  object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
  integer=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER});
function javCorrectionScopeSchema() {
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCOPE_SCHEMA,title:'JavCorrectionScope@1',
    'x-helix-ssotRefs':['8.6.19'],'x-helix-role':'accepted-business-dto','x-helix-maxCanonicalBytes':4096,
    ...object({schemaRef:{const:SCOPE_SCHEMA},schemaVersion:{const:1},objectId:text(),revision:integer(),objectKind:{const:'jav-correction-scope'},
      correctionId:text(),shelfEntryId:text(),admissionDigest:digest(),basisDigest:digest(),proposalDigest:digest(),expectedStateRevision:integer(),workspaceRootHandleRef:digest(),digest:digest()})};
}
function scopeValue(record,rootHandleRef,executionRevision){
  const body={schemaRef:SCOPE_SCHEMA,schemaVersion:1,objectId:record.correctionId,revision:executionRevision,objectKind:'jav-correction-scope',
    correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,basisDigest:record.proof.basis.basisDigest,
    proposalDigest:record.proof.proposal.proposalDigest,expectedStateRevision:executionRevision,workspaceRootHandleRef:rootHandleRef};
  return Object.freeze({...body,digest:canonicalDigest(body)});
}
function buildJavCorrectionScope(record,rootHandleRef) {
  if(record?.state!=='active'||!record.proof||!/^[a-f0-9]{64}$/.test(rootHandleRef||''))
    throw Object.assign(new TypeError('Correction execution requires its active immutable admission and registered Workspace root.'),{code:'ARCA_JAV_CORRECTION_SCOPE_INVALID'});
  const executionRevision=record.recoveryIntent?assertJavCorrectionRecoveryReceipt(record.recoveryIntent,record).executionRevision:record.stateRevision;
  return scopeValue(record,rootHandleRef,executionRevision);
}
function buildJavCorrectionScopeForRecovery(record,rootHandleRef){
  if(record?.state!=='attention_required'||!record.proof||!/^[a-f0-9]{64}$/.test(rootHandleRef||'')||!record.recoveryIntent&&record.stateRevision!==3)
    throw Object.assign(new TypeError('Recovery observation requires the actual attention state and original execution revision.'),{code:'ARCA_JAV_CORRECTION_SCOPE_INVALID'});
  const executionRevision=record.recoveryIntent?assertJavCorrectionRecoveryReceipt(record.recoveryIntent,record).executionRevision:2;
  return scopeValue(record,rootHandleRef,executionRevision);
}
function javCorrectionAssetsPreparedSchema() {
  const workspace={$ref:'helix://contracts/types/WorkspaceMaterialHandle/v1'},artifact={$ref:'helix://contracts/types/ArtifactHandle/v1'},
    derivation=require('../../../contracts/jav-cover-derivation').javCoverDerivationSchema();
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:RESULT_SCHEMA,title:'JavCorrectionAssetsPrepared@1',
    'x-helix-ssotRefs':['8.6.19'],'x-helix-envelopeRef':'helix://contracts/types/EvidenceEnvelope/v1','x-helix-maxCanonicalBytes':65536,
    ...object({schemaRef:{const:RESULT_SCHEMA},schemaVersion:{const:1},evidenceId:text(),evidenceKind:{const:'jav_correction_assets_prepared'},
      producerRef:{const:CAPABILITY},basisDigest:digest(),payloadDigest:digest(),observedAtMs:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},
      correctionId:text(),admissionDigest:digest(),confirmedProposalDigest:digest(),actualProposalDigest:digest(),sourceObservationDigest:digest(),metadataFactDigest:digest(),
      metadataHandle:workspace,artifacts:{type:'array',minItems:3,maxItems:3,items:object({artifactKind:{enum:['nfo','poster','fanart']},
        workspaceMaterialHandle:workspace,artifactHandle:artifact,coverDerivation:{oneOf:[derivation,{type:'null'}]}})}})};
}
function javCorrectionSourceVerifiedSchema() {
  return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SOURCE_SCHEMA,title:'JavCorrectionSourceVerified@1',
    'x-helix-ssotRefs':['8.6.19'],'x-helix-envelopeRef':'helix://contracts/types/EvidenceEnvelope/v1','x-helix-maxCanonicalBytes':65536,
    ...object({schemaRef:{const:SOURCE_SCHEMA},schemaVersion:{const:1},evidenceId:text(),evidenceKind:{const:'jav_correction_source_verified'},
      producerRef:{const:SOURCE_CAPABILITY},basisDigest:digest(),payloadDigest:digest(),observedAtMs:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},
      correctionId:text(),admissionDigest:digest(),scopeDigest:digest(),confirmedProposalDigest:digest(),actualProposalDigest:digest(),
      byteExpectations:{type:'array',minItems:4,maxItems:4,items:object({kind:{enum:['metadata','nfo','poster','fanart']},byteDigest:digest(),sizeBytes:{type:'integer',minimum:1,maximum:16*1024*1024}})},
      qualification:object({sourceSnapshot:require('../../../contracts/jav-source-contracts').javSourceSelectionSnapshotSchema(),
        sourceOrdinal:{type:'integer',minimum:0,maximum:7},observation:require('../../../contracts/jav-identity-evidence').javQualificationSchema()})})};
}
function sourceValue(record,scope,observation,at,byteExpectations,expectedScope) {
  const fail=()=>{throw Object.assign(new TypeError('Correction source verification must preserve the exact confirmed film, title, cover and active execution scope.'),{code:'ARCA_JAV_CORRECTION_SOURCE_CHANGED'});};
  const original=record?.proof?.proposal?.sourceQualification;
  if(!original||!expectedScope||scope.digest!==expectedScope.digest||
      observation?.resourceKey!==original.observation.resourceKey||observation.resourceUrl!==original.observation.resourceUrl||
      observation.cover?.byteDigest!==original.observation.cover.byteDigest||
      observation.descriptiveEntries?.find(row=>row.key==='title')?.value!==original.observation.descriptiveEntries.find(row=>row.key==='title')?.value)fail();
  const qualification={sourceSnapshot:original.sourceSnapshot,sourceOrdinal:original.sourceOrdinal,observation},
    actual=require('./jav-identity-correction').buildJavCorrectionProposal({basis:record.proof.basis,...qualification});
  if(actual.newIdentity.identityDigest!==record.proof.proposal.newIdentity.identityDigest)fail();
  if(!Array.isArray(byteExpectations)||byteExpectations.length!==4||byteExpectations.map(item=>item.kind).join(',')!=='metadata,nfo,poster,fanart'||
      byteExpectations.some(item=>Object.keys(item).sort().join(',')!=='byteDigest,kind,sizeBytes'||!/^[a-f0-9]{64}$/.test(item.byteDigest)||
        !Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<1||item.sizeBytes>(['metadata','nfo'].includes(item.kind)?128*1024:16*1024*1024)))fail();
  const fields={correctionId:record.correctionId,admissionDigest:record.admissionDigest,scopeDigest:scope.digest,
    confirmedProposalDigest:record.proof.proposal.proposalDigest,actualProposalDigest:actual.proposalDigest,qualification,byteExpectations},payloadDigest=canonicalDigest(fields);
  return Object.freeze({schemaRef:SOURCE_SCHEMA,schemaVersion:1,evidenceId:'arca-jav-source-'+payloadDigest.slice(0,40),evidenceKind:'jav_correction_source_verified',
    producerRef:SOURCE_CAPABILITY,basisDigest:scope.digest,payloadDigest,observedAtMs:at,...fields});
}
function buildJavCorrectionSourceVerified(record,scope,observation,at,byteExpectations){
  return sourceValue(record,scope,observation,at,byteExpectations,buildJavCorrectionScope(record,scope?.workspaceRootHandleRef));
}
function assertJavCorrectionVerifiedSource(record,scope,result) {
  const expected=buildJavCorrectionSourceVerified(record,scope,result?.qualification?.observation,result?.observedAtMs,result?.byteExpectations);
  if(canonicalDigest(expected)!==canonicalDigest(result))throw Object.assign(new TypeError('Correction asset preparation requires the exact frozen source Result.'),{code:'ARCA_JAV_CORRECTION_SOURCE_RESULT_INVALID'});
  return result;
}
function assertJavCorrectionHistoricalSource(record,scope,result){
  const expected=sourceValue(record,scope,result?.qualification?.observation,result?.observedAtMs,result?.byteExpectations,
    buildJavCorrectionScopeForRecovery(record,scope?.workspaceRootHandleRef));
  if(canonicalDigest(expected)!==canonicalDigest(result))throw Object.assign(new TypeError('Recovery observation requires the exact persisted Source Result.'),{code:'ARCA_JAV_CORRECTION_SOURCE_RESULT_INVALID'});
  return result;
}
module.exports=Object.freeze({CAPABILITY,SCOPE_SCHEMA,RESULT_SCHEMA,SOURCE_CAPABILITY,SOURCE_SCHEMA,STAGE_CAPABILITY,PUBLISH_CAPABILITY,VERIFY_CAPABILITY,javCorrectionAssetsWorkId,javCorrectionFilesWorkId,javCorrectionPublishWorkId,javCorrectionVerifyWorkId,javCorrectionScopeSchema,buildJavCorrectionScope,buildJavCorrectionScopeForRecovery,javCorrectionAssetsPreparedSchema,javCorrectionSourceVerifiedSchema,buildJavCorrectionSourceVerified,assertJavCorrectionVerifiedSource,assertJavCorrectionHistoricalSource});
