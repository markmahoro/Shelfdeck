'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const files=require('../src/clean-arca-recycle-port');
const {createRecycleStore,RETENTION_MS}=require('../src/helix/domains/arca/persistence/recycle-store');
const {createSourceCleanupStore}=require('../src/helix/domains/arca/persistence/source-cleanup-store');
const {createRecycleApplication}=require('../src/helix/domains/arca/application/recycle-application');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const schemaManifest=require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');

function fixture(testHooks={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arca-recycle-')),source=path.join(root,'media','Old Movie'),archiveRoot=path.join(root,'recycle');
  fs.mkdirSync(source,{recursive:true});fs.writeFileSync(path.join(source,'poster.jpg'),'historical artwork');
  let at=100000000;
  const kernel=openSqliteKernel({Database,databasePath:path.join(root,'db'),schemaDdl,schemaManifest,now:()=>at});
  kernel.runPrimitive(({prepare})=>prepare('INSERT INTO arca_shelf_entries(shelf_entry_id) VALUES(?)').run('entry-1'));
  const dependencies={schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),now:()=>at};
  const store=createRecycleStore(dependencies),port=files.createRecycleEffectPort({...dependencies,testHooks});
  const scope={knownSourceDirectories:[source],scanRoots:[path.join(root,'media')],protectedLocations:[]};
  const makeApp=(extra={})=>createRecycleApplication({root:archiveRoot,store,port,files,now:()=>at,readScope:()=>scope,...extra});
  const seedCleanup=()=>{kernel.runPrimitive(({prepare})=>{prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id) VALUES(?)').run('run-1');prepare("INSERT INTO arca_source_cleanup_checks(cleanup_id,on_deck_run_id,shelf_entry_id,state,check_revision,checks_schema_ref,checks_json,created_at_ms,updated_at_ms,next_check_at_ms) VALUES('run-1','run-1','entry-1','pending',1,'helix://contracts/application-types/SourceCleanupChecks/v1','[]',1,1,1)").run();});scope.onDeckRunId='run-1';return createSourceCleanupStore(dependencies);};
  return {root,source,archiveRoot,scope,store,port,makeApp,seedCleanup,setTime:value=>{at=value;},close(){kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}
async function enqueue(app,source,key='request-1'){
  const preview=await app.preview('entry-1',source);
  return app.archive('entry-1',{sourceLocation:source,manifestDigest:preview.manifestDigest,confirmManifestDigest:preview.manifestDigest,idempotencyKey:key});
}

test('new committed cleanup survives restart, archives only an empty directory, and retains a user restore',async()=>{
  const f=fixture();try{
    fs.unlinkSync(path.join(f.source,'poster.jpg'));const cleanupStore=f.seedCleanup();
    let app=f.makeApp({cleanupStore});assert.equal((await app.tick()).kind,'cleanup_checked');
    assert.equal(fs.existsSync(f.source),true);assert.equal(cleanupStore.page()[0].state,'pending');
    app=f.makeApp({cleanupStore});assert.equal((await app.tick()).kind,'completed');
    assert.equal(fs.existsSync(f.source),false);
    const archived=f.store.list()[0];await app.restore(archived.recycle_entry_id);await app.tick();
    f.setTime(100000000+5*60*1000+1);await app.tick();
    assert.equal(cleanupStore.page()[0].checks[0].state,'retained_after_restore');
    assert.equal(cleanupStore.page()[0].state,'completed');assert.equal(fs.existsSync(f.source),true);
  }finally{f.close();}
});

test('occupied cleanup is durably pending confirmation without hashing or creating a recycle effect',async()=>{
  const f=fixture();try{
    const cleanupStore=f.seedCleanup(),app=f.makeApp({cleanupStore,files:{...files,snapshot(){throw new Error('Must not hash occupied directories.');}}});
    assert.equal((await app.tick()).state,'attention');assert.equal(cleanupStore.page()[0].checks[0].state,'awaiting_confirmation');
    assert.equal(f.store.list().length,0);assert.equal(fs.readFileSync(path.join(f.source,'poster.jpg'),'utf8'),'historical artwork');
    assert.equal((await f.makeApp({cleanupStore}).tick()).kind,'idle');
    assert.equal(f.makeApp({cleanupStore}).list().cleanupChecks[0].state,'attention');
  }finally{f.close();}
});

test('cleanup display follows confirmed recycle facts immediately without bypassing the observation throttle',async()=>{
  const f=fixture();try{
    const cleanupStore=f.seedCleanup(),app=f.makeApp({cleanupStore});
    await app.tick();const observation=cleanupStore.page()[0];
    assert.equal(observation.state,'attention');
    const queued=await enqueue(app,f.source);
    assert.equal(app.list().cleanupChecks[0].state,'pending');
    await app.tick();
    assert.equal(app.list().cleanupChecks[0].checks[0].state,'archived');
    assert.equal(app.list().cleanupChecks[0].state,'completed');
    assert.deepEqual(cleanupStore.page()[0],observation);
    const restarted=f.makeApp({cleanupStore});
    assert.equal(restarted.list().cleanupChecks[0].checks[0].recycleEntryId,queued.id);
    await restarted.restore(queued.id);await restarted.tick();
    assert.equal(restarted.list().cleanupChecks[0].checks[0].state,'retained_after_restore');
    assert.equal(fs.existsSync(f.source),true);
    assert.deepEqual(cleanupStore.page()[0],observation);
  }finally{f.close();}
});

test('cleanup display does not adopt another Entry recycle record for the same old path',async()=>{
  const f=fixture();try{
    const cleanupStore=f.seedCleanup(),app=f.makeApp({cleanupStore});await app.tick();
    const foreign=f.makeApp({cleanupStore,store:{...f.store,list:()=>[{shelf_entry_id:'another-entry',source_location:f.source,created_at_ms:100000001,state:'archived',manifest:{entries:[],totalBytes:0}}]}});
    assert.equal(foreign.list().cleanupChecks[0].checks[0].state,'awaiting_confirmation');
  }finally{f.close();}
});

test('a file appearing after the empty check never acquires automatic confirmation',async()=>{
  const f=fixture();try{
    fs.unlinkSync(path.join(f.source,'poster.jpg'));const cleanupStore=f.seedCleanup();
    const app=f.makeApp({cleanupStore,files:{...files,async emptyDirectory(source){fs.writeFileSync(path.join(source,'new.txt'),'keep');return true;}}});
    await app.tick();assert.equal(cleanupStore.page()[0].checks[0].state,'awaiting_confirmation');
    assert.equal(f.store.list().length,0);assert.equal(fs.readFileSync(path.join(f.source,'new.txt'),'utf8'),'keep');
  }finally{f.close();}
});

test('cleanup retains protected locations, records exact errors, and retries a failed observation after restart',async()=>{
  const f=fixture();try{
    const cleanupStore=f.seedCleanup();let failOnce=true;
    const app=f.makeApp({cleanupStore,files:{...files,async emptyDirectory(source){if(failOnce){failOnce=false;throw Object.assign(new Error('denied'),{code:'EACCES'});}return files.emptyDirectory(source);}}});
    await app.tick();assert.equal(cleanupStore.page()[0].checks[0].errorCode,'EACCES');
    assert.equal((await f.makeApp({cleanupStore}).tick()).kind,'idle');
    f.scope.protectedLocations.push(path.join(f.source,'poster.jpg'));f.setTime(100000000+5*60*1000+1);
    await f.makeApp({cleanupStore}).tick();assert.equal(cleanupStore.page()[0].checks[0].state,'retained_in_use');
    assert.equal(f.store.list().length,0);
  }finally{f.close();}
});

test('historical Entries without an atomic cleanup responsibility are never automatically archived',async()=>{
  const f=fixture();try{
    fs.unlinkSync(path.join(f.source,'poster.jpg'));
    const app=f.makeApp({listEntryPage:()=>[{cursor:'entry-1',scope:{shelfEntryId:'entry-1'}}]});
    assert.equal((await app.tick()).kind,'idle');assert.equal(fs.existsSync(f.source),true);assert.equal(f.store.list().length,0);
  }finally{f.close();}
});

test('a pending asynchronous directory check excludes overlapping reconciler ticks',async()=>{
  const f=fixture();try{
    const cleanupStore=f.seedCleanup();let entered,release;
    const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const app=f.makeApp({cleanupStore,files:{...files,async emptyDirectory(){entered();await gate;return false;}}});
    const first=app.tick();await started;assert.equal((await app.tick()).kind,'busy');
    release();assert.equal((await first).kind,'cleanup_checked');assert.equal(cleanupStore.page()[0].check_revision,2);
  }finally{f.close();}
});

test('archive physically moves the exact directory; a restarted application restores it and permits a new generation',async()=>{
  const f=fixture();try{
    let app=f.makeApp();const row=await enqueue(app,f.source);
    assert.equal(fs.existsSync(f.source),true);
    const result=await app.tick();assert.equal(result.kind,'completed',JSON.stringify(result));
    assert.equal(fs.existsSync(f.source),false);
    const archived=f.store.get(row.id);assert.equal(archived.state,'archived');assert.equal(Number(archived.expires_at_ms)-Number(archived.archived_at_ms),RETENTION_MS);
    assert.equal(fs.readFileSync(path.join(archived.archive_location,'poster.jpg'),'utf8'),'historical artwork');
    app=f.makeApp();await app.restore(row.id);assert.equal((await app.tick()).kind,'completed');
    assert.equal(fs.readFileSync(path.join(f.source,'poster.jpg'),'utf8'),'historical artwork');
    assert.equal(f.store.get(row.id).state,'restored');
    assert.notEqual((await enqueue(app,f.source,'request-2')).id,row.id);
  }finally{f.close();}
});

test('cross-volume copy interruption preserves both copies and resumes without overwriting',async()=>{
  let interrupt=true;const f=fixture({forceCopy:true,afterCopy(){if(interrupt){interrupt=false;throw Object.assign(new Error('interrupt'),{code:'SIMULATED_CRASH'});}}});
  try{let app=f.makeApp();const row=await enqueue(app,f.source);assert.equal((await app.tick()).kind,'blocked');
    assert.equal(fs.existsSync(path.join(f.source,'poster.jpg')),true);
    assert.equal(fs.existsSync(path.join(f.store.get(row.id).archive_location,'poster.jpg')),true);
    app=f.makeApp();assert.equal((await app.tick()).kind,'completed');assert.equal(fs.existsSync(f.source),false);
  }finally{f.close();}
});

test('restore cannot overwrite a new original directory, and purge waits for retention',async()=>{
  const f=fixture();try{const app=f.makeApp(),row=await enqueue(app,f.source);await app.tick();
    fs.mkdirSync(f.source);fs.writeFileSync(path.join(f.source,'new.txt'),'keep');
    await assert.rejects(app.restore(row.id),{code:'ARCA_RECYCLE_TARGET_EXISTS'});
    assert.equal((await app.tick()).kind,'idle');assert.equal(f.store.get(row.id).state,'archived');
    f.setTime(100000000+RETENTION_MS+1);assert.equal((await app.tick()).kind,'idle');assert.equal((await app.expire()).kind,'completed');
    assert.equal(f.store.get(row.id).state,'purged');assert.equal(fs.readFileSync(path.join(f.source,'new.txt'),'utf8'),'keep');
  }finally{f.close();}
});

test('expiry does not delete an added archive file and keeps the entry recoverable for investigation',async()=>{
  const f=fixture();try{const app=f.makeApp(),row=await enqueue(app,f.source);await app.tick();
    const archive=f.store.get(row.id).archive_location;fs.writeFileSync(path.join(archive,'unknown.txt'),'keep');
    f.setTime(100000000+RETENTION_MS+1);assert.equal((await app.tick()).kind,'idle');assert.equal((await app.expire()).kind,'blocked');
    assert.equal(fs.readFileSync(path.join(archive,'unknown.txt'),'utf8'),'keep');
    assert.equal(fs.readFileSync(path.join(archive,'poster.jpg'),'utf8'),'historical artwork');
  }finally{f.close();}
});

test('stale confirmation, active inventory, unbound paths, primary media and root overlap cannot be archived',async()=>{
  const f=fixture();try{const app=f.makeApp(),preview=await app.preview('entry-1',f.source);
    fs.writeFileSync(path.join(f.source,'new.jpg'),'new');
    await assert.rejects(app.archive('entry-1',{...preview,confirmManifestDigest:preview.manifestDigest,idempotencyKey:'stale'}),{code:'ARCA_RECYCLE_CONFIRMATION_STALE'});
    await assert.rejects(app.preview('entry-1',f.root),{code:'ARCA_RECYCLE_SOURCE_NOT_BOUND'});
    f.scope.protectedLocations.push(path.join(f.source,'poster.jpg'));
    await assert.rejects(app.preview('entry-1',f.source),{code:'ARCA_RECYCLE_SOURCE_IN_USE'});f.scope.protectedLocations.length=0;
    fs.writeFileSync(path.join(f.source,'movie.mkv'),'primary');
    await assert.rejects(app.preview('entry-1',f.source),{code:'ARCA_RECYCLE_PRIMARY_PRESENT'});
    f.scope.scanRoots.push(f.root);await assert.rejects(app.preview('entry-1',f.source),{code:'ARCA_RECYCLE_ROOT_OVERLAP'});
  }finally{f.close();}
});

test('partial deletion recovery accepts only missing expected files, never changed survivors',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'recycle-remove-'));try{
    fs.writeFileSync(path.join(root,'a'),'a');fs.writeFileSync(path.join(root,'b'),'b');const manifest=await files.snapshot(root);
    fs.unlinkSync(path.join(root,'a'));fs.writeFileSync(path.join(root,'b'),'changed');
    await assert.rejects(files.removeExact(root,manifest),{code:'ARCA_RECYCLE_CONTENT_CHANGED'});
    fs.writeFileSync(path.join(root,'b'),'b');await files.removeExact(root,manifest);assert.equal(fs.existsSync(root),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('cross-volume recovery resumes a partial byte prefix and refuses conflicting staging data',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'recycle-prefix-'));
  try{
    const source=path.join(root,'source'),target=path.join(root,'target'),staging=target+'.copying';
    fs.mkdirSync(source);fs.mkdirSync(staging);fs.writeFileSync(path.join(source,'art.jpg'),'complete artwork');
    const manifest=await files.snapshot(source);
    fs.writeFileSync(path.join(staging,'art.jpg'),'wrong');
    await assert.rejects(files.moveExact(source,target,manifest,{forceCopy:true,resume:true}),{code:'ARCA_RECYCLE_COPY_CONFLICT'});
    assert.equal(fs.readFileSync(path.join(source,'art.jpg'),'utf8'),'complete artwork');
    fs.writeFileSync(path.join(staging,'art.jpg'),'complete');
    await files.moveExact(source,target,manifest,{forceCopy:true,resume:true});
    assert.equal(fs.readFileSync(path.join(target,'art.jpg'),'utf8'),'complete artwork');
    assert.equal(fs.existsSync(source),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
