'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {deliveryScopeStatements}=require('../persistence/series-delivery-scope-reader');
const ATTENTION=new Set(['waiting_product_identity','waiting_external_integration','frozen','freeze','awaiting_defect_decision',
 'suspended','suspend','recovery_reassessed','evidence_pending','work_cancelled','integrity_rejected','product_unachievable']);
const SPACE_CHECK_INTERVAL_MS=60_000,SPACE_CHECK_THRESHOLD=3;

function createAttentionWorkshop(options){
 const repository=createRepositoryDefinition({repositoryId:'libra_attention_workshop',owner:'libra',schemaManifest:options.schemaManifest,statements:{
  ...deliveryScopeStatements,
  run:{kind:'select-one',tableId:'libra_runs',columns:['subject_id','state'],keyColumns:['libra_run_id']},
  subject:{kind:'select-one',tableId:'libra_subjects',columns:['subject_id','status','intake_revision','current_identity_revision'],keyColumns:['subject_id']},
  token:{kind:'select-one',tableId:'libra_predeck_pipeline_tokens',columns:['source_field_id','source_process_id'],keyColumns:['subject_id']},
  head:{kind:'select-one',tableId:'libra_subject_decision_heads',columns:['head_revision','head_digest'],keyColumns:['subject_id']},
  policy:{kind:'select-one',tableId:'libra_field_routing_heads',columns:['current_routing_policy_id','current_policy_revision'],keyColumns:['field_id']},
  runs:{kind:'select-all',tableId:'libra_runs',columns:['libra_run_id','state','state_revision','state_digest','run_material_manifest_id'],keyColumns:['subject_id']},
  bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:['material_key','binding_revision','authority_kind','current'],keyColumns:['subject_id']},
  selection:{kind:'select-filtered-page',tableId:'libra_product_identity_selection_intents',columns:['intent_revision','intent_digest'],
    fixedKeyColumns:['libra_run_id'],orderBy:[{column:'intent_revision',direction:'desc'}],maxItems:1},
 }});
 const observations=new Map();
 function read(repo,subjectId){
  const subject=repo.invoke('subject',{subject_id:subjectId}),token=repo.invoke('token',{subject_id:subjectId});
  if(!subject||subject.status!=='active'||!token)return null;
  const runs=repo.invoke('runs',{subject_id:subjectId}).sort((a,b)=>a.libra_run_id.localeCompare(b.libra_run_id));
  const scopes=runs.map(run=>({runId:run.libra_run_id,accepted:repo.invoke('scope_packages',{libra_run_id:run.libra_run_id}).some(pkg=>repo.invoke('scope_receipt',{offer_id:pkg.offer_id})?.result==='accepted')}));
  const unfinished=runs.filter(run=>!['completed','discarded','superseded'].includes(run.state)&&!scopes.find(scope=>scope.runId===run.libra_run_id)?.accepted);
  const bindings=repo.invoke('bindings',{subject_id:subjectId}).filter(row=>Number(row.current)===1&&row.authority_kind==='primary_control')
   .sort((a,b)=>a.material_key.localeCompare(b.material_key));
  const assigned=new Set(runs.flatMap(run=>repo.invoke('scope_members',{run_material_manifest_id:run.run_material_manifest_id}).map(row=>row.material_key)));
  const pendingResponsibility=unfinished.length>0&&bindings.some(row=>!assigned.has(row.material_key));
  const facts={subject,token,head:repo.invoke('head',{subject_id:subjectId})||null,policy:repo.invoke('policy',{field_id:token.source_field_id})||null,runs,
   selections:unfinished.map(run=>repo.invoke('selection',{libra_run_id:run.libra_run_id,offset:0,limit:1})[0]||null),
   accepted:scopes.filter(scope=>scope.accepted).map(scope=>scope.runId).sort(),bindings};
  return {subjectId,digest:canonicalDigest(facts),sourceProcessId:token.source_process_id,
   runIds:unfinished.map(row=>row.libra_run_id),hasRuns:unfinished.length>0,pendingResponsibility};
 }
 function capture(subjectId){return options.unitOfWork.execute([{participantId:'libra_attention_capture',owner:'libra',repositories:[repository],
  execute:context=>read(context.repository(repository.repositoryId),subjectId)}]).libra_attention_capture;}
 function scopeForRun(runId){return options.unitOfWork.execute([{participantId:'libra_attention_subject',owner:'libra',repositories:[repository],
  execute:context=>context.repository(repository.repositoryId).invoke('run',{libra_run_id:runId})||null}]).libra_attention_subject;}
 function transfer(snapshot){
  if(!snapshot||snapshot.pendingResponsibility||options.pipelineAdmission.readSecondaryPolicy().free===0)return;
  const keys=snapshot.runIds.length?snapshot.runIds:[snapshot.subjectId];
  if(!keys.every(key=>{const observation=observations.get(key);return observation?.eligible&&observation.digest===snapshot.digest;}))return;
  const scopes=[...snapshot.runIds.map(processId=>({ownerDomain:'libra',processType:'libra_run',processId})),
   {ownerDomain:'libra',processType:'libra_intake',processId:snapshot.sourceProcessId},
   ...['libra_routing','libra_acceptance_spec'].map(processType=>({ownerDomain:'libra',processType,processId:snapshot.subjectId}))];
  let executionSafe=false;
  const executionRead=options.workResultReader.createExecutionStateReadParticipant(scopes,summaries=>{
   executionSafe=summaries.every(summary=>!summary.hasOpenWork&&!summary.hasOpenEvent&&!summary.hasUnsettledEffect);
  });
  const result=options.pipelineAdmission.transferToSecondary(snapshot.subjectId,{
   participantId:'libra_attention_transfer_proof',owner:'libra',repositories:[repository],execute(context){
    const current=read(context.repository(repository.repositoryId),snapshot.subjectId);
    return {subjectId:snapshot.subjectId,eligible:executionSafe&&!current?.pendingResponsibility&&current?.digest===snapshot.digest,
     readinessDigest:snapshot.digest};
   }},[executionRead]);
  if(result.transferred&&!result.replayed)options.onTransferred?.(snapshot.subjectId);
 }
 function observe(key,subjectId,attention,noRunOnly=false,spaceWait=false){
  if(!attention){observations.delete(key);return;}
  if(!spaceWait&&options.pipelineAdmission.readSecondaryPolicy().free===0)return;
  if(options.pipelineAdmission.listSecondaryPlacements().some(row=>row.subjectId===subjectId))return;
  const snapshot=capture(subjectId);
  if(!snapshot||(noRunOnly&&snapshot.hasRuns)){observations.delete(key);return;}
  const previous=observations.get(key),now=(options.now||Date.now)();
  let observation={digest:snapshot.digest,eligible:true};
  if(spaceWait){
   const stable=previous?.digest===snapshot.digest&&previous.spaceChecks;
   const due=stable&&now-previous.lastSpaceCheckAtMs>=SPACE_CHECK_INTERVAL_MS;
   const spaceChecks=stable?Math.min(SPACE_CHECK_THRESHOLD,previous.spaceChecks+(due?1:0)):1;
   observation={digest:snapshot.digest,eligible:spaceChecks>=SPACE_CHECK_THRESHOLD,spaceChecks,
    lastSpaceCheckAtMs:!stable||due?now:previous.lastSpaceCheckAtMs};
  }
  observations.set(key,observation);
  // Re-observe stable Owner readiness on a later reconciliation before moving.
  // The final transaction still checks this complete current fingerprint.
  if(previous?.digest===snapshot.digest&&observation.eligible)transfer(snapshot);
  else if(previous?.digest!==snapshot.digest)options.onReadinessObserved?.({kind:noRunOnly?'routing':'run'});
 }
 return Object.freeze({
  reconcileRun(runId,operation){
   const result=operation();
   // Only repeated Workspace admission failures qualify; encoder/volume waits do not.
   const spaceWait=result.kind==='waiting_for_resource'&&result.phase==='workspace_admission'&&result.reasonCode==='insufficient_space';
   const attention=ATTENTION.has(result.kind)||(result.kind==='terminal'&&['suspended','frozen'].includes(result.state));
   if(spaceWait||attention||result.kind==='not_due'){
    const scope=scopeForRun(runId);
    if(scope&&(spaceWait||attention||scope.state==='suspended'))observe(runId,scope.subject_id,true,false,spaceWait);
    else observations.delete(runId);
   }else observations.delete(runId);
   return result;
  },
  reconcileRouting(subjectId,operation){
   const result=operation();
   observe(subjectId,subjectId,result.kind==='unresolved'||result.decision?.result==='unresolved',true);
   return result;
  },
 });
}
module.exports=Object.freeze({createAttentionWorkshop});
