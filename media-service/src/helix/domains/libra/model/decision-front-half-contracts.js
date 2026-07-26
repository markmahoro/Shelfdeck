'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { utf8Compare } = require('./libra-intake-contracts');

const BASIS_KINDS = new Set(['routing', 'acceptance_spec']);
const READINESS_REASONS = new Set(['routing_policy_unavailable','subject_provenance_incomplete','required_input_missing',
  'required_input_conflicting','required_input_unavailable','shelf_projection_unavailable','routing_not_resolved',
  'target_shelf_not_active','shelf_standard_unavailable','profile_rule_not_found','product_scope_unavailable']);
const ROUTING_REASONS = new Set(['higher_priority_rule_unknown','no_matching_shelf','manual_target_invalid','target_shelf_inactive']);
const CONTENT_PROFILES = new Set(['movie','series','jav','western_adult']);
const INPUT_KINDS = new Set(['subject_snapshot','decision_head_snapshot','routing_authority','shelf_routing_projection','routing_fact','routing_decision',
  'shelf_standard_projection','product_scope','decision_fact','query_result']);
const REQUIREMENT_KEYS = ['identity','structure','metadata','mandatoryMedia','space','inventory'];

class LibraDecisionContractError extends Error {
  constructor(code,message,details={}){super(message);this.name='LibraDecisionContractError';this.code=code;this.details=details;}
}
function fail(code,message,details){throw new LibraDecisionContractError(code,message,details);}
function object(value,code){if(!value||typeof value!=='object'||Array.isArray(value))fail(code,'A closed typed object is required.');return value;}
function text(value,field){if(typeof value!=='string'||!value)fail('P8_DECISION_TEXT','A non-empty text value is required.',{field});return value;}
function digest(value,field){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('P8_DECISION_DIGEST','A SHA-256 digest is required.',{field});return value;}
function integer(value,minimum,field){if(!Number.isSafeInteger(value)||value<minimum)fail('P8_DECISION_REVISION','A bounded integer revision is required.',{field});return value;}
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function bytes(value,limit,code){if(Buffer.byteLength(canonicalJson(value),'utf8')>limit)fail(code,'Typed value exceeds its canonical byte limit.');}
function optional(value,key){return Object.hasOwn(value,key)?value[key]:null;}
function sortedUnique(values,key,code){const copy=[...values].sort((a,b)=>utf8Compare(key(a),key(b)));if(copy.some((v,i)=>i&&key(v)===key(copy[i-1])))fail(code,'Typed collection contains duplicate identities.');return copy;}

function decisionHeadDigest(subjectId,headRevision,currentRoutingDecisionId,currentDecisionBasisId,currentAcceptanceSpecId){
  return canonicalDigest({schema:'libra.subject-decision-head@1',subjectId,headRevision,currentRoutingDecisionId,currentDecisionBasisId,currentAcceptanceSpecId});
}

function validateSubjectSnapshot(value){
  object(value,'P8_SUBJECT_SNAPSHOT_REQUIRED');
  if(value.status!=='active'||!['single','season'].includes(value.structureKind)||!CONTENT_PROFILES.has(value.contentProfile)||
      (value.contentProfile==='series')!==(value.structureKind==='season'))fail('P8_SUBJECT_SNAPSHOT_PROFILE','Subject snapshot has an invalid active profile/structure pair.');
  for(const field of ['subjectId','routingAnchorIntakeDecisionId','continuitySetDigest','episodeScopeDigest','snapshotDigest'])text(value[field],field);
  integer(value.intakeRevision,1,'intakeRevision');
  const provenance=object(value.routingProvenance,'P8_SUBJECT_PROVENANCE_REQUIRED');
  for(const field of ['candidatePackageId','sourceFieldId','sourceFieldContextDigest','candidateIdentityClaimDigest'])text(provenance[field],field);
  integer(provenance.sourceFieldAccessRevision,1,'sourceFieldAccessRevision');
  if((optional(value,'currentIdentityRevision')===null)!==(optional(value,'currentIdentityDigest')===null))fail('P8_SUBJECT_IDENTITY_POINTER','Identity revision and digest must be jointly null or present.');
  if(optional(value,'currentIdentityRevision')!==null)integer(value.currentIdentityRevision,1,'currentIdentityRevision');
  if(optional(value,'currentIdentityDigest')!==null)digest(value.currentIdentityDigest,'currentIdentityDigest');
  if(value.snapshotDigest!==canonicalDigest(without(value,'snapshotDigest')))fail('P8_SUBJECT_SNAPSHOT_DIGEST','Subject snapshot digest is invalid.');
  return value;
}

