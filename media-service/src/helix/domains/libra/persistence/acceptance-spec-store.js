'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {buildDecisionInputSet,decisionHeadDigest}=require('../model/decision-front-half-contracts');
const {resolveAcceptanceSpec}=require('../model/acceptance-spec-contracts');
const {BASIS_COLUMNS,HEAD_COLUMNS,INPUT_COLUMNS,basisFromRow,reconstructInputSet}=require('./decision-basis-store');

const RESULT_SCHEMA='helix://contracts/types/AcceptanceSpecPublicationResult/v1';
class AcceptanceSpecStoreError extends Error{constructor(code,message,details={}){super(message);this.name='AcceptanceSpecStoreError';this.code=code;this.details=details;}}
class Replay extends Error{constructor(result){super('Acceptance Spec replay');this.result=result;}}
function fail(code,message,details){throw new AcceptanceSpecStoreError(code,message,details);}
function number(value){return Number(value);}

function domainDefinition(schemaManifest){return createRepositoryDefinition({repositoryId:'libra_acceptance_spec_facts',owner:'libra',schemaManifest,statements:{
  find_subject:{kind:'select-one',tableId:'libra_subjects',columns:['subject_id','structure_kind','content_profile','status','intake_revision','current_episode_scope_digest'],keyColumns:['subject_id']},
  find_episodes:{kind:'select-all',tableId:'libra_subject_episode_scopes',columns:['subject_id','episode_key'],keyColumns:['subject_id']},
  find_routing:{kind:'select-one',tableId:'libra_routing_decisions',columns:['routing_decision_id','subject_id','assessment_id','decision_revision','decision','shelf_id','unresolved_reason_code','routing_input_digest','shelf_priority_set_digest','decision_digest'],keyColumns:['routing_decision_id']},
  find_basis:{kind:'select-one',tableId:'libra_decision_basis_revisions',columns:BASIS_COLUMNS,keyColumns:['decision_basis_id']},
  find_inputs:{kind:'select-all',tableId:'libra_decision_basis_inputs',columns:INPUT_COLUMNS,keyColumns:['decision_basis_id']},
  find_head:{kind:'select-one',tableId:'libra_subject_decision_heads',columns:HEAD_COLUMNS,keyColumns:['subject_id']},
  advance_head:{kind:'update',tableId:'libra_subject_decision_heads',setColumns:['head_revision','head_digest','current_routing_decision_id','current_decision_basis_id','current_acceptance_spec_id','updated_at_ms'],keyColumns:['subject_id'],compareColumns:[
    {column:'head_revision',parameter:'expected_head_revision'},{column:'head_digest',parameter:'expected_head_digest'},{column:'current_routing_decision_id',parameter:'expected_routing_id',nullSafe:true},
    {column:'current_decision_basis_id',parameter:'expected_basis_id',nullSafe:true},{column:'current_acceptance_spec_id',parameter:'expected_spec_id',nullSafe:true}]},
  find_spec:{kind:'select-one',tableId:'libra_acceptance_specs',columns:['acceptance_spec_id','subject_id','decision_basis_id','product_scope_digest','spec_revision','spec_json','spec_digest','record_digest'],keyColumns:['decision_basis_id']},
  list_specs:{kind:'select-all',tableId:'libra_acceptance_specs',columns:['subject_id','spec_revision'],keyColumns:['subject_id']},
  insert_spec:{kind:'insert',tableId:'libra_acceptance_specs',columns:['acceptance_spec_id','subject_id','shelf_id','shelf_routing_projection_revision','shelf_projection_digest','shelf_standard_revision','shelf_standard_digest','decision_basis_id','product_scope_digest','spec_revision','spec_schema_ref','spec_json','spec_digest','record_digest','structure_kind','content_profile','published_at_ms']}
}});}
function foundationDefinition(schemaManifest){return createRepositoryDefinition({repositoryId:'libra_acceptance_spec_foundation',owner:'execution-foundation',schemaManifest,statements:{
  find_marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest'],keyColumns:['commit_marker']},
  find_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','result_json','result_digest'],keyColumns:['result_id']},
  insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
  insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']}
}});}

function resultFromSpec(spec,basisId,committedHeadRevision){const value={subjectId:spec.subjectId,acceptanceSpecId:spec.acceptanceSpecId,specRevision:spec.specRevision,
  decisionBasisId:basisId,productScopeDigest:spec.productScope.scopeDigest,specDigest:spec.specDigest,recordDigest:spec.recordDigest,committedHeadRevision};
  value.resultDigest=canonicalDigest(value);return Object.freeze(value);}

