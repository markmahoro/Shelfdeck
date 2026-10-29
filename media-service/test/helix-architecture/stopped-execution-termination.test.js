'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const {openSqliteKernel} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {canonicalDigest} = require('../../src/helix/contracts/canonical-json');
const {createStoppedExecutionTerminationStore} = require('../../src/helix/foundation/execution/stopped-execution-termination');
const {readStoppedSnapshot, observeStoppedTranscode} = require('../../scripts/formation-stopped-transcode');
const {inspectRetirementPlan} = require('../../scripts/formation-retirement-plan');
const {createFormationRetirementOperator} = require('../../scripts/formation-retirement-operator');
const {buildWorkspaceMediaOutputTarget} = require('../../src/helix/domains/libra/model/media-production-contracts');
const {runStateDigest} = require('../../src/helix/domains/libra/model/run-lifecycle-contracts');
const {activeRunScopeSetDigest} = require('../../src/helix/domains/libra/model/run-admission-contracts');
const {writeAtomic} = require('../../src/clean-runtime-operations');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const D = canonicalDigest({fixture:'stopped-transcode'});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'stopped-transcode-'));
  const dataDir = path.join(root,'data'), workspaceRoot = path.join(root,'workspace');
  fs.mkdirSync(dataDir); fs.mkdirSync(workspaceRoot);
  const databasePath = path.join(dataDir,'shelfdeck.db');
  const kernel = openSqliteKernel({Database, databasePath, schemaManifest, schemaDdl, now:()=>9000});
  const db = new Database(databasePath); db.pragma('foreign_keys = ON');
  const insert = (table, value) => db.prepare(`INSERT INTO ${table} (${Object.keys(value).join(',')}) VALUES (${Object.keys(value).map(()=>'?').join(',')})`).run(...Object.values(value));
  insert('libra_subjects',{subject_id:'subject',status:'active',structure_kind:'single',content_profile:'movie',intake_revision:1,
    current_continuity_set_digest:D,current_episode_scope_digest:D,created_at_ms:1,updated_at_ms:1});
  const stateDigest=runStateDigest({libraRunId:'run',stateRevision:1,state:'active',acceptanceSpecId:null,executionBasisDigest:D,
    runScopeDigest:D,priorityClass:'normal',priorityIntentDigest:D,transitionKind:'admitted',transitionEvidenceDigest:D});
  insert('libra_runs',{libra_run_id:'run',subject_id:'subject',admission_revision:1,execution_basis_record_json:'{}',
    execution_basis_digest:D,run_scope_digest:D,state:'active',state_revision:1,state_digest:stateDigest,
    priority_class:'normal',priority_intent_digest:D,recovery_attempt_ordinal:0,created_at_ms:1});
  insert('libra_run_admission_heads',{subject_id:'subject',head_revision:1,updated_at_ms:1,
    active_scope_set_digest:activeRunScopeSetDigest('subject',[{libraRunId:'run',runScopeDigest:D,stateRevision:1,stateDigest}])});
  insert('platform_workspace_roots',{root_id:'root',owner_scope:'libra',root_kind:'production',endpoint_id:'endpoint',mount_scope_id:'mount',
    mount_scope_revision:1,resolved_root:workspaceRoot,config_revision:1,capability_digest:D,state:'active',root_handle_ref:D,snapshot_digest:D});
  db.transaction(()=>{
    insert('libra_workspaces',{workspace_id:D,libra_run_id:'run',platform_workspace_root_id:'root',platform_workspace_snapshot_digest:D,
      root_handle_ref:D,workspace_scope_digest:D,current_revision:1,state:'active',state_digest:D,space_admission_evidence_json:'{}'});
    insert('libra_workspace_revisions',{workspace_id:D,workspace_revision:1,state:'active',revision_digest:D});
  })();
  insert('fx_workspace_registry',{workspace_id:D,owner_domain:'libra',process_type:'libra_run',process_id:'run',root_handle_ref:D,state:'active'});
  const output = buildWorkspaceMediaOutputTarget({libraRunId:'run',executionBasisDigest:D,workspaceId:D,
    expectedWorkspaceRevision:1,expectedWorkspaceStateDigest:D,rootSnapshot:{rootId:'root',rootHandleRef:D,snapshotDigest:D},
    workspaceScopeDigest:D,targetRelativePath:'product/encoded.mkv',productionIntentDigest:D});
  const inputs={materialHandle:{},encodeIntent:{intentDigest:D},mediaExecutionDeviceSnapshot:{},transcodeInputVerification:{},workspaceMediaOutputTarget:output};
  insert('fx_supporting_works',{work_id:'work',owner_domain:'libra',process_type:'libra_run',process_id:'run',state:'running',definition_json:'{}'});
  insert('fx_work_attempts',{attempt_id:'work-attempt',work_id:'work',ordinal:1,state:'running'});
  insert('fx_workflow_plans',{plan_id:'plan',attempt_id:'work-attempt',state:'planned'});
  insert('fx_plan_nodes',{plan_id:'plan',node_id:'encode',capability_ref:'libra.media.transcode@1',contract_version:1,effect_class:'workspace_write',
    input_bindings_json:JSON.stringify({bindings:Object.entries(inputs).map(([portName,value])=>({portName,bindingKind:'literal',value}))})});
  insert('fx_workflow_events',{event_id:'event',plan_id:'plan',node_id:'encode',work_id:'work',attempt_id:'work-attempt',
    owner_domain:'libra',capability_ref:'libra.media.transcode@1',contract_version:1,state:'executing'});
  insert('fx_event_attempts',{event_attempt_id:'event-attempt',event_id:'event',ordinal:1,executor_ref:'libra.media.transcode@1',
    executor_version:1,input_snapshot_digest:canonicalDigest(inputs),fence_snapshot_digest:D,state:'executing'});
  insert('fx_effect_journal',{effect_id:'effect-one',event_attempt_id:'event-attempt',effect_class:'workspace_write',idempotency_key:'effect-key',
    intent_digest:canonicalDigest({eventId:'event',capabilityRef:'libra.media.transcode@1',contractVersion:1,
      inputSnapshotDigest:canonicalDigest(inputs),fenceSnapshotDigest:D}),state:'intended'});
  const partial=path.join(workspaceRoot,D,'product','encoded.mkv.partial-effect-one');
  fs.mkdirSync(path.dirname(partial),{recursive:true}); fs.writeFileSync(partial,Buffer.from('unfinished encoded media'));
  let stopped=true, crash=false;
  const unitOfWork=createSqliteUnitOfWork({kernel});
  const store=createStoppedExecutionTerminationStore({schemaManifest,unitOfWork,
    assertStopped(){if(!stopped)throw Object.assign(new Error('running'),{code:'STILL_RUNNING'});},
    observeWorkspace:snapshot=>observeStoppedTranscode(db,workspaceRoot,snapshot),
    beforeReceipt(){if(crash)throw new Error('simulated commit interruption');}});
  const command=()=>{const snapshot=readStoppedSnapshot(db,'event');return {retirementId:'formation-reset-test',eventId:'event',
    snapshotDigest:snapshot.snapshotDigest,realityDigest:canonicalDigest(observeStoppedTranscode(db,workspaceRoot,snapshot)),manifestDigest:D,backupDigest:D};};
  return {root,dataDir,workspaceRoot,db,kernel,store,command,partial,insert,setStopped:value=>{stopped=value;},setCrash:value=>{crash=value;},
    close(){db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}};
}

