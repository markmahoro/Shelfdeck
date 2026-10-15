'use strict';

const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {buildJavCorrectionNoEffectObservation}=require('../model/jav-correction-no-effect');

function createJavCorrectionNoEffectReader(options){
  const page=(tableId,columns,fixedKeyColumns,key)=>({kind:'select-filtered-page',tableId,columns,fixedKeyColumns,
    orderBy:[{column:key,direction:'asc'}],maxItems:65,safeIntegers:true});
  const definition=createRepositoryDefinition({repositoryId:'arca_jav_no_effect_read',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    works:page('fx_supporting_works',['work_id','owner_domain','process_type','process_id','work_kind','basis_digest','definition_schema_ref','definition_json','definition_digest','state'],
      ['owner_domain','process_type','process_id'],'work_id'),
    attempts:page('fx_work_attempts',['attempt_id','work_id','ordinal','basis_digest','state','failure_code'],['work_id'],'attempt_id'),
    plans:page('fx_workflow_plans',['plan_id','attempt_id','planner_ref','planner_version','basis_digest','graph_digest','state'],['attempt_id'],'plan_id'),
    nodes:page('fx_plan_nodes',['plan_id','node_id','capability_ref','input_bindings_json','effect_class'],['plan_id'],'node_id'),
    edges:page('fx_plan_edges',['plan_id','from_node_id','to_node_id','dependency_kind'],['plan_id'],'from_node_id'),
    events:page('fx_workflow_events',['event_id','plan_id','node_id','work_id','attempt_id','owner_domain','capability_ref','state','result_id'],['work_id'],'event_id'),
    event_attempts:page('fx_event_attempts',['event_attempt_id','event_id','ordinal','state','outcome_kind','failure_code'],['event_id'],'event_attempt_id'),
    effects:page('fx_effect_journal',['effect_id','event_attempt_id','effect_class','state'],['event_attempt_id'],'effect_id'),
    results:page('fx_event_result_bindings',['event_id','result_id'],['event_id'],'result_id'),
    registries:page('fx_workspace_registry',['workspace_id'],['owner_domain','process_type','process_id'],'workspace_id'),
    materials:page('fx_workspace_materials',['workspace_id','material_handle_id'],['owner_domain','process_id'],'material_handle_id'),
    artifacts:page('fx_artifact_registry',['artifact_handle_id'],['owner_domain','owner_scope_type','owner_scope_id'],'artifact_handle_id'),
  }});
  function observe(repo,record,currentBasisDigest,recoveryHistory){
    const fail=()=>{throw Object.assign(new Error('Correction execution evidence is incomplete or exceeds its observation bound.'),{code:'ARCA_JAV_CORRECTION_NO_EFFECT_UNPROVEN'});};
    const exactly=(rows,count)=>{if(rows.length!==count)fail();return rows;};
    const read=(name,keys)=>{const rows=repo.invoke(name,{...keys,offset:0,limit:65});
      if(rows.length>64)fail();
      return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
        if(typeof value!=='bigint')return [key,value];const number=Number(value);if(!Number.isSafeInteger(number))fail();return [key,number];
      })));},
      works=read('works',{owner_domain:'arca',process_type:'arca_jav_identity_correction',process_id:record.correctionId}),
      attempts=works.flatMap(work=>exactly(read('attempts',{work_id:work.work_id}),1)),
      plans=attempts.flatMap(attempt=>exactly(read('plans',{attempt_id:attempt.attempt_id}),1)),
      events=works.flatMap(work=>exactly(read('events',{work_id:work.work_id}),2)),
      eventAttempts=events.flatMap(event=>read('event_attempts',{event_id:event.event_id}));
    if(eventAttempts.length>256)fail();
    const snapshot={workspaceRootHandleRef:options.rootSnapshot.rootHandleRef,works,attempts,plans,events,eventAttempts,
        nodes:plans.flatMap(plan=>exactly(read('nodes',{plan_id:plan.plan_id}),2)),edges:plans.flatMap(plan=>exactly(read('edges',{plan_id:plan.plan_id}),1)),
        effects:eventAttempts.flatMap(attempt=>read('effects',{event_attempt_id:attempt.event_attempt_id})),
        results:events.flatMap(event=>read('results',{event_id:event.event_id})),
        registries:read('registries',{owner_domain:'arca',process_type:'jav_identity_correction',process_id:record.correctionId}),
        materials:read('materials',{owner_domain:'arca',process_id:record.correctionId}),
        artifacts:read('artifacts',{owner_domain:'arca',owner_scope_type:'jav_identity_correction',owner_scope_id:record.correctionId})};
    return buildJavCorrectionNoEffectObservation({record,currentBasisDigest,snapshot,recoveryHistory});
  }
  return Object.freeze({participant({record,currentBasisDigest,recoveryHistory=()=>[],accept}){
    return {participantId:'arca_jav_no_effect_observation',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[definition],
      execute(context){const observation=observe(context.repository(definition.repositoryId),typeof record==='function'?record():record,
        typeof currentBasisDigest==='function'?currentBasisDigest():currentBasisDigest,typeof recoveryHistory==='function'?recoveryHistory():recoveryHistory);
        if(accept)accept(observation);return observation;}};
  }});
}
module.exports=Object.freeze({createJavCorrectionNoEffectReader});
