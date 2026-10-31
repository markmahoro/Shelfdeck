'use strict';
/**
 * Fixture id: provider_transient_fail_no_retry_tight_wait
 *
 * Gap class (post-#62 Attention dig / waiting-window check):
 * - Tip caches sticky provider failure on the first transport reject (0 retries).
 * - waitingBoundMs default 20s and per-request AbortSignal 15s are tighter than
 *   Clash/ThePornDB dial recovery, so flaky egress becomes durable Attention.
 *
 * Contract: bounded auto-retry of transient transport fails, then fail-closed;
 * default waitingBound + request timeout leave headroom for Clash/TPDB.
 * Fail-closed Attention after budget remains OK (hang suite).
 *
 * RED-first on tip without the product retry/window fix.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const {
  createCatalogueProviderObservationPort,
  DEFAULT_WAITING_BOUND_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
}=require('../../src/helix/integrations/us-adult-catalogue-provider-observation');

const FIXTURE_ID='provider_transient_fail_no_retry_tight_wait';
const PROVIDER_FAILED='PEOPLE_CATALOGUE_PROVIDER_FAILED';
const PROVIDER_PENDING='PEOPLE_CATALOGUE_PROVIDER_PENDING';
const ENDPOINT='https://api.theporndb.net/graphql';

function stashOk(body){
  const bytes=Buffer.from(JSON.stringify(body));
  return {
    ok:true,status:200,url:ENDPOINT,headers:{get:()=>null},
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
  };
}

function emptySearch(){
  return stashOk({data:{searchPerformer:[]}});
}

function settleMicrotasks(){
  return new Promise(resolve=>setImmediate(resolve));
}

async function drain(rounds=20){
  for(let i=0;i<rounds;i+=1)await settleMicrotasks();
}

test(`fixture ${FIXTURE_ID}: default waitingBound and request timeout leave Clash/TPDB headroom`,()=>{
  // Tip today: waitingBound 20s / AbortSignal 15s — too tight vs proxy dial recovery.
  assert.ok(Number.isSafeInteger(DEFAULT_WAITING_BOUND_MS),
    'DEFAULT_WAITING_BOUND_MS must be exported');
  assert.ok(Number.isSafeInteger(DEFAULT_REQUEST_TIMEOUT_MS),
    'DEFAULT_REQUEST_TIMEOUT_MS must be exported (tip hardcodes AbortSignal.timeout(15000))');
  assert.ok(Number.isSafeInteger(DEFAULT_MAX_ATTEMPTS),
    'DEFAULT_MAX_ATTEMPTS must be exported (tip has 0 retries)');
  assert.ok(DEFAULT_REQUEST_TIMEOUT_MS>=30_000,
    `request timeout must be >=30s for Clash/TPDB (got ${DEFAULT_REQUEST_TIMEOUT_MS})`);
  assert.ok(DEFAULT_WAITING_BOUND_MS>=120_000,
    `waitingBound must be >=120s and above multi-attempt request budget (got ${DEFAULT_WAITING_BOUND_MS})`);
  assert.ok(DEFAULT_WAITING_BOUND_MS>=DEFAULT_REQUEST_TIMEOUT_MS*DEFAULT_MAX_ATTEMPTS,
    'waitingBound must cover maxAttempts × requestTimeout for a single-term search');
  assert.ok(DEFAULT_MAX_ATTEMPTS>=3,
    `must allow at least 1 initial + 2 retries before sticky fail (got ${DEFAULT_MAX_ATTEMPTS})`);
});

test(`fixture ${FIXTURE_ID}: transient transport failure retries before sticky fail-cache`,async()=>{
  let calls=0;
  let wakes=0;
  const port=createCatalogueProviderObservationPort({
    fetchImpl:async()=>{
      calls+=1;
      if(calls<2)throw Object.assign(new Error('dial timeout'),{code:'P5_PROVIDER_TRANSPORT_FAILED'});
      return emptySearch();
    },
    readStashBoxConfiguration:()=>({endpoint:ENDPOINT,configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    wake:()=>{wakes+=1;},
    delay:async()=>{}, // instant backoff in tests
  });
  const first=port.observeProviderSearch({name:'Tia Ling',aliases:[]});
  assert.equal(first.kind,'waiting');
  assert.equal(first.pendingCode,PROVIDER_PENDING);
  await drain();
  const second=port.observeProviderSearch({name:'Tia Ling',aliases:[]});
  assert.notEqual(second.kind,'failed',
    'first transient transport reject must not sticky-fail before bounded retries');
  assert.ok(second.queries||second.kind==='waiting',
    'retry must recover to observation (or still be waiting mid-retry)');
  if(second.queries){
    assert.ok(calls>=2,'must issue more than one transport attempt before success cache');
    assert.ok(wakes>=1);
  }
});

test(`fixture ${FIXTURE_ID}: exhausted retry budget fail-closes sticky (Attention path)`,async()=>{
  let calls=0;
  let wakes=0;
  const port=createCatalogueProviderObservationPort({
    fetchImpl:async()=>{
      calls+=1;
      throw Object.assign(new Error('dial timeout'),{code:'P5_PROVIDER_TRANSPORT_FAILED'});
    },
    readStashBoxConfiguration:()=>({endpoint:ENDPOINT,configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    wake:()=>{wakes+=1;},
    delay:async()=>{},
    maxAttempts:3,
  });
  const first=port.observeProviderSearch({name:'Lea Lexis',aliases:[]});
  assert.equal(first.kind,'waiting');
  await drain(40);
  const second=port.observeProviderSearch({name:'Lea Lexis',aliases:[]});
  assert.equal(second.kind,'failed');
  assert.equal(second.code,PROVIDER_FAILED);
  assert.ok(calls>=3,'exhausted budget must use the configured attempts');
  assert.ok(wakes>=1,'final fail must wake settlement');
  // Sticky: further observe must not re-hit transport.
  const before=calls;
  const third=port.observeProviderSearch({name:'Lea Lexis',aliases:[]});
  assert.equal(third.kind,'failed');
  assert.equal(calls,before,'sticky fail-cache must not refetch after budget');
});

test(`fixture ${FIXTURE_ID}: non-retryable INVALID fails closed without retry storm`,async()=>{
  let calls=0;
  const port=createCatalogueProviderObservationPort({
    fetchImpl:async()=>{
      calls+=1;
      return stashOk({errors:[{message:'bad'}],data:null});
    },
    readStashBoxConfiguration:()=>({endpoint:ENDPOINT,configRevision:1}),
    withStashBoxCredential:async(_rev,fn)=>fn(Buffer.from('test-key')),
    delay:async()=>{},
    maxAttempts:3,
  });
  port.observeProviderSearch({name:'Bad Payload',aliases:[]});
  await drain();
  const hit=port.observeProviderSearch({name:'Bad Payload',aliases:[]});
  assert.equal(hit.kind,'failed');
  assert.equal(hit.code,'PEOPLE_CATALOGUE_PROVIDER_INVALID');
  assert.equal(calls,1,'INVALID must not burn the transport retry budget');
});
