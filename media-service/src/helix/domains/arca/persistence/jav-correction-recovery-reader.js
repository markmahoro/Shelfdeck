'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {WORK_KINDS}=require('../model/jav-correction-recovery');
const fail=()=>{throw Object.assign(new Error('Correction recovery execution history is incomplete, unresolved or outside its bounded scope.'),
  {code:'ARCA_JAV_CORRECTION_RECOVERY_EXECUTION_UNPROVEN'});};
function createJavCorrectionRecoveryReader(options){
  const page=(tableId,columns,fixedKeyColumns,key)=>({kind:'select-filtered-page',tableId,columns,fixedKeyColumns,
    orderBy:[{column:key,direction:'asc'}],maxItems:65,safeIntegers:true});
  const definition=createRepositoryDefinition({repositoryId:'arca_jav_recovery_execution_read',owner:'execution-foundation',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{
      works:page('fx_supporting_works',['work_id','owner_domain','process_type','process_id','work_kind','basis_digest','definition_schema_ref','definition_json','definition_digest','state'],
        ['owner_domain','process_type','process_id'],'work_id'),
      attempts:page('fx_work_attempts',['attempt_id','work_id','ordinal','basis_digest','state','failure_code'],['work_id'],'attempt_id'),
      plans:page('fx_workflow_plans',['plan_id','attempt_id','planner_ref','planner_version','basis_digest','graph_digest','state'],['attempt_id'],'plan_id'),
      nodes:page('fx_plan_nodes',['plan_id','node_id','capability_ref','input_bindings_json','effect_class'],['plan_id'],'node_id'),
      events:page('fx_workflow_events',['event_id','plan_id','node_id','work_id','attempt_id','owner_domain','capability_ref','state','result_id'],['work_id'],'event_id'),
      event_attempts:page('fx_event_attempts',['event_attempt_id','event_id','ordinal','state','outcome_kind','failure_code'],['event_id'],'event_attempt_id'),
      effects:page('fx_effect_journal',['effect_id','event_attempt_id','effect_class','state'],['event_attempt_id'],'effect_id'),
      results:page('fx_event_result_bindings',['event_id','result_id','outcome_kind','result_schema_ref','result_digest'],['event_id'],'result_id'),
      source_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['event_id','outcome_kind','result_schema_ref','result_json','result_digest'],keyColumns:['event_id']},
      registries:page('fx_workspace_registry',['workspace_id','owner_domain','process_type','process_id','root_handle_ref','state'],['owner_domain','process_type','process_id'],'workspace_id'),
      materials:page('fx_workspace_materials',['workspace_id','material_handle_id','handle_digest','fence_digest','state'],['owner_domain','process_id'],'material_handle_id'),
      artifacts:page('fx_artifact_registry',['artifact_handle_id','artifact_kind','digest_hex','size_bytes','reference_revision','state'],['owner_domain','owner_scope_type','owner_scope_id'],'artifact_handle_id'),
    }});
  function collect(repo,record){
    const read=(name,keys)=>{const rows=repo.invoke(name,{...keys,offset:0,limit:65});if(rows.length>64)fail();
      return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
        if(typeof value!=='bigint')return [key,value];const number=Number(value);if(!Number.isSafeInteger(number))fail();return [key,number];
      })));},
      works=read('works',{owner_domain:'arca',process_type:'arca_jav_identity_correction',process_id:record.correctionId});
    if(!works.length||works.some(work=>!WORK_KINDS.includes(work.work_kind)||!['succeeded','failed','cancelled'].includes(work.state)))fail();
    const definitions=new Map();
    for(const work of works){let value;try{value=JSON.parse(work.definition_json);}catch{fail();}
      if(work.definition_schema_ref!=='helix://foundation/types/SupportingWorkDefinition/v1'||canonicalJson(value)!==work.definition_json||canonicalDigest(value)!==work.definition_digest||
          value.workId!==work.work_id||value.ownerDomain!=='arca'||value.processType!=='arca_jav_identity_correction'||value.processId!==record.correctionId||
          value.workKind!==work.work_kind||value.executionBasisDigest!==work.basis_digest)fail();
      definitions.set(work.work_id,value);
    }
    const attempts=works.flatMap(work=>read('attempts',{work_id:work.work_id}));
    if(attempts.length>64||attempts.some(item=>!['succeeded','failed','cancelled'].includes(item.state)))fail();
    const plans=attempts.flatMap(attempt=>read('plans',{attempt_id:attempt.attempt_id})),events=works.flatMap(work=>read('events',{work_id:work.work_id}));
    if(plans.length>64||events.length>128||events.some(item=>item.owner_domain!=='arca'||!['succeeded','failed','cancelled','skipped'].includes(item.state)))fail();
    const eventAttempts=events.flatMap(event=>read('event_attempts',{event_id:event.event_id}));
    if(eventAttempts.length>256||eventAttempts.some(item=>item.state!=='completed'))fail();
    const effects=eventAttempts.flatMap(attempt=>read('effects',{event_attempt_id:attempt.event_attempt_id}));
    if(effects.length>256||effects.some(item=>!['committed','failed'].includes(item.state)))fail();
    const results=events.flatMap(event=>read('results',{event_id:event.event_id})),nodes=plans.flatMap(plan=>read('nodes',{plan_id:plan.plan_id}));
    if(results.length>128||nodes.length>128)fail();
    const registries=read('registries',{owner_domain:'arca',process_type:'jav_identity_correction',process_id:record.correctionId}),
      materials=read('materials',{owner_domain:'arca',process_id:record.correctionId}),
      artifacts=read('artifacts',{owner_domain:'arca',owner_scope_type:'jav_identity_correction',owner_scope_id:record.correctionId});
    if(registries.length>1||materials.length>4||artifacts.length>3||!registries.length&&(materials.length||artifacts.length))fail();
    const snapshot={works,attempts,plans,nodes,events,eventAttempts,effects,results,registries,materials,artifacts},workMap=new Map(works.map(item=>[item.work_id,item])),
      attemptMap=new Map(attempts.map(item=>[item.attempt_id,item])),planMap=new Map(plans.map(item=>[item.plan_id,item]));
    for(const attempt of attempts){const work=workMap.get(attempt.work_id);if(!work||attempt.basis_digest!==work.basis_digest)fail();}
    for(const plan of plans){const attempt=attemptMap.get(plan.attempt_id);if(!attempt||plan.basis_digest!==attempt.basis_digest)fail();}
    for(const event of events){const attempt=attemptMap.get(event.attempt_id),plan=planMap.get(event.plan_id),
      node=nodes.find(item=>item.plan_id===event.plan_id&&item.node_id===event.node_id);
      if(!attempt||attempt.work_id!==event.work_id||!plan||plan.attempt_id!==attempt.attempt_id||node?.capability_ref!==event.capability_ref)fail();}
    for(const result of results){const event=events.find(item=>item.event_id===result.event_id);
      if(!event||event.result_id!==result.result_id||!['succeeded','failed'].includes(result.outcome_kind))fail();}
    for(const event of events){const bound=results.filter(item=>item.event_id===event.event_id);
      if(event.result_id!==null&&bound.length!==1||event.result_id===null&&bound.length!==0||
          event.state==='succeeded'&&(bound.length!==1||bound[0].outcome_kind!=='succeeded'))fail();}
    const sourceRows=new Map(events.filter(event=>event.capability_ref==='arca.jav_correction.source.verify@1'&&event.state==='succeeded')
      .map(event=>[event.event_id,repo.invoke('source_result',{event_id:event.event_id})]));
    function source(reference){
      if(!reference)return null;
      const event=events.find(item=>item.event_id===reference.eventId),work=event&&workMap.get(event.work_id),row=event&&sourceRows.get(event.event_id);
      if(work?.work_id!==reference.workId||event.state!=='succeeded'||event.capability_ref!=='arca.jav_correction.source.verify@1'||
          row?.outcome_kind!=='succeeded'||row.result_digest!==reference.resultDigest||Buffer.byteLength(row.result_json)>65536)fail();
      let value;try{value=JSON.parse(row.result_json);}catch{fail();}
      if(canonicalJson(value)!==row.result_json||canonicalDigest(value)!==row.result_digest||value.correctionId!==record.correctionId||value.admissionDigest!==record.admissionDigest||
          value.scopeDigest!==work.basis_digest||row.result_schema_ref!=='helix://contracts/capabilities/arca.jav_correction.source.verify/v1/result')fail();
      options.contractValidator.validate(value.schemaRef,value);return Object.freeze(value);
    }
    return Object.freeze({snapshot,definitions,snapshotDigest:canonicalDigest(snapshot),source,
      workEvidence(workId){
        const work=workMap.get(workId);if(!work||work.state!=='failed')fail();
        const selectedAttempts=attempts.filter(item=>item.work_id===workId),selectedEvents=events.filter(item=>item.work_id===workId),ids=new Set(selectedEvents.map(item=>item.event_id)),
          selectedEventAttempts=eventAttempts.filter(item=>ids.has(item.event_id)),attemptIds=new Set(selectedAttempts.map(item=>item.attempt_id)),eventAttemptIds=new Set(selectedEventAttempts.map(item=>item.event_attempt_id));
        if(!selectedAttempts.length||selectedAttempts.sort((a,b)=>b.ordinal-a.ordinal)[0].state!=='failed')fail();
        return canonicalDigest({work,attempts:selectedAttempts,plans:plans.filter(item=>attemptIds.has(item.attempt_id)),events:selectedEvents,
          eventAttempts:selectedEventAttempts,effects:effects.filter(item=>eventAttemptIds.has(item.event_attempt_id)),results:results.filter(item=>ids.has(item.event_id))});
      }});
  }
  return Object.freeze({definition,collect,read(record){return options.unitOfWork.execute([{participantId:'arca_jav_recovery_execution_observation',owner:'execution-foundation',boundBusinessOwner:'arca',
    repositories:[definition],execute:context=>collect(context.repository(definition.repositoryId),record)}]).arca_jav_recovery_execution_observation;},
    participant({record,expectedDigest,accept}){return {participantId:'arca_jav_recovery_execution_validation',owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[definition],
      execute(context){const value=collect(context.repository(definition.repositoryId),typeof record==='function'?record():record);if(value.snapshotDigest!==expectedDigest)fail();accept(value);}};}});
}
module.exports=Object.freeze({createJavCorrectionRecoveryReader});
