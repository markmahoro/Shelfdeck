'use strict';

const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createPreparationWorkRecovery,KINDS}=require('./preparation-work-recovery');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const phases={libra_intake:'接收材料',libra_routing:'确定收藏去向',libra_acceptance_spec:'准备整理要求'};

function createPreparationRecoveryAdmin(options){
  const reader=options.workResultReader,recovery=createPreparationWorkRecovery(options);
  const kinds=Object.entries(KINDS).flatMap(([processType,items])=>items.map(workKind=>({processType,workKind})));
  const repository=createRepositoryDefinition({repositoryId:'libra_preparation_recovery_subjects',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    subject:{kind:'select-one',tableId:'libra_subjects',columns:['status'],keyColumns:['subject_id']},
    projection:{kind:'select-one',tableId:'libra_formation_projections',columns:['display_identity'],keyColumns:['subject_id']},
    runs:{kind:'select-all',tableId:'libra_runs',columns:['libra_run_id'],keyColumns:['subject_id']},
  }});
  function subject(subjectId){return options.unitOfWork.execute([{participantId:'libra_preparation_recovery_subject',owner:'libra',repositories:[repository],execute(context){
    const repo=context.repository(repository.repositoryId);return {subject:repo.invoke('subject',{subject_id:subjectId}),
      projection:repo.invoke('projection',{subject_id:subjectId}),runs:repo.invoke('runs',{subject_id:subjectId})};
  }}]).libra_preparation_recovery_subject;}
  function active(definition){
    if(definition.processType==='libra_intake')return !options.intakeStore.getReceipt(definition.processId)&&Boolean(options.offerReader.read(definition.processId));
    const state=subject(definition.processId);
    return state.subject?.status==='active'&&!state.runs.length&&!options.taskCancellations.get(definition.processId);
  }
  function processFailure(processType,processId){
    for(const workKind of KINDS[processType]){
      const rows=reader.listWorks({ownerDomain:'libra',processType,processId,workKind});
      const latest=[...rows].sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms)||b.work_id.localeCompare(a.work_id))[0];
      if(!latest)continue;
      const definition=reader.readDefinition(latest.work_id)?.definition;
      const current=definition&&recovery.current(definition);
      if(current&&reader.status(current.workId)?.state==='failed')return Object.freeze({workId:current.workId,
        phase:phases[processType],failureCode:reader.status(current.workId)?.latestAttempt?.failure_code||'PREPARATION_FAILED'});
    }
    return null;
  }
  function readSubject(subjectId){
    const state=subject(subjectId);
    if(state.subject?.status!=='active'||state.runs.length||options.taskCancellations.get(subjectId))return null;
    return processFailure('libra_routing',subjectId)||processFailure('libra_acceptance_spec',subjectId);
  }
  function readIntakeTasks(){
    // Only current occupied seats are read; historical failures are not scanned.
    return options.pipelineAdmission.listTokens().flatMap(token=>{
      if(options.intakeStore.getReceipt(token.processId))return [];
      const source=options.offerReader.read(token.processId);if(!source)return [];
      const failure=processFailure('libra_intake',token.processId);
      const pkg=source.snapshot.candidatePackage;
      return [Object.freeze({kind:'intake',formationViewId:token.subjectId,
        displayIdentity:pkg.displayIdentity||pkg.identityClaim?.claimedDisplayIdentity||'待接收的媒体',
        classification:failure?'attention_required':'in_progress',targetShelfId:null,
        addedAtMs:token.acquiredAtMs,label:failure?'接收材料失败':'正在接收材料',
        retryWorkId:failure?.workId||null,failureCode:failure?.failureCode||null})];
    });
  }
  function list({cursor=null}={}){
    let [index,key]=cursor?String(cursor).split('|'):[0,null];index=Number(index);
    if(!Number.isInteger(index)||index<0||index>=kinds.length||key?.length>256)fail('LIBRA_PREPARATION_CURSOR','Invalid preparation cursor.');
    const items=[];let visited=0;
    while(index<kinds.length&&visited<100){
      const scope=kinds[index],budget=100-visited,page=reader.listOwnerWorksPage({ownerDomain:'libra',workKind:scope.workKind,state:'failed'},key||null,budget);
      for(const row of page){visited++;key=row.work_id;
        const def=reader.readDefinition(row.work_id)?.definition;
        if(!def||def.processType!==scope.processType||recovery.current(def).workId!==row.work_id||!active(def))continue;
        const siblings=reader.listWorks({ownerDomain:'libra',processType:def.processType,processId:def.processId,workKind:def.workKind});
        const created=Number(siblings.find(item=>item.work_id===row.work_id)?.created_at_ms||0);
        const newer=siblings.filter(item=>item.work_id!==row.work_id&&Number(item.created_at_ms)>created);
        if(newer.length)continue;
        const source=def.processType==='libra_intake'?options.offerReader.read(def.processId):null;
        const member=source?.snapshot?.primaryInputManifest?.members?.[0];
        const location=member?.location?.location||member?.fieldRelativeLocation||null;
        const title=source?(location?String(location).split(/[\\/]/).at(-1):'来源文件（等待读取资料）'):
          subject(def.processId).projection?.display_identity||'待准备的媒体';
        items.push({workId:row.work_id,subjectId:def.processType==='libra_intake'?null:def.processId,title,
          phase:phases[def.processType],failureCode:reader.status(row.work_id)?.latestAttempt?.failure_code||'PREPARATION_FAILED'});
      }
      if(page.length<budget){index++;key=null;}
    }
    return {items,nextCursor:index<kinds.length?index+'|'+(key||''):null};
  }
  function retry(workId){
    const def=reader.readDefinition(workId)?.definition;
    if(!def||def.ownerDomain!=='libra'||!KINDS[def.processType]?.includes(def.workKind)||!active(def))
      fail('LIBRA_PREPARATION_RETRY_STATE','Preparation is no longer eligible for recovery.');
    const coordinator={libra_intake:options.intakeCoordinator,libra_routing:options.routingCoordinator,libra_acceptance_spec:options.acceptanceSpecCoordinator}[def.processType];
    const current=coordinator.reconcile(def.processId);
    if(current.kind!=='preparation_failed'||current.workId!==workId){
      if(recovery.current(def).workId!==workId)return {kind:'already_retried',workId:recovery.current(def).workId};
      fail('LIBRA_PREPARATION_RETRY_STALE','Preparation changed; refresh before retrying.');
    }
    return recovery.retry(workId);
  }
  return Object.freeze({list,retry,readSubject,readIntakeTasks});
}
module.exports=Object.freeze({createPreparationRecoveryAdmin});
