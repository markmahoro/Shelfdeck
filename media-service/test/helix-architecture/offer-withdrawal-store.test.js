'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,schemaManifest,Database}=require('./fixtures/us-adult-analysis-basis-harness');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildOfferWithdrawal,assertOfferWithdrawal}=require('../../src/helix/domains/arca/model/offer-withdrawal');
const {createOfferWithdrawalStore}=require('../../src/helix/domains/arca/persistence/offer-withdrawal-store');
const {createOnDeckProcessCoordinator,refsFromOffer}=require('../../src/helix/domains/arca/application/on-deck-process-coordinator');
const {createHandoffBAcceptanceStore}=require('../../src/helix/domains/arca/persistence/handoff-b-acceptance-store');
const {createFormationStatusProjection}=require('../../src/helix/domains/arca/application/formation-status-projection');
const {createOutboxDispatcherHost}=require('../../src/helix/foundation/execution/outbox-dispatcher-host');
const {createWorkLifecycle}=require('../../src/helix/foundation/execution/work-lifecycle');

function evidence(){
  const offer={onDeckPackageId:'package',packageRevision:1,packageDigest:D('package'),shelfId:'shelf',libraRunId:'run-1',
    subjectId:'subject',acceptanceSpecId:'old-spec',relatedDispositionSetDigest:D('related')};
  offer.offerId=D({schema:'libra.product-offer-id@1',onDeckPackageId:offer.onDeckPackageId,packageDigest:offer.packageDigest});
  const body={eligibility:'ineligible',reasonCode:'target_not_current',libraRunId:offer.libraRunId,runState:'frozen',runStateRevision:2,
    runStateDigest:D('frozen'),acceptanceSpecId:offer.acceptanceSpecId,packageRevisionHead:1,deliveryReceiptAbsent:true};
  return {offer,deliveryFence:{...body,fenceDigest:D(body)}};
}
const mutated=(value,change)=>{const copy=structuredClone(value);change(copy);return copy;};
function seedOfferMessage(h){
  const messageId=D({schema:'libra.product-offer-message-id@1',offerId:h.input.offer.offerId,packageDigest:h.input.offer.packageDigest}),
    payload={...h.input.offer,messageKind:'libra.product-offer.available@1',messageId,dedupKey:messageId};
  // The specialized Promotion writer publishes this nominal envelope; it is
  // intentionally outside the generic ID-only Outbox payload grammar.
  h.db.prepare('INSERT INTO fx_outbox(message_id,producer_domain,message_kind,aggregate_type,aggregate_id,aggregate_revision,dedup_key,consumer_set_digest,intended_consumer_count,payload_schema_ref,payload_json,payload_digest,state,available_at_ms,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(messageId,'libra',payload.messageKind,'on_deck_package',payload.onDeckPackageId,1,messageId,D(['arca']),1,
      'helix://contracts/types/LibraProductOfferAvailableMessage/v1',canonicalJson(payload),D(payload),'pending',0,0);
  h.db.prepare('INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count,next_attempt_at_ms) VALUES(?,?,?,?,?)')
    .run(messageId,'arca','pending',0,0);
  return payload;
}
function harness(callback){return fixture(h=>{
  const db=new Database(h.databasePath),options={schemaManifest,unitOfWork:h.unitOfWork,now:()=>1700000001000},store=createOfferWithdrawalStore(options),
    input=evidence();
  const recovery=()=>db.prepare('SELECT * FROM arca_acceptance_recovery_cases WHERE offer_id=?').get(input.offer.offerId),
    snapshot=()=>Object.fromEntries(['arca_offer_withdrawal_receipts','arca_acceptance_recovery_cases','fx_command_receipts',
      'fx_commit_markers','fx_audit_records'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()])),
    protectedRows=()=>Object.fromEntries(['fx_material_controls','libra_runs','arca_acceptance_attempts','fx_outbox','arca_ondeck_commit_receipts']
      .map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
  function seedRecovery(state='attention_required'){
    db.prepare('INSERT INTO arca_acceptance_recovery_cases(offer_id,on_deck_package_id,package_digest,recovery_state,owner_domain,active_work_id,work_kind,recovery_generation,error_code,failure_phase,terminal_attempt_count,recovery_trigger_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(input.offer.offerId,input.offer.onDeckPackageId,input.offer.packageDigest,state,'arca','old-work','acceptance_assessment',1,
        'ORIGINAL_TRANSPORT_FAILURE','acceptance_assessment',3,D('trigger'));
  }
  const close=(overrides={})=>store.close({...input,readFence:h.unitOfWork.captureReadFence(),...overrides});
  let deferred=false;
  try{const result=callback({...h,db,options,store,input,close,seedRecovery,recovery,snapshot,protectedRows});
    if(result&&typeof result.then==='function'){deferred=true;return Promise.resolve(result).finally(()=>db.close());}return result;
  }finally{if(!deferred)db.close();}
});}

