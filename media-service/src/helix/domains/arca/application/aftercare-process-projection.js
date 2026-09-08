'use strict';

const {currentActionSummary}=require('../../../foundation/execution/current-action-summary');
const { CAPABILITY_REFS:C } = require('../model/aftercare-contract');
const { CAPABILITY_REFS:A } = require('../model/on-deck-contract');

const WORKS=Object.freeze({
  care_repair_prepare:['repair','处理影片与资料','按本次维护目标生成并验证处理结果。'],
  care_repair_commit:['commit','更新收藏与收尾','提交验证后的结果并处理原位置的文件。'],
  health_assessment:['reassessment','复核收藏健康','重新检查维护后的实际文件与收藏要求。'],
  care_case_closure:['closure','完成维护','依据复检结果记录本次维护结论。'],
  care_deregistration_settlement:['settlement','结束维护与收尾','处理要求变化或执行终止后的责任收尾。'],
});
const LABELS=Object.freeze({
  [C.textRender]:'准备说明书',[C.binaryAcquire]:'取得海报',[C.artifactMaterialize]:'保存资料',
  [C.transcode]:'转码影片',[C.remux]:'重新封装影片',[C.mediaVerify]:'验证处理结果',
  [C.inventoryCommit]:'更新收藏记录',[C.settlement]:'处理原位置文件',
  [C.custody]:'检查文件状态',[C.presentation]:'检查资料文件',[C.conformance]:'检查收藏要求',
  [C.assessmentCommit]:'保存健康检查结果',[C.caseCommit]:'记录维护结论',
  [A.slot]:'准备收藏位置',[A.stage]:'暂存处理结果',[A.stagedVerify]:'验证暂存结果',
  [A.placement]:'切换收藏位置',[A.finalVerify]:'验证正式文件',
});
function state(value){
  return value==='succeeded'?'completed':value==='cancelled'?'cancelled':['failed','timed_out'].includes(value)?'attention':
    ['running','executing','waiting_for_resource','waiting_for_external','waiting_for_approval','ready','admitted'].includes(value)?'running':'pending';
}
function orderedEvents(events,edges){
  const remaining=[...events],result=[],present=new Set(events.map(item=>item.nodeId));
  while(remaining.length){
    const ready=remaining.findIndex(item=>!(edges||[]).some(edge=>edge.toNodeId===item.nodeId&&
      present.has(edge.fromNodeId)&&!result.some(done=>done.nodeId===edge.fromNodeId)));
    if(ready<0)throw new Error('Aftercare durable Plan contains a dependency cycle.');
    result.push(remaining.splice(ready,1)[0]);
  }
  return result;
}
function node(event,atMs){
  const status=event.result?.outcomeKind==='failed'||['failed','timed_out'].includes(event.state)?'failed':event.state==='succeeded'||event.result?.outcomeKind==='succeeded'?'completed':
    ['cancelled','skipped'].includes(event.state)?event.state:state(event.state)==='running'?'running':'pending';
  const label=LABELS[event.capabilityRef]||'执行维护步骤';
  const sample=event.progress,fresh=sample&&Number.isFinite(sample.sampledAtMs)&&atMs-sample.sampledAtMs<=120000;
  const statusText=status==='completed'?'已完成':status==='failed'?'执行失败':status==='cancelled'?'未执行':status==='skipped'?'无需执行':event.state==='waiting_for_resource'?'等待资源':event.state==='waiting_for_external'?'等待外部结果':
    event.state==='waiting_for_approval'?'等待确认':status==='running'&&sample&&!fresh?'等待进度更新':event.state==='executing'?'正在执行':event.state==='ready'?'准备执行':'等待前序步骤';
  const results=[];
  if(event.result){
    const value=event.result.result;
    if(value.assessmentState)results.push({label:'检查结论',value:({healthy:'健康',degraded:'不健康',not_assessable:'暂无法判断'})[value.assessmentState]||'已记录'});
    if(Number.isSafeInteger(value.newInventoryRevision))results.push({label:'收藏版本',value:String(value.newInventoryRevision)});
    if(['passed','failed'].includes(value.result))results.push({label:'验证结论',value:value.result==='passed'?'通过':'未通过'});
  }
  return Object.freeze({nodeId:event.nodeId,label,state:status,statusText,
    description:status==='completed'?'此步骤已完成。':statusText||(status==='failed'?'执行未完成，请查看处理依据。':'按真实计划执行此步骤。'),
    progress:status==='running'&&fresh?sample:null,results:Object.freeze(results),
    technicalDetail:Object.freeze({summary:'本次实际执行的步骤与结果标识。',fields:Object.freeze([
      {label:'步骤标识',value:event.eventId},{label:'执行能力',value:event.capabilityRef},
      ...(event.failure?[{label:'失败原因',value:event.failure.failureCode}]:[]),
      ...(event.result?[{label:'结果校验',value:event.result.resultDigest}]:[]),
    ]),parameters:Object.freeze([])})});
}
function projectAftercareProcess(works,atMs=Date.now()){
  const stages=[];
  for(const work of [...works].sort((a,b)=>a.createdAtMs-b.createdAtMs||a.workId.localeCompare(b.workId))){
    const copy=WORKS[work.workKind];if(!copy)continue;
    const plans=(work.plans||[]).map(plan=>{
      const events=orderedEvents(work.events.filter(event=>event.planId===plan.planId),plan.edges);
      const nodes=events.map(event=>node(event,atMs)),planState=nodes.some(item=>item.state==='running')?'running':
        nodes.some(item=>item.state==='failed')?'attention':work.state==='cancelled'?'cancelled':
          nodes.length&&nodes.every(item=>['completed','skipped'].includes(item.state))?'completed':'pending';
      return Object.freeze({planId:plan.planId,title:copy[1],state:planState,createdAtMs:plan.createdAtMs,
        nodes:Object.freeze(nodes)});
    });
    stages.push(Object.freeze({key:work.workId,label:copy[1],description:copy[2],state:state(work.state),
      summary:work.state==='succeeded'?'已完成':work.state==='cancelled'?'已终止':work.state==='failed'?'需要处理':'执行中',plans:Object.freeze(plans)}));
  }
  const detail={contract:'aftercare_process_actual_plans@1',stages:Object.freeze(stages)};
  return Object.freeze({...detail,currentAction:currentActionSummary(detail)});
}
module.exports=Object.freeze({projectAftercareProcess});
