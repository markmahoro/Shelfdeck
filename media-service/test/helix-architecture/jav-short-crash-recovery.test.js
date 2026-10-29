'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const test=require('node:test');
const Database=require('better-sqlite3');
const {createCleanServiceHost}=require('../../src/clean-service-host');

const secretRoot='jav-host-fixture-root-0123456789abcdef0123456789';
const preload=path.join(__dirname,'fixtures','jav-short-crash-preload.js');
const journey=path.join(__dirname,'jav-host-journey.test.js');

function files(root,directory) {
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const name=path.join(directory,entry.name);
    if(entry.isDirectory())return files(root,name);
    assert.ok(entry.isFile(),'An unclassified file appeared in the test target.');
    const stat=fs.statSync(name,{bigint:true});
    return [{path:path.relative(root,name),size:Number(stat.size),inode:String(stat.ino),
      sha256:crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex')}];
  }).sort((a,b)=>a.path.localeCompare(b.path));
}

for(const phase of ['stage','verify','placement','stage_mid_link','stage_copy_partial','directory_created','placement_mid_link']){
  test('new shortened JAV resumes its original Effect after process loss at '+phase,
    {timeout:180000,skip:process.platform!=='linux'?'Requires the Linux service Host fixture.':false},async t=>{
      const directory=fs.mkdtempSync(path.join(os.tmpdir(),'helix-jav-short-crash-')),
        proof=path.join(directory,'crash.json');
      let host=null,db=null;
      t.after(async()=>{
        if(host)await host.close();
        if(db)db.close();
        assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith('helix-jav-short-crash-'));
        fs.rmSync(directory,{recursive:true,force:true});
      });
      const childEnvironment={...process.env,TMPDIR:directory,JAV_SHORT_CRASH_PHASE:phase,JAV_SHORT_CRASH_PROOF:proof,
        NODE_OPTIONS:(process.env.NODE_OPTIONS||'')+' --require='+JSON.stringify(preload)};
      delete childEnvironment.NODE_TEST_CONTEXT;
      const child=spawnSync(process.execPath,['--test','--test-name-pattern=^new JAV long title completes',journey],{
        encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:childEnvironment});
      assert.equal(child.status,1,'The injected process must exit before its Effect receipt.\n'+child.stderr);
      assert.ok(fs.existsSync(proof),'The process did not reach the requested crash point.\n'+child.stdout+'\n'+child.stderr);
      const saved=JSON.parse(fs.readFileSync(proof,'utf8'));
      assert.equal(saved.point,phase);
      assert.equal(path.dirname(saved.root),directory);
      assert.equal(saved.target,path.join(saved.root,'shelf'));
      const before=files(saved.root,saved.target);
      assert.ok(before.length>0,'The interrupted Effect must have left recorded physical material.');
      db=new Database(path.join(saved.root,'data','shelfdeck.db'));
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
      const errors=[];
      host=await createCleanServiceHost({dataDir:path.join(saved.root,'data'),adminDistDir:path.join(saved.root,'admin'),secretRoot,
        integrationFetch:async()=>{throw new Error('The isolated recovery must not issue another source request.');},
        onExecutionRuntimeError:error=>errors.push({code:error.code||null,message:error.message})});
      const deadline=Date.now()+90000;
      while(Date.now()<deadline&&db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===0)
        await new Promise(resolve=>setTimeout(resolve,100));
      const events=db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE capability_ref IN ('arca.inventory.product.stage@1','arca.inventory.staged.verify@1','arca.inventory.placement.switch@1','arca.ondeck.commit@1') ORDER BY capability_ref").all(),
        effects=db.prepare("SELECT e.capability_ref,j.state FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id WHERE e.capability_ref IN ('arca.inventory.product.stage@1','arca.inventory.placement.switch@1') ORDER BY e.capability_ref").all(),
        failures=db.prepare('SELECT failure_code,failure_class FROM fx_event_attempts WHERE failure_code IS NOT NULL').all(),
        diagnostics=JSON.stringify({phase,events,effects,failures,errors});
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1,diagnostics);
      assert.deepEqual(errors,[],diagnostics);
      assert.ok(events.every(row=>row.state==='succeeded'),diagnostics);
      assert.ok(effects.every(row=>row.state==='committed'),diagnostics);
      const after=files(saved.root,saved.target);
      assert.equal(after.length,4);
      for(const item of before)assert.ok(after.some(result=>result.inode===item.inode&&
        (phase==='stage_copy_partial'||result.size===item.size&&result.sha256===item.sha256)),
      'Recovery lost or changed recorded physical material: '+item.path);
      const control=db.prepare("SELECT c.state,c.owner_domain,c.owner_scope_type FROM fx_material_controls c JOIN arca_inventory_materials m ON m.material_key=c.material_key WHERE m.role='primary_payload'").get();
      assert.deepEqual(control,{state:'controlled',owner_domain:'arca',owner_scope_type:'shelf_entry'});
      t.diagnostic(JSON.stringify({phase,oneCommit:true,physicalIdentitiesPreserved:true,effectsCommitted:true}));
    });
}

