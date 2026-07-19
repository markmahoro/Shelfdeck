'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {buildDecisionBasisRevision,buildDecisionInputSet,decisionHeadDigest,inputSnapshotRows}=require('../model/decision-front-half-contracts');

const RESULT_SCHEMA='helix://contracts/types/DecisionBasisRevision/v1';
class DecisionBasisStoreError extends Error{constructor(code,message,details={}){super(message);this.name='DecisionBasisStoreError';this.code=code;this.details=details;}}
class Replay extends Error{constructor(result){super('Decision Basis replay');this.result=result;}}
function fail(code,message,details){throw new DecisionBasisStoreError(code,message,details);}
function number(value){return Number(value);}

const SUBJECT_COLUMNS=['subject_id','structure_kind','content_profile','routing_anchor_intake_decision_id','status','intake_revision','current_continuity_set_digest','current_episode_scope_digest','current_identity_revision'];
const BASIS_COLUMNS=['decision_basis_id','subject_id','basis_kind','basis_revision','expected_head_revision','expected_head_snapshot_digest','routing_decision_id','query_result_set_digest','routing_input_digest','spec_input_digest','product_scope_digest','input_set_digest','status','unresolved_reason_code','basis_digest','committed_at_ms'];
const INPUT_COLUMNS=['decision_basis_id','input_ordinal','input_kind','input_schema_ref','input_object_id','input_revision','input_digest','input_json','provider_domain','query_contract','query_version','query_input_digest','result_kind','result_revision','result_digest','expires_at_ms'];
const HEAD_COLUMNS=['subject_id','head_revision','head_digest','current_routing_decision_id','current_decision_basis_id','current_acceptance_spec_id','updated_at_ms'];

