'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {setup,seed}=require('./fixtures/us-adult-cast-context');
const {proof}=require('./fixtures/us-adult-match-proof');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildRecord}=require('../../src/helix/domains/libra/model/us-adult-actor-choice');
const {createUsAdultMatchCompletionStore}=require('../../src/helix/domains/libra/persistence/us-adult-match-completion-store');
const {buildMediaCastDraft,buildProductFactHandle}=require('../../src/helix/domains/libra/model/product-fact-contracts');

test('explicit actor choice commits one same-Run actor with frozen name and user provenance without invented matching evidence',()=>harness(input=>{
  const h=setup(input);h.command.choose('run-1',h.choiceBody,'admin');const selected=h.selected(),value=h.cast(selected),
    committed=h.coordinator.execute(h.request(value));
  assert.equal(committed.replayed,false);assert.equal(committed.typedResult.relationCount,1);
  assert.equal(committed.typedResult.relations[0].personId,'actor-1');assert.equal(committed.typedResult.relations[0].displayName,'actor-1');
  assert.equal(committed.typedResult.relations[0].confidenceClass,'user_confirmed');assert.equal(selected.matchCompletion,null);
  assert.equal(input.db.prepare("SELECT source_ref_count FROM libra_product_fact_revisions WHERE fact_kind='media_cast'").get().source_ref_count,0);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_product_fact_source_refs').get().n,0);
  assert.equal(h.coordinator.execute(h.request(value)).replayed,true);
}));
test('automatic actor cast requires the exact completed winner and its persisted Work/Result matching source chain',()=>harness(input=>{
  const h=setup(input),evidence=proof(input),completion=createUsAdultMatchCompletionStore(h.options).freeze(evidence);
  for(const record of evidence.results)seed(input,record);
  const selected=h.selected(null,completion),value=h.cast(selected),committed=h.coordinator.execute(h.request(value));
  assert.equal(committed.typedResult.relations[0].personId,'actor-3');assert.equal(committed.typedResult.relations[0].confidenceClass,'strong');
  const ref=input.db.prepare('SELECT * FROM libra_product_fact_source_refs').get();
  assert.equal(ref.source_basis_kind,'us_adult_actor');assert.equal(ref.result_id,completion.winner.matchResultRef.resultId);
  assert.equal(ref.result_digest,canonicalDigest(completion.winner.personMatchEvidence));
}));
test('an unpersisted or superseded explicit actor choice cannot publish a US Media-Cast Fact',()=>harness(input=>{
  const h=setup(input),record=buildRecord({snapshot:input.snapshot,personSnapshot:input.pages[0].items[0],body:h.choiceBody,actorId:'admin'}),
    pending=h.cast(h.selected(record));
  assert.throws(()=>h.coordinator.execute(h.request(pending)),{code:'P9_US_ACTOR_CHOICE_STALE'});
  h.command.choose('run-1',h.choiceBody,'admin');const old=h.cast(h.selected());
  h.command.choose('run-1',{...h.choiceBody,personId:'actor-2',expectedChoiceRevision:1,idempotencyKey:'choose-next'},'admin');
  assert.throws(()=>h.coordinator.execute(h.request(old)),{code:'P9_US_ACTOR_CHOICE_STALE'});
  assert.equal(input.db.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='media_cast'").get().n,0);
  assert.equal(input.db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE result_id='cast-result'").get().n,0);
}));
test('US Owner rejects the old empty-match publication path and refuses a substituted actor relation',()=>harness(input=>{
  const h=setup(input),sourceBasis={sourceBasisKind:'western_match',sourceBasisDigest:canonicalDigest('unmatched'),
    westernBasis:{libraRunId:'run-1',matchState:'no_matches',basisId:'unmatched',basisDigest:canonicalDigest('unmatched')}},
    draft=buildMediaCastDraft({subjectId:'subject-1',sourceBasis,relations:[],producedAtMs:1}),payload={schema:'libra.media-cast-fact-commit-payload@1',sourceBasis,mediaCastDraft:draft},
    handle=buildProductFactHandle({libraRunId:'run-1',factKind:'media_cast',expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:canonicalDigest('fence')});
  assert.throws(()=>h.coordinator.execute(h.request({handle,payload})),{code:'P9_US_ACTOR_REQUIRED'});
  h.command.choose('run-1',h.choiceBody,'admin');const value=h.cast(h.selected()),changed=structuredClone(value.payload);
  changed.mediaCastDraft.relations[0].displayName='Substituted actor';
  const {draftDigest,...body}=changed.mediaCastDraft;changed.mediaCastDraft.draftDigest=canonicalDigest(body);
  const changedHandle=buildProductFactHandle({libraRunId:'run-1',factKind:'media_cast',expectedRevision:0,payloadDigest:canonicalDigest(changed),eventFenceDigest:canonicalDigest('fence')});
  assert.throws(()=>h.coordinator.execute(h.request({handle:changedHandle,payload:changed})),{code:'P9_US_ACTOR_SOURCE'});
}));
