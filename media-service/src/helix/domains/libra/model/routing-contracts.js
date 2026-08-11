'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { utf8Compare } = require('./libra-intake-contracts');
const { LibraDecisionContractError, buildDecisionInputSet } = require('./decision-front-half-contracts');

function fail(code,message,details){throw new LibraDecisionContractError(code,message,details);}
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function digestValid(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function factValues(facts,kind){return facts.filter((fact)=>fact.factKind===kind);}
function scalarFact(fact){
  if(fact.factKind==='material_field')return fact.fieldId;
  if(fact.factKind==='release_year')return fact.year;
  if(fact.factKind==='region')return fact.countryCodes;
  if(fact.factKind==='genre')return fact.genreCodes;
  if(fact.factKind==='resolved_provider_identity')return Object.freeze({provider:fact.provider,namespace:fact.namespace,
    providerKey:fact.providerKey,identityRevision:fact.identityRevision,identityDigest:fact.identityDigest});
  return fact.value;
}
function expressionDigest(expression){return canonicalDigest(expression);}

function validatePredicateContract(expression){
  const scalarKinds=new Set(['content_profile','structure_kind','material_field']);
  const setKinds=new Set(['region','genre']);
  const allowed=expression.factKind==='release_year'?new Set(['eq','one_of','gte','lte','exists']):
    scalarKinds.has(expression.factKind)||setKinds.has(expression.factKind)||expression.factKind==='resolved_provider_identity'?
      new Set(['eq','one_of','exists']):new Set();
  if(!allowed.has(expression.operator))fail('P8_ROUTING_PREDICATE_OPERATOR','Routing operator is not valid for this Fact kind.');
  if(expression.operator==='exists'){
    if(typeof expression.expectedValue!=='boolean')fail('P8_ROUTING_PREDICATE_VALUE','exists requires a boolean expected value.');
    return;
  }
  if(expression.operator==='one_of'&&(!Array.isArray(expression.expectedValue)||expression.expectedValue.length<1||expression.expectedValue.length>64))
    fail('P8_ROUTING_PREDICATE_VALUE','one_of requires 1..64 expected values.');
  if(expression.factKind==='release_year'){
    const values=expression.operator==='one_of'?expression.expectedValue:[expression.expectedValue];
    if(values.some((value)=>!Number.isSafeInteger(value)||value<1870||value>3000))fail('P8_ROUTING_PREDICATE_VALUE','release_year requires bounded integers.');
  }else if(scalarKinds.has(expression.factKind)){
    const values=expression.operator==='one_of'?expression.expectedValue:[expression.expectedValue];
    if(values.some((value)=>typeof value!=='string'||!value))fail('P8_ROUTING_PREDICATE_VALUE','Scalar Routing Facts require text values.');
  }else if(setKinds.has(expression.factKind)){
    if(!Array.isArray(expression.expectedValue)||expression.expectedValue.length<1||expression.expectedValue.some((value)=>typeof value!=='string'||!value))
      fail('P8_ROUTING_PREDICATE_VALUE','Set Routing Facts require a non-empty text set.');
  }else if(expression.factKind==='resolved_provider_identity'){
    const values=expression.operator==='one_of'?expression.expectedValue:[expression.expectedValue];
    if(values.some((value)=>!value||typeof value!=='object'||Array.isArray(value)||typeof value.provider!=='string'||
      typeof value.namespace!=='string'||typeof value.providerKey!=='string'||!Number.isSafeInteger(value.identityRevision)||
      typeof value.identityDigest!=='string'))fail('P8_ROUTING_PREDICATE_VALUE','Provider identity expected value is invalid.');
  }
}

function validateExpression(expression,state={depth:1,count:{value:0}}){
  if(!expression||typeof expression!=='object'||Array.isArray(expression)||state.depth>4||state.count.value>=64)fail('P8_ROUTING_EXPRESSION_BOUND','Routing expression exceeds the closed AST bound.');
  state.count.value+=1;
  if(!['always','predicate','all','any','not'].includes(expression.nodeKind))fail('P8_ROUTING_EXPRESSION_KIND','Routing expression node is not registered.');
  if(expression.nodeKind==='predicate'){
    if(!['content_profile','structure_kind','material_field','release_year','region','genre','resolved_provider_identity'].includes(expression.factKind)||
        !['eq','one_of','gte','lte','exists'].includes(expression.operator)||!Object.hasOwn(expression,'expectedValue'))fail('P8_ROUTING_PREDICATE','Routing predicate is outside the closed vocabulary.');
    validatePredicateContract(expression);
  }else if(expression.nodeKind==='all'||expression.nodeKind==='any'){
    if(!Array.isArray(expression.children)||expression.children.length<1||expression.children.length>16)fail('P8_ROUTING_EXPRESSION_CHILDREN','all/any requires 1..16 children.');
    expression.children.forEach((child)=>validateExpression(child,{depth:state.depth+1,count:state.count}));
    const digests=expression.children.map(expressionDigest);if(digests.some((value,index)=>index&&utf8Compare(digests[index-1],value)>0))fail('P8_ROUTING_EXPRESSION_ORDER','Expression children are not digest ordered.');
  }else if(expression.nodeKind==='not')validateExpression(expression.child,{depth:state.depth+1,count:state.count});
  return expression;
}

function evaluatePredicate(expression,facts){
  const candidates=factValues(facts,expression.factKind);if(candidates.length!==1)return 'unknown';const actual=scalarFact(candidates[0]);
  if(expression.operator==='exists')return (actual!==null&&actual!==undefined)===(expression.expectedValue===true)?'true':'false';
  if(actual===null||actual===undefined)return 'unknown';
  if(['region','genre'].includes(expression.factKind)){
    if(!Array.isArray(actual)||!Array.isArray(expression.expectedValue))return 'unknown';
    const left=[...actual].sort(utf8Compare),right=[...expression.expectedValue].sort(utf8Compare);
    if(expression.operator==='eq')return JSON.stringify(left)===JSON.stringify(right)?'true':'false';
    return right.some((item)=>left.includes(item))?'true':'false';
  }
  if(expression.operator==='eq')return JSON.stringify(actual)===JSON.stringify(expression.expectedValue)?'true':'false';
  if(expression.operator==='one_of')return Array.isArray(expression.expectedValue)&&expression.expectedValue.some((item)=>JSON.stringify(item)===JSON.stringify(actual))?'true':'false';
  if(typeof actual!=='number'||typeof expression.expectedValue!=='number')return 'unknown';
  return expression.operator==='gte'?(actual>=expression.expectedValue?'true':'false'):(actual<=expression.expectedValue?'true':'false');
}

function evaluateRoutingExpression(expression,facts){
  validateExpression(expression);if(expression.nodeKind==='always')return 'true';if(expression.nodeKind==='predicate')return evaluatePredicate(expression,facts);
  if(expression.nodeKind==='not'){const value=evaluateRoutingExpression(expression.child,facts);return value==='unknown'?'unknown':value==='true'?'false':'true';}
  const values=expression.children.map((child)=>evaluateRoutingExpression(child,facts));
  if(expression.nodeKind==='all')return values.includes('false')?'false':values.includes('unknown')?'unknown':'true';
  return values.includes('true')?'true':values.includes('unknown')?'unknown':'false';
}

function authorityFields(authority){
  if(authority.authorityKind==='policy')return {routingAuthorityKind:'policy',routingPolicyId:authority.policy.routingPolicyId,
    routingPolicyRevision:authority.policy.revision,manualSelectionDigest:null};
  if(authority.authorityKind==='manual_selection')return {routingAuthorityKind:'manual_selection',routingPolicyId:null,routingPolicyRevision:null,
    manualSelectionDigest:authority.manualIntent.requestDigest};
  fail('P8_ROUTING_AUTHORITY','Routing authority variant is invalid.');
}

function resolveRoutingAssessment(value){
  const inputSet=buildDecisionInputSet(value);if(inputSet.basisKind!=='routing'||inputSet.readiness.result!=='ready')fail('P8_ROUTING_BASIS_NOT_READY','Routing Resolver requires a ready Routing Basis.');
  const authority=inputSet.routingAuthoritySnapshot,fields=authorityFields(authority),subjectId=inputSet.subjectSnapshot.subjectId;
  if(authority.authorityDigest!==canonicalDigest(without(authority,'authorityDigest')))fail('P8_ROUTING_AUTHORITY_DIGEST','Routing authority digest is invalid.');
  const targets=[];let result='unresolved',targetShelfId=null,unresolvedReasonCode=null;
  for(const projection of inputSet.shelfRoutingTargets){const expected=canonicalDigest({schema:'arca.shelf-routing-target-projection@1',shelfId:projection.shelfId,status:projection.status,
    routingProjectionRevision:projection.routingProjectionRevision,currentStandardRevision:projection.currentStandardRevision,currentStandardDigest:projection.currentStandardDigest});
    if(projection.projectionDigest!==expected)fail('P8_ROUTING_PROJECTION_DIGEST','Shelf Routing Projection digest is invalid.');}
  for(const fact of inputSet.decisionFacts.filter((item)=>['content_profile','structure_kind','material_field','release_year','region','genre','resolved_provider_identity'].includes(item.factKind))){
    if(fact.factDigest!==canonicalDigest(without(fact,'factDigest')))fail('P8_ROUTING_FACT_DIGEST','Routing Decision Fact digest is invalid.');}
  const byShelf=new Map(inputSet.shelfRoutingTargets.map((projection)=>[projection.shelfId,projection]));
  if(authority.authorityKind==='policy'){
    const policy=authority.policy;if(policy.policyDigest!==canonicalDigest(without(policy,'policyDigest'))||!Array.isArray(policy.targets)||policy.targets.length<1||policy.targets.length>64)fail('P8_ROUTING_POLICY','Routing Policy snapshot is invalid.');
    for(let index=0;index<policy.targets.length;index+=1){const item=policy.targets[index];if(item.rank!==index+1||item.matchRuleDigest!==expressionDigest(item.matchExpression))fail('P8_ROUTING_POLICY_TARGET','Routing Policy target rank or digest is invalid.');
      const projection=byShelf.get(item.shelfId);let evaluation='unknown';if(projection&&projection.status==='active'&&projection.currentStandardRevision!==null&&projection.currentStandardDigest!==null)evaluation=evaluateRoutingExpression(item.matchExpression,inputSet.decisionFacts);
      const evaluated={rank:item.rank,shelfId:item.shelfId,shelfProjectionRevision:projection?.routingProjectionRevision??0,
        shelfProjectionDigest:projection?.projectionDigest??canonicalDigest({schema:'libra.missing-shelf-projection@1',shelfId:item.shelfId}),
        matchRuleDigest:item.matchRuleDigest,evaluation,inputFactSetDigest:canonicalDigest({schema:'libra.routing-evaluation-fact-set@1',items:inputSet.decisionFacts.map((fact)=>fact.factDigest)})};
      evaluated.evaluationDigest=canonicalDigest(evaluated);targets.push(evaluated);
      if(evaluation==='true'){result='resolved';targetShelfId=item.shelfId;break;}if(evaluation==='unknown'){unresolvedReasonCode='higher_priority_rule_unknown';break;}
    }
    if(!targetShelfId&&!unresolvedReasonCode)unresolvedReasonCode='no_matching_shelf';
  }else{
    const intent=authority.manualIntent,projection=inputSet.shelfRoutingTargets[0];
    if(inputSet.shelfRoutingTargets.length!==1||!projection||projection.shelfId!==intent.targetShelfId)unresolvedReasonCode='manual_target_invalid';
    else if(projection.status!=='active'||projection.currentStandardRevision===null||projection.currentStandardDigest===null)unresolvedReasonCode='target_shelf_inactive';
    else{result='resolved';targetShelfId=projection.shelfId;}
    const evaluated={rank:1,shelfId:intent.targetShelfId,shelfProjectionRevision:projection?.routingProjectionRevision??0,
      shelfProjectionDigest:projection?.projectionDigest??canonicalDigest({schema:'libra.missing-shelf-projection@1',shelfId:intent.targetShelfId}),
      evaluation:result==='resolved'?'true':'false',inputFactSetDigest:canonicalDigest({schema:'libra.routing-evaluation-fact-set@1',items:[]})};
    evaluated.evaluationDigest=canonicalDigest(evaluated);targets.push(evaluated);
  }
  const shelfPrioritySetDigest=canonicalDigest({schema:'libra.shelf-priority-set@1',authorityKind:fields.routingAuthorityKind,
    items:targets.map((item)=>({rank:item.rank,shelfId:item.shelfId,matchRuleDigestOrNull:item.matchRuleDigest??null,
      shelfProjectionRevision:item.shelfProjectionRevision,shelfProjectionDigest:item.shelfProjectionDigest}))});
  const routingAssessmentId=canonicalDigest({schema:'libra.routing-assessment-id@1',subjectId,decisionBasisId:value.decisionBasisId,routingInputDigest:inputSet.routingInputDigest});
  const assessment={routingAssessmentId,subjectId,decisionBasisId:value.decisionBasisId,routingInputDigest:inputSet.routingInputDigest,...fields,
    evaluatedTargets:targets,result,targetShelfId,unresolvedReasonCode,shelfPrioritySetDigest};assessment.assessmentDigest=canonicalDigest(assessment);
  if(Buffer.byteLength(canonicalJson(assessment),'utf8')>65536)fail('P8_ROUTING_ASSESSMENT_LIMIT','Routing Assessment exceeds 64 KiB.');return Object.freeze(assessment);
}

function buildRoutingDecision(assessment,decisionRevision){
  if(!assessment||assessment.assessmentDigest!==canonicalDigest(without(assessment,'assessmentDigest'))||!Number.isSafeInteger(decisionRevision)||decisionRevision<1)fail('P8_ROUTING_DECISION_INPUT','Routing Decision input is invalid.');
  if((assessment.result==='resolved'&&(typeof assessment.targetShelfId!=='string'||!assessment.targetShelfId||assessment.unresolvedReasonCode!==null))||
      (assessment.result==='unresolved'&&(assessment.targetShelfId!==null||!['higher_priority_rule_unknown','no_matching_shelf','manual_target_invalid','target_shelf_inactive'].includes(assessment.unresolvedReasonCode))))fail('P8_ROUTING_DECISION_VARIANT','Routing Assessment result variant is invalid.');
  const routingDecisionId=canonicalDigest({schema:'libra.routing-decision-id@1',assessmentId:assessment.routingAssessmentId});
  const decision={routingDecisionId,subjectId:assessment.subjectId,decisionRevision,assessmentId:assessment.routingAssessmentId,
    decisionBasisId:assessment.decisionBasisId,routingAuthorityKind:assessment.routingAuthorityKind,routingPolicyId:assessment.routingPolicyId,
    routingPolicyRevision:assessment.routingPolicyRevision,manualSelectionDigest:assessment.manualSelectionDigest,routingInputDigest:assessment.routingInputDigest,
    shelfPrioritySetDigest:assessment.shelfPrioritySetDigest,result:assessment.result,targetShelfId:assessment.targetShelfId,
    unresolvedReasonCode:assessment.unresolvedReasonCode};decision.decisionDigest=canonicalDigest(decision);return Object.freeze(decision);
}

module.exports=Object.freeze({buildRoutingDecision,evaluateRoutingExpression,resolveRoutingAssessment,validateExpression});
