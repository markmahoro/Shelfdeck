'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createNetworkFetch,isLocalDestination}=require('../../src/helix/integrations/network-fetch');
const {createNetworkPolicy,normalizeProxyServer}=require('../../src/helix/platform/application/network-policy');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
function stores(){let row=null;const receipts=new Map();return {repository:{find:()=>row?{integration:row}:undefined,commit({expectedRevision,integration}){assert.equal(row?.configRevision||0,expectedRevision);row={integrationType:integration.integration_type,state:integration.state,configSchemaRef:integration.config_schema_ref,configRevision:integration.config_revision,config:JSON.parse(integration.config_json),configDigest:integration.config_digest};}},receiptRepository:{read:k=>receipts.get(k.idempotencyKey),commit:v=>receipts.set(v.idempotencyKey,{requestDigest:v.requestDigest,result:v.result})}};}
const command=(proxyServer='',expectedConfigRevision=0,idempotencyKey='network:save')=>({kind:'network',settings:{proxyServer},expectedConfigRevision,idempotencyKey});
test('global network policy persists across instances, fences revisions, replays and explicitly disables proxy',()=>{
 const storage=stores(),policy=createNetworkPolicy(storage);assert.equal(policy.get().configured,false);assert.equal(policy.route().mode,'direct');
 const body=command('http://proxy.test:7890/');const saved=policy.configure('network',body);assert.equal(saved.settings.proxyServer,'http://proxy.test:7890');assert.equal(saved.configRevision,1);
 const restarted=createNetworkPolicy(storage);assert.deepEqual(restarted.route(),{mode:'http_proxy',proxyEndpoint:'http://proxy.test:7890'});
 assert.deepEqual(restarted.configure('network',body),saved);
 assert.throws(()=>restarted.configure('network',command('http://other.test:1234')),{code:'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT'});
 assert.throws(()=>restarted.configure('network',command('',0,'stale')),{code:'PLATFORM_INTEGRATION_CAS_CONFLICT'});
 const direct=restarted.configure('network',command('',1,'disable'));assert.equal(direct.configRevision,2);assert.equal(restarted.route().mode,'direct');
 assert.equal(canonicalDigest(saved),canonicalDigest(restarted.configure('network',body)));
});
test('global proxy validation rejects credentials, paths, wrong protocols and extra overrides',()=>{
 for(const value of ['socks5://proxy:1080','https://user:pass@proxy','https://proxy/path','https://proxy?key=secret','https://proxy/#fragment',null])assert.throws(()=>normalizeProxyServer(value),{code:'PLATFORM_NETWORK_PROXY_INVALID'});
 const policy=createNetworkPolicy(stores());assert.throws(()=>policy.configure('network',{...command(),siteRef:'javdb'}),{code:'PLATFORM_NETWORK_COMMAND_INVALID'});
});
test('all external requests share one dispatcher; local services bypass proxy and provider overrides cannot win',async()=>{
 let route={mode:'http_proxy',proxyEndpoint:'http://proxy.test:7890'};const calls=[],created=[],closed=[];
 const agent=name=>({name,async close(){closed.push(name);}});
 const request=createNetworkFetch({networkPolicy:{route:()=>route},fetchImpl:async(url,init)=>{calls.push({url,init});return {ok:true};},createDirect:()=>agent('direct'),createProxy:v=>{created.push(v);return agent(v);}});
 const signal=new AbortController().signal;
 for(const url of ['https://api.themoviedb.org/3','https://javdb.com','https://c0.jdbstatic.com/poster.jpg','https://movie.douban.com'])await request(url,{signal,dispatcher:'provider-override',headers:{'x-test':'retained'}});
 assert.equal(created.length,1);for(const c of calls){assert.equal(c.init.dispatcher.name,route.proxyEndpoint);assert.equal(c.init.signal,signal);assert.equal(c.init.headers['x-test'],'retained');}
 for(const url of ['http://192.168.12.230:3000','http://127.0.0.1','http://10.0.0.1','http://172.31.2.4','http://[::1]']){await request(url);assert.equal(calls.at(-1).init.dispatcher.name,'direct');}
 assert.equal(isLocalDestination('https://10.example.com'),false);assert.equal(isLocalDestination('https://172.32.0.1'),false);
 route={mode:'http_proxy',proxyEndpoint:'http://second.test:7890'};await request('https://javmenu.com');assert.equal(created.length,2);
 route={mode:'direct',proxyEndpoint:null};await request('https://javdb.com',{dispatcher:'old'});assert.equal(calls.at(-1).init.dispatcher.name,'direct');
 await request.close();assert.ok(closed.includes('http://proxy.test:7890'));assert.ok(closed.includes('http://second.test:7890'));
});
