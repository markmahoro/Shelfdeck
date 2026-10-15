'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const Database=require('better-sqlite3');
const {initializeCleanData}=require('../scripts/helix-operational-safety');const {createCleanServiceHost}=require('../src/clean-service-host');const {canonicalDigest}=require('../src/helix/contracts/canonical-json');

test('direct watched has independent lineage, strict replay and restart persistence without changing rating',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-direct-watched-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dataDir=path.join(root,'data'),admin=path.join(root,'admin'),secretRoot='direct-watched-test-secret-20261015';fs.mkdirSync(admin,{recursive:true});fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot}),targetId='watched-entry';
  const body={targetType:'shelf_entry',targetId,targetRevision:1,title:'Watched Movie',year:2024,providerIdentity:'tmdb_movie:123456'},projection={...body,targetDigest:canonicalDigest(body)};
  let runtimeError,host;const options={dataDir,adminDistDir:admin,secretRoot,perceptionTargetProjectionReader:(type,id)=>type==='shelf_entry'&&id===targetId?projection:null,onExecutionRuntimeError(error){runtimeError=error;}};
  async function open(){host=await createCleanServiceHost(options);const response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(response.statusCode,204,response.body);return response.headers['set-cookie'];}
  let cookie=await open();
  const command=(field,value,revision,key)=>({targetType:'shelf_entry',targetId,expectedRevision:revision,[field]:value,idempotencyKey:key});
  const post=(payload)=>host.inject({method:'POST',url:'/v1/admin/perception/records',headers:{cookie},payload});
  async function wait(field,predicate){let current;const deadline=Date.now()+30_000;while(Date.now()<deadline){assert.ifError(runtimeError);const response=await host.inject({method:'GET',url:'/v1/admin/perception/records?targetType=shelf_entry&targetId='+targetId,headers:{cookie}});assert.equal(response.statusCode,200,response.body);current=response.json()[field];if(predicate(current))return current;await new Promise(resolve=>setTimeout(resolve,30));}assert.fail(JSON.stringify(current));}
  function rows(){const db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{return db.prepare('SELECT * FROM perception_records ORDER BY committed_at_ms,perception_id').all();}finally{db.close();}}
  try{
    assert.equal((await post(command('watched',null,0,'empty-clear'))).statusCode,400);
    for(const payload of [command('watched','true',0,'bad-type'),{...command('watched',true,0,'mixed'),rating:4}])assert.equal((await post(payload)).statusCode,400);
    assert.equal((await post(command('rating',4,0,'rating'))).statusCode,202);
    await wait('currentRating',value=>value?.state==='ready'&&value.rating===4);const ratingRow=rows()[0];
    const first=command('watched',true,0,'watched-true'),accepted=await post(first);assert.equal(accepted.statusCode,202,accepted.body);
    await wait('currentWatched',value=>value?.state==='ready'&&value.watchedState===true&&value.expectedRevision===1);
    const replay=await post(first);assert.equal(replay.statusCode,202,replay.body);assert.deepEqual(replay.json(),accepted.json());
    assert.equal((await post({...first,watched:false})).statusCode,409);
    assert.equal((await post(command('watched',false,0,'stale'))).statusCode,409);
    assert.equal((await post(command('watched',false,1,'watched-false'))).statusCode,202);
    await wait('currentWatched',value=>value?.state==='ready'&&value.watchedState===false&&value.expectedRevision===2);
    assert.equal((await post(command('watched',null,2,'watched-clear'))).statusCode,202);
    await wait('currentWatched',value=>value?.state==='ready'&&value.watchedState===null&&value.expectedRevision===3);
    await wait('currentRating',value=>value?.state==='ready'&&value.rating===4&&value.expectedRevision===1);
    assert.deepEqual(rows().find(row=>row.perception_id===ratingRow.perception_id),ratingRow);assert.equal(rows().length,4);
    const db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});try{
      const relations=db.prepare('SELECT r.*,a.source_record_key AS a_key,b.source_record_key AS b_key FROM perception_record_relations r JOIN perception_records a ON a.perception_id=r.source_perception_id JOIN perception_records b ON b.perception_id=r.target_perception_id').all();
      assert.equal(relations.length,2);for(const relation of relations){assert.match(relation.a_key,/^shelfdeck:watched:/);assert.equal(relation.a_key,relation.b_key);}
    }finally{db.close();}
    await host.close();cookie=await open();
    await wait('currentWatched',value=>value?.state==='ready'&&value.watchedState===null&&value.expectedRevision===3);
    const restartedReplay=await post(first);assert.equal(restartedReplay.statusCode,202,restartedReplay.body);assert.deepEqual(restartedReplay.json(),accepted.json());
    assert.deepEqual(rows().find(row=>row.perception_id===ratingRow.perception_id),ratingRow);assert.equal(rows().length,4);assert.ifError(runtimeError);
  }catch(error){throw new Error(error.message,{cause:error});}finally{await host.close();}
});