function validateExpectedHead(subjectId,value){
  object(value,'P8_DECISION_HEAD_REQUIRED');integer(value.headRevision,0,'expectedDecisionHead.headRevision');
  const pointers=['currentRoutingDecisionId','currentDecisionBasisId','currentAcceptanceSpecId'].map((key)=>optional(value,key));
  if(value.headState==='absent'){
    if(value.headRevision!==0||optional(value,'headDigest')!==null||pointers.some((item)=>item!==null))fail('P8_DECISION_HEAD_INITIAL','Absent Decision head requires revision zero and null digest/pointers.');
  }else if(value.headState==='present'){
    if(value.headRevision<1||!pointers[1]||value.headDigest!==decisionHeadDigest(subjectId,value.headRevision,...pointers)||
        (pointers[0]!==null&&pointers[1]===null)||(pointers[2]!==null&&(pointers[0]===null||pointers[1]===null)))fail('P8_DECISION_HEAD_DIGEST','Present Decision head snapshot is invalid.');
  }else fail('P8_DECISION_HEAD_STATE','Decision head state is invalid.');
  const snapshot={subjectId,headState:value.headState,headRevision:value.headRevision,headDigest:optional(value,'headDigest'),
    currentRoutingDecisionId:pointers[0],currentDecisionBasisId:pointers[1],currentAcceptanceSpecId:pointers[2]};
  snapshot.snapshotDigest=canonicalDigest({schema:'libra.subject-decision-head-snapshot@1',...snapshot});
  if(value.snapshotDigest!==snapshot.snapshotDigest)fail('P8_DECISION_HEAD_SNAPSHOT_DIGEST','Decision head snapshot digest is invalid.');
  return snapshot;
}

function querySummary(value){
  object(value,'P8_DECISION_QUERY_RESULT');
  for(const field of ['providerDomain','queryContract','inputDigest','resultKind','resultDigest'])text(value[field],field);
  integer(value.queryVersion,1,'queryVersion');integer(value.resultRevision,0,'resultRevision');integer(value.expiresAtMs,0,'expiresAtMs');
  return {providerDomain:value.providerDomain,queryContract:value.queryContract,queryVersion:value.queryVersion,inputDigest:value.inputDigest,
    resultKind:value.resultKind,resultRevision:value.resultRevision,resultDigest:value.resultDigest,expiresAtMs:value.expiresAtMs};
}

function inputSnapshotRows(inputSet){
  const rows=[];
  const add=(inputKind,value,query=null)=>{if(value===null||value===undefined)return;object(value,'P8_DECISION_INPUT_OBJECT');
    const schemaDefaults={subject_snapshot:'SubjectDecisionSnapshot@1',decision_head_snapshot:'SubjectDecisionHeadSnapshot@1',routing_authority:'RoutingAuthoritySnapshot@1',shelf_routing_projection:'ShelfRoutingTargetProjection@1',
      routing_decision:'RoutingDecision@1',shelf_standard_projection:'ShelfStandardProjection@1',product_scope:'ProductScopeSnapshot@1',
      routing_fact:'RoutingDecisionFact@1',decision_fact:'PerceptionResolutionRevision@1',query_result:'VersionedQueryResult@1'};
    const inputSchemaRef=text(value.schemaRef||value.factSchemaRef||value.projectionContract||value.snapshotContract||value.queryContract||schemaDefaults[inputKind],inputKind+'.schemaRef');
    const authority=value.authorityKind==='policy'?value.policy:value.manualIntent;
    const inputObjectId=text(value.objectId||value.factId||value.sourceObjectId||value.subjectId||value.routingDecisionId||value.shelfId||value.scopeDigest||value.queryInputDigest||value.inputDigest||
      authority?.routingPolicyId||authority?.requestDigest,inputKind+'.objectId');
    const inputRevision=integer(value.headRevision??value.revision??value.routingProjectionRevision??value.standardRevision??value.subjectIntakeRevision??value.intakeRevision??value.sourceRevision??value.decisionRevision??value.resultRevision??
      authority?.revision??authority?.expectedDecisionHead?.revision,0,inputKind+'.revision');
    const inputDigest=digest(value.digest||value.factDigest||value.snapshotDigest||value.authorityDigest||value.projectionDigest||value.projectionResultDigest||value.scopeDigest||value.decisionDigest||value.resultDigest,inputKind+'.digest');
    bytes(value,65536,'P8_DECISION_INPUT_ITEM_LIMIT');rows.push({inputKind,inputSchemaRef,inputObjectId,inputRevision,inputDigest,inputJson:canonicalJson(value),query});};
  add('subject_snapshot',inputSet.subjectSnapshot);
  add('decision_head_snapshot',inputSet.expectedDecisionHead);
  add('routing_authority',optional(inputSet,'routingAuthoritySnapshot'));
  inputSet.shelfRoutingTargets.forEach((value)=>add('shelf_routing_projection',value));
  add('routing_decision',optional(inputSet,'routingDecision'));
  add('shelf_standard_projection',optional(inputSet,'shelfStandardProjection'));
  add('product_scope',optional(inputSet,'productScope'));
  inputSet.decisionFacts.forEach((value)=>add(value.factKind&&['content_profile','structure_kind','material_field','release_year','region','genre','resolved_provider_identity'].includes(value.factKind)?'routing_fact':'decision_fact',value));
  inputSet.queryResults.forEach((value)=>add('query_result',value,querySummary(value)));
  return rows.map((row,inputOrdinal)=>Object.freeze({...row,inputOrdinal}));
}

