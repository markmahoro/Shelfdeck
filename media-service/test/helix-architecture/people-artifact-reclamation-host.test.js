'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3'),sharp=require('sharp');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const skip=!process.env.SHELFDECK_FACE_MODEL_ROOT?'Explicit pinned local models required for actual failed reference import.':false;
async function run(t,injectFault=false){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'people-artifact-reclamation-host-')),dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),
    secretRoot='reference-gc-host-isolated-secret-0123456789';fs.mkdirSync(adminDistDir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});let host=null,db=null,cookie,now=Date.parse('2026-07-01T12:00:00+08:00');const errors=[];let faultInjected=false,faultObserved=false;
  const open=()=>createCleanServiceHost({dataDir,adminDistDir,secretRoot,now:()=>now,faceModelRoot:process.env.SHELFDECK_FACE_MODEL_ROOT,onExecutionRuntimeError:error=>errors.push({code:error.code,message:error.message}),afterPeopleReferenceReclamationPhysicalEffect(){
    if(injectFault&&!faultInjected){const writer=new Database(path.join(dataDir,'shelfdeck.db'));try{writer.exec("CREATE TRIGGER fixture_gc_marker_failure BEFORE INSERT ON fx_commit_markers WHEN NEW.scope_type='people_artifact_reclamation' BEGIN SELECT RAISE(ABORT,'fixture_gc_marker_failure'); END");faultInjected=true;}finally{writer.close();}}
  }});
  t.after(async()=>{await host?.close();db?.close();assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('people-artifact-reclamation-host-'));fs.rmSync(root,{recursive:true,force:true});});
  async function login(){const response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(response.statusCode,204,response.body);cookie=response.headers['set-cookie'];}
  const request=(method,url,payload)=>host.inject({method,url,headers:{cookie},payload});
  host=await open();await login();const bytes=await sharp({create:{width:256,height:256,channels:3,background:'#213145'}}).png().toBuffer(),
    started=await request('POST','/v1/admin/people',{idempotencyKey:'failed-reference-before-retention',libraryKind:'us_adult',canonicalName:'Uncreated Actor',aliases:[],image:{kind:'upload',bytesBase64:bytes.toString('base64')}});
  assert.equal(started.statusCode,202,started.body);let operation;const operationDeadline=Date.now()+20000;
  do{operation=(await request('GET','/v1/admin/people/operations/'+started.json().operationRef)).json();if(operation.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,30));}while(Date.now()<operationDeadline);
  assert.equal(operation.state,'failed',JSON.stringify({operation,errors}));
  db=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});const artifact=db.prepare("SELECT artifact_handle_id,created_at_ms FROM fx_artifact_registry WHERE owner_domain='people'").get();assert.ok(artifact);assert.equal(artifact.created_at_ms,now);
  const file=path.join(dataDir,'artifacts','people',artifact.artifact_handle_id);assert.equal(fs.existsSync(file),true);
  await host.close();host=null;now=Date.parse('2026-10-24T02:59:00+08:00');host=await open();await login();
  await new Promise(resolve=>setTimeout(resolve,150));assert.equal(db.prepare("SELECT count(*) n FROM fx_supporting_works WHERE process_type='people_artifact_reclamation'").get().n,0);
  now=Date.parse('2026-10-24T03:00:00+08:00');let advancedQuiet=false;const deadline=Date.now()+110000;
  const diagnostics=()=>JSON.stringify({errors,works:db.prepare("SELECT work_id,work_kind,state FROM fx_supporting_works WHERE owner_domain='people'").all(),
    events:db.prepare("SELECT capability_ref,state FROM fx_workflow_events WHERE owner_domain='people'").all(),attempts:db.prepare('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL').all()});
  while(Date.now()<deadline){const row=db.prepare('SELECT state,reference_revision FROM fx_artifact_registry WHERE artifact_handle_id=?').get(artifact.artifact_handle_id);if(row.state==='deleted')break;
    if(faultInjected&&!faultObserved&&row.state==='gc_eligible'&&db.prepare("SELECT count(*) n FROM fx_effect_journal WHERE state='reconcile_required'").get().n>0){
      assert.equal(fs.existsSync(file),false);assert.equal(db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/types/PeopleArtifactReclamationReceipt/v1'").get().n,0);
      const writer=new Database(path.join(dataDir,'shelfdeck.db'));try{writer.exec('DROP TRIGGER fixture_gc_marker_failure');}finally{writer.close();}
      faultObserved=true;now=Date.parse('2026-10-24T09:01:00+08:00');
    }
    if(!advancedQuiet){const waiting=db.prepare("SELECT result_json FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/types/PeopleArtifactReferenceEvidence/v1'").all().map(row=>JSON.parse(row.result_json)).find(value=>value.status==='waiting');
      if(waiting){now+=61000;advancedQuiet=true;}}
    await new Promise(resolve=>setTimeout(resolve,40));}
  assert.deepEqual(db.prepare('SELECT state,reference_revision FROM fx_artifact_registry WHERE artifact_handle_id=?').get(artifact.artifact_handle_id),{state:'deleted',reference_revision:3},diagnostics());
  assert.equal(advancedQuiet,true);assert.equal(fs.existsSync(file),false);const receipts=db.prepare("SELECT result_id,result_digest,result_json FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/types/PeopleArtifactReclamationReceipt/v1'").all();
  assert.equal(receipts.length,1,diagnostics());const receipt=JSON.parse(receipts[0].result_json);assert.equal(receipt.disposition,'deleted');assert.equal(receipt.artifactHandleId,artifact.artifact_handle_id);
  assert.equal(db.prepare('SELECT count(*) n FROM fx_commit_markers WHERE result_id=? AND result_digest=?').get(receipts[0].result_id,receipts[0].result_digest).n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM people_persons').get().n,0);assert.equal(db.prepare("SELECT state FROM people_image_operations WHERE operation_id=?").get(started.json().operationRef).state,'failed');
  await host.close();host=null;now=Date.parse('2026-10-25T12:00:00+08:00');host=await open();await login();await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE result_schema_ref='helix://contracts/types/PeopleArtifactReclamationReceipt/v1'").get().n,1);assert.equal(faultObserved,injectFault);assert.deepEqual(errors.filter(error=>!injectFault||!error.message.includes('fixture_gc_marker_failure')),[]);
}
test('actual maintenance Work audits twice and atomically reclaims only an expired failed Actor image',{timeout:180000,skip},t=>run(t));
test('actual late marker failure rolls back Registry/Result and recovers the original Effect outside the maintenance window',{timeout:180000,skip},t=>run(t,true));

