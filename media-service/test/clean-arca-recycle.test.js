'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const files=require('../src/clean-arca-recycle-port');
const {createRecycleStore,RETENTION_MS}=require('../src/helix/domains/arca/persistence/recycle-store');
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
  const makeApp=()=>createRecycleApplication({root:archiveRoot,store,port,files,now:()=>at,readScope:()=>scope});
  return {root,source,archiveRoot,scope,store,port,makeApp,setTime:value=>{at=value;},close(){kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}
async function enqueue(app,source,key='request-1'){
  const preview=await app.preview('entry-1',source);
  return app.archive('entry-1',{sourceLocation:source,manifestDigest:preview.manifestDigest,confirmManifestDigest:preview.manifestDigest,idempotencyKey:key});
}

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
    f.setTime(100000000+RETENTION_MS+1);assert.equal((await app.tick()).kind,'completed');
    assert.equal(f.store.get(row.id).state,'purged');assert.equal(fs.readFileSync(path.join(f.source,'new.txt'),'utf8'),'keep');
  }finally{f.close();}
});

test('expiry does not delete an added archive file and keeps the entry recoverable for investigation',async()=>{
  const f=fixture();try{const app=f.makeApp(),row=await enqueue(app,f.source);await app.tick();
    const archive=f.store.get(row.id).archive_location;fs.writeFileSync(path.join(archive,'unknown.txt'),'keep');
    f.setTime(100000000+RETENTION_MS+1);assert.equal((await app.tick()).kind,'blocked');
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