test('stopped cancellation preserves partial bytes and execution identity without a successful result',()=>{
  const f=fixture();try {
    const request=f.command(),before=fs.readFileSync(f.partial);
    const first=f.store.commit(request);assert.equal(first.replayed,false);
    assert.equal(f.store.commit(request).replayed,true);
    assert.deepEqual(fs.readFileSync(f.partial),before);
    assert.equal(f.db.prepare('SELECT state FROM fx_workflow_events').get().state,'cancelled');
    assert.equal(f.db.prepare('SELECT outcome_kind FROM fx_event_attempts').get().outcome_kind,'cancelled');
    assert.equal(f.db.prepare('SELECT state FROM fx_effect_journal').get().state,'failed');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_event_result_bindings').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,0);
    assert.equal(f.db.prepare('SELECT state FROM libra_runs').get().state,'active');
    assert.throws(()=>f.store.commit({...request,backupDigest:'b'.repeat(64)}),{code:'STOPPED_EXECUTION_REPLAY_CONFLICT'});
  }finally{f.close();}
});

test('termination refuses running runtime, changed bytes and changed execution; receipt failure rolls back all states',()=>{
  const f=fixture();try {
    const request=f.command();f.setStopped(false);assert.throws(()=>f.store.commit(request),{code:'STILL_RUNNING'});f.setStopped(true);
    fs.appendFileSync(f.partial,'growth');assert.throws(()=>f.store.commit(request),{code:'STOPPED_EXECUTION_REALITY_DRIFT'});
    const current=f.command();f.setCrash(true);assert.throws(()=>f.store.commit(current),/simulated commit interruption/);
    assert.equal(f.db.prepare('SELECT state FROM fx_workflow_events').get().state,'executing');
    assert.equal(f.db.prepare('SELECT state FROM fx_effect_journal').get().state,'intended');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,0);
    f.setCrash(false);f.db.prepare("UPDATE fx_event_attempts SET executor_version=2").run();
    assert.throws(()=>f.store.commit(current),{code:'STOPPED_EXECUTION_SNAPSHOT_DRIFT'});
  }finally{f.close();}
});