function buildDecisionInputSet(value){
  object(value,'P8_DECISION_INPUT_SET_REQUIRED');if(!BASIS_KINDS.has(value.basisKind))fail('P8_DECISION_BASIS_KIND','Decision Basis kind is invalid.');
  const subject=validateSubjectSnapshot(value.subjectSnapshot),expectedHead=validateExpectedHead(subject.subjectId,value.expectedDecisionHead);
  const readiness=object(value.readiness,'P8_DECISION_READINESS_REQUIRED');
  if(!['ready','unresolved'].includes(readiness.result)||(readiness.result==='ready'&&optional(readiness,'reasonCode')!==null)||
      (readiness.result==='unresolved'&&!READINESS_REASONS.has(readiness.reasonCode)))fail('P8_DECISION_READINESS','Decision readiness variant is invalid.');
  const shelfRoutingTargets=Array.isArray(value.shelfRoutingTargets)?value.shelfRoutingTargets:fail('P8_ROUTING_TARGETS','Routing targets are required.');
  const decisionFacts=Array.isArray(value.decisionFacts)?sortedUnique(value.decisionFacts,(item)=>(item.factKind||'')+'\0'+(item.factDigest||''),'P8_DECISION_FACT_DUPLICATE'):fail('P8_DECISION_FACTS','Decision facts are required.');
  const queryResults=Array.isArray(value.queryResults)?sortedUnique(value.queryResults,(item)=>(item.providerDomain||'')+'\0'+(item.queryContract||'')+'\0'+(item.inputDigest||'')+'\0'+(item.resultDigest||''),'P8_DECISION_QUERY_DUPLICATE'):fail('P8_DECISION_QUERY_RESULTS','Query results are required.');
  if(shelfRoutingTargets.length>128||decisionFacts.length>128||queryResults.length>128)fail('P8_DECISION_INPUT_BOUND','Decision input collections exceed 128 items.');
  const queryResultSetDigest=canonicalDigest({schema:'libra.decision-query-result-set@1',items:queryResults.map(querySummary)});
  const core={basisKind:value.basisKind,subjectSnapshot:subject,expectedDecisionHead:expectedHead,readiness,
    routingAuthoritySnapshot:optional(value,'routingAuthoritySnapshot'),shelfRoutingTargets,routingDecision:optional(value,'routingDecision'),
    shelfStandardProjection:optional(value,'shelfStandardProjection'),productScope:optional(value,'productScope'),decisionFacts,queryResults,queryResultSetDigest};
  if(value.basisKind==='routing'){
    if(core.shelfStandardProjection!==null||core.productScope!==null||core.routingDecision!==null)fail('P8_ROUTING_INPUT_SCOPE','Routing Basis cannot contain Spec inputs.');
    if(readiness.result==='ready'&&!core.routingAuthoritySnapshot)fail('P8_ROUTING_AUTHORITY_REQUIRED','Ready Routing Basis requires authority.');
    if(readiness.result==='ready'&&core.routingAuthoritySnapshot.authorityKind==='policy'){
      const policy=core.routingAuthoritySnapshot.policy;
      if(!policy||!Array.isArray(policy.targets)||policy.targets.length!==shelfRoutingTargets.length||
          policy.targets.some((target,index)=>target.shelfId!==shelfRoutingTargets[index]?.shelfId))fail('P8_ROUTING_TARGET_COVERAGE','Ready policy Basis must carry every target projection in rank order.');
    }
    if(readiness.result==='ready'&&core.routingAuthoritySnapshot.authorityKind==='manual_selection'&&
        (shelfRoutingTargets.length!==1||shelfRoutingTargets[0].shelfId!==core.routingAuthoritySnapshot.manualIntent?.targetShelfId))fail('P8_ROUTING_TARGET_COVERAGE','Ready manual Basis must carry exactly the selected target projection.');
    core.routingInputDigest=canonicalDigest({schema:'libra.routing-input@1',subjectSnapshot:subject,routingAuthoritySnapshotOrNull:core.routingAuthoritySnapshot,
      shelfRoutingTargets,decisionFacts,queryResults});core.specInputDigest=null;
  }else{
    if(core.routingAuthoritySnapshot!==null||shelfRoutingTargets.length)fail('P8_SPEC_INPUT_SCOPE','Acceptance Spec Basis cannot contain Routing preparation inputs.');
    if(readiness.result==='ready'&&(!core.routingDecision||core.routingDecision.result!=='resolved'||!core.shelfStandardProjection||!core.productScope))fail('P8_SPEC_INPUT_REQUIRED','Ready Acceptance Spec Basis requires resolved Routing, Standard, and Product Scope.');
    core.routingInputDigest=core.routingDecision?digest(core.routingDecision.routingInputDigest,'routingDecision.routingInputDigest'):null;
    core.specInputDigest=canonicalDigest({schema:'libra.spec-input@1',subjectSnapshot:subject,routingDecisionOrNull:core.routingDecision,
      shelfStandardProjectionOrNull:core.shelfStandardProjection,productScopeOrNull:core.productScope,decisionFacts,queryResults});
  }
  const inputSetDigest=canonicalDigest(core),decisionInputSetId=canonicalDigest({schema:'libra.decision-input-set-id@1',basisKind:value.basisKind,subjectId:subject.subjectId,inputSetDigest});
  const result=Object.freeze({decisionInputSetId,...core,inputSetDigest});bytes(result,1048576,'P8_DECISION_INPUT_SET_LIMIT');inputSnapshotRows(result);return result;
}

