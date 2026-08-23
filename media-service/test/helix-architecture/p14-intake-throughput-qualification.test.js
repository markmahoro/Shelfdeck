'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createIntakeProcessCoordinator } = require('../../src/helix/domains/libra/application/intake-process-coordinator');
const { createIntakeOfferReader, decisionId } = require('../../src/helix/domains/libra/persistence/intake-offer-reader');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');

const generatedRoot=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generatedRoot,'clean-schema.manifest.json'),'utf8'));

function digest(index) { return index.toString(16).padStart(64, '0'); }
function offer(index) {
  return Object.freeze({
    offerId:`offer-${String(index).padStart(4, '0')}`,
    candidatePackageId:`candidate-${index}`,
    packageRevision:1,
    packageDigest:digest(index + 1),
    acceptanceBasisDigest:digest(index + 1001),
  });
}
function durableOfferReader(offers) {
  const sources = new Map(offers.map((value) => {
    const processId=`process-${value.offerId}`;
    return [processId,Object.freeze({processId,offer:value,snapshot:Object.freeze({deliverySnapshotDigest:digest(Number(value.offerId.slice(6)) + 2001)})})];
  }));
  const ids=[...sources.keys()].sort();
  return Object.freeze({
    decisionId:(offerId)=>`process-${offerId}`,
    remember:(value)=>sources.get(`process-${value.offerId}`),
    read:(processId)=>sources.get(processId)||null,
    listProcessPage(cursor,limit){
      const start=cursor?ids.findIndex((id)=>id>cursor):0,offset=start<0?ids.length:start;
      const items=ids.slice(offset,offset+limit).map((processId)=>Object.freeze({processId}));
      return Object.freeze({items,nextCursor:offset+items.length<ids.length?items.at(-1).processId:null});
    },
  });
}
function fakeAdmission(mode) {
  return Object.freeze({
    replay:()=>null,
    submit:(work)=>mode.value==='defer'
      ? Object.freeze({kind:'deferred',reasonCode:'WORK_HARD_CAP'})
      : Object.freeze({kind:'admitted',workId:work.workId,state:'admitted',replayed:false}),
  });
}

test('hundreds of deferred Intake Candidates are rediscovered after restart and admitted in bounded batches', () => {
  const offers=Array.from({length:400},(_,index)=>offer(index));
  const offerReader=durableOfferReader(offers),mode={value:'defer'};
  const dependencies={offerReader,workAdmission:fakeAdmission(mode),workResultReader:{status:()=>null,read:()=>[]}};
  const beforeRestart=createIntakeProcessCoordinator(dependencies);
  for(const value of offers)assert.equal(beforeRestart.admitOffer(value).result.kind,'deferred');

  mode.value='admit';
  const afterRestart=createIntakeProcessCoordinator(dependencies);
  let admitted=0,calls=0;
  while(admitted<offers.length&&calls<20){
    const result=afterRestart.reconcilePending({limit:100,admissionLimit:32});
    assert.ok(result.visited<=100);
    assert.ok(result.admittedCount<=32);
    admitted+=result.admittedCount;
    calls+=1;
  }
  assert.equal(admitted,400);
  assert.equal(calls,13);
});

test('fallback Intake discovery skips terminal Receipts but preserves the decision-to-receipt crash gap',()=>{
  const values=Array.from({length:1005},(_,index)=>Object.freeze({
    schemaRef:'helix://contracts/types/ProcurementCandidateOfferAvailableMessage/v1',schemaVersion:1,
    messageKind:'procurement_candidate_offer_available',acceptanceOwnerDomain:'libra',targetContext:'libra_intake',
    offerId:`offer-${String(index).padStart(4,'0')}`,candidatePackageId:`candidate-${index}`,packageRevision:1,
    packageDigest:digest(index+5000),acceptanceBasisDigest:digest(index+6000),
  }));
  const rows=values.map((value,index)=>Object.freeze({message_id:'message-'+index,producer_domain:'procurement',
    message_kind:'procurement_candidate_offer_available',aggregate_type:'candidate_package',aggregate_id:value.candidatePackageId,
    aggregate_revision:1,dedup_key:'dedup-'+index,payload_schema_ref:value.schemaRef,payload_json:canonicalJson(value),
    payload_digest:canonicalDigest(value),state:'fully_acked',created_at_ms:1}));
  const unitOfWork={execute(participants){const participant=participants[0],result=participant.execute({repository(){return {invoke(){return rows;}}}});return {[participant.participantId]:result};}};
  const deliveryCalls=[],terminal=new Set(values.slice(0,1000).map((value)=>decisionId(value.offerId)));let completionReads=0;
  const reader=createIntakeOfferReader({schemaManifest,unitOfWork,intakeCompletionReader:{listTerminalIntakeDecisionIds(){completionReads+=1;return [...terminal];}},candidateDeliveryPort:{readSnapshot(request){
    deliveryCalls.push(request.offerId);const value=values.find((item)=>item.offerId===request.offerId);
    const snapshot={offer:value,deliverySnapshotDigest:''};snapshot.deliverySnapshotDigest=canonicalDigest({offer:value});
    return {resultKind:'found',snapshot:Object.freeze(snapshot)};
  }}});
  for(let cadence=0;cadence<3;cadence++)assert.deepEqual(reader.listProcessPage(null,100).items.map((item)=>item.processId),
    values.slice(1000).map((value)=>decisionId(value.offerId)).sort());
  assert.deepEqual(deliveryCalls.sort(),values.slice(1000).map((value)=>value.offerId).sort());
  terminal.add(decisionId(values[1000].offerId));
  assert.deepEqual(reader.listProcessPage(null,100).items.map((item)=>item.processId),
    values.slice(1001).map((value)=>decisionId(value.offerId)).sort());
  assert.equal(deliveryCalls.length,5);
  assert.equal(completionReads,5);
});