test('Offer withdrawal is a closed bounded receipt, never an Accepted or Rejected decision',()=>{
  const input={...evidence(),closedAtMs:1700000001000},receipt=buildOfferWithdrawal(input);
  assert.deepEqual(assertOfferWithdrawal(receipt),receipt);
  assert.equal(receipt.reasonCode,'target_not_current');assert.equal(receipt.ownerDomain,'arca');
  assert.equal(Object.hasOwn(receipt,'acceptanceDecisionId'),false);
  for(const change of [row=>{row.deliveryFence.eligibility='eligible';},row=>{row.deliveryFence.reasonCode='run_not_active';},
    row=>{row.deliveryFence.deliveryReceiptAbsent=false;},row=>{row.deliveryFence.libraRunId='other';},
    row=>{row.offer.packageDigest=D('changed');},row=>{row.closedAtMs=-1;}])
    assert.throws(()=>buildOfferWithdrawal(mutated(input,change)),{code:'ARCA_OFFER_WITHDRAWAL_INVALID'});
  assert.throws(()=>assertOfferWithdrawal({...receipt,accepted:true}),{code:'ARCA_OFFER_WITHDRAWAL_INVALID'});
  assert.throws(()=>assertOfferWithdrawal({...receipt,receiptDigest:D('forged')}),{code:'ARCA_OFFER_WITHDRAWAL_INVALID'});
});

test('withdrawal atomically closes recovery scheduling and preserves its failures and every collection/Control row',()=>harness(h=>{
  h.seedRecovery();const protectedBefore=h.protectedRows(),prior=h.recovery(),result=h.close(),receipt=result.receipt.resultRef;
  assert.equal(result.replayed,false);assert.deepEqual(h.store.read(h.input.offer.offerId),receipt);
  assert.equal(h.recovery().recovery_state,'resolved');assert.equal(h.recovery().error_code,prior.error_code);
  assert.equal(h.recovery().terminal_attempt_count,3);assert.equal(h.recovery().failure_phase,prior.failure_phase);
  assert.deepEqual(h.protectedRows(),protectedBefore);
  assert.equal(h.snapshot().fx_command_receipts.length,1);assert.equal(h.snapshot().fx_audit_records.length,1);
  assert.equal(h.snapshot().fx_commit_markers.length,1);
  const status=createFormationStatusProjection(h.options).read([h.input.offer.offerId]).get(h.input.offer.offerId);
  assert.equal(status.stage,'offer_withdrawn');assert.equal(status.completedAtMs,null);
  assert.deepEqual(status.withdrawalReceipt,receipt);
  h.unitOfWork.execute([h.store.admissionParticipant(receipt)]);
  const before=h.snapshot(),replay=h.close({readFence:null,deliveryFence:null});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt.resultRef,receipt);assert.deepEqual(h.snapshot(),before);
}));

test('an Offer not yet delivered to Arca can close without inventing an Acceptance Attempt',()=>harness(h=>{
  const before=h.protectedRows();h.close();assert.equal(h.recovery(),undefined);assert.deepEqual(h.protectedRows(),before);
}));

