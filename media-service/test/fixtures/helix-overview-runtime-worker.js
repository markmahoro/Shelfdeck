'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {AsyncLocalStorage}=require('node:async_hooks');
const {createReadinessSnapshot}=require('../../scripts/create-readiness-snapshot');
const {createCleanServiceHost}=require('../../src/clean-service-host');

(async()=>{
  fs.mkdirSync('/tmp/overview-source');
  for(const name of ['shelfdeck.db','admin-credential-secret.json'])fs.copyFileSync('/backup/'+name,'/tmp/overview-source/'+name);
  await createReadinessSnapshot('/tmp/overview-source','/tmp/overview-data');
  const requests=new AsyncLocalStorage(),reads=[];
  const host=await createCleanServiceHost({dataDir:'/tmp/overview-data',adminDistDir:'/app/dist/admin',
    secretRoot:process.env.SHELFDECK_SECRET_ROOT,unitOfWorkDecorator:uow=>({execute(participants){
      return uow.execute(participants.map(participant=>({...participant,execute(context){
        return participant.execute({...context,repository(id){const repo=context.repository(id);return {invoke(statement,parameters){
          if(requests.getStore())reads.push({repository:id,statement});return repo.invoke(statement,parameters);
        }};}});
      }})));
    }})});
  try {
    const inject=()=>host.inject({method:'GET',url:'/v1/admin/overview',headers:{'x-api-key':process.env.SHELFDECK_UAT_ADMIN_KEY}});
    let response;
    const started=Date.now();
    do {response=await inject();if(response.statusCode===200)break;
      assert.equal(response.statusCode,503,response.body);assert.ok(Date.now()-started<60_000);
      await new Promise(resolve=>setTimeout(resolve,25));
    }while(true);
    const warmupMs=Date.now()-started,elapsed=[];
    for(let i=0;i<100;i++){
      const begin=performance.now();response=await requests.run(true,inject);elapsed.push(performance.now()-begin);
      assert.equal(response.statusCode,200,response.body);
      assert.equal(response.json().projection.state,'ready');
    }
    assert.ok(!reads.some(row=>/overview|collection|aftercare|offdeck|material_field|people|formation/.test(row.repository)),JSON.stringify(reads));
    assert.ok(!reads.some(row=>/^(insert|update|delete|commit|write|upsert|append)/.test(row.statement)),JSON.stringify(reads));
    elapsed.sort((a,b)=>a-b);
    assert.ok(elapsed[94]<1000);
    console.log(JSON.stringify({requests:100,warmupMs,p95Ms:elapsed[94],p99Ms:elapsed[98],
      requestRepositoryStatements:[...new Set(reads.map(row=>row.repository+'.'+row.statement))],
      metrics:response.json().metrics,projection:response.json().projection}));
  }finally{await host.close();}
})().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
