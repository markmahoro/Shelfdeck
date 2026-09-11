'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {initializeCleanData}=require('../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../src/clean-service-host');
const {canonicalDigest:D,canonicalJson}=require('../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createRepositoryDefinition}=require('../src/helix/foundation/persistence/owner-repository');
const {createMaterialControlParticipant,controlScopeDigest}=require('../src/helix/foundation/persistence/material-control');
const generated=path.resolve(__dirname,'../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));

// Change Control through its owning CAS participant in a stopped, disposable Host.
function advanceControl(databasePath) {
  const read=new Database(databasePath,{readonly:true});
  const row=read.prepare('SELECT * FROM fx_material_controls').get(); read.close();
  const identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
    materialKey:row.material_key,mountScopeId:row.mount_scope_id,inode:String(row.inode),sizeBytes:Number(row.size_bytes),
    fingerprintAlgorithm:row.fingerprint_algorithm,fingerprintVersion:Number(row.fingerprint_version),contentFingerprint:row.content_fingerprint};
  const scope={ownerDomain:'procurement',scopeType:'material_field',scopeId:row.owner_scope_id};
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest}),unitOfWork=createSqliteUnitOfWork({kernel});
  const owner=createRepositoryDefinition({repositoryId:'test_control_owner',owner:'procurement',schemaManifest,
    statements:{read:{kind:'select-all',tableId:'proc_material_fields',columns:['field_id']}}});
  const markers=createRepositoryDefinition({repositoryId:'test_control_markers',owner:'execution-foundation',schemaManifest,
    statements:{insert:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','committed_at_ms']}}});
  try {
    for(const [ordinal,action] of ['release','acquire'].entries()) {
      const change={action,identity,expectedRevision:Number(row.control_revision)+ordinal,fromScope:ordinal===0?scope:null,toScope:ordinal===0?null:scope};
      const marker='test-control-'+action;
      const handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:marker,
        operationKind:action,ownerDomain:'procurement',processType:'test-control',processId:marker,
        basisRef:{objectType:'test',objectId:marker,revision:1,digest:D(marker)},basisDigest:D('basis'),canonicalFactSetDigest:D('facts'),
        bindingSetDigest:D('bindings'),controlScopeDigest:controlScopeDigest([change]),
        expectedControlRevisions:[{materialKey:identity.materialKey,revision:change.expectedRevision}],
        receiptContract:{receiptSchemaRef:'helix://contracts/types/TestControlReceipt/v1',controlRevisionSetSchemaRef:'test.control-revision-set@1'},eventFenceDigest:D('fence')};
      unitOfWork.execute([
        {participantId:'test_owner',owner:'procurement',repositories:[owner],execute(context){context.repository(owner.repositoryId).invoke('read',{});}},
        createMaterialControlParticipant({schemaManifest,handle,changes:[change],commitMarker:marker}),
        {participantId:'test_marker',owner:'execution-foundation',boundBusinessOwner:'procurement',repositories:[markers],execute(context){
          context.repository(markers.repositoryId).invoke('insert',{commit_marker:marker,owner_domain:'procurement',scope_type:'test',scope_id:marker,
            commit_digest:D(marker),committed_at_ms:context.commitTimeMs});}}
      ]);
    }
  } finally {kernel.close();}
}

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-intake-control-'));
  const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin'),source=path.join(root,'source');
  fs.mkdirSync(adminDistDir);fs.mkdirSync(source);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div></div>');
  fs.writeFileSync(path.join(source,'Control.2024.mkv'),'disposable-control-material');
  const secretRoot='isolated-control-recovery-secret-root-20260912';
  const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
  const databasePath=path.join(dataDir,'shelfdeck.db'),errors=[];
  const options={dataDir,adminDistDir,secretRoot,onExecutionRuntimeError:error=>errors.push(error.code),mediaProbe:{async probe(handle){
    const value={resultKind:'probed',sourceHandleDigest:D(handle),durationMs:1000,
      videoStreams:[{streamIndex:0,codec:'hevc',dispositionDefault:true,width:1920,height:1080}],audioStreams:[],subtitleStreams:[],discTopology:null};
    return {...value,payloadDigest:D(value)};
  }}};
  let host,cookie;
  const read=(sql,...args)=>{const db=new Database(databasePath,{readonly:true});try{return db.prepare(sql).all(...args);}finally{db.close();}};
  const write=fn=>{const db=new Database(databasePath);try{return fn(db);}finally{db.close();}};
  async function start(){host=await createCleanServiceHost(options);const response=await host.inject({method:'POST',url:'/v1/admin/session',
    headers:{'x-api-key':initialized.adminApiKey}});assert.equal(response.statusCode,204,response.body);cookie=response.headers['set-cookie'];}
  async function stop(){if(host){await host.close();host=null;}}
  t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  async function request(method,url,payload){const response=await host.inject({method,url,headers:{cookie},payload});
    assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response.json();}
  async function until(predicate,label){const deadline=Date.now()+35000;do{if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}while(Date.now()<deadline);
    assert.fail(label+': '+JSON.stringify({errors,events:read('SELECT capability_ref,state FROM fx_workflow_events'),attempts:read('SELECT failure_code FROM fx_event_attempts WHERE failure_code IS NOT NULL')}));}
  const fieldId='control-field';
  await start();
  const policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
  const policyBasis={extractionPolicyId:'control-policy',revision:1,...policy};
  const access={fieldId,revision:1,endpointId:'control-endpoint',rootLocation:source,mountScopeId:'control-mount',mountScopeRevision:1,
    accessSchemaRef:'helix://fixtures/control-access/v1'};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'create-control-field',fieldId,name:'Control',contentProfileHint:'movie',
    policy:{extractionPolicyId:policyBasis.extractionPolicyId,revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,policyDigest:D(policyBasis)},
    access:{...access,accessDigest:D(access)}});
  await request('PATCH',`/v1/admin/libra/material-fields/${fieldId}/intake-admission`,{predeckPipelineSeats:0,idempotencyKey:'hold'});
  await request('POST',`/v1/admin/material-fields/${fieldId}/actions/observe`,{idempotencyKey:'scan',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  await until(()=>read('SELECT count(*) n FROM proc_candidate_packages')[0].n===1,'candidate created');
  await stop();
  const originalPackageId=read('SELECT candidate_package_id FROM proc_candidate_packages')[0].candidate_package_id;
  const frozen=canonicalJson(read('SELECT * FROM proc_candidate_packages WHERE candidate_package_id=?',originalPackageId));
  return {read,write,start,stop,until,request,databasePath,errors,source,fieldId,frozen,originalPackageId,
    async enable(){await request('PATCH',`/v1/admin/libra/material-fields/${fieldId}/intake-admission`,{predeckPipelineSeats:3,idempotencyKey:'enable'});}};
}

test('fresh Control mismatch commits formal rejection, releases reservation/seat, and survives restart without changing source facts',
  {timeout:60000},async t=>{
    const f=await fixture(t);advanceControl(f.databasePath);
    const controls=canonicalJson(f.read('SELECT * FROM fx_material_controls'));
    await f.start();await f.enable();await f.stop();await f.start();
    await f.until(()=>f.read("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='rejected'")[0].n===1 &&
      f.read('SELECT count(*) n FROM libra_predeck_pipeline_tokens')[0].n===0,'formal rejection and release');
    const decision=f.read('SELECT * FROM libra_intake_decisions')[0];
    assert.equal(decision.primary_rejection_code,'candidate_control_scope_unavailable');
    assert.equal(f.read('SELECT count(*) n FROM libra_subjects')[0].n,0);
    assert.equal(f.read("SELECT count(*) n FROM proc_run_materials WHERE selection_state='released' AND terminal_disposition='handoff_rejected'")[0].n,1);
    const ref=f.read('SELECT * FROM libra_intake_rejection_reason_evidence')[0];
    const row=f.read('SELECT * FROM fx_event_result_bindings WHERE result_id=?',ref.evidence_id)[0];
    assert.equal(ref.evidence_digest,D(JSON.parse(row.evidence_json)));
    assert.equal(JSON.parse(row.evidence_json).controlRevision,3);
    assert.equal(JSON.parse(row.result_json).controlScopeStatus,'mismatched');
    assert.equal(canonicalJson(f.read('SELECT * FROM fx_material_controls')),controls);
    const receipts=canonicalJson(f.read('SELECT * FROM libra_handoff_a_receipts WHERE intake_decision_id=?',decision.intake_decision_id));
    await f.stop();await f.start();
    assert.equal(canonicalJson(f.read('SELECT * FROM libra_handoff_a_receipts WHERE intake_decision_id=?',decision.intake_decision_id)),receipts);
    assert.equal(canonicalJson(f.read('SELECT * FROM proc_candidate_packages WHERE candidate_package_id=?',f.originalPackageId)),f.frozen);
    // Ordinary post-rejection selection creates a new immutable Candidate on current Control.
    await f.until(()=>f.read("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='accepted'")[0].n===1,'fresh Candidate accepted');
    assert.equal(f.read('SELECT count(*) n FROM proc_candidate_packages')[0].n,2);
    assert.notEqual(f.read("SELECT candidate_package_id FROM proc_candidate_deliveries WHERE state='accepted'")[0].candidate_package_id,f.originalPackageId);
    assert.equal(f.read('SELECT control_revision FROM fx_material_controls')[0].control_revision,4);
    assert.equal(fs.readFileSync(path.join(f.source,'Control.2024.mkv'),'utf8'),'disposable-control-material');
  });

test('corrupt Control projection is technical failure with no rejection or seat release', {timeout:60000},async t=>{
  const f=await fixture(t);
  // Deliberate local database corruption exercises Foundation unavailable semantics.
  await f.start();
  f.write(db=>db.prepare("UPDATE fx_material_controls SET owner_scope_id=''").run());
  await f.enable();
  await f.until(()=>f.read("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.intake.material.verify@1' AND state='failed'")[0].n===1,'technical failure');
  assert.equal(f.read('SELECT count(*) n FROM libra_handoff_a_receipts')[0].n,0);
  assert.equal(f.read('SELECT count(*) n FROM libra_predeck_pipeline_tokens')[0].n,1);
  assert.equal(f.read('SELECT state FROM proc_candidate_deliveries')[0].state,'open');
  assert.equal(canonicalJson(f.read('SELECT * FROM proc_candidate_packages WHERE candidate_package_id=?',f.originalPackageId)),f.frozen);
});

test('Control change after passed Evidence preserves the unresolved acceptance fence without inventing a rejection', {timeout:90000},async t=>{
  const f=await fixture(t);await f.start();
  f.write(db=>db.exec("CREATE TRIGGER fail_control_acceptance BEFORE INSERT ON libra_subjects BEGIN SELECT RAISE(ABORT,'injected'); END"));
  await f.enable();
  await f.until(()=>f.read("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.intake.accept.commit@1' AND state='executing'")[0].n===1,'unresolved acceptance');
  const evidence=canonicalJson(f.read("SELECT r.* FROM fx_event_result_bindings r JOIN fx_workflow_events e USING(event_id) WHERE e.capability_ref='libra.intake.material.verify@1'"));
  const attempt=f.read("SELECT a.event_attempt_id,a.input_snapshot_digest FROM fx_event_attempts a JOIN fx_workflow_events e USING(event_id) WHERE e.capability_ref='libra.intake.accept.commit@1'")[0];
  await f.stop();f.write(db=>db.exec('DROP TRIGGER fail_control_acceptance'));advanceControl(f.databasePath);
  const effect=f.read('SELECT * FROM fx_effect_journal WHERE event_attempt_id=?',attempt.event_attempt_id)[0];
  await f.start();
  await f.until(()=>f.errors.includes('P3_CONTROL_CAS_CONFLICT') ||
    f.read('SELECT updated_at_ms FROM fx_effect_journal WHERE effect_id=?',effect.effect_id)[0].updated_at_ms>effect.updated_at_ms,'original acceptance reconciliation');
  assert.equal(f.read('SELECT count(*) n FROM libra_handoff_a_receipts')[0].n,0);
  assert.equal(f.read('SELECT count(*) n FROM libra_predeck_pipeline_tokens')[0].n,1);
  assert.equal(f.read("SELECT count(*) n FROM fx_supporting_works WHERE work_kind='rejection'")[0].n,0);
  assert.equal(f.read('SELECT state FROM proc_candidate_deliveries')[0].state,'open');
  assert.equal(canonicalJson(f.read("SELECT r.* FROM fx_event_result_bindings r JOIN fx_workflow_events e USING(event_id) WHERE e.capability_ref='libra.intake.material.verify@1'")),evidence);
  assert.equal(f.read('SELECT input_snapshot_digest FROM fx_event_attempts WHERE event_attempt_id=?',attempt.event_attempt_id)[0].input_snapshot_digest,attempt.input_snapshot_digest);
  assert.equal(f.errors.includes('P4_EVENT_RECOVERY_INPUT_DRIFT'),false);
});
