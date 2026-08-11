'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createFormationQuery(options){const repository=createRepositoryDefinition({repositoryId:'libra_formation_query',owner:'libra',schemaManifest:options.schemaManifest,statements:{
  list_subjects:{kind:'select-all',tableId:'libra_subjects',columns:['subject_id','structure_kind','content_profile','routing_anchor_intake_decision_id','status','intake_revision','created_at_ms','updated_at_ms'],keyColumns:[],safeIntegers:true},
  list_decisions:{kind:'select-all',tableId:'libra_intake_decisions',columns:['intake_decision_id','offer_id','candidate_package_id','package_revision','candidate_delivery_snapshot_json','accepted_result','target_subject_id','decided_at_ms'],keyColumns:[],safeIntegers:true},
  list_receipts:{kind:'select-all',tableId:'libra_handoff_a_receipts',columns:['intake_decision_id','outcome','subject_id','subject_intake_revision','committed_at_ms'],keyColumns:[],safeIntegers:true},
  list_bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:['subject_id','material_key','role','authority_kind','current'],keyColumns:[],safeIntegers:true}
}});
  function rows(){return options.unitOfWork.execute([{participantId:'libra_formation_read',owner:'libra',repositories:[repository],execute(context){const r=context.repository(repository.repositoryId);
    return {subjects:r.invoke('list_subjects',{}),decisions:r.invoke('list_decisions',{}),receipts:r.invoke('list_receipts',{}),bindings:r.invoke('list_bindings',{})};}}]).libra_formation_read;}
  function build(){const value=rows(),receipts=new Map(value.receipts.filter((item)=>item.outcome==='accepted').map((item)=>[item.intake_decision_id,item]));
    const decisionsBySubject=new Map();for(const decision of value.decisions){const receipt=receipts.get(decision.intake_decision_id),subjectId=receipt?.subject_id||decision.target_subject_id;if(!subjectId)continue;
      const list=decisionsBySubject.get(subjectId)||[];list.push(decision);decisionsBySubject.set(subjectId,list);}
    return Object.freeze(value.subjects.map((subject)=>{const decisions=(decisionsBySubject.get(subject.subject_id)||[]).sort((a,b)=>Number(a.decided_at_ms)-Number(b.decided_at_ms));
      const anchor=decisions.find((item)=>item.intake_decision_id===subject.routing_anchor_intake_decision_id)||decisions[0];let snapshot=null;
      try{snapshot=anchor?.candidate_delivery_snapshot_json?JSON.parse(anchor.candidate_delivery_snapshot_json):null;}catch{snapshot=null;}
      const bindings=value.bindings.filter((item)=>item.subject_id===subject.subject_id&&Number(item.current)===1);
      return Object.freeze({formationViewId:subject.subject_id,subjectId:subject.subject_id,displayIdentity:snapshot?.candidatePackage?.displayIdentity||subject.subject_id,
        contentProfile:subject.content_profile,structureKind:subject.structure_kind,status:subject.status,stage:'awaiting_destination',
        stageLabel:'已接收，等待选择收藏架',intakeCount:Number(subject.intake_revision),primaryMaterialCount:bindings.filter((item)=>item.authority_kind==='primary_control').length,
        relatedMaterialCount:bindings.filter((item)=>item.authority_kind==='related_derived').length,lastAcceptedAtMs:decisions.length?Number(decisions.at(-1).decided_at_ms):Number(subject.updated_at_ms)});}).sort((a,b)=>a.displayIdentity.localeCompare(b.displayIdentity,'zh-CN')));}
  return Object.freeze({list(){const items=build();return Object.freeze({items,summary:Object.freeze({subjectCount:items.length,awaitingDestinationCount:items.filter((item)=>item.stage==='awaiting_destination').length})});},
    get(subjectId){const item=build().find((row)=>row.subjectId===subjectId);if(!item){const error=new Error('Formation Subject was not found.');error.code='FORMATION_SUBJECT_NOT_FOUND';throw error;}return item;}});
}
module.exports=Object.freeze({createFormationQuery});
