'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,schemaManifest,Database}=require('./fixtures/us-adult-analysis-basis-harness');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository');
const {createArcaOfferResponsibilityProjection}=require('../../src/helix/domains/arca/public');
const {createOfferWithdrawalStore}=require('../../src/helix/domains/arca/persistence/offer-withdrawal-store');

function offer(){
  const value={onDeckPackageId:'package',packageRevision:1,packageDigest:D('package'),shelfId:'shelf',libraRunId:'run-1',
    subjectId:'subject',acceptanceSpecId:'spec',relatedDispositionSetDigest:D('related')};
  return {...value,offerId:D({schema:'libra.product-offer-id@1',onDeckPackageId:value.onDeckPackageId,packageDigest:value.packageDigest})};
}
function harness(fn){return fixture(h=>{
  const db=new Database(h.databasePath);db.pragma('foreign_keys = OFF');
  const options={schemaManifest,unitOfWork:h.unitOfWork,now:()=>1700000001000},input=offer();
  try{return fn({...h,db,options,input,projection:createArcaOfferResponsibilityProjection(options)});}finally{db.close();}
});}
function addAttempt(h,state='active',overrides={}){
  const o={offer_id:h.input.offerId,on_deck_package_id:h.input.onDeckPackageId,package_digest:h.input.packageDigest,
    shelf_id:h.input.shelfId,...overrides};
  h.db.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,shelf_id,state) VALUES(?,?,?,?,?,?)')
    .run('attempt',o.offer_id,o.on_deck_package_id,o.package_digest,o.shelf_id,state);
}
function addDecision(h,result='accepted',overrides={}){
  const o={offer_id:h.input.offerId,on_deck_package_id:h.input.onDeckPackageId,package_digest:h.input.packageDigest,
    shelf_id:h.input.shelfId,...overrides};
  h.db.prepare('INSERT INTO arca_acceptance_decisions(acceptance_decision_id,offer_id,on_deck_package_id,package_digest,shelf_id,result) VALUES(?,?,?,?,?,?)')
    .run('decision',o.offer_id,o.on_deck_package_id,o.package_digest,o.shelf_id,result);
}
function addCustody(h,overrides={}){
  const o={on_deck_package_id:h.input.onDeckPackageId,package_digest:h.input.packageDigest,...overrides};
  h.db.prepare('INSERT INTO arca_ondeck_custodies(custody_id,on_deck_package_id,package_digest,state) VALUES(?,?,?,?)')
    .run('custody',o.on_deck_package_id,o.package_digest,'active');
}
function addReceipt(h,outcome='accepted',overrides={}){
  const o={offer_id:h.input.offerId,on_deck_package_id:h.input.onDeckPackageId,package_digest:h.input.packageDigest,...overrides};
  h.db.prepare('INSERT INTO arca_handoff_b_receipts(receipt_id,offer_id,on_deck_package_id,package_digest,outcome) VALUES(?,?,?,?,?)')
    .run('receipt',o.offer_id,o.on_deck_package_id,o.package_digest,outcome);
}
function closeOffer(h){
  const body={eligibility:'ineligible',reasonCode:'target_not_current',libraRunId:h.input.libraRunId,runState:'frozen',runStateRevision:2,
    runStateDigest:D('frozen'),acceptanceSpecId:h.input.acceptanceSpecId,packageRevisionHead:1,deliveryReceiptAbsent:true};
  return createOfferWithdrawalStore(h.options).close({offer:h.input,deliveryFence:{...body,fenceDigest:D(body)},
    readFence:h.unitOfWork.captureReadFence()}).receipt.resultRef;
}

test('exact Offer has no accepted responsibility only when every Arca acceptance source is absent or nonaccepted',()=>harness(h=>{
  assert.deepEqual(h.projection.read(h.input),{kind:'ready',offer:h.input,state:'not_accepted'});
  addAttempt(h);assert.equal(h.projection.read(h.input).state,'not_accepted');
  addDecision(h,'rejected');addReceipt(h,'rejected');assert.equal(h.projection.read(h.input).state,'not_accepted');
}));

