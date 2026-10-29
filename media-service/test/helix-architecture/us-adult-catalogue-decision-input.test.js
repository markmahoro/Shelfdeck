'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {coordination}=require('./fixtures/us-adult-catalogue-coordination');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultCatalogueDecisionInput}=require('../../src/helix/domains/libra/model/us-adult-catalogue-decision-input');
async function ready(t,{match=true}={}){
  const f=coordination(t);f.reconcile();await f.completeFrames('initial');const result=await f.completeObservation('initial',{match});
  f.options.movieProductionReader.readFact=()=>f.identity;
  return {...f,result,compile:()=>createUsAdultCatalogueDecisionInput(f.options).compile({libraRunId:'run',mode:'initial'})};
}
test('a qualified complete Observation yields a stable Owner input without creating a Person or Cast',async t=>{
  const f=await ready(t),value=f.compile();assert.equal(value.kind,'qualified');
  assert.equal(value.input.winner.name,'Example Performer');assert.equal(value.input.winner.uid,'catalogue:1');
  assert.equal(value.input.observationResultRef.resultId,f.records.get(f.result.work.workId)[0].resultId);
  assert.equal(value.input.observationHandle.observationArtifactHandle.digestHex,D(f.result.observation));
  assert.equal(value.input.expectedChoiceHead,null);assert.equal(value.inputDigest,D(value.input));
  assert.deepEqual(f.compile(),value);assert.equal(Object.hasOwn(value.input,'personId'),false);
});
test('an unqualified Observation is not a Person request and never becomes a guessed actor',async t=>{
  const f=await ready(t,{match:false}),value=f.compile();assert.equal(value.kind,'unqualified');
  assert.notEqual(value.status,'qualified_candidate');assert.equal(Object.hasOwn(value,'input'),false);
});
test('manual choice before or during Artifact read wins over automatic compilation',async t=>{
  const f=await ready(t);f.choice.current={intentId:'manual'};assert.equal(f.compile().kind,'manual_choice_present');
  f.choice.current=null;const read=f.options.workspaceProductPort.readArtifactBytes;
  f.options.workspaceProductPort.readArtifactBytes=handle=>{const data=read(handle);f.choice.current={intentId:'late'};return data;};
  assert.equal(f.compile().kind,'manual_choice_present');
});
test('stale identity, substituted producer Result and cancelled Owner state cannot compile an automatic request',async t=>{
  const f=await ready(t),original=f.options.movieProductionReader.readFact;
  f.options.movieProductionReader.readFact=()=>({factValue:{...f.identity.factValue,identityDigest:D('other')}});
  assert.throws(f.compile,{code:'US_ADULT_CATALOGUE_DECISION_INPUT_INVALID'});f.options.movieProductionReader.readFact=original;
  const records=f.records.get(f.result.work.workId),prior=records[0];records[0]={...prior,resultDigest:D('other')};
  assert.throws(f.compile,{code:'US_ADULT_CATALOGUE_RESULT_SCOPE_INVALID'});records[0]=prior;
  f.db.exec("UPDATE libra_runs SET state='discarded',state_revision=3");
  assert.throws(f.compile,{code:'US_ADULT_CATALOGUE_BASIS_STALE'});
});
