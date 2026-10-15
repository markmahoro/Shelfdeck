'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionRecoveryIntentReceipt/v1';
const OBSERVATION_SCHEMA='helix://contracts/application-types/ArcaJavCorrectionRecoveryObservation/v1';
const WORK_KINDS=Object.freeze(['jav_correction_assets','jav_correction_files','jav_correction_publish','jav_correction_verify',
  'jav_correction_commit','jav_correction_formal_retirement','jav_correction_workspace_reclaim']);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),text=value=>typeof value==='string'&&value.length>0&&value.length<=256,
  integer=value=>Number.isSafeInteger(value)&&value>=1;
const fail=()=>{throw Object.assign(new TypeError('Correction recovery requires the exact failed execution, immutable scope and current user Intent.'),
  {code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'});};
function recoveryMode(record){
  if(record?.state==='attention_required'&&record.cleanupState===null)return 'continue_correction';
  if(record?.state==='committed'&&record.cleanupState==='attention_required')return 'continue_cleanup';
  return null;
}
function assertJavCorrectionRecoveryReceipt(value,record){
  const {receiptDigest,...body}=value||{};
  if(value?.schemaRef!==SCHEMA||value.schemaVersion!==1||!hex(receiptDigest)||canonicalDigest(body)!==receiptDigest||
      value.correctionId!==record?.correctionId||value.shelfEntryId!==record.shelfEntryId||value.admissionDigest!==record.admissionDigest||
      !integer(value.executionRevision)||value.executionRevision<2||!integer(value.acceptedStateRevision)||value.acceptedStateRevision>record.stateRevision||
      !integer(value.expectedStateRevision)||value.acceptedStateRevision!==value.expectedStateRevision+(value.mode==='continue_correction'?1:0)||
      value.mode==='continue_cleanup'&&record.state!=='committed'||record.state==='admitted'||
      record.state==='active'&&(value.mode!=='continue_correction'||record.stateRevision!==value.acceptedStateRevision)||
      !Array.isArray(value.workLineage)||value.workLineage.length<1||value.workLineage.length>WORK_KINDS.length||
      new Set(value.workLineage.map(item=>item.workKind)).size!==value.workLineage.length||
      value.workLineage.some(item=>!WORK_KINDS.includes(item.workKind)||![item.baseWorkId,item.workId,item.previousWorkId].every(text))||
      Buffer.byteLength(canonicalJson(value))>16384)fail();
  return value;
}
function buildJavCorrectionRecoveryReceipt({record,command,observation,admittedAtMs}){
  const mode=recoveryMode(record),previous=record?.recoveryIntent?assertJavCorrectionRecoveryReceipt(record.recoveryIntent,record):null,
    previousDigest=previous?.receiptDigest||null,failed=observation?.failedWork;
  if(!mode||!command||Object.keys(command).sort().join(',')!==['actorId','correctionId','expectedAdmissionDigest','expectedCleanupState','expectedRecoveryIntentDigest','expectedStateRevision','idempotencyKey','shelfEntryId'].sort().join(',')||
      !text(command.actorId)||!text(command.idempotencyKey)||command.correctionId!==record.correctionId||command.shelfEntryId!==record.shelfEntryId||
      command.expectedStateRevision!==record.stateRevision||command.expectedAdmissionDigest!==record.admissionDigest||
      command.expectedCleanupState!==record.cleanupState||command.expectedRecoveryIntentDigest!==previousDigest||
      !Number.isSafeInteger(admittedAtMs)||admittedAtMs<record.updatedAtMs)fail();
  const {observationDigest,...observationBody}=observation||{};
  if(!hex(observationDigest)||canonicalDigest(observationBody)!==observationDigest||observation.schema!=='arca.jav-correction-recovery-observation@1'||
      observation.correctionId!==record.correctionId||observation.admissionDigest!==record.admissionDigest||observation.stateRevision!==record.stateRevision||
      observation.updatedAtMs!==record.updatedAtMs||observation.previousIntentDigest!==previousDigest||observation.realityClassification!=='matching'||
      !observation.realityObservation||canonicalDigest(observation.realityObservation)!==observation.realityDigest||
      observation.realityObservation.correctionId!==record.correctionId||observation.realityObservation.phase!==failed?.workKind||
      observation.realityObservation.classification!=='matching'||!Array.isArray(observation.realityObservation.files)||observation.realityObservation.files.some(file=>file.status==='conflict')||
      observation.realityObservation.observedAtMs>admittedAtMs||
      !observation.executionSnapshot||!hex(observation.realityDigest)||!hex(observation.scopeDigest)||!integer(observation.executionRevision)||observation.executionRevision<2||
      previous&&observation.executionRevision!==previous.executionRevision||
      failed?.ownerDomain!=='arca'||failed.processType!=='arca_jav_identity_correction'||failed.processId!==record.correctionId||failed.state!=='failed'||
      failed.hasUnresolvedEffects!==false||!WORK_KINDS.includes(failed.workKind)||!text(failed.workId)||!text(failed.baseWorkId)||
      !hex(failed.definitionDigest)||!hex(failed.executionEvidenceDigest)||failed.basisDigest!==observation.scopeDigest||
      mode==='continue_cleanup'&&!['jav_correction_formal_retirement','jav_correction_workspace_reclaim'].includes(failed.workKind)||
      mode==='continue_correction'&&['jav_correction_formal_retirement','jav_correction_workspace_reclaim'].includes(failed.workKind)||
      observation.filePlanDigest!==null&&!hex(observation.filePlanDigest))fail();
  const predecessor=previous?.workLineage.find(item=>item.workKind===failed.workKind);
  if(failed.workId!==(predecessor?.workId||failed.baseWorkId)||predecessor&&predecessor.baseWorkId!==failed.baseWorkId)fail();
  const source=observation.sourceResultReference;
  if(source!==null&&(!source||Object.keys(source).sort().join(',')!=='eventId,resultDigest,workId'||![source.workId,source.eventId].every(text)||!hex(source.resultDigest)))fail();
  if(previous?.sourceResultReference&&canonicalDigest(previous.sourceResultReference)!==canonicalDigest(source)||
      previous?.filePlanDigest&&observation.filePlanDigest!==previous.filePlanDigest)fail();
  const recoveryId='arca-jav-recovery-'+canonicalDigest({correctionId:record.correctionId,actorId:command.actorId,idempotencyKey:command.idempotencyKey}).slice(0,40),
    replacement={workKind:failed.workKind,baseWorkId:failed.baseWorkId,previousWorkId:failed.workId,
      workId:'arca-jav-recovery-work-'+canonicalDigest({recoveryId,workKind:failed.workKind,previousWorkId:failed.workId}).slice(0,40)},
    workLineage=[...(previous?.workLineage||[]).filter(item=>item.workKind!==failed.workKind),replacement]
      .sort((a,b)=>WORK_KINDS.indexOf(a.workKind)-WORK_KINDS.indexOf(b.workKind)),
    body={schemaRef:SCHEMA,schemaVersion:1,recoveryId,correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,
      actorId:command.actorId,mode,expectedStateRevision:record.stateRevision,acceptedStateRevision:record.stateRevision+(mode==='continue_correction'?1:0),
      expectedCleanupState:record.cleanupState,previousIntentDigest:previousDigest,executionRevision:observation.executionRevision,
      scopeDigest:observation.scopeDigest,filePlanDigest:observation.filePlanDigest,observationDigest,realityDigest:observation.realityDigest,
      failedWorkId:failed.workId,failedWorkDefinitionDigest:failed.definitionDigest,failedExecutionEvidenceDigest:failed.executionEvidenceDigest,
      sourceResultReference:source,workLineage,admittedAtMs};
  return Object.freeze({...body,receiptDigest:canonicalDigest(body)});
}
function recoveryWorkId(record,kind,baseWorkId){
  if(!record.recoveryIntent)return baseWorkId;
  const receipt=assertJavCorrectionRecoveryReceipt(record.recoveryIntent,record),item=receipt.workLineage.find(value=>value.workKind===kind);
  if(!item)return baseWorkId;
  if(item.baseWorkId!==baseWorkId)fail();return item.workId;
}
function executionRevisionForRow(row,validator){
  if(!row||row.state!=='active'||row.terminal_at_ms!==null)fail();
  if(row.recovery_intent_json===null){
    if(row.recovery_intent_schema_ref!==null||row.recovery_intent_digest!==null||Number(row.state_revision)!==2)fail();return 2;
  }
  let receipt;try{receipt=JSON.parse(row.recovery_intent_json);}catch{fail();}
  validator.validate(SCHEMA,receipt);
  assertJavCorrectionRecoveryReceipt(receipt,{correctionId:row.correction_id,shelfEntryId:row.shelf_entry_id,admissionDigest:row.admission_digest,state:row.state,stateRevision:Number(row.state_revision)});
  if(receipt.mode!=='continue_correction'||receipt.acceptedStateRevision!==Number(row.state_revision)||row.recovery_intent_schema_ref!==SCHEMA||
      row.recovery_intent_digest!==receipt.receiptDigest||canonicalJson(receipt)!==row.recovery_intent_json)fail();return receipt.executionRevision;
}
function javCorrectionRecoveryReceiptSchema(){
  const str=()=>({type:'string',minLength:1,maxLength:256}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),int=()=>({type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}),
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),nullable=schema=>({oneOf:[schema,{type:'null'}]});
  return object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},recoveryId:str(),correctionId:str(),shelfEntryId:str(),admissionDigest:digest(),actorId:str(),
    mode:{enum:['continue_correction','continue_cleanup']},expectedStateRevision:int(),acceptedStateRevision:int(),expectedCleanupState:nullable({const:'attention_required'}),
    previousIntentDigest:nullable(digest()),executionRevision:{type:'integer',minimum:2,maximum:Number.MAX_SAFE_INTEGER},scopeDigest:digest(),filePlanDigest:nullable(digest()),
    observationDigest:digest(),realityDigest:digest(),failedWorkId:str(),failedWorkDefinitionDigest:digest(),failedExecutionEvidenceDigest:digest(),
    sourceResultReference:nullable(object({workId:str(),eventId:str(),resultDigest:digest()})),
    workLineage:{type:'array',minItems:1,maxItems:7,items:object({workKind:{enum:WORK_KINDS},baseWorkId:str(),workId:str(),previousWorkId:str()})},
    admittedAtMs:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},receiptDigest:digest()});
}
function javCorrectionRecoveryObservationSchema(){
  const str=(maxLength=256)=>({type:'string',minLength:1,maxLength}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    int=()=>({type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER}),nullable=schema=>({oneOf:[schema,{type:'null'}]}),
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),array=(items,maxItems)=>({type:'array',maxItems,items});
  const row=fields=>object(Object.fromEntries(fields.split(' ').map(key=>[key,
    ['ordinal','planner_version','size_bytes','reference_revision'].includes(key)?int():['failure_code','result_id'].includes(key)?nullable(str()):
      key.endsWith('_json')?str(65536):key.endsWith('_digest')?digest():str()])));
  const executionSnapshot=object({
    works:array(row('work_id owner_domain process_type process_id work_kind basis_digest definition_schema_ref definition_json definition_digest state'),64),
    attempts:array(row('attempt_id work_id ordinal basis_digest state failure_code'),64),
    plans:array(row('plan_id attempt_id planner_ref planner_version basis_digest graph_digest state'),64),
    nodes:array(row('plan_id node_id capability_ref input_bindings_json effect_class'),128),
    events:array(row('event_id plan_id node_id work_id attempt_id owner_domain capability_ref state result_id'),128),
    eventAttempts:array(row('event_attempt_id event_id ordinal state outcome_kind failure_code'),256),
    effects:array(row('effect_id event_attempt_id effect_class state'),256),
    results:array(row('event_id result_id outcome_kind result_schema_ref result_digest'),128),
    registries:array(row('workspace_id owner_domain process_type process_id root_handle_ref state'),1),
    materials:array(row('workspace_id material_handle_id handle_digest fence_digest state'),4),
    artifacts:array(row('artifact_handle_id artifact_kind digest_hex size_bytes reference_revision state'),3),
  });
  const physical=nullable(object({device:str(),inode:str(),sizeBytes:int(),modifiedAtNs:str(),changedAtNs:str(),contentFingerprint:nullable(digest())}));
  const realityObservation=object({schema:{const:'arca.jav-correction-recovery-reality@1'},correctionId:str(),phase:{enum:WORK_KINDS},observedAtMs:int(),
    classification:{enum:['matching','conflict']},files:array(object({role:str(),ordinal:int(),location:str(4096),exists:{type:'boolean'},
      kind:{enum:['file','directory','absent','symlink','other']},physical,expectedDigest:nullable(digest()),status:{enum:['matching','absent','conflict']}}),32),
    directories:array(object({location:str(4096),exists:{type:'boolean'},memberNames:array(str(4096),2048),memberSetDigest:digest()}),32)});
  return object({schema:{const:'arca.jav-correction-recovery-observation@1'},correctionId:str(),admissionDigest:digest(),stateRevision:int(),updatedAtMs:int(),
    previousIntentDigest:nullable(digest()),scopeDigest:digest(),executionRevision:{type:'integer',minimum:2,maximum:Number.MAX_SAFE_INTEGER},filePlanDigest:nullable(digest()),
    sourceResultReference:nullable(object({workId:str(),eventId:str(),resultDigest:digest()})),realityClassification:{const:'matching'},realityDigest:digest(),realityObservation,
    failedWork:object({ownerDomain:{const:'arca'},processType:{const:'arca_jav_identity_correction'},processId:str(),state:{const:'failed'},hasUnresolvedEffects:{const:false},
      workKind:{enum:WORK_KINDS},baseWorkId:str(),workId:str(),definitionDigest:digest(),executionEvidenceDigest:digest(),basisDigest:digest()}),executionSnapshot,observationDigest:digest()});
}
module.exports=Object.freeze({SCHEMA,OBSERVATION_SCHEMA,WORK_KINDS,recoveryMode,buildJavCorrectionRecoveryReceipt,assertJavCorrectionRecoveryReceipt,recoveryWorkId,executionRevisionForRow,javCorrectionRecoveryReceiptSchema,javCorrectionRecoveryObservationSchema});
