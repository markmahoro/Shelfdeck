'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildDecisionInputSet,buildDecisionBasisRevision}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {resolveAcceptanceSpec}=require('../../src/helix/domains/libra/model/acceptance-spec-contracts');
const {BETA_RECOMMENDED_RULES}=require('../../src/helix/domains/arca/model/rule-template-contracts');
const {fixture:specFixture}=require('./fixtures/custom-acceptance-spec-harness');
const {createCustomTargetBaselineReader}=require('../../src/helix/domains/libra/application/custom-target-baseline-reader');

const D=canonicalDigest,without=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));
function input(rating,revision=1,identity=D('identity')){
  const base=specFixture().inputSet,subject={...base.subjectSnapshot,currentIdentityRevision:1,currentIdentityDigest:identity};
  subject.snapshotDigest=D(without(subject,'snapshotDigest'));
  const projection={...base.shelfStandardProjection},standard={...projection.standard,
    profileRuleSets:[BETA_RECOMMENDED_RULES.profileRuleSets.find(item=>item.contentProfile==='movie')]};
  standard.standardDigest=D(without(standard,'standardDigest'));projection.standard=standard;
  projection.projectionResultDigest=D(without(projection,'projectionResultDigest'));
  const fact={schemaRef:'helix://contracts/types/PerceptionResolutionRevision/v1',factKind:'rating',factId:'rating-'+revision,
    factDigest:D('rating-'+revision),revision,resultKind:'found',resolvedValue:{factKind:'rating',value:rating},
    resolvedProvenance:{sourceKind:'shelfdeck_direct',winningPerceptionId:'direct-'+revision}},
    query={schemaRef:'helix://contracts/types/VersionedQueryResult/v1',providerDomain:'perception',queryContract:'perception.rating.resolve@1',
      queryVersion:1,inputDigest:D('query-'+revision),resultKind:'found',resultRevision:revision,resultDigest:fact.factDigest,expiresAtMs:1000};
  return buildDecisionInputSet({...base,subjectSnapshot:subject,shelfStandardProjection:projection,decisionFacts:[fact],queryResults:[query]});
}
function fixture(current=input(5)){
  let set=current,state='no_offer',available=true;
  const reader=createCustomTargetBaselineReader({acceptanceSpecContextReader:{read:()=>available?{kind:'ready',inputSet:set}:{kind:'pending_perception'}},
    readHandoffResponsibility:({subjectId,libraRunId})=>({kind:'ready',subjectId,libraRunId,
      productScopeDigest:set.productScope.scopeDigest,handoffState:state})});
  return {reader,setInput:value=>{set=value;},setState:value=>{state=value;},setAvailable:value=>{available=value;},
    request:{subjectId:'subject',libraRunId:'run',productScopeDigest:current.productScope.scopeDigest}};
}

test('current standard semantics follow the actual Perception rating and retain same-rating provenance changes',()=>{
  const f=fixture(),five=f.reader.read(f.request),requirements5=input(5).shelfStandardProjection.standard.profileRuleSets[0].decisionBranches
    .find(item=>item.rating===5).requirements;
  assert.equal(five.kind,'ready');assert.equal(five.identityDigest,D('identity'));
  assert.equal(five.standardSpecDigest,D({schema:'libra.acceptance-spec-semantic@1',targetShelfId:'shelf',contentProfile:'movie',
    structureKind:'single',productScope:{scopeKind:'single',episodeKeys:[]},requirements:requirements5}));
  const set=input(5),basis=buildDecisionBasisRevision(set,3,100,'fixture-marker'),
    standard=resolveAcceptanceSpec({inputSet:set,decisionBasis:basis,specRevision:1,producedAtMs:100,publishedAtMs:100});
  assert.equal(five.standardSpecDigest,standard.specDigest);
  f.setInput(input(5,2));assert.equal(f.reader.read(f.request).standardSpecDigest,five.standardSpecDigest);
  f.setInput(input(4,3));assert.notEqual(f.reader.read(f.request).standardSpecDigest,five.standardSpecDigest);
});

test('pending or foreign Owner views do not produce a ready custom target baseline',()=>{
  const f=fixture();f.setAvailable(false);assert.equal(f.reader.read(f.request).kind,'unavailable');
  f.setAvailable(true);f.setState('accepted');assert.equal(f.reader.read(f.request).handoffState,'accepted');
  const foreign=createCustomTargetBaselineReader({acceptanceSpecContextReader:{read:()=>({kind:'ready',inputSet:input(5)})},
    readHandoffResponsibility:()=>({kind:'ready',subjectId:'foreign',libraRunId:'run',productScopeDigest:f.request.productScopeDigest,handoffState:'no_offer'})});
  assert.throws(()=>foreign.read(f.request),{code:'LIBRA_CUSTOM_TARGET_BASELINE_INVALID'});
  const pending=createCustomTargetBaselineReader({acceptanceSpecContextReader:{read:()=>({kind:'ready',inputSet:input(5)})},
    readHandoffResponsibility:()=>({kind:'pending'})});
  assert.deepEqual(pending.read(f.request),{kind:'unavailable',reasonCode:'handoff_responsibility_pending'});
  const missingIdentity=createCustomTargetBaselineReader({acceptanceSpecContextReader:{read:()=>({kind:'ready',inputSet:specFixture().inputSet})},
    readHandoffResponsibility:()=>{throw new Error('identity must be checked first');}});
  assert.equal(missingIdentity.read(f.request).reasonCode,'current_identity_pending');
  const altered=input(5);const changed={...altered,subjectSnapshot:{...altered.subjectSnapshot,currentIdentityDigest:D('forged')}};
  const corrupt=createCustomTargetBaselineReader({acceptanceSpecContextReader:{read:()=>({kind:'ready',inputSet:changed})},
    readHandoffResponsibility:()=>{throw new Error('corrupt inputs must fail first');}});
  assert.throws(()=>corrupt.read(f.request));
});