test('preview retains blockers for unsupported, outside-scope and physically shared effects',()=>{
  const f=fixture();try {
    assert.ok(inspectRetirementPlan(f.db).blockers.some(row=>row.code==='RESET_UNRESOLVED_EFFECT'));
    const plan=inspectRetirementPlan(f.db,{workspaceRoot:f.workspaceRoot});
    assert.equal(plan.terminations.length,1);assert.equal(plan.blockers.length,0);
    const alias=path.join(f.root,'other-owner');fs.linkSync(f.partial,alias);
    assert.equal(inspectRetirementPlan(f.db,{workspaceRoot:f.workspaceRoot}).terminations.length,0);fs.unlinkSync(alias);
    f.db.prepare("UPDATE fx_supporting_works SET process_id='other-run'").run();
    assert.equal(inspectRetirementPlan(f.db,{workspaceRoot:f.workspaceRoot}).terminations.length,0);
    f.db.prepare("UPDATE fx_supporting_works SET process_id='run'").run();
    f.db.prepare("UPDATE fx_effect_journal SET effect_class='material_commit'").run();
    assert.equal(inspectRetirementPlan(f.db,{workspaceRoot:f.workspaceRoot}).terminations.length,0);
  }finally{f.close();}
});

test('Reset replays a termination committed before journal acknowledgement and retires the Run without restarting it',async()=>{
  const f=fixture();let operator;try {
    let crash=true;
    const plan=inspectRetirementPlan(f.db,{workspaceRoot:f.workspaceRoot}),resetId='formation-reset-stopped';
    const options={dataDir:f.dataDir,workspaceRoot:f.workspaceRoot,verifyBackup:async()=>{},
      afterCommit(step){if(step.owner==='execution_termination'&&crash){crash=false;throw new Error('after termination commit');}}};
    operator=createFormationRetirementOperator(options);
    operator.prepare({resetId,expectedPlanDigest:plan.planDigest,previewDigest:D,backup:{backupId:'verified-test',backupDigest:D}});
    fs.mkdirSync(path.join(f.dataDir,'operator-runtime'),{recursive:true});
    writeAtomic(path.join(f.dataDir,'operator-runtime','intent.json'),{schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',
      pendingReset:{resetId,backupId:'verified-test',backupDigest:D,previewDigest:D}});
    await assert.rejects(operator.execute(resetId),/after termination commit/);operator.close();operator=null;
    assert.equal(f.db.prepare('SELECT state FROM fx_effect_journal').get().state,'failed');
    assert.equal(f.db.prepare('SELECT state FROM libra_runs').get().state,'active');
    operator=createFormationRetirementOperator(options);
    const result=await operator.execute(resetId);assert.equal(result.state,'completed');
    assert.equal(f.db.prepare('SELECT status FROM libra_subjects').get().status,'administratively_retired');
    assert.equal(f.db.prepare('SELECT state FROM libra_runs').get().state,'administratively_retired');
    assert.equal(f.db.prepare('SELECT state FROM fx_supporting_works').get().state,'cancelled');
    assert.equal(f.db.prepare('SELECT count(*) n FROM fx_event_attempts').get().n,1);
    assert.equal(fs.existsSync(f.partial),true);
    assert.equal((await operator.execute(resetId)).state,'completed');
  }finally{operator?.close();f.close();}
});
