'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {initializeCleanData}=require('../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../src/clean-service-host');

const SECRET_ROOT='douban-perception-e2e-secret-root-20260812';
const COOKIE='private-douban-cookie-never-persisted-in-facts';
const pause=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

function response(status,body,contentType='text/html'){
  const bytes=Buffer.from(String(body),'utf8');let delivered=false;
  return Object.freeze({ok:status>=200&&status<300,status,headers:Object.freeze({get(name){const key=String(name).toLowerCase();return key==='content-length'?String(bytes.length):key==='content-type'?contentType:null;}}),
    body:Object.freeze({getReader(){return Object.freeze({async read(){if(delivered)return{done:true};delivered=true;return{done:false,value:Uint8Array.from(bytes)};},async cancel(){delivered=true;}});}}),
    async arrayBuffer(){return Uint8Array.from(bytes).buffer;}});
}
function item(id,title,year,rating){return `<li class="item"><div class="title"><a href="/subject/${id}/" title="${title}"><em>${title}</em></a></div><div class="intro">${year} / 中国大陆</div><span class="rating${rating}-t"></span></li>`;}
function providerFetch(state){return async(input,init={})=>{const url=new URL(String(input)),headers=Object.fromEntries(Object.entries(init.headers||{}).map(([key,value])=>[key.toLowerCase(),value]));state.calls.push(url.pathname+url.search);
  if(url.host!=='movie.douban.com')return response(404,'missing','text/plain');if(headers.cookie!==COOKIE)return response(401,'denied','text/plain');
  const start=Number(url.searchParams.get('start')||0),identity='<a href="/people/test-user">test-user</a>';
  if(start===0)return response(200,identity+'<ul>'+item('1001','第一页甲',1999,state.firstRating)+item('1002','第一页乙',2020,5)+'</ul><div class="paginator"><span class="next"><a href="/people/test-user/collect?start=2&mode=grid&type=movie&sort=time">后页</a></span></div>');
  if(start===2)return response(200,identity+'<ul>'+item('1003','第二页丙',2014,3)+'</ul><div class="paginator"></div>');return response(200,identity+'<ul></ul>');};}
async function session(host,key){const result=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':key}});assert.equal(result.statusCode,204,result.body);return result.headers['set-cookie'];}
async function configure(host,cookie){let result=await host.inject({method:'POST',url:'/v1/admin/settings/integrations/douban/actions/test',headers:{cookie},payload:{kind:'douban',idempotencyKey:'douban-test',endpoint:'https://movie.douban.com',credential:{kind:'cookie',value:COOKIE},settings:{userId:'test-user'},timeoutMs:5000}});assert.equal(result.statusCode,200,result.body);
  result=await host.inject({method:'PATCH',url:'/v1/admin/settings/integrations/douban',headers:{cookie},payload:{kind:'douban',idempotencyKey:'douban-configure',expectedConfigRevision:0,connectionProofId:result.json().connectionProofId}});assert.equal(result.statusCode,200,result.body);}
async function sync(host,cookie,idempotencyKey,expectedRecords,debugState){const started=await host.inject({method:'POST',url:'/v1/admin/perception/actions/sync',headers:{cookie},payload:{idempotencyKey}});assert.equal(started.statusCode,202,started.body);const deadline=Date.now()+30_000;let last=null,recordCount=0;
  while(Date.now()<deadline){const acquisitions=await host.inject({method:'GET',url:'/v1/admin/perception/acquisitions',headers:{cookie}});assert.equal(acquisitions.statusCode,200,acquisitions.body);const current=acquisitions.json().items.find((item)=>item.perceptionAcquisitionId===started.json().operationRef);
    last=current;if(current?.state==='completed'){const records=await host.inject({method:'GET',url:'/v1/admin/perception/records?sourceKind=douban&limit=100',headers:{cookie}});assert.equal(records.statusCode,200,records.body);recordCount=records.json().items.length;if(recordCount===expectedRecords)return records.json().items;}await pause(25);}
  assert.fail('Douban Acquisition did not complete with the expected record count: '+JSON.stringify({last,recordCount,calls:debugState?.calls,runtimeError:debugState?.runtimeError&&{name:debugState.runtimeError.name,code:debugState.runtimeError.code,message:debugState.runtimeError.message,details:debugState.runtimeError.details}}));}

test('real-shaped Douban pages are bounded, paged, replay-safe, and append source correction lineage',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-douban-perception-'));t.after(()=>{if(process.env.HELIX_KEEP_TEST_ASSETS!=='1')fs.rmSync(root,{recursive:true,force:true});});const dataDir=path.join(root,'data'),admin=path.join(root,'admin');fs.mkdirSync(admin,{recursive:true});fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:SECRET_ROOT}),state={calls:[],firstRating:2,runtimeError:null};let now=1_900_000_000_000,runtimeError=null;
  const host=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:SECRET_ROOT,integrationFetch:providerFetch(state),now:()=>++now,onExecutionRuntimeError(error){runtimeError=error;state.runtimeError=error;}});
  try{const cookie=await session(host,initialized.adminApiKey);await configure(host,cookie);const beforeSyncCalls=state.calls.length;
    let records=await sync(host,cookie,'sync-first',3,state);assert.deepEqual(records.map((item)=>item.rating).sort(),[2,3,5]);assert.equal(state.calls.slice(beforeSyncCalls).filter((value)=>value.includes('/collect')).length,2);assert.ifError(runtimeError);
    records=await sync(host,cookie,'sync-identical-replay',3,state);assert.equal(records.filter((item)=>item.current).length,3);assert.ifError(runtimeError);
    state.firstRating=4;records=await sync(host,cookie,'sync-rating-changed',4,state);const changed=records.filter((item)=>item.sourceRecordKey==='douban:1001');assert.equal(changed.length,2);assert.deepEqual(changed.map((item)=>[item.rating,item.resolutionStatus]).sort((a,b)=>a[0]-b[0]),[[2,'superseded'],[4,'unmatched']]);
    const database=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{assert.equal(database.prepare("SELECT count(1) count FROM perception_records WHERE source_kind='douban'").get().count,4);assert.equal(database.prepare("SELECT count(1) count FROM perception_record_relations WHERE relation_kind='supersedes'").get().count,1);assert.equal(database.prepare('SELECT count(1) count FROM perception_acquisitions WHERE state=\'completed\'').get().count,3);}finally{database.close();}
    assert.equal(fs.readFileSync(path.join(dataDir,'shelfdeck.db')).includes(Buffer.from(COOKIE,'utf8')),false);assert.ifError(runtimeError);
  }finally{await host.close();}
});