for(const kind of ['attempt','decision','custody','receipt'])test('any '+kind+' accepted evidence blocks an unaccepted conclusion',()=>harness(h=>{
  if(kind==='attempt')addAttempt(h,'accepted');
  if(kind==='decision')addDecision(h);
  if(kind==='custody')addCustody(h);
  if(kind==='receipt')addReceipt(h);
  assert.equal(h.projection.read(h.input).state,'acceptance_present');
}));

test('withdrawal returns the reconstructed exact Arca receipt and cannot coexist with accepted evidence',()=>harness(h=>{
  addAttempt(h);const receipt=closeOffer(h);
  assert.deepEqual(h.projection.read(h.input),{kind:'ready',offer:h.input,state:'withdrawn',withdrawalReceipt:receipt});
  addDecision(h);assert.throws(()=>h.projection.read(h.input),{code:'ARCA_OFFER_RESPONSIBILITY_CORRUPT'});
}));

test('withdrawal must match the entire requested Offer and its stored receipt must reconstruct',()=>harness(h=>{
  const receipt=closeOffer(h);
  assert.throws(()=>h.projection.read({...h.input,subjectId:'another-subject'}),{code:'ARCA_OFFER_RESPONSIBILITY_CORRUPT'});
  h.db.prepare('UPDATE arca_offer_withdrawal_receipts SET receipt_json=?').run(canonicalJson({...receipt,reasonCode:'run_not_active'}));
  assert.throws(()=>h.projection.read(h.input),{code:'ARCA_OFFER_WITHDRAWAL_CORRUPT'});
}));

for(const kind of ['attempt_offer','attempt_package','decision_offer','decision_package','custody_digest','receipt_offer','receipt_package'])
  test('conflicting '+kind+' is never treated as missing Arca evidence',()=>harness(h=>{
    if(kind==='attempt_offer')addAttempt(h,'active',{on_deck_package_id:'foreign-package'});
    if(kind==='attempt_package')addAttempt(h,'active',{offer_id:D('foreign-offer')});
    if(kind==='decision_offer')addDecision(h,'rejected',{on_deck_package_id:'foreign-package'});
    if(kind==='decision_package')addDecision(h,'rejected',{offer_id:D('foreign-offer')});
    if(kind==='custody_digest')addCustody(h,{package_digest:D('foreign-digest')});
    if(kind==='receipt_offer')addReceipt(h,'rejected',{on_deck_package_id:'foreign-package'});
    if(kind==='receipt_package')addReceipt(h,'rejected',{offer_id:D('foreign-offer')});
    assert.throws(()=>h.projection.read(h.input),{code:'ARCA_OFFER_RESPONSIBILITY_CORRUPT'});
  }));

test('a caller must use its pre-read opaque fence for the subsequent atomic write',()=>harness(h=>{
  const fence=h.unitOfWork.captureReadFence();assert.equal(h.projection.read(h.input).state,'not_accepted');
  addCustody(h);
  const repository=createRepositoryDefinition({repositoryId:'libra_fenced_test',owner:'libra',schemaManifest,statements:{
    insert:{kind:'insert',tableId:'libra_subjects',columns:['subject_id','status','content_profile','structure_kind','intake_revision']}}});
  assert.throws(()=>h.unitOfWork.execute([{participantId:'libra_fenced_write',owner:'libra',repositories:[repository],execute(context){
    return context.repository(repository.repositoryId).invoke('insert',{subject_id:'stale-subject',status:'active',
      content_profile:'movie',structure_kind:'single',intake_revision:1});
  }}],{readFence:fence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.equal(h.db.prepare("SELECT count(*) n FROM libra_subjects WHERE subject_id='stale-subject'").get().n,0);
}));
