'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createIntakeProcessCoordinator } = require('../../src/helix/domains/libra/application/intake-process-coordinator');

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