function buildDecisionBasisRevision(inputSet,basisRevision,committedAtMs,commitMarker){
  const set=buildDecisionInputSet(inputSet);integer(basisRevision,1,'basisRevision');integer(committedAtMs,0,'committedAtMs');text(commitMarker,'commitMarker');
  const decisionBasisId=canonicalDigest({schema:'libra.decision-basis-id@1',subjectId:set.subjectSnapshot.subjectId,basisKind:set.basisKind,basisRevision,inputSetDigest:set.inputSetDigest});
  const routingDecisionId=set.basisKind==='acceptance_spec'&&set.readiness.result==='ready'?set.routingDecision.routingDecisionId:null;
  const productScopeDigest=set.productScope?set.productScope.scopeDigest:null;
  const basisDigest=canonicalDigest({schema:'libra.decision-basis@1',decisionBasisId,subjectId:set.subjectSnapshot.subjectId,basisKind:set.basisKind,basisRevision,
    expectedHeadRevision:set.expectedDecisionHead.headRevision,expectedHeadSnapshotDigest:set.expectedDecisionHead.snapshotDigest,
    readiness:set.readiness.result,unresolvedReasonCode:optional(set.readiness,'reasonCode'),routingDecisionId,queryResultSetDigest:set.queryResultSetDigest,
    routingInputDigest:set.routingInputDigest,specInputDigest:set.specInputDigest,productScopeDigest,inputSetDigest:set.inputSetDigest});
  const result=Object.freeze({schemaRef:'helix://contracts/types/DecisionBasisRevision/v1',schemaVersion:1,factId:decisionBasisId,ownerDomain:'libra',
    aggregateType:'subject_decision_basis',aggregateId:set.subjectSnapshot.subjectId,revision:basisRevision,factSchemaRef:'libra.decision-basis@1',factDigest:basisDigest,
    commitMarker,committedAtMs,decisionBasisId,subjectId:set.subjectSnapshot.subjectId,basisKind:set.basisKind,basisRevision,
    expectedHeadRevision:set.expectedDecisionHead.headRevision,expectedHeadSnapshotDigest:set.expectedDecisionHead.snapshotDigest,
    readiness:set.readiness.result,unresolvedReasonCode:optional(set.readiness,'reasonCode'),routingDecisionId,
    queryResultSetDigest:set.queryResultSetDigest,routingInputDigest:set.routingInputDigest,specInputDigest:set.specInputDigest,productScopeDigest,inputSetDigest:set.inputSetDigest,basisDigest});
  bytes(result,16384,'P8_DECISION_BASIS_LIMIT');return result;
}

module.exports=Object.freeze({BASIS_KINDS,CONTENT_PROFILES,INPUT_KINDS,LibraDecisionContractError,READINESS_REASONS,REQUIREMENT_KEYS,
  ROUTING_REASONS,buildDecisionBasisRevision,buildDecisionInputSet,decisionHeadDigest,inputSnapshotRows,validateSubjectSnapshot});