function createAcceptanceSpecStore(options){if(!options?.schemaManifest||!options.unitOfWork)fail('P8_SPEC_STORE_DEPENDENCIES','Schema manifest and Unit of Work are required.');
  const domain=domainDefinition(options.schemaManifest),foundation=foundationDefinition(options.schemaManifest);
  return Object.freeze({repositoryManifest:Object.freeze({libraTableIds:domain.tableIds,foundationTableIds:foundation.tableIds}),publish(request){
    const set=buildDecisionInputSet(request?.decisionInputSet),basis=request?.decisionBasis,marker=request?.commitMarker,resultId=request?.resultId;
    if(set.basisKind!=='acceptance_spec'||set.readiness.result!=='ready'||!basis||typeof marker!=='string'||!marker||typeof resultId!=='string'||!resultId)fail('P8_SPEC_COMMIT_INPUT','Acceptance Spec publication input is incomplete.');
    const commitDigest=canonicalDigest({schema:'libra.acceptance-spec-publish@1',decisionBasisId:basis.decisionBasisId,inputSetDigest:set.inputSetDigest});let result,replayed=false;
    const preflight={participantId:'acceptance_spec_preflight',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId),found=repo.invoke('find_marker',{commit_marker:marker});if(!found)return;
      if(found.owner_domain!=='libra'||found.scope_type!=='acceptance_spec'||found.commit_digest!==commitDigest||found.result_schema_ref!==RESULT_SCHEMA)fail('P8_SPEC_MARKER_CONFLICT','Commit marker belongs to another Acceptance Spec.');const stored=repo.invoke('find_result',{result_id:found.result_id});if(!stored||stored.result_digest!==found.result_digest)fail('P8_SPEC_REPLAY_CORRUPT','Acceptance Spec Result is absent.');result=JSON.parse(stored.result_json);if(canonicalDigest(result)!==stored.result_digest)fail('P8_SPEC_REPLAY_CORRUPT','Acceptance Spec Result is corrupt.');throw new Replay(result);}};
    const apply={participantId:'acceptance_spec_domain',owner:'libra',repositories:[domain],execute(context){const repo=context.repository(domain.repositoryId),row=repo.invoke('find_basis',{decision_basis_id:basis.decisionBasisId});
      if(!row||row.basis_kind!=='acceptance_spec'||row.status!=='ready')fail('P8_SPEC_BASIS','Ready Acceptance Spec Basis is absent.');const storedSet=reconstructInputSet(repo,row);
      if(canonicalJson(storedSet)!==canonicalJson(set)||canonicalJson(basisFromRow(row,basis.commitMarker))!==canonicalJson(basis))fail('P8_SPEC_BASIS','Acceptance Spec Basis or relationized inputs differ from Owner rows.');
      const existing=repo.invoke('find_spec',{decision_basis_id:basis.decisionBasisId});if(existing){const spec=JSON.parse(existing.spec_json);if(spec.recordDigest!==existing.record_digest||canonicalJson(resolveAcceptanceSpec({inputSet:storedSet,decisionBasis:basis,specRevision:number(existing.spec_revision),producedAtMs:spec.producedAtMs,publishedAtMs:spec.publishedAtMs}))!==canonicalJson(spec))fail('P8_SPEC_REPLAY_CORRUPT','Stored Acceptance Spec is corrupt.');result=resultFromSpec(spec,basis.decisionBasisId,set.expectedDecisionHead.headRevision+2);replayed=true;return;}
      const subject=repo.invoke('find_subject',{subject_id:set.subjectSnapshot.subjectId});if(!subject||subject.status!=='active'||subject.structure_kind!==set.subjectSnapshot.structureKind||subject.content_profile!==set.subjectSnapshot.contentProfile||number(subject.intake_revision)!==set.subjectSnapshot.intakeRevision||subject.current_episode_scope_digest!==set.subjectSnapshot.episodeScopeDigest)fail('P8_SPEC_SUBJECT_STALE','Subject changed after Spec Basis commit.');
      const routing=repo.invoke('find_routing',{routing_decision_id:set.routingDecision.routingDecisionId});if(!routing||routing.subject_id!==subject.subject_id||routing.decision!=='resolved'||routing.shelf_id!==set.routingDecision.targetShelfId||routing.decision_digest!==set.routingDecision.decisionDigest)fail('P8_SPEC_ROUTING_STALE','Resolved Routing Decision changed or is absent.');
      if(set.productScope.scopeKind==='episode_manifest'){const current=new Set(repo.invoke('find_episodes',{subject_id:subject.subject_id}).map((item)=>item.episode_key));if(set.productScope.episodeKeys.some((key)=>!current.has(key)))fail('P8_SPEC_SCOPE_STALE','Product Scope is not a subset of current accepted Episodes.');}
      const basisHeadRevision=set.expectedDecisionHead.headRevision+1,basisHeadDigest=decisionHeadDigest(subject.subject_id,basisHeadRevision,set.expectedDecisionHead.currentRoutingDecisionId,basis.decisionBasisId,null),head=repo.invoke('find_head',{subject_id:subject.subject_id});
      if(!head||number(head.head_revision)!==basisHeadRevision||head.head_digest!==basisHeadDigest||head.current_routing_decision_id!==set.expectedDecisionHead.currentRoutingDecisionId||head.current_decision_basis_id!==basis.decisionBasisId||head.current_acceptance_spec_id!==null)fail('P8_SPEC_HEAD_CAS','Decision head is not the Spec Basis post-state.');
      const revision=repo.invoke('list_specs',{subject_id:subject.subject_id}).reduce((max,item)=>Math.max(max,number(item.spec_revision)),0)+1,
        spec=resolveAcceptanceSpec({inputSet:storedSet,decisionBasis:basis,specRevision:revision,producedAtMs:request.producedAtMs,publishedAtMs:context.commitTimeMs});
      if(request.expectedRecordDigest&&request.expectedRecordDigest!==spec.recordDigest)fail('P8_SPEC_RECORD_MISMATCH','Acceptance Spec differs from caller expectation.');
      repo.invoke('insert_spec',{acceptance_spec_id:spec.acceptanceSpecId,subject_id:spec.subjectId,shelf_id:spec.targetShelfId,shelf_routing_projection_revision:spec.shelfRoutingProjectionRevision,shelf_projection_digest:spec.shelfProjectionDigest,shelf_standard_revision:spec.shelfStandardRevision,shelf_standard_digest:spec.shelfStandardDigest,decision_basis_id:basis.decisionBasisId,product_scope_digest:spec.productScope.scopeDigest,spec_revision:spec.specRevision,spec_schema_ref:'libra.acceptance-spec@1',spec_json:canonicalJson(spec),spec_digest:spec.specDigest,record_digest:spec.recordDigest,structure_kind:spec.structureKind,content_profile:spec.contentProfile,published_at_ms:context.commitTimeMs});
      const committedHeadRevision=basisHeadRevision+1,nextDigest=decisionHeadDigest(subject.subject_id,committedHeadRevision,routing.routing_decision_id,basis.decisionBasisId,spec.acceptanceSpecId);
      if(repo.invoke('advance_head',{head_revision:committedHeadRevision,head_digest:nextDigest,current_routing_decision_id:routing.routing_decision_id,current_decision_basis_id:basis.decisionBasisId,current_acceptance_spec_id:spec.acceptanceSpecId,updated_at_ms:context.commitTimeMs,subject_id:subject.subject_id,expected_head_revision:basisHeadRevision,expected_head_digest:basisHeadDigest,expected_routing_id:routing.routing_decision_id,expected_basis_id:basis.decisionBasisId,expected_spec_id:null}).changes!==1)fail('P8_SPEC_HEAD_CAS','Acceptance Spec head CAS failed.');result=resultFromSpec(spec,basis.decisionBasisId,committedHeadRevision);}};
    const finish={participantId:'acceptance_spec_foundation',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId),storedDigest=canonicalDigest(result);repo.invoke('insert_result',{result_id:resultId,event_id:null,outcome_kind:'succeeded',result_schema_ref:RESULT_SCHEMA,result_json:canonicalJson(result),result_digest:storedDigest,evidence_schema_ref:null,evidence_json:null,evidence_digest:null,effect_receipt_id:null,committed_at_ms:context.commitTimeMs});repo.invoke('insert_marker',{commit_marker:marker,effect_id:null,owner_domain:'libra',scope_type:'acceptance_spec',scope_id:result.acceptanceSpecId,commit_digest:commitDigest,result_id:resultId,result_schema_ref:RESULT_SCHEMA,result_digest:storedDigest,committed_at_ms:context.commitTimeMs});}};
    try{options.unitOfWork.execute([preflight,apply,finish]);}catch(error){if(error instanceof Replay)return Object.freeze({result:error.result,replayed:true});throw error;}return Object.freeze({result,replayed});
  }});
}

module.exports=Object.freeze({AcceptanceSpecStoreError,RESULT_SCHEMA,createAcceptanceSpecStore});