test('missing, forged and stale public read fences leave zero closure or technical receipt writes',()=>harness(h=>{
  h.seedRecovery();const before=h.snapshot(),readFence=h.unitOfWork.captureReadFence();
  h.db.prepare('UPDATE libra_runs SET state_revision=state_revision+1').run();
  assert.throws(()=>h.close({readFence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.throws(()=>h.close({readFence:{}}),{code:'P3_UOW_READ_FENCE_CHANGED'});
  assert.throws(()=>h.close({readFence:null}),{code:'ARCA_OFFER_WITHDRAWAL_READ_FENCE_REQUIRED'});
  assert.deepEqual(h.snapshot(),before);
}));

for(const acceptedKind of ['attempt','decision','custody'])test('existing Accepted '+acceptedKind+' forbids withdrawal',()=>harness(h=>{
  h.seedRecovery();
  if(acceptedKind==='attempt')h.db.prepare("INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,state) VALUES('accepted-attempt',?,'accepted')").run(h.input.offer.offerId);
  if(acceptedKind==='decision')h.db.prepare("INSERT INTO arca_acceptance_decisions(acceptance_decision_id,offer_id,result) VALUES('accepted-decision',?,'accepted')").run(h.input.offer.offerId);
  if(acceptedKind==='custody')h.db.prepare("INSERT INTO arca_ondeck_custodies(custody_id,on_deck_package_id) VALUES('custody',?)").run(h.input.offer.onDeckPackageId);
  const before=h.snapshot();assert.throws(()=>h.close(),{code:'ARCA_OFFER_ALREADY_ACCEPTED'});assert.deepEqual(h.snapshot(),before);
}));

test('failure after Owner writes rolls back withdrawal, recovery, receipt, marker and audit together',()=>harness(h=>{
  h.seedRecovery();const before=h.snapshot(),base=h.unitOfWork,unitOfWork={...base,execute(participants){return base.execute(participants.map(participant=>
    participant.participantId==='arca_offer_withdrawal_commit'?{...participant,execute(context){participant.execute(context);throw new Error('injected after withdrawal');}}:participant));}},
    store=createOfferWithdrawalStore({...h.options,unitOfWork});
  assert.throws(()=>store.close({...h.input,readFence:base.captureReadFence()}),/injected after withdrawal/);
  assert.deepEqual(h.snapshot(),before);assert.equal(h.close().replayed,false);
}));

test('receipt reader rejects a digest/header-valid JSON body with forged closure authority',()=>harness(h=>{
  const receipt=h.close().receipt.resultRef,value={...receipt,reasonCode:'run_not_active'};
  h.db.prepare('UPDATE arca_offer_withdrawal_receipts SET receipt_json=?').run(canonicalJson(value));
  assert.throws(()=>h.store.read(receipt.offer.offerId),{code:'ARCA_OFFER_WITHDRAWAL_CORRUPT'});
}));

test('coordinator consumes delayed Offers with one withdrawal, cancels their process and never submits new Work',()=>harness(h=>{
  const cancellations=[],contextReader={onDeck:{findRunByOffer:()=>null},
    readOfferDelivery(){return {offer:h.input.offer,deliveryFence:h.input.deliveryFence};}},
    coordinator=createOnDeckProcessCoordinator({...h.options,contextReader,workResultReader:{},
      cancelProcessWorks(scope){cancellations.push(scope);return {cancelledWorks:0,drainingWorks:0};}}),
    offer={...h.input.offer,messageKind:'libra.product-offer.available@1',messageId:'message',dedupKey:'message'};
  const first=coordinator.admitOffer(offer),second=coordinator.admitOffer(offer);
  assert.equal(first.kind,'offer_withdrawn');assert.deepEqual(second.withdrawalReceipt,first.withdrawalReceipt);
  assert.throws(()=>coordinator.admitOffer({...offer,subjectId:'different-subject'}),{code:'ARCA_OFFER_WITHDRAWAL_OFFER_CONFLICT'});
  assert.equal(h.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
  assert.equal(h.snapshot().fx_command_receipts.length,1);assert.equal(cancellations.length,2);
  assert.ok(cancellations.every(scope=>scope.ownerDomain==='arca'&&scope.processType==='arca_acceptance'&&scope.processId===offer.offerId));
  h.unitOfWork.execute([second.admissionParticipant]);
  assert.equal(coordinator.reconcileAcceptance(offer.offerId,refsFromOffer(offer)).kind,'offer_withdrawn');
  assert.equal(coordinator.recordTerminalFailure({processId:offer.offerId}).kind,'offer_withdrawn');
  assert.throws(()=>coordinator.retryAcceptance(offer.offerId),{code:'ARCA_OFFER_WITHDRAWN'});
}));

test('late assessment cannot create new facts for an already withdrawn Offer',()=>harness(h=>{
  h.close();const before=h.snapshot(),acceptance=createHandoffBAcceptanceStore(h.options);
  const input={acceptanceAttemptId:'attempt',offerId:h.input.offer.offerId,onDeckPackageId:'package',packageDigest:h.input.offer.packageDigest,
    shelfId:'shelf',standardRevision:1,placementRevision:1,checks:[]};
  assert.throws(()=>acceptance.recordAssessment(input),{code:'ARCA_OFFER_WITHDRAWN'});assert.deepEqual(h.snapshot(),before);
}));

test('real Outbox/Inbox dispatch ACKs repeated withdrawn messages without a new Work or scheduler wake',()=>harness(async h=>{
  let cancellations=0,wakes=0;
  const contextReader={onDeck:{findRunByOffer:()=>null},readOfferDelivery:()=>({offer:h.input.offer,deliveryFence:h.input.deliveryFence})},
    coordinator=createOnDeckProcessCoordinator({...h.options,contextReader,workResultReader:{},cancelProcessWorks(){cancellations++;
      return {cancelledWorks:0,drainingWorks:0};}}),payload=seedOfferMessage(h);
  const dispatcher=createOutboxDispatcherHost({...h.options,arcaCoordinator:coordinator,executionRuntimeHost:{wake(){wakes++;}},
    onError(error){throw error;}});
  try{
    assert.deepEqual(await dispatcher.drainOnce(),{kind:'advanced',delivered:1});
    assert.equal(h.db.prepare('SELECT state FROM fx_outbox_deliveries').get().state,'acked');
    const inboxBefore=h.db.prepare('SELECT * FROM fx_inbox').all(),receipt=h.store.read(payload.offerId);
    h.db.prepare("UPDATE fx_outbox_deliveries SET state='pending',next_attempt_at_ms=0,acked_at_ms=NULL").run();
    assert.deepEqual(await dispatcher.drainOnce(),{kind:'advanced',delivered:1});
    assert.equal(h.db.prepare('SELECT state FROM fx_outbox_deliveries').get().state,'acked');
    assert.deepEqual(h.db.prepare('SELECT * FROM fx_inbox').all(),inboxBefore);
    assert.deepEqual(h.store.read(payload.offerId),receipt);assert.equal(h.snapshot().fx_command_receipts.length,1);
    assert.equal(h.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
    assert.equal(wakes,0);assert.equal(cancellations,2);
  }finally{await dispatcher.stop();}
}));

test('already-consumed admission survives interruption after withdrawal and closes real Work on redelivery',()=>harness(async h=>{
  let clock=1700000001000,targetChanged=false,interrupt=true;
  const errors=[],options={...h.options,now:()=>clock},lifecycle=createWorkLifecycle({...options,nextWorkAttemptId:()=> 'unused'}),
    contextReader={onDeck:{findRunByOffer:()=>null},readOfferDelivery:()=>({offer:h.input.offer,
      deliveryFence:targetChanged?h.input.deliveryFence:{eligibility:'eligible'}})},
    makeCoordinator=()=>createOnDeckProcessCoordinator({...options,contextReader,workResultReader:{},cancelProcessWorks(scope){
      if(interrupt)throw new Error('injected interruption after durable closure');
      return lifecycle.cancelProcess(scope);
    }}),makeDispatcher=()=>createOutboxDispatcherHost({...options,arcaCoordinator:makeCoordinator(),
      executionRuntimeHost:{wake(){}},onError:error=>errors.push(error)}),payload=seedOfferMessage(h);
  let dispatcher=makeDispatcher();
  try{
    assert.deepEqual(await dispatcher.drainOnce(),{kind:'advanced',delivered:1});
    const admittedInbox=h.db.prepare('SELECT * FROM fx_inbox').all(),originalWork=h.db.prepare('SELECT * FROM fx_supporting_works').get(),
      originalCommandCount=h.snapshot().fx_command_receipts.length;
    assert.equal(h.db.prepare('SELECT state FROM fx_outbox_deliveries').get().state,'delivered');
    targetChanged=true;clock+=2000;
    assert.deepEqual(await dispatcher.drainOnce(),{kind:'idle',delivered:0});
    assert.match(errors[0].message,/injected interruption/);assert.equal(h.snapshot().arca_offer_withdrawal_receipts.length,1);
    assert.equal(h.recovery().recovery_state,'resolved');
    assert.equal(h.db.prepare('SELECT state FROM fx_supporting_works').get().state,originalWork.state);
    await dispatcher.stop();interrupt=false;clock+=20000;dispatcher=makeDispatcher();
    assert.deepEqual(await dispatcher.drainOnce(),{kind:'advanced',delivered:1});
    assert.equal(h.db.prepare('SELECT state FROM fx_supporting_works').get().state,'cancelled');
    assert.equal(h.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,1);
    assert.deepEqual(h.db.prepare('SELECT * FROM fx_inbox').all(),admittedInbox);
    assert.equal(h.db.prepare('SELECT state FROM fx_outbox_deliveries').get().state,'acked');
    assert.equal(h.store.read(payload.offerId).reasonCode,'target_not_current');
    assert.equal(h.snapshot().fx_command_receipts.length,originalCommandCount+1);
  }finally{await dispatcher.stop();}
}));
