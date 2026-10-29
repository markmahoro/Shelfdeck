'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {createUsAdultAnalysisStore}=require('../../../src/helix/domains/libra/persistence/us-adult-analysis-store');
const {createUsAdultActorChoiceStore}=require('../../../src/helix/domains/libra/persistence/us-adult-actor-choice-store');
const {createUsAdultActorChoiceCommand}=require('../../../src/helix/domains/libra/capabilities/us-adult-actor-choice-command');
const {buildActorSelection,actorRelation,selectedPerson}=require('../../../src/helix/domains/libra/model/us-adult-actor-selection');
const {buildMediaCastDraft,buildProductFactHandle}=require('../../../src/helix/domains/libra/model/product-fact-contracts');
const {createProductFactRegistrations}=require('../../../src/helix/domains/libra/persistence/product-fact-store');
const {createDomainCommitCoordinator,createDomainCommitRegistry,createCanonicalTransactionRegistry}=require('../../../src/helix/foundation/persistence/domain-commit-registry');
const transaction=require('../../../src/helix/contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
function setup(input){
  createUsAdultAnalysisStore(input.options).freeze(input.basis,input.pages);
  const schemas=['UsAdultActorSelectionBasis','UsAdultActorChoiceRecord','UsAdultActorChoiceDecision','UsAdultActorChoiceReceipt','UsAdultMatchCompletion',
    'UsAdultPersonSnapshot','PersonReferenceProjection','LibraMediaCastSourceBasis','ResolvedProviderIdentity'].map(type=>require('../../../src/helix/contracts/domain-types/'+type+'/v1/schema.json'));
  schemas.push(...['MediaCastDraft','MediaCastFact','PersonMatchEvidence','MetadataObservation','IntegrationHandle'].map(type=>require('../../../src/helix/contracts/types/'+type+'/v1/schema.json')));
  schemas.push(require('../../../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json'));
  const options={...input.options,contractValidator:createCapabilityContractValidator({schemas})},store=createUsAdultActorChoiceStore(options),
    command=createUsAdultActorChoiceCommand({...options,usAdultActorChoiceStore:store,movieProductionReader:{readRunSnapshot:()=>input.snapshot},
      peopleReferenceQuery:{readUsAdultPersonSnapshot({personId}){return input.pages.flatMap(page=>page.items).find(person=>person.personId===personId);}}});
  const choiceBody={idempotencyKey:'choose-actor',expectedRunStateRevision:1,expectedChoiceRevision:0,personId:'actor-1',expectedPersonRevision:1,expectedReferenceRevision:1};
  function selected(choiceRecord=store.current('subject-1'),completion=null){
    return buildActorSelection({snapshot:input.snapshot,analysisBasis:input.basis,resolvedIdentityDigest:input.basis.resolvedIdentityDigest,
      actorChoiceRecord:choiceRecord,matchCompletion:completion});
  }
  function cast(selection){
    const sourceBasis={sourceBasisKind:'us_adult_actor',actorSelection:selection,sourceBasisDigest:selection.selectionDigest},
      draft=buildMediaCastDraft({subjectId:'subject-1',sourceBasis,relations:[actorRelation(selection)],personProjection:{items:[selectedPerson(selection).referenceProjection]},producedAtMs:1}),
      payload={schema:'libra.media-cast-fact-commit-payload@1',sourceBasis,mediaCastDraft:draft},
      handle=buildProductFactHandle({libraRunId:'run-1',factKind:'media_cast',expectedRevision:0,payloadDigest:D(payload),eventFenceDigest:D('actor-cast-fence')});
    options.contractValidator.validate('helix://contracts/domain-types/LibraMediaCastSourceBasis/v1',sourceBasis);
    options.contractValidator.validate(draft.schemaRef,draft);return {selection,sourceBasis,draft,payload,handle};
  }
  const coordinator=createDomainCommitCoordinator({schemaManifest:options.schemaManifest,unitOfWork:input.unitOfWork,
    registry:createDomainCommitRegistry({registrations:createProductFactRegistrations(options)}),transactionRegistry:createCanonicalTransactionRegistry({contracts:[transaction]})});
  function request(value){return {transactionId:'helix.transaction.domain-fact-commit',handle:value.handle,payload:value.payload,
    supportingWorkId:'cast-work',outboxMessages:[],commitMarker:{commitMarker:'cast-marker',commitDigest:D('cast-commit')},
    resultBinding:{resultId:'cast-result',eventId:'cast-event',evidenceSchemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',
      evidence:{schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',schemaVersion:1,evidenceId:'cast-evidence',evidenceDigest:D('cast-evidence')}}};}
  seed(input,{workId:'cast-work',attemptId:'cast-attempt',planId:'cast-plan',eventId:'cast-event',resultId:null,capabilityRef:'libra.media_cast.commit@1',
    inputBindings:{schema:'fixture-owner-commit'},state:'running'});
  return {options,store,command,choiceBody,selected,cast,coordinator,request};
}
// Owner persistence fixtures use prepared producer values; this is not a media Host qualification.
function seed(input,record){
  const db=input.db,state=record.state||'succeeded',result=record.result,basis=input.basis.runExecutionBasisDigest,
    nodeId=record.eventId+'-node',evidence={evidenceId:record.eventId+'-evidence',evidenceKind:'us_adult_analysis',
      producerRef:record.capabilityRef,basisDigest:input.basis.basisDigest,payloadDigest:result?D(result):D('pending'),observedAtMs:1};
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(record.workId,'libra','libra_run','run-1','us_adult_actor_fixture',basis,'normal',state,record.workId+'-key',1,1);
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run(record.attemptId,record.workId,1,basis,state,1,state==='succeeded'?2:null);
  db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(record.planId,record.attemptId,'fixture-us-actor-plan',1,D('catalog'),basis,D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameters_json,when_json,fence_basis_json,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(record.planId,nodeId,record.capabilityRef,1,'fixture-input',canonicalJson(record.inputBindings),'{}','null','{}','{}');
  db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(record.eventId,record.planId,nodeId,record.workId,record.attemptId,'libra',record.capabilityRef,1,state==='succeeded'?'succeeded':'executing','normal',1,record.resultId);
  if(result){
    db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(record.eventId+'-execution',record.eventId,1,record.capabilityRef,1,'fixture-input',D(record.inputBindings),D('fence'),'completed','succeeded',1,2);
    db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(record.resultId,record.eventId,'succeeded',record.resultSchemaRef,canonicalJson(result),D(result),'fixture-evidence',canonicalJson(evidence),D(evidence),2);
  }
}
module.exports=Object.freeze({setup,seed});
