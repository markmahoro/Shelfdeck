'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {resolvePerception}=require('../../src/helix/domains/perception/capabilities/perception-resolution-resolver');

const digest=(value)=>canonicalDigest({value});
const anchor=(value,confidenceClass='strong')=>({anchorKind:'title',anchorValue:value,confidenceClass,evidenceDigest:digest(value+confidenceClass)});
function record(id,value,anchors=[anchor('same')]){const facts={};if(value!==undefined)facts.rating=value;return {perceptionId:id,recordKind:'observation',sourceKind:'user',sourceRecordKey:id,sourceRecordRevision:1,recordDigest:digest(id),facts,observedTitle:id,observedAtMs:1,identityAnchors:anchors,provenanceRef:'p:'+id,provenanceDigest:digest('p:'+id)};}
function inputs(records,overrides={}){
  const queryBody={queryContract:'perception.rating.resolve@1',queryVersion:1,querySchemaRef:'helix://contracts/domain-types/PerceptionResolutionQuery/v1',factKind:'rating',identityEvidence:[anchor(overrides.queryValue||'same')]};
  const query={...queryBody,queryInputDigest:canonicalDigest(queryBody)};
  const relations=overrides.relations||[];const setBody={queryInputDigest:query.queryInputDigest,records,relations};
  const recordSet={...setBody,recordSetDigest:canonicalDigest(setBody)};
  const fuzzy=overrides.fuzzy===true;
  const ruleBody={ruleContract:'beta',ruleVersion:1,supportedFactKinds:['rating'],candidateRetrievalClauses:[],
    anchorMatchers:[{anchorKind:'title',matchMode:fuzzy?'fuzzy':'exact',...(fuzzy?{normalizationProfileRef:'unicode_nfkc_casefold',threshold:.7}:{}),strengthRank:1,minConfidenceClass:'strong'}],winnerOrder:'strongest_anchor_then_value_consensus_then_perception_id',equalStrengthConflict:'not_found',duplicateProofMatchers:[{anchorKind:'title',matchMode:'exact',minConfidenceClass:'strong',requireSameAnchorValue:true,requireSameFactKind:true,requireSameCanonicalValue:true}],maxCandidateRecords:256};
  return {query,recordSet,ruleSnapshot:{...ruleBody,ruleDigest:canonicalDigest(ruleBody)}};
}
const resolve=(value)=>resolvePerception(value,{draftId:'draft',producedAtMs:1});

test('same strongest-tier value chooses the stable lowest perceptionId',()=>{
  const result=resolve(inputs([record('b',5),record('a',5)]));
  assert.equal(result.resultKind,'found');assert.equal(result.winningPerceptionId,'a');
});

test('same strongest tier with conflicting values returns not_found instead of choosing by order or time',()=>{
  const result=resolve(inputs([record('a',3),record('b',5)]));
  assert.equal(result.resultKind,'not_found');assert.equal(result.reasonCode,'strongest_value_conflict');
  assert.equal(Object.hasOwn(result,'winningPerceptionId'),false);
});

test('distinguishes no identity match from missing requested fact',()=>{
  assert.equal(resolve(inputs([record('a',5) ],{queryValue:'other'})).reasonCode,'no_matching_record');
  assert.equal(resolve(inputs([record('a',undefined)])).reasonCode,'requested_fact_absent');
});

test('excludes superseded targets and never treats fuzzy similarity as duplicate proof',()=>{
  const relations=[{relationId:'sup',relationKind:'supersedes',sourcePerceptionId:'b',targetPerceptionId:'a',ruleRevision:1,evidenceDigest:digest('sup')}];
  const superseded=resolve(inputs([record('a',3),record('b',5)],{relations}));
  assert.equal(superseded.winningPerceptionId,'b');
  const fuzzy=resolve(inputs([record('a',5,[anchor('Example Movie')]),record('b',5,[anchor('Example Movies')])],{queryValue:'Example Movie',fuzzy:true}));
  assert.equal(fuzzy.resultKind,'found');assert.deepEqual(fuzzy.duplicateRelationDrafts,[]);
});

test('fails closed when any typed input digest changes',()=>{
  const value=inputs([record('a',5)]);value.recordSet.records[0].facts.rating=4;
  assert.throws(()=>resolve(value),(error)=>error.code==='P6_PERCEPTION_RESOLUTION_INPUT_DIGEST');
});
