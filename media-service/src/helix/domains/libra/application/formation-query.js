'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createFormationQuery(options){const repository=createRepositoryDefinition({repositoryId:'libra_formation_query',owner:'libra',schemaManifest:options.schemaManifest,statements:{
  list_subjects:{kind:'select-all',tableId:'libra_subjects',columns:['subject_id','structure_kind','content_profile','routing_anchor_intake_decision_id','status','intake_revision','created_at_ms','updated_at_ms'],keyColumns:[],safeIntegers:true},
  list_decisions:{kind:'select-all',tableId:'libra_intake_decisions',columns:['intake_decision_id','offer_id','candidate_package_id','package_revision','candidate_delivery_snapshot_json','accepted_result','target_subject_id','decided_at_ms'],keyColumns:[],safeIntegers:true},
  list_receipts:{kind:'select-all',tableId:'libra_handoff_a_receipts',columns:['intake_decision_id','outcome','subject_id','subject_intake_revision','committed_at_ms'],keyColumns:[],safeIntegers:true},
  list_bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:['subject_id','material_key','role','authority_kind','current'],keyColumns:[],safeIntegers:true},
  list_routing_decisions:{kind:'select-all',tableId:'libra_routing_decisions',columns:['routing_decision_id','subject_id','decision_revision','decision','shelf_id','unresolved_reason_code','routing_policy_id','routing_policy_revision','decision_digest','decided_at_ms'],keyColumns:[],safeIntegers:true},
  list_routing_policies:{kind:'select-all',tableId:'libra_routing_policy_revisions',columns:['routing_policy_id','revision','mode'],keyColumns:[],safeIntegers:true}
  ,list_decision_heads:{kind:'select-all',tableId:'libra_subject_decision_heads',columns:['subject_id','head_revision','head_digest','current_routing_decision_id','current_decision_basis_id','current_acceptance_spec_id'],keyColumns:[],safeIntegers:true},
  list_acceptance_specs:{kind:'select-all',tableId:'libra_acceptance_specs',columns:['acceptance_spec_id','subject_id','spec_revision','spec_digest','record_digest','shelf_id','shelf_standard_revision','published_at_ms'],keyColumns:[],safeIntegers:true}
}});
  function rows(){return options.unitOfWork.execute([{participantId:'libra_formation_read',owner:'libra',repositories:[repository],execute(context){const r=context.repository(repository.repositoryId);
    return {subjects:r.invoke('list_subjects',{}),decisions:r.invoke('list_decisions',{}),receipts:r.invoke('list_receipts',{}),bindings:r.invoke('list_bindings',{}),
      routingDecisions:r.invoke('list_routing_decisions',{}),routingPolicies:r.invoke('list_routing_policies',{}),decisionHeads:r.invoke('list_decision_heads',{}),acceptanceSpecs:r.invoke('list_acceptance_specs',{})};}}]).libra_formation_read;}
  function build(){const value=rows(),receipts=new Map(value.receipts.filter((item)=>item.outcome==='accepted').map((item)=>[item.intake_decision_id,item]));
    const decisionsBySubject=new Map();for(const decision of value.decisions){const receipt=receipts.get(decision.intake_decision_id),subjectId=receipt?.subject_id||decision.target_subject_id;if(!subjectId)continue;
      const list=decisionsBySubject.get(subjectId)||[];list.push(decision);decisionsBySubject.set(subjectId,list);}
    return Object.freeze(value.subjects.map((subject)=>{const decisions=(decisionsBySubject.get(subject.subject_id)||[]).sort((a,b)=>Number(a.decided_at_ms)-Number(b.decided_at_ms));
      const anchor=decisions.find((item)=>item.intake_decision_id===subject.routing_anchor_intake_decision_id)||decisions[0];let snapshot=null;
      try{snapshot=anchor?.candidate_delivery_snapshot_json?JSON.parse(anchor.candidate_delivery_snapshot_json):null;}catch{snapshot=null;}
      const bindings=value.bindings.filter((item)=>item.subject_id===subject.subject_id&&Number(item.current)===1);
      const routing=value.routingDecisions.filter((item)=>item.subject_id===subject.subject_id).sort((a,b)=>Number(b.decision_revision)-Number(a.decision_revision))[0]||null;
      const policy=routing?value.routingPolicies.find((item)=>item.routing_policy_id===routing.routing_policy_id&&Number(item.revision)===Number(routing.routing_policy_revision)):null;
      const decisionHead=value.decisionHeads.find((item)=>item.subject_id===subject.subject_id)||null;
      const acceptanceSpec=decisionHead?.current_acceptance_spec_id?value.acceptanceSpecs.find((item)=>item.acceptance_spec_id===decisionHead.current_acceptance_spec_id)||null:null;
      const stage=!routing?'routing_preparing':routing.decision==='resolved'?'routing_resolved':'routing_unresolved';
      return Object.freeze({formationViewId:subject.subject_id,subjectId:subject.subject_id,displayIdentity:snapshot?.candidatePackage?.displayIdentity||subject.subject_id,
        contentProfile:subject.content_profile,structureKind:subject.structure_kind,status:subject.status,stage,
        stageLabel:stage==='routing_resolved'?'已选定收藏架':stage==='routing_unresolved'?'分拣未解决':'正在准备分拣事实',
        routingState:routing?.decision||'preparing',routingPolicyMode:policy?.mode||null,routingPolicyRevision:routing?.routing_policy_revision===null?null:Number(routing?.routing_policy_revision),
        targetShelfId:routing?.shelf_id||null,unresolvedReasonCode:routing?.unresolved_reason_code||null,routingDecisionRevision:routing?Number(routing.decision_revision):null,
        routingDecisionDigest:routing?.decision_digest||null,routingDecisionHeadRevision:decisionHead?Number(decisionHead.head_revision):null,
        routingDecisionHeadDigest:decisionHead?.head_digest||null,acceptanceSpecId:acceptanceSpec?.acceptance_spec_id||null,acceptanceSpecRevision:acceptanceSpec?Number(acceptanceSpec.spec_revision):null,
        acceptanceSpecDigest:acceptanceSpec?.spec_digest||null,acceptanceSpecPublishedAtMs:acceptanceSpec?Number(acceptanceSpec.published_at_ms):null,intakeCount:Number(subject.intake_revision),primaryMaterialCount:bindings.filter((item)=>item.authority_kind==='primary_control').length,
        relatedMaterialCount:bindings.filter((item)=>item.authority_kind==='related_derived').length,lastAcceptedAtMs:decisions.length?Number(decisions.at(-1).decided_at_ms):Number(subject.updated_at_ms)});}).sort((a,b)=>a.displayIdentity.localeCompare(b.displayIdentity,'zh-CN')));}
  return Object.freeze({list(){const items=build();return Object.freeze({items,summary:Object.freeze({subjectCount:items.length,
    preparingCount:items.filter((item)=>item.stage==='routing_preparing').length,unresolvedCount:items.filter((item)=>item.stage==='routing_unresolved').length,
    resolvedCount:items.filter((item)=>item.stage==='routing_resolved').length})});},
    get(subjectId){const item=build().find((row)=>row.subjectId===subjectId);if(!item){const error=new Error('Formation Subject was not found.');error.code='FORMATION_SUBJECT_NOT_FOUND';throw error;}return item;}});
}
module.exports=Object.freeze({createFormationQuery});
