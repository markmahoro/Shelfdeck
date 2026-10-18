'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {setup}=require('./fixtures/us-adult-cast-context');
const {proof}=require('./fixtures/us-adult-match-proof');
const {createUsAdultAnalysisStore}=require('../../src/helix/domains/libra/persistence/us-adult-analysis-store');
const {createUsAdultMatchCompletionStore}=require('../../src/helix/domains/libra/persistence/us-adult-match-completion-store');
const {createUsAdultActorSelectionQuery}=require('../../src/helix/domains/libra/application/us-adult-actor-selection-query');
test('actor picker reads frozen Libra versions without creating Work or choice facts and becomes read-only after delivery',()=>harness(input=>{
  const owner=setup(input),completion=createUsAdultMatchCompletionStore(owner.options);completion.freeze(proof(input,{noFaces:true}));
  let snapshot={...input.snapshot,run:{...input.snapshot.run,state:'active',packageRevisionHead:0}};
  const query=createUsAdultActorSelectionQuery({movieProductionReader:{readRunSnapshot:()=>snapshot},
    usAdultActorChoiceStore:owner.store,usAdultAnalysisStore:createUsAdultAnalysisStore(input.options),usAdultMatchCompletionStore:completion});
  const waiting=query.read('run-1');assert.equal(waiting.analysisState,'completed');assert.equal(waiting.detectedFaceCount,0);
  assert.equal(waiting.selectedActor,null);assert.equal(waiting.canChoose,true);assert.equal(waiting.expectedChoiceRevision,0);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,0);
  assert.equal(input.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
  owner.command.choose('run-1',owner.choiceBody,'admin');
  const selected=query.read('run-1');assert.equal(selected.expectedChoiceRevision,1);assert.equal(selected.selectionOrigin,'user_choice');
  assert.deepEqual(selected.selectedActor,{personId:'actor-1',canonicalName:'actor-1',personRevision:1,referenceRevision:1});
  snapshot={...snapshot,run:{...snapshot.run,packageRevisionHead:1}};assert.equal(query.read('run-1').canChoose,false);
  snapshot={...snapshot,run:{...snapshot.run,state:'completed'}};assert.equal(query.read('run-1').canChoose,false);
  snapshot={...snapshot,spec:{...snapshot.spec,contentProfile:'movie'}};assert.throws(()=>query.read('run-1'),{code:'US_ADULT_ACTOR_CHOICE_INVALID'});
}));
