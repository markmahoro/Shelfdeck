'use strict';

const { createOverviewQuery } = require('./overview-query');

const READERS = Object.freeze(['readMaterialFields','readShelves','readStandingAuthorization','readFormation',
  'readCollectionStats','readOffdeck','readPeopleSummary','readBackgroundOperations','readHealth']);

// Only this producer invokes domain readers. HTTP reads never rebuild a snapshot.
function createOverviewProjectionHost(options) {
  const now=options.now||Date.now, cadenceMs=options.cadenceMs||5000;
  let snapshot=null, timer=null, running=null, stopped=true, lastError=null;
  const yieldTurn=()=>new Promise(resolve=>setImmediate(resolve));
  async function rebuild() {
    if(running)return running;
    running=(async()=>{
      const startedAt=now(), values={};
      try {
        for(const name of READERS) {
          if(typeof options[name]!=='function')continue;
          await yieldTurn();
          if(stopped)return;
          values[name]=await options[name](startedAt);
        }
        const readers=Object.fromEntries(Object.entries(values).map(([name,value])=>[name,()=>value]));
        const next=createOverviewQuery({...readers,now:()=>startedAt,
          isLocationAvailable:options.isLocationAvailable}).get();
        if(!stopped){snapshot=next;lastError=null;}
      } catch(error) {
        lastError=error?.code||'OVERVIEW_PROJECTION_BUILD_FAILED';
        options.onError?.(error);
      }
    })();
    try {await running;} finally {running=null;}
  }
  async function tick() {
    const startedAt=now();
    await rebuild();
    if(!stopped){timer=setTimeout(tick,Math.max(1,cadenceMs-(now()-startedAt)));timer.unref?.();}
  }
  return Object.freeze({
    start(){if(!stopped)return running||Promise.resolve();stopped=false;return tick();},
    async stop(){stopped=true;clearTimeout(timer);timer=null;if(running)await running;},
    async refresh(){if(stopped)throw new Error('Overview projection producer is stopped.');await rebuild();},
    get(){
      if(!snapshot)throw Object.assign(new Error('概览正在生成，请稍后刷新。'),{
        code:'OVERVIEW_PROJECTION_REBUILDING',statusCode:503});
      const ageMs=Math.max(0,now()-Date.parse(snapshot.generatedAt));
      return Object.freeze({...snapshot,projection:Object.freeze({
        state:lastError?'failed':ageMs>30_000?'stale':'ready',ageMs,
      })});
    },
  });
}

module.exports=Object.freeze({createOverviewProjectionHost});
