'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOverviewProjectionHost}=require('../src/helix/projections/overview-projection-host');

function inputs(extra={}){return {readMaterialFields:()=>({items:[],waitingAcceptanceCount:0}),
  readShelves:()=>({activeCount:0}),readFormation:()=>({summary:{}}),
  readCollectionStats:()=>({currentCount:0,monthNewCount:0,healthyCount:0,healthAttentionCount:0,recentOnDeck:[]}),
  readOffdeck:()=>({attentionCount:0}),...extra};}

test('Overview reads keep the last complete generation during an overlapping rebuild and expose failure',async t=>{
  let at=100_000,reads=0,release=null,fail=false;
  const host=createOverviewProjectionHost(inputs({now:()=>at,cadenceMs:100_000,readCollectionStats:async()=>{
    reads++;if(release)await new Promise(resolve=>{release=resolve;});if(fail)throw Error('private diagnostic');
    return {currentCount:reads,monthNewCount:0,healthyCount:0,healthAttentionCount:0,recentOnDeck:[]};
  }}));
  t.after(()=>host.stop());
  assert.throws(()=>host.get(),error=>error.code==='OVERVIEW_PROJECTION_REBUILDING');
  await host.start();assert.equal(host.get().metrics[0].value,1);
  release=true;const pending=host.refresh();
  while(typeof release!=='function')await new Promise(resolve=>setImmediate(resolve));
  const concurrent=host.refresh();
  for(let i=0;i<1000;i++)assert.equal(host.get().metrics[0].value,1);
  assert.equal(reads,2);const finish=release;release=null;finish();await Promise.all([pending,concurrent]);
  assert.equal(host.get().metrics[0].value,2);
  at+=31_000;assert.equal(host.get().projection.state,'stale');
  fail=true;await host.refresh();assert.equal(host.get().metrics[0].value,2);
  assert.equal(host.get().projection.state,'failed');
  assert.ok(!JSON.stringify(host.get()).includes('private diagnostic'));
  fail=false;await host.refresh();assert.equal(host.get().projection.state,'ready');
});

test('Stopping discards an unfinished generation and a new instance explicitly rebuilds',async()=>{
  let release;
  const host=createOverviewProjectionHost(inputs({readCollectionStats:()=>new Promise(resolve=>{release=resolve;})}));
  const starting=host.start();while(!release)await new Promise(resolve=>setImmediate(resolve));
  const stopping=host.stop();release({currentCount:9,recentOnDeck:[]});await Promise.all([starting,stopping]);
  assert.throws(()=>host.get(),error=>error.code==='OVERVIEW_PROJECTION_REBUILDING');
  const restarted=createOverviewProjectionHost(inputs());
  assert.throws(()=>restarted.get(),error=>error.code==='OVERVIEW_PROJECTION_REBUILDING');
  await restarted.start();assert.equal(restarted.get().metrics[0].value,0);await restarted.stop();
});
