'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {proof}=require('./fixtures/us-adult-match-proof');
const {createUsAdultAnalysisStore}=require('../../src/helix/domains/libra/persistence/us-adult-analysis-store');
const {createUsAdultMatchCompletionStore}=require('../../src/helix/domains/libra/persistence/us-adult-match-completion-store');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {createUsAdultAnalysisCoordinator}=require('../../src/helix/domains/libra/application/us-adult-analysis-coordinator');
function store(input,extra={}){
  createUsAdultAnalysisStore(input.options).freeze(input.basis,input.pages);
  const schemas=['UsAdultMatchCompletion','UsAdultPersonSnapshot','PersonReferenceProjection'].map(type=>
    require('../../src/helix/contracts/domain-types/'+type+'/v1/schema.json'));
  schemas.push(require('../../src/helix/contracts/types/PersonMatchEvidence/v1/schema.json'));
  return createUsAdultMatchCompletionStore({...input.options,contractValidator:createCapabilityContractValidator({schemas}),...extra});
}
test('freezes the bounded highest match only after every page completed and preserves exact replay after Run completion',()=>harness(input=>{
  const s=store(input),evidence=proof(input),completed=s.freeze(evidence);
  assert.equal(completed.winner.personSnapshot.personId,'actor-3');assert.equal(completed.completedPageCount,3);assert.equal(completed.detectedFaceCount,20);
  assert.equal(Object.isFrozen(completed.winner.personSnapshot.referenceProjection),true);assert.deepEqual(s.getByRun('run-1'),completed);
  let resultReads=0;
  const coordinator=createUsAdultAnalysisCoordinator({usAdultAnalysisStore:createUsAdultAnalysisStore(input.options),usAdultMatchCompletionStore:s,
    submit(){throw new Error('Completed analysis must not admit more Work.');},peopleReferenceQuery:{readUsAdultReferencePage(){throw new Error('Completed analysis must not re-read the actor library.');}},
    workResultReader:{read(workId){resultReads++;return evidence.results.filter(item=>item.workId===workId);}}});
  const ready=coordinator.reconcile(input.snapshot,{factValue:{contentProfile:'western_adult',identityDigest:input.basis.resolvedIdentityDigest}},{libraRunId:'run-1'});
  assert.equal(ready.kind,'matched');assert.equal(ready.winner.personSnapshot.personId,'actor-3');assert.equal(resultReads,1);
  input.db.prepare("UPDATE libra_runs SET state='completed'").run();assert.deepEqual(s.freeze(evidence),completed);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_match_completions').get().n,1);
}));
test('incomplete or failed pages never become an unmatched completion and interruption rolls the completion row back',()=>harness(input=>{
  const s=store(input),evidence=proof(input);
  assert.throws(()=>s.freeze({...evidence,results:evidence.results.slice(0,2)}),/missing reference pages/);
  const failed=structuredClone(evidence);failed.results[1].outcomeKind='failed';assert.throws(()=>s.freeze(failed),/provenance changed/);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_match_completions').get().n,0);
  const interrupted=store(input,{afterCompletionInsert(){throw new Error('fixture-completion-interruption');}});
  assert.throws(()=>interrupted.freeze(evidence),/fixture-completion-interruption/);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_match_completions').get().n,0);
  assert.equal(s.freeze(evidence).winner.personSnapshot.personId,'actor-3');
}));
test('fully completed no-face matching is an explicit empty result and a stale Run rejects a new completion',()=>harness(input=>{
  const s=store(input),evidence=proof(input,{noFaces:true});
  input.db.prepare("UPDATE libra_runs SET state='frozen'").run();assert.throws(()=>s.freeze(evidence),{code:'US_ADULT_MATCH_COMPLETION_STALE'});
  input.db.prepare("UPDATE libra_runs SET state='active'").run();
  const completed=s.freeze(evidence);assert.equal(completed.winner,null);assert.equal(completed.detectedFaceCount,0);assert.equal(completed.completedPageCount,3);
  assert.throws(()=>s.freeze(proof(input)),{code:'US_ADULT_MATCH_COMPLETION_CONFLICT'});
}));