for(const phase of ['stage_create_gap','directory_create_gap']){
  test('an unrecorded short-path '+phase+' stops for inspection and can be rechecked after user resolution',
    {timeout:180000,skip:process.platform!=='linux'?'Requires the Linux service Host fixture.':false},async t=>{
      const directory=fs.mkdtempSync(path.join(os.tmpdir(),'helix-jav-short-gap-')),
        proof=path.join(directory,'crash.json'),credential=path.join(directory,'fixture-credential');
      let host=null,db=null;
      t.after(async()=>{if(host)await host.close();if(db)db.close();
        assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('helix-jav-short-gap-'));
        fs.rmSync(directory,{recursive:true,force:true});});
      const childEnvironment={...process.env,TMPDIR:directory,JAV_SHORT_CRASH_PHASE:phase,JAV_SHORT_CRASH_PROOF:proof,
        JAV_SHORT_CRASH_CREDENTIAL:credential,NODE_OPTIONS:(process.env.NODE_OPTIONS||'')+' --require='+JSON.stringify(preload)};
      delete childEnvironment.NODE_TEST_CONTEXT;
      const child=spawnSync(process.execPath,['--test','--test-name-pattern=^new JAV long title completes',journey],{
        encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:childEnvironment});
      assert.equal(child.status,1);assert.ok(fs.existsSync(proof),child.stdout+'\n'+child.stderr);
      const saved=JSON.parse(fs.readFileSync(proof,'utf8'));assert.equal(saved.point,phase);assert.equal(path.dirname(saved.root),directory);
      const before=files(saved.root,saved.target),errors=[];
      db=new Database(path.join(saved.root,'data','shelfdeck.db'));
      host=await createCleanServiceHost({dataDir:path.join(saved.root,'data'),adminDistDir:path.join(saved.root,'admin'),secretRoot,
        integrationFetch:async()=>{throw new Error('The isolated recovery must not issue another source request.');},
        onExecutionRuntimeError:error=>errors.push({code:error.code||null,message:error.message})});
      const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':fs.readFileSync(credential,'utf8')}});
      assert.equal(login.statusCode,200,login.body);const cookie=login.headers['set-cookie'],subject=db.prepare('SELECT subject_id FROM libra_runs').get().subject_id;
      let detail=null;const deadline=Date.now()+45000;
      while(Date.now()<deadline){
        const response=await host.inject({method:'GET',url:'/v1/admin/formation/'+subject,headers:{cookie}});
        assert.equal(response.statusCode,200,response.body);detail=response.json();
        if(detail.executorIssue?.errorCode==='ARCA_JAV_SHORT_RECOVERY_UNPROVEN')break;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      assert.equal(detail?.classification,'attention_required');assert.equal(detail.executorIssue?.errorCode,'ARCA_JAV_SHORT_RECOVERY_UNPROVEN');
      assert.equal(detail.executorIssue.canRetry,false);assert.equal(detail.executorIssue.canRecheck,true);
      assert.ok(detail.executorIssue.details?.sourceDirectory);
      const works=()=>db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE process_type='arca_ondeck_run' AND work_kind='on_deck_execution'").get().n,
        originalWorks=works(),url='/v1/admin/formation/acceptance/'+detail.executorIssue.offerId+'/actions/retry';
      await new Promise(resolve=>setTimeout(resolve,1500));assert.equal(works(),originalWorks,'Unknown reality must not dispatch a successor automatically.');
      const refused=await host.inject({method:'POST',url,headers:{cookie},payload:{idempotencyKey:'short-gap-still-present'}});
      assert.equal(refused.statusCode,409,refused.body);assert.equal(works(),originalWorks);
      assert.deepEqual(files(saved.root,saved.target),before);assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,0);
      const row=db.prepare("SELECT witness_json FROM arca_jav_short_stage_witnesses WHERE state='intent' ORDER BY witness_id LIMIT 1").get(),witness=JSON.parse(row.witness_json);
      if(phase==='stage_create_gap')fs.unlinkSync(witness.temporaryPath);
      else fs.rmdirSync(witness.targetPath);
      const accepted=await host.inject({method:'POST',url,headers:{cookie},payload:{idempotencyKey:'short-gap-user-resolved'}});
      assert.ok(accepted.statusCode>=200&&accepted.statusCode<300,accepted.body);
      const completeBy=Date.now()+90000;
      while(Date.now()<completeBy&&db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===0)
        await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n,1,JSON.stringify(errors));
      assert.deepEqual(errors,[]);
      t.diagnostic(JSON.stringify({phase,unknownPreserved:true,noAutomaticSuccessor:true,recheckedAfterUserResolution:true,oneCommit:true}));
    });
}
