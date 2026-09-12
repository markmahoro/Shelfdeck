'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {terminalPresentation}=require('../../src/helix/domains/libra/persistence/formation-run-history-store');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');

test('terminal history identifies user cancellation only from its explicit durable result',()=>{
  assert.deepEqual(terminalPresentation({outcome:'unable_to_on_deck',reason_code:'user_cancelled'}),
    {outcome:'user_abandoned',label:'已结束 · 用户放弃'});
  assert.deepEqual(terminalPresentation({outcome:'unable_to_on_deck',reason_code:'processing_failed'}),
    {outcome:'unable_to_on_deck',label:'无法上架'});
  for(const value of [null,{}, {outcome:'unable_to_on_deck',reason_code:'unknown'},
    {outcome:'on_deck',reason_code:'user_cancelled'}])
    assert.throws(()=>terminalPresentation(value),{code:'FORMATION_DISCARD_HISTORY_INTEGRITY'});
});

test('historical explicit admin Discard remains readable only with its original bound decision',()=>{
  const body={actorId:'admin',libraRunId:'run',discardDecisionId:'decision',expectedRunStateRevision:3};
  const decision={...body,decisionDigest:canonicalDigest(body)},receipt={libra_run_id:'run',discard_decision_id:'decision',committed_run_state_revision:4};
  assert.equal(terminalPresentation(undefined,decision,receipt).outcome,'user_abandoned');
  for(const changed of [{...decision,actorId:'system'},{...decision,libraRunId:'other'},{...decision,decisionDigest:'changed'}])
    assert.throws(()=>terminalPresentation(undefined,changed,receipt),{code:'FORMATION_DISCARD_HISTORY_INTEGRITY'});
});