function libraDefinitions(schemaManifest){
  const facts=createRepositoryDefinition({repositoryId:'libra_decision_basis_facts',owner:'libra',schemaManifest,statements:{
    find_subject:{kind:'select-one',tableId:'libra_subjects',columns:SUBJECT_COLUMNS,keyColumns:['subject_id']},
    find_anchor:{kind:'select-one',tableId:'libra_intake_decisions',columns:['intake_decision_id','candidate_package_id','source_field_id','source_field_access_revision','source_field_context_digest','candidate_identity_claim_digest'],keyColumns:['intake_decision_id']},
    find_identity:{kind:'select-one',tableId:'libra_product_identity_revisions',columns:['subject_id','revision','identity_digest'],keyColumns:['subject_id','revision']},
    find_episodes:{kind:'select-all',tableId:'libra_subject_episode_scopes',columns:['subject_id','episode_key'],keyColumns:['subject_id']},
    find_head:{kind:'select-one',tableId:'libra_subject_decision_heads',columns:HEAD_COLUMNS,keyColumns:['subject_id']},
    insert_head:{kind:'insert',tableId:'libra_subject_decision_heads',columns:HEAD_COLUMNS},
    advance_head:{kind:'update',tableId:'libra_subject_decision_heads',setColumns:['head_revision','head_digest','current_routing_decision_id','current_decision_basis_id','current_acceptance_spec_id','updated_at_ms'],keyColumns:['subject_id'],compareColumns:[
      {column:'head_revision',parameter:'expected_head_revision'},{column:'head_digest',parameter:'expected_head_digest'},{column:'current_routing_decision_id',parameter:'expected_routing_id',nullSafe:true},
      {column:'current_decision_basis_id',parameter:'expected_basis_id',nullSafe:true},{column:'current_acceptance_spec_id',parameter:'expected_spec_id',nullSafe:true}]},
    list_basis:{kind:'select-all',tableId:'libra_decision_basis_revisions',columns:BASIS_COLUMNS,keyColumns:['subject_id']},
    find_semantic:{kind:'select-one',tableId:'libra_decision_basis_revisions',columns:BASIS_COLUMNS,keyColumns:['subject_id','basis_kind','input_set_digest']},
    find_inputs:{kind:'select-all',tableId:'libra_decision_basis_inputs',columns:INPUT_COLUMNS,keyColumns:['decision_basis_id']},
    insert_basis:{kind:'insert',tableId:'libra_decision_basis_revisions',columns:BASIS_COLUMNS},
    insert_input:{kind:'insert',tableId:'libra_decision_basis_inputs',columns:INPUT_COLUMNS},
    find_policy_head:{kind:'select-one',tableId:'libra_field_routing_heads',columns:['field_id','current_routing_policy_id','current_policy_revision'],keyColumns:['field_id']},
    find_policy:{kind:'select-one',tableId:'libra_routing_policy_revisions',columns:['routing_policy_id','revision','field_id','policy_json','policy_digest'],keyColumns:['routing_policy_id','revision']},
    find_policy_targets:{kind:'select-all',tableId:'libra_routing_policy_targets',columns:['routing_policy_id','policy_revision','shelf_id','rank','match_rule_json','match_rule_digest'],keyColumns:['routing_policy_id','policy_revision']},
    find_routing:{kind:'select-one',tableId:'libra_routing_decisions',columns:['routing_decision_id','subject_id','decision_revision','decision_digest'],keyColumns:['routing_decision_id']}
  }});
  return facts;
}
function foundationDefinitions(schemaManifest){return createRepositoryDefinition({repositoryId:'libra_decision_basis_foundation',owner:'execution-foundation',schemaManifest,statements:{
  find_marker:{kind:'select-one',tableId:'fx_commit_markers',columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest'],keyColumns:['commit_marker']},
  find_result:{kind:'select-one',tableId:'fx_event_result_bindings',columns:['result_id','result_json','result_digest'],keyColumns:['result_id']},
  insert_result:{kind:'insert',tableId:'fx_event_result_bindings',columns:['result_id','event_id','outcome_kind','result_schema_ref','result_json','result_digest','evidence_schema_ref','evidence_json','evidence_digest','effect_receipt_id','committed_at_ms']},
  insert_marker:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','effect_id','owner_domain','scope_type','scope_id','commit_digest','result_id','result_schema_ref','result_digest','committed_at_ms']},
  find_receipt:{kind:'select-one',tableId:'fx_command_receipts',columns:['command_receipt_id','request_digest','target_id','result_digest'],keyColumns:['owner_domain','command_contract','caller_scope','idempotency_key']},
  insert_receipt:{kind:'insert',tableId:'fx_command_receipts',columns:['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_type','target_id','result_schema_ref','result_ref_json','result_digest','committed_at_ms']}
}});}

function reconstructSubject(repo,expected){
  const row=repo.invoke('find_subject',{subject_id:expected.subjectId});if(!row||row.status!=='active')fail('P8_DECISION_SUBJECT_NOT_ACTIVE','Decision Basis Subject is absent or inactive.');
  const anchor=repo.invoke('find_anchor',{intake_decision_id:row.routing_anchor_intake_decision_id});if(!anchor)fail('P8_DECISION_SUBJECT_PROVENANCE','Subject routing anchor is absent.');
  const identity=row.current_identity_revision===null?null:repo.invoke('find_identity',{subject_id:row.subject_id,revision:number(row.current_identity_revision)});
  const value={subjectId:row.subject_id,status:'active',intakeRevision:number(row.intake_revision),structureKind:row.structure_kind,contentProfile:row.content_profile,
    routingAnchorIntakeDecisionId:row.routing_anchor_intake_decision_id,routingProvenance:{candidatePackageId:anchor.candidate_package_id,sourceFieldId:anchor.source_field_id,
      sourceFieldAccessRevision:number(anchor.source_field_access_revision),sourceFieldContextDigest:anchor.source_field_context_digest,candidateIdentityClaimDigest:anchor.candidate_identity_claim_digest},
    currentIdentityRevision:identity?number(identity.revision):null,currentIdentityDigest:identity?identity.identity_digest:null,continuitySetDigest:row.current_continuity_set_digest,
    episodeScopeDigest:row.current_episode_scope_digest};value.snapshotDigest=canonicalDigest(value);
  if(canonicalJson(value)!==canonicalJson(expected))fail('P8_DECISION_SUBJECT_STALE','Subject Decision Snapshot is stale or incomplete.');return row;
}
function validatePolicy(repo,set){
  const authority=set.routingAuthoritySnapshot;if(set.basisKind!=='routing'||set.readiness.result!=='ready'||!authority||authority.authorityKind!=='policy')return;
  const policy=authority.policy,head=repo.invoke('find_policy_head',{field_id:set.subjectSnapshot.routingProvenance.sourceFieldId});
  if(!head||head.current_routing_policy_id!==policy.routingPolicyId||number(head.current_policy_revision)!==policy.revision)fail('P8_DECISION_POLICY_STALE','Field Routing Policy head is stale.');
  const row=repo.invoke('find_policy',{routing_policy_id:policy.routingPolicyId,revision:policy.revision});
  const targets=repo.invoke('find_policy_targets',{routing_policy_id:policy.routingPolicyId,policy_revision:policy.revision}).sort((a,b)=>number(a.rank)-number(b.rank));
  if(!row||row.policy_digest!==policy.policyDigest||targets.length!==policy.targets.length||targets.some((item,index)=>item.shelf_id!==policy.targets[index].shelfId||number(item.rank)!==policy.targets[index].rank||item.match_rule_digest!==policy.targets[index].matchRuleDigest))fail('P8_DECISION_POLICY_STALE','Routing Policy snapshot cannot be reconstructed from current Owner rows.');
}
function validateHandle(handle,set){
  if(!handle||handle.schemaRef!=='helix://contracts/types/DomainFactCommitHandle/v1'||handle.schemaVersion!==1||handle.ownerDomain!=='libra'||
      handle.aggregateId!==set.subjectSnapshot.subjectId||handle.expectedRevision!==set.expectedDecisionHead.headRevision||handle.payloadDigest!==canonicalDigest(set)||
      handle.resultSchemaRef!==RESULT_SCHEMA||typeof handle.commitIdempotencyKey!=='string'||!handle.commitIdempotencyKey)fail('P8_DECISION_BASIS_HANDLE','Domain Fact Commit Handle does not bind the exact Decision Input Set.');
}
function basisFromRow(row,commitMarker){return Object.freeze({schemaRef:RESULT_SCHEMA,schemaVersion:1,factId:row.decision_basis_id,ownerDomain:'libra',aggregateType:'subject_decision_basis',aggregateId:row.subject_id,
  revision:number(row.basis_revision),factSchemaRef:'libra.decision-basis@1',factDigest:row.basis_digest,commitMarker,committedAtMs:number(row.committed_at_ms),decisionBasisId:row.decision_basis_id,
  subjectId:row.subject_id,basisKind:row.basis_kind,basisRevision:number(row.basis_revision),expectedHeadRevision:number(row.expected_head_revision),
  expectedHeadSnapshotDigest:row.expected_head_snapshot_digest,readiness:row.status,
  unresolvedReasonCode:row.unresolved_reason_code,routingDecisionId:row.routing_decision_id,queryResultSetDigest:row.query_result_set_digest,routingInputDigest:row.routing_input_digest,
  specInputDigest:row.spec_input_digest,productScopeDigest:row.product_scope_digest,inputSetDigest:row.input_set_digest,basisDigest:row.basis_digest});}

function reconstructInputSet(repo,basis){
  const rows=repo.invoke('find_inputs',{decision_basis_id:basis.decision_basis_id}).sort((a,b)=>number(a.input_ordinal)-number(b.input_ordinal));
  if(!rows.length||rows.some((row,index)=>number(row.input_ordinal)!==index))fail('P8_DECISION_BASIS_INPUT_INTEGRITY','Decision Basis inputs are missing or non-contiguous.');
  const byKind=(kind)=>rows.filter((row)=>row.input_kind===kind).map((row)=>JSON.parse(row.input_json));
  const one=(kind,required=false)=>{const values=byKind(kind);if(values.length>(required?1:1)||(required&&values.length!==1))fail('P8_DECISION_BASIS_INPUT_INTEGRITY','Decision Basis input cardinality is invalid.',{kind});return values[0]??null;};
  const subject=one('subject_snapshot',true),head=one('decision_head_snapshot',true),authority=one('routing_authority');
  const input=buildDecisionInputSet({basisKind:basis.basis_kind,subjectSnapshot:subject,expectedDecisionHead:head,readiness:{result:basis.status,...(basis.unresolved_reason_code?{reasonCode:basis.unresolved_reason_code}:{})},
    routingAuthoritySnapshot:authority,shelfRoutingTargets:byKind('shelf_routing_projection'),routingDecision:one('routing_decision'),
    shelfStandardProjection:one('shelf_standard_projection'),productScope:one('product_scope'),decisionFacts:[...byKind('routing_fact'),...byKind('decision_fact')],queryResults:byKind('query_result')});
  const expectedRows=inputSnapshotRows(input);if(input.inputSetDigest!==basis.input_set_digest||rows.length!==expectedRows.length||rows.some((row,index)=>{
    const expected=expectedRows[index];return row.input_kind!==expected.inputKind||row.input_schema_ref!==expected.inputSchemaRef||row.input_object_id!==expected.inputObjectId||
      number(row.input_revision)!==expected.inputRevision||row.input_digest!==expected.inputDigest||row.input_json!==expected.inputJson||
      row.provider_domain!==(expected.query?.providerDomain??null)||row.query_contract!==(expected.query?.queryContract??null)||
      (row.query_version===null?null:number(row.query_version))!==(expected.query?.queryVersion??null)||row.query_input_digest!==(expected.query?.inputDigest??null)||
      row.result_kind!==(expected.query?.resultKind??null)||(row.result_revision===null?null:number(row.result_revision))!==(expected.query?.resultRevision??null)||
      row.result_digest!==(expected.query?.resultDigest??null)||(row.expires_at_ms===null?null:number(row.expires_at_ms))!==(expected.query?.expiresAtMs??null);
  }))fail('P8_DECISION_BASIS_INPUT_INTEGRITY','Decision Basis input rows do not reconstruct the frozen Input Set.');
  if(number(basis.expected_head_revision)!==head.headRevision||basis.expected_head_snapshot_digest!==head.snapshotDigest)fail('P8_DECISION_BASIS_INPUT_INTEGRITY','Decision Basis expected Head pair does not match its typed input.');
  return input;
}

function createDecisionBasisStore(options){
  if(!options||!options.schemaManifest||!options.unitOfWork)fail('P8_DECISION_BASIS_DEPENDENCIES','Schema manifest and Unit of Work are required.');
  const libra=libraDefinitions(options.schemaManifest),foundation=foundationDefinitions(options.schemaManifest);
  return Object.freeze({repositoryManifest:Object.freeze({libraTableIds:libra.tableIds,foundationTableIds:foundation.tableIds}),commit(request){
    const set=buildDecisionInputSet(request?.decisionInputSet);validateHandle(request?.domainFactCommitHandle,set);const marker=request.commitMarker,resultId=request.resultId;
    if(typeof marker!=='string'||!marker||typeof resultId!=='string'||!resultId)fail('P8_DECISION_BASIS_IDENTITY','Commit marker and Result identity are required.');let result,replayed=false;
    const preflight={participantId:'decision_basis_preflight',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId),found=repo.invoke('find_marker',{commit_marker:marker});if(!found)return;
      if(found.owner_domain!=='libra'||found.scope_type!=='subject_decision_basis'||found.commit_digest!==request.domainFactCommitHandle.payloadDigest||found.result_schema_ref!==RESULT_SCHEMA)fail('P8_DECISION_BASIS_MARKER_CONFLICT','Commit marker belongs to another Basis.');const stored=repo.invoke('find_result',{result_id:found.result_id});if(!stored||stored.result_digest!==found.result_digest)fail('P8_DECISION_BASIS_REPLAY_CORRUPT','Stored Basis Result is absent.');result=JSON.parse(stored.result_json);if(canonicalDigest(result)!==found.result_digest)fail('P8_DECISION_BASIS_REPLAY_CORRUPT','Stored Basis Result is corrupt.');throw new Replay(result);}};
    const domain={participantId:'decision_basis_domain',owner:'libra',repositories:[libra],execute(context){const repo=context.repository(libra.repositoryId);
      const semantic=repo.invoke('find_semantic',{subject_id:set.subjectSnapshot.subjectId,basis_kind:set.basisKind,input_set_digest:set.inputSetDigest});
      if(semantic){const reconstructed=reconstructInputSet(repo,semantic);if(canonicalJson(reconstructed)!==canonicalJson(set))fail('P8_DECISION_BASIS_INPUT_INTEGRITY','Semantic replay input differs from stored Owner rows.');result=basisFromRow(semantic,marker);replayed=true;return;}
      reconstructSubject(repo,set.subjectSnapshot);validatePolicy(repo,set);
      const expected=set.expectedDecisionHead,head=repo.invoke('find_head',{subject_id:set.subjectSnapshot.subjectId});
      if(expected.headState==='absent'){if(head)fail('P8_DECISION_HEAD_CAS','First Decision head already exists.');}else if(!head||number(head.head_revision)!==expected.headRevision||head.head_digest!==expected.headDigest||
        head.current_routing_decision_id!==expected.currentRoutingDecisionId||head.current_decision_basis_id!==expected.currentDecisionBasisId||head.current_acceptance_spec_id!==expected.currentAcceptanceSpecId)fail('P8_DECISION_HEAD_CAS','Decision head is stale.');
      if(set.basisKind==='acceptance_spec'){const routing=repo.invoke('find_routing',{routing_decision_id:set.routingDecision.routingDecisionId});if(!routing||routing.subject_id!==set.subjectSnapshot.subjectId||routing.decision_digest!==set.routingDecision.decisionDigest||head?.current_routing_decision_id!==routing.routing_decision_id)fail('P8_DECISION_ROUTING_STALE','Acceptance Spec Basis does not bind the current Routing Decision.');}
      const rows=repo.invoke('list_basis',{subject_id:set.subjectSnapshot.subjectId}),basisRevision=rows.reduce((max,row)=>Math.max(max,number(row.basis_revision)),0)+1;
      result=buildDecisionBasisRevision(set,basisRevision,context.commitTimeMs,marker);repo.invoke('insert_basis',{decision_basis_id:result.decisionBasisId,subject_id:result.subjectId,basis_kind:result.basisKind,basis_revision:result.basisRevision,
        expected_head_revision:result.expectedHeadRevision,expected_head_snapshot_digest:result.expectedHeadSnapshotDigest,routing_decision_id:result.routingDecisionId,query_result_set_digest:result.queryResultSetDigest,routing_input_digest:result.routingInputDigest,
        spec_input_digest:result.specInputDigest,product_scope_digest:result.productScopeDigest,input_set_digest:result.inputSetDigest,status:result.readiness,unresolved_reason_code:result.unresolvedReasonCode,
        basis_digest:result.basisDigest,committed_at_ms:context.commitTimeMs});
      inputSnapshotRows(set).forEach((row)=>repo.invoke('insert_input',{decision_basis_id:result.decisionBasisId,input_ordinal:row.inputOrdinal,input_kind:row.inputKind,input_schema_ref:row.inputSchemaRef,
        input_object_id:row.inputObjectId,input_revision:row.inputRevision,input_digest:row.inputDigest,input_json:row.inputJson,provider_domain:row.query?.providerDomain??null,query_contract:row.query?.queryContract??null,
        query_version:row.query?.queryVersion??null,query_input_digest:row.query?.inputDigest??null,result_kind:row.query?.resultKind??null,result_revision:row.query?.resultRevision??null,
        result_digest:row.query?.resultDigest??null,expires_at_ms:row.query?.expiresAtMs??null}));
      const nextRevision=expected.headRevision+1,nextRouting=set.basisKind==='routing'?null:expected.currentRoutingDecisionId,nextSpec=null;
      const nextDigest=decisionHeadDigest(result.subjectId,nextRevision,nextRouting,result.decisionBasisId,nextSpec);
      if(expected.headState==='absent')repo.invoke('insert_head',{subject_id:result.subjectId,head_revision:nextRevision,head_digest:nextDigest,current_routing_decision_id:nextRouting,current_decision_basis_id:result.decisionBasisId,current_acceptance_spec_id:null,updated_at_ms:context.commitTimeMs});
      else if(repo.invoke('advance_head',{head_revision:nextRevision,head_digest:nextDigest,current_routing_decision_id:nextRouting,current_decision_basis_id:result.decisionBasisId,current_acceptance_spec_id:null,updated_at_ms:context.commitTimeMs,
        subject_id:result.subjectId,expected_head_revision:expected.headRevision,expected_head_digest:expected.headDigest,expected_routing_id:expected.currentRoutingDecisionId,expected_basis_id:expected.currentDecisionBasisId,expected_spec_id:expected.currentAcceptanceSpecId}).changes!==1)fail('P8_DECISION_HEAD_CAS','Decision head CAS failed.');
    }};
    const finish={participantId:'decision_basis_foundation',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId),resultDigest=canonicalDigest(result);
      repo.invoke('insert_result',{result_id:resultId,event_id:null,outcome_kind:'succeeded',result_schema_ref:RESULT_SCHEMA,result_json:canonicalJson(result),result_digest:resultDigest,evidence_schema_ref:null,evidence_json:null,evidence_digest:null,effect_receipt_id:null,committed_at_ms:context.commitTimeMs});
      if(set.routingAuthoritySnapshot?.authorityKind==='manual_selection'){const intent=set.routingAuthoritySnapshot.manualIntent,receiptId=canonicalDigest({schema:'foundation.command-receipt-id@1',ownerDomain:'libra',commandContract:'libra.select-shelf@1',callerScope:intent.actorId,idempotencyKey:intent.idempotencyKey});
        const found=repo.invoke('find_receipt',{owner_domain:'libra',command_contract:'libra.select-shelf@1',caller_scope:intent.actorId,idempotency_key:intent.idempotencyKey});if(found){if(found.request_digest!==intent.requestDigest||found.target_id!==result.decisionBasisId)fail('P8_DECISION_MANUAL_REPLAY_CONFLICT','Manual selection idempotency key conflicts.');}
        else repo.invoke('insert_receipt',{command_receipt_id:receiptId,owner_domain:'libra',command_contract:'libra.select-shelf@1',caller_scope:intent.actorId,idempotency_key:intent.idempotencyKey,request_digest:intent.requestDigest,
          target_type:'decision_basis',target_id:result.decisionBasisId,result_schema_ref:RESULT_SCHEMA,result_ref_json:canonicalJson(result),result_digest:resultDigest,committed_at_ms:context.commitTimeMs});}
      repo.invoke('insert_marker',{commit_marker:marker,effect_id:null,owner_domain:'libra',scope_type:'subject_decision_basis',scope_id:result.decisionBasisId,commit_digest:request.domainFactCommitHandle.payloadDigest,
        result_id:resultId,result_schema_ref:RESULT_SCHEMA,result_digest:resultDigest,committed_at_ms:context.commitTimeMs});}};
    try{options.unitOfWork.execute([preflight,domain,finish]);}catch(error){if(error instanceof Replay)return Object.freeze({result:error.result,replayed:true});throw error;}return Object.freeze({result,replayed});
  }});
}

module.exports=Object.freeze({DecisionBasisStoreError,RESULT_SCHEMA,createDecisionBasisStore});
