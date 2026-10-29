'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,schemaManifest,D,Database}=require('./fixtures/us-adult-analysis-basis-harness');
const {fixture:specFixture}=require('./fixtures/custom-acceptance-spec-harness');
const {canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {decisionHeadDigest}=require('../../src/helix/domains/libra/model/decision-front-half-contracts');
const {createCommandCommitCoordinator}=require('../../src/helix/foundation/persistence/commit-foundation');
const {createCustomTargetStore}=require('../../src/helix/domains/libra/persistence/custom-target-store');
const {createCustomSpecPublicationStore}=require('../../src/helix/domains/libra/persistence/custom-spec-publication-store');
const {harness}=require('./fixtures/custom-spec-publication-harness');

test('real SQLite publishes one complete custom Spec, advances the decision head and atomically records its receipt',()=>harness(h=>{
  const old=canonicalJson(h.db.prepare('SELECT * FROM libra_runs').get()),published=h.publish(),ref=published.receipt.resultRef,spec=h.publisher.read(ref.acceptanceSpecId);
  assert.equal(published.replayed,false);assert.equal(spec.targetKind,'user_custom');assert.equal(spec.specRevision,2);
  assert.equal(spec.originalTarget.acceptanceSpecId,h.base.acceptanceSpecId);assert.equal(spec.requirements.mandatoryMedia.minimumRasterClass,'none');
  assert.equal(spec.requirements.space.maxSizeGiB,50);assert.equal(ref.committedHeadRevision,5);
  assert.equal(h.db.prepare('SELECT current_acceptance_spec_id FROM libra_subject_decision_heads').get().current_acceptance_spec_id,spec.acceptanceSpecId);
  assert.deepEqual(h.counts(),[2,1,3,3,3]);assert.equal(canonicalJson(h.db.prepare('SELECT * FROM libra_runs').get()),old);
  assert.equal(h.db.prepare('SELECT spec_json FROM libra_acceptance_specs WHERE acceptance_spec_id=?').get(h.base.acceptanceSpecId).spec_json,canonicalJson(h.base));
  assert.deepEqual(h.db.pragma('foreign_key_check'),[]);
}));

test('publication replay precedes later Arca, Run and read-view changes and preserves the original revision',()=>harness(h=>{
  const first=h.publish(),readFence=h.unitOfWork.captureReadFence();h.db.exec("UPDATE libra_runs SET state='completed',state_revision=2");
  const replay=h.publish({readFence,currentBasis:{...h.currentBasis,handoffState:'accepted'}});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,first.receipt);assert.deepEqual(h.counts(),[2,1,3,3,3]);
  assert.equal(h.publisher.read(first.receipt.resultRef.acceptanceSpecId).specRevision,2);
  assert.throws(()=>h.publish({intentDigest:D('other')}),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
}));

test('fresh publication rejects Arca acceptance, changed Shelf projection and stale technical views',()=>harness(h=>{
  const before=h.counts();for(const currentBasis of [{...h.currentBasis,handoffState:'accepted'},
    {...h.currentBasis,shelfStandardRevision:2},{...h.currentBasis,runSpecDigest:D('different')}]){
    assert.throws(()=>h.publish({currentBasis}),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});assert.deepEqual(h.counts(),before);
  }
  const readFence=h.unitOfWork.captureReadFence();h.db.exec('UPDATE libra_subjects SET intake_revision=2');
  assert.throws(()=>h.publish({readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});assert.deepEqual(h.counts(),before);
}));

test('interruption after Spec, head and all technical writes rolls back the entire publication',()=>harness(h=>{
  const before=h.counts(),head=h.db.prepare('SELECT * FROM libra_subject_decision_heads').get();
  assert.throws(()=>h.publish(),/injected after publication/);assert.deepEqual(h.counts(),before);
  assert.deepEqual(h.db.prepare('SELECT * FROM libra_subject_decision_heads').get(),head);
  assert.equal(h.publish().replayed,false);assert.deepEqual(h.counts(),[2,1,3,3,3]);
},{failAfterPublication:true}));

test('the immutable custom Spec Reader rejects drift in relational placement and target headers',()=>harness(h=>{
  const id=h.publish().receipt.resultRef.acceptanceSpecId;
  h.db.prepare('UPDATE libra_acceptance_specs SET shelf_id=? WHERE acceptance_spec_id=?').run('other-shelf',id);
  assert.throws(()=>h.publisher.read(id),{code:'LIBRA_CUSTOM_SPEC_RECORD_INVALID'});
}));

test('post-confirmation execution suspension uses its fresh state without changing the durable user target',()=>harness(h=>{
  const confirmed=h.chosen.intent,revision=2,stateDigest=D('suspended-after-confirmation');
  h.db.prepare('UPDATE libra_runs SET state=?,state_revision=?,state_digest=?').run('suspended',revision,stateDigest);
  const published=h.publish({currentBasis:{...h.currentBasis,runState:'suspended',runStateRevision:revision,runStateDigest:stateDigest,
    gapEvidenceSetDigest:D('observations-after-confirmation')}}),
    spec=h.publisher.read(published.receipt.resultRef.acceptanceSpecId);
  assert.equal(spec.customTargetRef.intentDigest,confirmed.intentDigest);
  assert.equal(h.db.prepare('SELECT state FROM libra_runs').get().state,'suspended');
  assert.equal(JSON.parse(h.db.prepare('SELECT record_json FROM libra_custom_target_intents').get().record_json).basis.runState,'frozen');
}));

test('post-confirmation terminalization or another Package revision still forbids new Spec publication',()=>harness(h=>{
  h.db.prepare('UPDATE libra_runs SET package_revision_head=1').run();
  assert.throws(()=>h.publish({currentBasis:{...h.currentBasis,runPackageRevisionHead:1}}),{code:'LIBRA_CUSTOM_TARGET_PREVIEW_STALE'});
  h.db.prepare('UPDATE libra_runs SET package_revision_head=0,state=?').run('discarded');
  assert.throws(()=>h.publish({currentBasis:{...h.currentBasis,runState:'discarded'}}),{code:'LIBRA_CUSTOM_TARGET_SCOPE'});
  assert.deepEqual(h.counts(),[1,1,2,2,2]);
}));
