'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { activeRunScopeSetDigest } = require('../src/helix/domains/libra/model/run-admission-contracts');
const { runStateDigest } = require('../src/helix/domains/libra/model/run-lifecycle-contracts');
const { emptyReferenceSetDigest, workspaceStateDigest } = require('../src/helix/domains/libra/model/workspace-admission-contracts');
const { applyReset, assertSafeTranscodeRoot, inspectPlan, verifyFrozenManifest } = require('../scripts/helix-formation-reset');
const {createUserFormationReset}=require('../scripts/user-formation-reset');
const {createUserFormationResetWorkerPort}=require('../src/clean-formation-reset-port');
const {inspectRetirementPlan}=require('../scripts/formation-retirement-plan');
const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
const {writeAtomic}=require('../src/clean-runtime-operations');
const schemaManifest=require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

function authorizeReset(f,preview,saved){
  const directory=path.join(f.dataDir,'operator-runtime');fs.mkdirSync(directory,{recursive:true});
  writeAtomic(path.join(directory,'intent.json'),{schema:'shelfdeck.runtime-intent@1',desiredMode:'stopped',revision:1,
    pendingReset:{operationId:'test-operation',previewDigest:preview.previewDigest,...saved}});
}

test('administrative retirement selects current occupancy and preserves terminal Run history',()=>{
  for(const state of ['discarded','superseded','completed']){
    const f=fixture('retirement-history');
    try{
      const history=seedSubjectRun(f.database,'history',state);
      f.database.prepare(`INSERT INTO libra_formation_projections(subject_id,classification,subject_status,
        display_identity,next_action_label,next_action_state,attention_state,added_at_ms,updated_at_ms)
        VALUES (?,'in_progress','active','History','Waiting','pending','none',1,1)`).run(history.subjectId);
      const before=f.database.prepare('SELECT * FROM libra_runs').all();
      const plan=inspectRetirementPlan(f.database);
      assert.equal(plan.subjects.length,1);
      assert.deepEqual(plan.runs,[]);
      assert.deepEqual(plan.workspaces,[]);
      assert.deepEqual(plan.preserved.runs,before);
      assert.deepEqual(plan.blockers,[]);
      assert.deepEqual(f.database.prepare('SELECT * FROM libra_runs').all(),before);
      assert.equal(inspectRetirementPlan(f.database).planDigest,plan.planDigest);
      assert.equal(f.database.inTransaction,false);
    }finally{close(f);}
  }
});

test('administrative retirement uses present typed Control ownership, not old bindings or matching IDs',()=>{
  const f=fixture('retirement-controls');
  try{
    const target=seedSubjectRun(f.database,'target');
    for(const [material,owner,type,id] of [
      ['own','libra','subject',target.subjectId],
      ['new-owner','libra','subject','later-subject'],
      ['collision','arca','on_deck_custody',target.subjectId],
      ['returned','procurement','field','field'],
    ]) f.database.prepare(`INSERT INTO fx_material_controls(material_key,owner_domain,owner_scope_type,
      owner_scope_id,control_revision,state,updated_at_ms) VALUES (?,?,?,?,2,'controlled',2)`).run(material,owner,type,id);
    f.database.prepare(`INSERT INTO libra_material_bindings(subject_id,material_key,role,binding_revision,health_state,current)
      VALUES (?,'new-owner','primary',1,'active',1)`).run(target.subjectId);
    const plan=inspectRetirementPlan(f.database);
    assert.deepEqual(plan.controls.map(row=>row.material_key),['own']);
    const before=plan.planDigest;
    f.database.prepare("UPDATE fx_material_controls SET control_revision=3 WHERE material_key='own'").run();
    assert.notEqual(inspectRetirementPlan(f.database).planDigest,before);
  }finally{close(f);}
});

test('administrative retirement blocks undrained Events even when their Effects are pure',()=>{
  const f=fixture('retirement-undrained');
  try{
    const target=seedSubjectRun(f.database,'target');
    const graph=seedExecution(f.database,'libra','libra_run',target.runId,'target');
    f.database.prepare("UPDATE fx_effect_journal SET effect_class='pure'").run();
    const plan=inspectRetirementPlan(f.database);
    assert.deepEqual(plan.works.map(row=>row.work_id),[graph.workId]);
    assert.ok(plan.blockers.some(row=>row.code==='RESET_EXECUTION_NOT_DRAINED'));
    assert.equal(plan.blockers.some(row=>row.code==='RESET_UNRESOLVED_EFFECT'),false);
  }finally{close(f);}
});

test('user Reset selects current workbench and excludes terminal-only history',()=>{
  const f=fixture('user-reset-protection');
  try{
    const active=seedSubjectRun(f.database,'active'),ended=seedSubjectRun(f.database,'history','discarded');
    const port=createUserFormationReset({dataDir:f.dataDir,workspaceRoot:f.transcodeDir});
    const preview=port.preview();assert.equal(preview.ready,true,JSON.stringify(preview));
    assert.deepEqual(preview.items.map(row=>row.subjectId),[active.subjectId]);
    assert.equal(preview.protected.endedRunCount,1);
    const work=seedExecution(f.database,'libra','libra_run','missing-run','detached');
    f.database.prepare("UPDATE fx_effect_journal SET effect_class='pure' WHERE event_attempt_id=?").run(work.eventAttemptId);
    const blocked=port.preview();assert.equal(blocked.ready,false);assert.ok(blocked.blockers.some(row=>row.code==='RESET_UNSCOPED_RESPONSIBILITY'));
    assert.equal(f.database.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
    assert.ok(f.database.prepare('SELECT 1 FROM libra_runs WHERE libra_run_id=?').get(ended.runId));
  }finally{close(f);}
});

test('user Reset refuses unproven pre-Subject Intake occupancy instead of deleting its evidence',async()=>{
  const f=fixture('user-reset-pre-subject');
  try{
    const token=seedOrphanPipelineToken(f.database,'user');
    // Intake is a pure observation in this fixture; unknown file writes are separately refused.
    f.database.prepare("UPDATE fx_effect_journal SET effect_class='pure' WHERE event_attempt_id=?").run(token.eventAttemptId);
    seedSubjectRun(f.database,'ended','discarded');
    const port=createUserFormationReset({dataDir:f.dataDir,workspaceRoot:f.transcodeDir});
    const preview=port.preview();assert.equal(preview.ready,false,JSON.stringify(preview));assert.equal(preview.items[0].subjectId,token.subjectId);
    assert.equal(preview.items[0].displayIdentity,'待识别媒体');
    assert.ok(preview.blockers.some(row=>row.code==='RESET_INTAKE_OFFER_MISSING'));
    await assert.rejects(port.apply(preview,()=>assert.fail('Unproven Intake cannot apply')),{code:'RUNTIME_RESET_PREVIEW_STALE'});
    assert.equal(f.database.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,1);
    assert.equal(f.database.prepare('SELECT count(*) n FROM libra_runs').get().n,1);
  }finally{close(f);}
});

test('user Reset retires the current Subject while preserving all selected terminal Run history',async()=>{
  for(const classification of ['in_progress','attention_required'])for(const state of ['discarded','superseded']){
    const f=fixture('user-reset-history-overlap');
    try{
      const ended=seedSubjectRun(f.database,'overlap',state);
      f.database.prepare(`INSERT INTO libra_formation_projections(subject_id,classification,subject_status,
        display_identity,next_action_label,next_action_state,attention_state,added_at_ms,updated_at_ms)
        VALUES (?,?,'active','History overlap','Waiting','pending','none',1,1)`).run(ended.subjectId,classification);
      const before=f.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(ended.runId);
      const port=createUserFormationReset({dataDir:f.dataDir,workspaceRoot:f.transcodeDir});
      const preview=port.preview();
      assert.equal(preview.items.length,1);
      assert.equal(preview.protected.endedRunCount,1);
      assert.equal(preview.ready,true);
      await port.apply(preview,saved=>authorizeReset(f,preview,saved));
      assert.deepEqual(f.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(ended.runId),before);
      assert.equal(f.database.prepare('SELECT status FROM libra_subjects WHERE subject_id=?').get(ended.subjectId).status,'administratively_retired');
      assert.equal(fs.existsSync(path.join(f.dataDir,'operator-backups')),true);
    }finally{close(f);}
  }
});

test('user Reset backs up selected workspaces and preserves ended history and source media',async()=>{
  const f=fixture('user-reset');
  try{
    const active=seedSubjectRun(f.database,'user-active'),ended=seedSubjectRun(f.database,'user-ended','discarded');
    const history=f.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(ended.runId);
    const dir=path.join(f.transcodeDir,active.workspaceId);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'partial.mkv'),'workspace');
    const original=path.join(f.root,'source-original.mkv');fs.writeFileSync(original,'preserve');
    const port=createUserFormationReset({dataDir:f.dataDir,workspaceRoot:f.transcodeDir});
    const preview=port.preview();assert.equal(preview.ready,true);assert.equal(preview.items.length,1);assert.equal(preview.protected.endedRunCount,1);
    let authorized=false;const result=await port.apply(preview,saved=>{authorized=true;authorizeReset(f,preview,saved);});
    assert.equal(authorized,true);assert.equal(result.retainedWorkspaces,1);assert.equal(fs.existsSync(dir),true);assert.equal(fs.readFileSync(original,'utf8'),'preserve');
    assert.deepEqual(f.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(ended.runId),history);
    const backup=path.join(f.dataDir,'operator-backups',result.backupId);
    assert.equal(fs.readFileSync(path.join(backup,'workspaces',active.workspaceId,'partial.mkv'),'utf8'),'workspace');
    assert.ok(fs.existsSync(path.join(backup,'receipt.json')));
    const resetReceipt=path.join(f.dataDir,'reset-receipts',result.resetId+'.json');
    assert.ok(fs.existsSync(resetReceipt));assert.equal(JSON.parse(fs.readFileSync(resetReceipt,'utf8')).retiredSubjects,1);
    assert.equal(port.preview().empty,true);
  }finally{close(f);}
});

test('user Reset refuses insufficient backup space without reading Workspace payloads',async()=>{
  const f=fixture('user-reset-space'),statfs=fs.statfsSync,readStream=fs.createReadStream;
  try {
    const active=seedSubjectRun(f.database,'space-active');
    const dir=path.join(f.transcodeDir,active.workspaceId);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'partial.mkv'),'retained bytes');
    const port=createUserFormationReset({dataDir:f.dataDir,workspaceRoot:f.transcodeDir}),preview=port.preview();
    const before=f.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(active.runId);
    fs.statfsSync=()=>({bavail:0n,bsize:4096n});
    fs.createReadStream=function(file,...args){assert.equal(path.resolve(String(file)).startsWith(path.resolve(dir)+path.sep),false,'Capacity refusal must not read media bytes');return readStream.call(this,file,...args);};
    await assert.rejects(port.apply(preview,()=>assert.fail('No authorization before backup')),{code:'RESET_BACKUP_SPACE_INSUFFICIENT'});
    assert.deepEqual(f.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(active.runId),before);
    assert.deepEqual(fs.readdirSync(path.join(f.dataDir,'operator-backups')),[]);
  }finally{fs.statfsSync=statfs;fs.createReadStream=readStream;close(f);}
});

test('user Reset rejects filesystem roots, data ancestors and Workspace aliases before backup or retirement',async()=>{
  const f=fixture('user-reset-root-safety');
  try {
    seedSubjectRun(f.database,'root-safety');
    const alias=path.join(f.root,'workspace-alias');
    fs.symlinkSync(f.transcodeDir,alias,process.platform==='win32'?'junction':'dir');
    for(const workspaceRoot of [path.parse(f.root).root,f.dataDir,f.root,alias]) {
      const port=createUserFormationReset({dataDir:f.dataDir,workspaceRoot}),preview=port.preview();
      await assert.rejects(port.apply(preview,()=>assert.fail('Unsafe root cannot authorize retirement')),{code:'RESET_WORKSPACE_ROOT_UNSAFE'});
    }
    assert.equal(fs.existsSync(path.join(f.dataDir,'operator-backups')),false);
    assert.equal(f.database.prepare("SELECT status FROM libra_subjects WHERE subject_id='subject-root-safety'").get().status,'active');
  } finally {close(f);}
});

test('user Reset refuses a changed preview and any unresolved non-pure Effect',async()=>{
  const f=fixture('user-reset-stale');
  try{
    seedSubjectRun(f.database,'first');const port=createUserFormationReset({dataDir:f.dataDir,workspaceRoot:f.transcodeDir});
    const preview=port.preview();seedSubjectRun(f.database,'second');
    await assert.rejects(port.apply(preview,()=>assert.fail('No apply authorization expected')),{code:'RUNTIME_RESET_PREVIEW_STALE'});
    const graph=seedExecution(f.database,'libra','libra_run','run-first','uncertain');
    f.database.prepare("INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,updated_at_ms) VALUES(?,?,'workspace_write',?,?,'reconcile_required',1)").run('uncertain-effect',graph.eventAttemptId,'uncertain-key',DIGEST);
    const blocked=port.preview();assert.equal(blocked.ready,false);assert.ok(blocked.blockers.some(b=>b.code==='RESET_UNRESOLVED_EFFECT'));
  }finally{close(f);}
});

test('user Reset executes through the isolated Operator worker and requires parent authorization',async()=>{
  const f=fixture('user-reset-worker');
  try{
    seedSubjectRun(f.database,'worker');let checked=0,authorized=false;
    const port=createUserFormationResetWorkerPort({dataDir:f.dataDir,workspaceRoot:f.transcodeDir,assertWorkspaceAvailable(){checked++;}});
    const preview=await port.preview();assert.equal(preview.ready,true);
    const result=await port.apply(preview,saved=>{authorized=true;authorizeReset(f,preview,saved);});
    assert.equal(authorized,true);assert.equal(checked,2);assert.equal(result.retiredSubjects,1);assert.equal((await port.preview()).empty,true);
  }finally{close(f);}
});

test('Operator worker retires pending Intake with verified backup and rejects corrupted backup during recovery',async()=>{
  const f=fixture('user-reset-pending-worker');
  try {
    const processId=require('../src/helix/domains/libra/persistence/intake-offer-reader').decisionId('pending-offer');
    const db=f.database;
    db.prepare("INSERT INTO proc_procurement_runs(procurement_run_id,state) VALUES ('pending-proc','sealed')").run();
    db.prepare("INSERT INTO proc_candidate_packages(candidate_package_id,procurement_run_id,package_digest) VALUES ('pending-package','pending-proc',?)").run(DIGEST);
    db.prepare("INSERT INTO proc_candidate_deliveries(offer_id,candidate_package_id,package_revision,package_digest,acceptance_basis_digest,state,offered_at_ms) VALUES ('pending-offer','pending-package',1,?,?,'open',1)").run(DIGEST,DIGEST);
    db.prepare("INSERT INTO proc_candidate_primary_materials(candidate_package_id,ordinal,material_key) VALUES ('pending-package',0,'pending-material')").run();
    db.prepare("INSERT INTO proc_run_materials(procurement_run_id,ordinal,material_key,selection_state,candidate_package_id) VALUES ('pending-proc',0,'pending-material','candidate_delivery','pending-package')").run();
    db.prepare("INSERT INTO libra_predeck_pipeline_tokens VALUES ('pending-subject','field',?,1)").run(processId);
    const offer={offerId:'pending-offer',candidatePackageId:'pending-package',packageRevision:1,packageDigest:DIGEST,acceptanceBasisDigest:DIGEST};
    db.prepare("INSERT INTO fx_outbox(message_id,producer_domain,message_kind,payload_json,payload_digest,consumer_set_digest,intended_consumer_count,state) VALUES ('pending-message','procurement','procurement_candidate_offer_available',?,?,?,1,'pending')")
      .run(JSON.stringify(offer),canonicalDigest(offer),canonicalDigest(['libra']));
    db.prepare("INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count,next_attempt_at_ms) VALUES ('pending-message','libra','pending',0,0)").run();
    const candidate=db.prepare('SELECT * FROM proc_candidate_packages').get();
    const port=createUserFormationResetWorkerPort({dataDir:f.dataDir,workspaceRoot:f.transcodeDir,assertWorkspaceAvailable(){}});
    const preview=await port.preview();assert.equal(preview.ready,true);assert.equal(preview.counts.intakes,1);
    const result=await port.apply(preview,saved=>authorizeReset(f,preview,saved));
    assert.equal(result.retiredIntakes,1);assert.equal(result.retiredSubjects,0);
    assert.equal(db.prepare('SELECT state FROM proc_candidate_deliveries').get().state,'administratively_retired');
    assert.deepEqual(db.prepare('SELECT * FROM proc_candidate_packages').get(),candidate);
    assert.equal(db.prepare('SELECT count(*) n FROM libra_intake_decisions').get().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM libra_predeck_pipeline_tokens').get().n,0);
    assert.equal((await port.preview()).empty,true);
    assert.deepEqual(await port.recover(result.resetId),result);
    const backupDb=path.join(f.dataDir,'operator-backups',result.backupId,'data','shelfdeck.db');
    const fd=fs.openSync(backupDb,'r+');try{fs.writeSync(fd,Buffer.from('changed'),0,7,128);}finally{fs.closeSync(fd);}
    await assert.rejects(port.recover(result.resetId),{code:'RESET_BACKUP_INTEGRITY_FAILED'});
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir,'operator-runtime','intent.json'),'utf8')).desiredMode,'stopped');
  }finally{close(f);}
});

const schemaDdl = fs.readFileSync(path.join(
  __dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');
const DIGEST = 'a'.repeat(64);

function fixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const dataDir = path.join(root, 'data');
  const isolatedLinuxMount = process.env.HELIX_TEST_ISOLATED_TRANSCODE === '1';
  const transcodeDir = isolatedLinuxMount ? '/transcode' : path.join(root, 'transcode');
  fs.mkdirSync(dataDir);
  if (isolatedLinuxMount) {
    assert.equal(process.platform, 'linux');
    assert.ok(fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').some(line =>
      line.split(' ')[4] === '/transcode' && line.includes(' - tmpfs ')), 'Reset tests require a disposable tmpfs mount.');
    assert.deepEqual(fs.readdirSync(transcodeDir), [], 'The test mount must be empty before each fixture.');
  } else fs.mkdirSync(transcodeDir);
  openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaDdl,schemaManifest,now:()=>1}).close();
  const database = new Database(path.join(dataDir, 'shelfdeck.db'));
  database.pragma('foreign_keys = ON');
  return { root, dataDir, transcodeDir, database, isolatedLinuxMount };
}

function close(value) {
  value.database.close();
  if (value.isolatedLinuxMount) {
    for (const name of fs.readdirSync(value.transcodeDir)) {
      const target=path.resolve(value.transcodeDir,name);
      assert.equal(path.dirname(target), '/transcode');
      fs.rmSync(target, { recursive:true, force:true });
    }
  }
  fs.rmSync(value.root, { recursive:true, force:true });
}

function seedSubjectRun(database, suffix, state = 'active') {
  const subjectId = `subject-${suffix}`;
  const runId = `run-${suffix}`;
  const workspaceId = canonicalDigest({ workspace:suffix });
  const initialState = { libraRunId:runId,stateRevision:1,state,acceptanceSpecId:null,
    executionBasisDigest:DIGEST,runScopeDigest:DIGEST,priorityClass:'normal',priorityIntentDigest:DIGEST,
    transitionKind:'admitted',transitionEvidenceDigest:DIGEST };
  const stateDigest = runStateDigest(initialState);
  const activeScopeDigest = activeRunScopeSetDigest(subjectId, [{ libraRunId:runId,runScopeDigest:DIGEST,
    stateRevision:1,stateDigest }]);
  database.prepare(`INSERT INTO libra_subjects
    (subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,
     current_episode_scope_digest,created_at_ms,updated_at_ms)
    VALUES (?, 'single','movie','active',1,?,?,1,1)`).run(subjectId,DIGEST,DIGEST);
  database.prepare(`INSERT INTO libra_runs
    (libra_run_id,subject_id,admission_revision,execution_basis_record_json,execution_basis_digest,
     run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,
     recovery_attempt_ordinal,created_at_ms)
    VALUES (?,?,1,'{}',?,?,?,1,?,'normal',?,0,1)`)
    .run(runId,subjectId,DIGEST,DIGEST,state,stateDigest,DIGEST);
  database.prepare(`INSERT INTO libra_run_admission_heads(subject_id,head_revision,active_scope_set_digest,updated_at_ms)
    VALUES (?,1,?,1)`).run(subjectId,activeScopeDigest);
  const referenceDigest = emptyReferenceSetDigest(workspaceId);
  const workspaceState = { workspaceId,workspaceRevision:1,state:'active',workspaceMaterialReferenceSetDigest:referenceDigest,
    transitionKind:'admitted',transitionEvidenceDigest:DIGEST };
  const workspaceDigest = workspaceStateDigest(workspaceState);
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    database.prepare(`INSERT INTO libra_workspaces
      (workspace_id,libra_run_id,current_revision,state,state_digest,created_at_ms)
      VALUES (?,?,1,'active',?,1)`).run(workspaceId,runId,workspaceDigest);
    database.prepare(`INSERT INTO libra_workspace_revisions
      (workspace_id,workspace_revision,state,material_reference_set_digest,transition_kind,
       transition_evidence_digest,revision_digest,committed_at_ms)
      VALUES (?,1,'active',?,'admitted',?,?,1)`).run(workspaceId,referenceDigest,DIGEST,canonicalDigest(workspaceState));
  })();
  database.prepare(`INSERT INTO fx_workspace_registry(workspace_id,owner_domain,process_type,process_id,state,created_at_ms)
    VALUES (?,'libra','libra_run',?,'active',1)`).run(workspaceId,runId);
  return { subjectId, runId, workspaceId };
}

function seedExecution(database, ownerDomain, processType, processId, suffix) {
  const workId = `work-${suffix}`, attemptId = `attempt-${suffix}`, planId = `plan-${suffix}`,
    eventId = `event-${suffix}`, eventAttemptId = `event-attempt-${suffix}`;
  database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,
     definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?, 'test',?,'normal','{}',?,'running',?,1,1)`)
    .run(workId,ownerDomain,processType,processId,DIGEST,DIGEST,`key-${suffix}`);
  database.prepare(`INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms)
    VALUES (?,?,1,?,'running',1)`).run(attemptId,workId,DIGEST);
  database.prepare(`INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?, 'test',1,?,?,?,'planned',1)`).run(planId,attemptId,DIGEST,DIGEST,DIGEST);
  database.prepare(`INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,
    capability_ref,contract_version,state,priority_class,ready_at_ms)
    VALUES (?,?, 'node',?,?,?,'test',1,'executing','normal',1)`)
    .run(eventId,planId,workId,attemptId,ownerDomain);
  database.prepare(`INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,
    input_snapshot_digest,fence_snapshot_digest,state,started_at_ms)
    VALUES (?,?,1,'test',1,?,?,'executing',1)`).run(eventAttemptId,eventId,DIGEST,DIGEST);
  database.prepare(`INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,
    intent_digest,state,updated_at_ms) VALUES (?,?,?,?,?,'intended',1)`)
    .run(`effect-${suffix}`,eventAttemptId,'workspace_write',`effect-key-${suffix}`,DIGEST);
  return { workId, attemptId, planId, eventId, eventAttemptId };
}

function seedEventlessMarker(database, { marker, ownerDomain = 'libra', scopeType, scopeId, resultId }) {
  const result = { scopeType, scopeId };
  const resultDigest = canonicalDigest(result);
  database.prepare(`INSERT INTO fx_event_result_bindings
    (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,committed_at_ms)
    VALUES (?,NULL,'succeeded','test-result',?,?,1)`)
    .run(resultId,JSON.stringify(result),resultDigest);
  database.prepare(`INSERT INTO fx_commit_markers
    (commit_marker,effect_id,owner_domain,scope_type,scope_id,commit_digest,result_id,
     result_schema_ref,result_digest,committed_at_ms)
    VALUES (?,NULL,?,?,?,?,?,'test-result',?,1)`)
    .run(marker,ownerDomain,scopeType,scopeId,DIGEST,resultId,resultDigest);
}

test('selected Formation Reset retires candidate Evidence with its execution scope and preserves other Runs',()=>{
  const f=fixture('candidate-evidence-reset');
  try {
    const selected=seedSubjectRun(f.database,'selected'),other=seedSubjectRun(f.database,'preserved');
    for(const scope of [selected,other]) {
      const graph=seedExecution(f.database,'libra','libra_run',scope.runId,scope.runId);
      f.database.prepare("UPDATE fx_effect_journal SET effect_class='pure' WHERE event_attempt_id=?").run(graph.eventAttemptId);
      f.database.prepare(`INSERT INTO libra_acquisition_candidate_evidence
        (record_id,libra_run_id,search_work_id,search_event_id,search_event_attempt_id,evidence_json,record_json)
        VALUES (?,?,?,?,?,'{}','{}')`).run(scope.runId,scope.runId,graph.workId,graph.eventId,graph.eventAttemptId);
    }
    const retained=f.database.prepare('SELECT * FROM libra_acquisition_candidate_evidence WHERE libra_run_id=?').get(other.runId);
    const result=applyReset({...f,subjectIds:[selected.subjectId],nowMs:100});
    assert.equal(result.verification.foreignKeyViolations,0);
    assert.equal(f.database.prepare('SELECT count(*) n FROM libra_acquisition_candidate_evidence WHERE libra_run_id=?').get(selected.runId).n,0);
    assert.deepEqual(f.database.prepare('SELECT * FROM libra_acquisition_candidate_evidence WHERE libra_run_id=?').get(other.runId),retained);
  } finally { close(f); }
});

function seedAcceptedOrphan(database, suffix) {
  const subjectId = `subject-orphan-${suffix}`;
  const intakeDecisionId = `intake-orphan-${suffix}`;
  const materialKey = `material-orphan-${suffix}`;
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    database.prepare(`INSERT INTO libra_subjects
      (subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,
       current_episode_scope_digest,routing_anchor_intake_decision_id,created_at_ms,updated_at_ms)
      VALUES (?,'single','movie','active',1,?,?,?,1,1)`).run(subjectId,DIGEST,DIGEST,intakeDecisionId);
    database.prepare(`INSERT INTO libra_intake_decisions
      (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,package_revision,
       package_digest,target_subject_id,accepted_result,decision_digest,decided_at_ms,
       candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
       decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest)
      VALUES (?,1,'accepted_resolution',?, ?,1,?,?,'new_subject',?,1,'snapshot','{}','identity','{}',?)`)
      .run(intakeDecisionId,`offer-${suffix}`,`candidate-${suffix}`,DIGEST,subjectId,DIGEST,DIGEST);
    database.prepare(`INSERT INTO libra_handoff_a_receipts
      (receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,
       subject_id,subject_intake_revision,subject_continuity_head_revision,committed_at_ms)
      VALUES (?,?, 'accepted',?,?,1,?,?,1,1,1)`)
      .run(`receipt-${suffix}`,intakeDecisionId,`offer-${suffix}`,`candidate-${suffix}`,DIGEST,subjectId);
    database.prepare(`INSERT INTO libra_material_bindings
      (subject_id,material_key,role,authority_kind,binding_revision,health_state,origin_intake_decision_id,current)
      VALUES (?,?,'primary_payload','primary_control',1,'active',?,1)`)
      .run(subjectId,materialKey,intakeDecisionId);
  })();
  database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
    fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
    control_revision,state,updated_at_ms) VALUES (?, 'mount',?,1,'middle','1',?,'procurement','procurement_run',?,1,'controlled',1)`)
    .run(materialKey,`inode-${suffix}`,`fp-${suffix}`,`proc-run-${suffix}`);
  database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
    to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
    VALUES (?,1,'acquire','procurement','procurement_run',?,?,'procurement',1)`)
    .run(materialKey,`proc-run-${suffix}`,DIGEST);
  return { subjectId, intakeDecisionId, materialKey };
}

function seedOrphanPipelineToken(database, suffix) {
  const subjectId = `subject-token-orphan-${suffix}`;
  const processId = `intake-process-token-orphan-${suffix}`;
  database.prepare(`INSERT INTO libra_predeck_pipeline_tokens
    (subject_id,source_field_id,source_process_id,acquired_at_ms) VALUES (?,'field-orphan',?,1)`)
    .run(subjectId,processId);
  const execution = seedExecution(database, 'libra', 'libra_intake', processId, `token-orphan-${suffix}`);
  database.prepare(`INSERT INTO fx_command_receipts
    (command_receipt_id,owner_domain,command_contract,caller_scope,idempotency_key,request_digest,
     target_type,target_id,result_schema_ref,result_ref_json,result_digest,committed_at_ms)
    VALUES (?,'libra','helix.foundation.work.submit@1',?,?,?,'supporting_work',?,'result','{}',?,1)`)
    .run(`admission-receipt-work-${suffix}`,`libra:${processId}/evidence`,`key-work-${suffix}`,
      DIGEST,execution.workId,DIGEST);
  return { subjectId, processId, ...execution };
}

function seedPhantomAdmissionReceipt(database, suffix) {
  const subjectId = `subject-token-receipt-orphan-${suffix}`;
  const processId = `intake-process-token-receipt-orphan-${suffix}`;
  const targetWorkId = `missing-intake-work-${suffix}`;
  const receiptId = `admission-receipt-${suffix}`;
  database.prepare(`INSERT INTO libra_predeck_pipeline_tokens
    (subject_id,source_field_id,source_process_id,acquired_at_ms) VALUES (?,'field-orphan',?,1)`)
    .run(subjectId,processId);
  database.prepare(`INSERT INTO fx_command_receipts
    (command_receipt_id,owner_domain,command_contract,caller_scope,idempotency_key,request_digest,
     target_type,target_id,result_schema_ref,result_ref_json,result_digest,committed_at_ms)
    VALUES (?,'libra','helix.foundation.work.submit@1',?,? ,?,'supporting_work',?,'result','{}',?,1)`)
    .run(receiptId,`libra:${processId}/evidence`,`key-${suffix}`,DIGEST,targetWorkId,DIGEST);
  return { subjectId, processId, targetWorkId, receiptId };
}

function seedLatentPhantomAdmissionReceipt(database, suffix) {
  const processId = `intake-process-latent-receipt-${suffix}`;
  const targetWorkId = `missing-latent-intake-work-${suffix}`;
  const receiptId = `latent-admission-receipt-${suffix}`;
  database.prepare(`INSERT INTO fx_command_receipts
    (command_receipt_id,owner_domain,command_contract,caller_scope,idempotency_key,request_digest,
     target_type,target_id,result_schema_ref,result_ref_json,result_digest,committed_at_ms)
    VALUES (?,'libra','helix.foundation.work.submit@1',?,?,?,'supporting_work',?,'result','{}',?,1)`)
    .run(receiptId,`libra:${processId}/evidence`,`latent-key-${suffix}`,DIGEST,targetWorkId,DIGEST);
  return { processId, targetWorkId, receiptId };
}

function seedClosedHandoffABoundary(database, suffix) {
  const subjectId = `subject-handoff-reset-${suffix}`;
  const processId = `intake-handoff-reset-${suffix}`;
  const offerId = `offer-handoff-reset-${suffix}`;
  const candidatePackageId = `candidate-handoff-reset-${suffix}`;
  const procurementRunId = `proc-run-handoff-reset-${suffix}`;
  const materialKey = `material-handoff-reset-${suffix}`;
  const messageId = `message-handoff-reset-${suffix}`;
  const dedupKey = `libra_candidate_accepted:${offerId}`;
  database.prepare(`INSERT INTO libra_predeck_pipeline_tokens
    (subject_id,source_field_id,source_process_id,acquired_at_ms) VALUES (?,'field-handoff-reset',?,1)`)
    .run(subjectId,processId);
  database.prepare(`INSERT INTO proc_procurement_runs
    (procurement_run_id,state,state_revision,created_at_ms) VALUES (?,'sealed',1,1)`).run(procurementRunId);
  database.prepare(`INSERT INTO proc_candidate_packages
    (candidate_package_id,procurement_run_id,package_revision,package_digest,state,published_at_ms)
    VALUES (?,?,1,?,'published',1)`).run(candidatePackageId,procurementRunId,DIGEST);
  database.prepare(`INSERT INTO proc_candidate_deliveries
    (offer_id,candidate_package_id,package_revision,package_digest,acceptance_basis_digest,state,
     handoff_decision_id,handoff_receipt_id,handoff_receipt_digest,terminal_evidence_digest,offered_at_ms,closed_at_ms)
    VALUES (?,?,1,?,?,'accepted',?,'old-receipt',?,?,1,2)`)
    .run(offerId,candidatePackageId,DIGEST,DIGEST,processId,DIGEST,DIGEST);
  database.prepare(`INSERT INTO proc_run_materials
    (procurement_run_id,ordinal,material_key,selection_state,candidate_package_id,terminal_disposition,
     terminal_evidence_digest,reservation_updated_at_ms)
    VALUES (?,0,?,'transferred',?,'handoff_accepted',?,2)`)
    .run(procurementRunId,materialKey,candidatePackageId,DIGEST);
  database.prepare(`INSERT INTO fx_material_controls
    (material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,
     owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms)
    VALUES (?,'mount-handoff-reset',?,1,'middle','1',?,NULL,NULL,NULL,3,'released',3)`)
    .run(materialKey,`inode-${suffix}`,`fingerprint-${suffix}`);
  database.prepare(`INSERT INTO fx_material_control_revisions
    (material_key,revision,operation_kind,to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
    VALUES (?,1,'acquire','procurement','material_field','field-handoff-reset',?,'acquire-marker',1)`)
    .run(materialKey,DIGEST);
  database.prepare(`INSERT INTO fx_material_control_revisions
    (material_key,revision,operation_kind,from_owner_domain,from_scope_type,from_scope_id,
     to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
    VALUES (?,2,'transfer','procurement','material_field','field-handoff-reset','libra','subject',?,?,'transfer-marker',2)`)
    .run(materialKey,subjectId,DIGEST);
  database.prepare(`INSERT INTO fx_material_control_revisions
    (material_key,revision,operation_kind,from_owner_domain,from_scope_type,from_scope_id,
     basis_digest,commit_marker,committed_at_ms)
    VALUES (?,3,'release','libra','subject',?,?, 'release-marker',3)`)
    .run(materialKey,subjectId,DIGEST);
  database.prepare(`INSERT INTO fx_outbox
    (message_id,producer_domain,message_kind,aggregate_type,aggregate_id,aggregate_revision,dedup_key,
     consumer_set_digest,intended_consumer_count,payload_schema_ref,payload_json,payload_digest,state,
     available_at_ms,created_at_ms,all_acked_at_ms)
    VALUES (?,'libra','libra_candidate_accepted','intake_decision',?,1,?,?,1,'message','{}',?,'fully_acked',1,1,2)`)
    .run(messageId,processId,dedupKey,DIGEST,DIGEST);
  database.prepare(`INSERT INTO fx_outbox_deliveries
    (message_id,consumer_domain,state,attempt_count,next_attempt_at_ms,acked_at_ms)
    VALUES (?,'procurement','acked',1,1,2)`).run(messageId);
  database.prepare(`INSERT INTO fx_inbox
    (consumer_domain,message_id,dedup_key,received_at_ms,consumed_at_ms,result_digest)
    VALUES ('procurement',?,?,1,1,?)`).run(messageId,dedupKey,DIGEST);
  return { subjectId, processId, offerId, candidatePackageId, procurementRunId, materialKey, messageId, dedupKey };
}

function makeClosedHandoffALatent(database, seeded) {
  database.prepare('DELETE FROM libra_predeck_pipeline_tokens WHERE subject_id=?').run(seeded.subjectId);
  database.prepare('DELETE FROM fx_material_control_revisions WHERE material_key=? AND revision=3')
    .run(seeded.materialKey);
  database.prepare(`UPDATE fx_material_controls
    SET owner_domain='libra',owner_scope_type='subject',owner_scope_id=?,control_revision=2,state='controlled',updated_at_ms=2
    WHERE material_key=?`).run(seeded.subjectId,seeded.materialKey);
  return seeded;
}

test('Formation Reset is an exact no-op on an empty database and preserves unrelated transcode entries', () => {
  const value = fixture('helix-formation-reset-empty');
  try {
    fs.writeFileSync(path.join(value.transcodeDir, 'unrelated.part'), 'keep');
    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.runs, 0);
    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:1000 });
    assert.equal(result.verification.integrity, 'ok');
    assert.equal(fs.existsSync(path.join(value.transcodeDir, 'unrelated.part')), true);
  } finally { close(value); }
});

test('Formation Reset clears Accepted Subjects without a token while preserving Procurement Control', () => {
    const value = fixture('helix-formation-reset-orphan');
    try {
      const seeded = seedAcceptedOrphan(value.database, 'formation');
      const plan = inspectPlan(value.database);
      assert.equal(plan.ready, true);
      assert.equal(plan.counts.orphanAcceptedSubjects, 1);
      assert.equal(plan.counts.preservedProcurementControls, 1);
      const result = applyReset({ database:value.database, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3500 });
      assert.equal(result.verification.integrity, 'ok');
      assert.equal(inspectPlan(value.database).counts.orphanAcceptedSubjects, 0);
      assert.deepEqual(value.database.prepare(`SELECT owner_domain,owner_scope_type,control_revision,state
        FROM fx_material_controls WHERE material_key=?`).get(seeded.materialKey), {
        owner_domain:'procurement', owner_scope_type:'procurement_run', control_revision:1, state:'controlled',
      });
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions WHERE material_key=?')
        .get(seeded.materialKey).count, 1);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?')
        .get(seeded.subjectId).count, 0);
    } finally { close(value); }
});

test('Formation Reset clears orphan pipeline tokens and their Intake execution responsibility', () => {
    const value = fixture('helix-formation-reset-orphan-token');
    try {
      const seeded = seedOrphanPipelineToken(value.database, 'formation');
      const plan = inspectPlan(value.database);
      assert.equal(plan.ready, true);
      assert.equal(plan.counts.orphanPipelineTokens, 1);
      assert.equal(plan.counts.works, 1);
      assert.deepEqual(plan.orphans.pipelineTokens.map((row) => row.subject_id), [seeded.subjectId]);
      assert.equal(plan.scope.orphanPipelineSourceProcessIds.includes(seeded.processId), true);

      const result = applyReset({ database:value.database, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3550 });
      assert.equal(result.verification.integrity, 'ok');
      assert.equal(inspectPlan(value.database).counts.orphanPipelineTokens, 0);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_predeck_pipeline_tokens WHERE subject_id=?')
        .get(seeded.subjectId).count, 0);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?')
        .get(seeded.workId).count, 0);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_command_receipts WHERE target_id=?')
        .get(seeded.workId).count, 0);

      applyReset({ database:value.database, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3560 });
      assert.equal(inspectPlan(value.database).counts.orphanPipelineTokens, 0);
    } finally { close(value); }
});

test('explicit Subject scope clears only its pre-Subject Intake token and execution graph', () => {
  const value = fixture('helix-scoped-pre-subject-intake');
  try {
    const target = seedOrphanPipelineToken(value.database, 'selected');
    const other = seedOrphanPipelineToken(value.database, 'protected');
    const active = seedSubjectRun(value.database, 'active-protected');
    const subjectIds = [target.subjectId];
    const retainedWork = value.database.prepare('SELECT * FROM fx_supporting_works WHERE work_id=?').get(other.workId);
    const retainedRun = value.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(active.runId);
    const plan = inspectPlan(value.database, { subjectIds });
    assert.deepEqual(plan.scope.pipelineTokenSubjectIds, subjectIds);
    assert.deepEqual(plan.scope.pipelineSourceProcessIds, [target.processId]);
    assert.equal(plan.counts.works, 1);
    const result = applyReset({ ...value, transcodeDir:null, subjectIds, nowMs:4000 });
    assert.equal(result.verification.integrity, 'ok');
    assert.equal(value.database.prepare('SELECT 1 FROM libra_predeck_pipeline_tokens WHERE subject_id=?').get(target.subjectId), undefined);
    assert.equal(value.database.prepare('SELECT 1 FROM fx_supporting_works WHERE work_id=?').get(target.workId), undefined);
    assert.deepEqual(value.database.prepare('SELECT * FROM fx_supporting_works WHERE work_id=?').get(other.workId), retainedWork);
    assert.deepEqual(value.database.prepare('SELECT * FROM libra_runs WHERE libra_run_id=?').get(active.runId), retainedRun);
    assert.equal(inspectPlan(value.database, { subjectIds }).counts.works, 0);
    applyReset({ ...value, transcodeDir:null, subjectIds, nowMs:4001 });
    assert.equal(inspectPlan(value.database).counts.orphanPipelineTokens, 1);
  } finally { close(value); }
});

test('scoped Reset relinquishes only selected Work recovery probes without resolving incidents', () => {
  const value = fixture('helix-reset-recovery-reservation');
  try {
    const target = seedSubjectRun(value.database, 'recovery-selected');
    const other = seedSubjectRun(value.database, 'recovery-protected');
    const selectedWork = seedExecution(value.database, 'libra', 'libra_run', target.runId, 'recovery-selected');
    const protectedWork = seedExecution(value.database, 'libra', 'libra_run', other.runId, 'recovery-protected');
    function seedRecovery(work, suffix) {
      const circuitKey = 'owner/libra/test/' + suffix, incidentKey = canonicalDigest({incident:suffix});
      const evidence = canonicalDigest({schema:'foundation.executor-incident-recovery-work@1',circuitKey,workId:work.workId});
      value.database.prepare(`INSERT INTO fx_circuit_states
        (circuit_key,state,reason_code,evidence_digest,opened_at_ms,reviewed_at_ms)
        VALUES (?,'recovering','P5_PROVIDER_TRANSPORT_FAILED',?,1,2)`).run(circuitKey,evidence);
      value.database.prepare(`INSERT INTO fx_executor_incidents
        (incident_key,owner_domain,process_type,work_kind,error_code,occurrence_count,circuit_key,
         incident_state,evidence_digest,first_seen_at_ms,last_seen_at_ms,resolved_at_ms)
        VALUES (?,'libra','libra_run','test','P5_PROVIDER_TRANSPORT_FAILED',3,?,'recovering',?,1,2,NULL)`)
        .run(incidentKey,circuitKey,DIGEST);
      return {circuitKey,incidentKey};
    }
    const selected = seedRecovery(selectedWork, 'selected'), protectedScope = seedRecovery(protectedWork, 'protected');
    const protectedCircuit = value.database.prepare('SELECT * FROM fx_circuit_states WHERE circuit_key=?').get(protectedScope.circuitKey);
    const protectedIncident = value.database.prepare('SELECT * FROM fx_executor_incidents WHERE incident_key=?').get(protectedScope.incidentKey);
    const result = applyReset({...value,transcodeDir:null,subjectIds:[target.subjectId],nowMs:5000});
    assert.equal(result.verification.integrity, 'ok');
    assert.equal(value.database.prepare('SELECT state FROM fx_circuit_states WHERE circuit_key=?').get(selected.circuitKey).state, 'open');
    const incident = value.database.prepare('SELECT * FROM fx_executor_incidents WHERE incident_key=?').get(selected.incidentKey);
    assert.equal(incident.incident_state, 'open');
    assert.equal(incident.occurrence_count, 3);
    assert.equal(incident.resolved_at_ms, null);
    assert.deepEqual(value.database.prepare('SELECT * FROM fx_circuit_states WHERE circuit_key=?').get(protectedScope.circuitKey), protectedCircuit);
    assert.deepEqual(value.database.prepare('SELECT * FROM fx_executor_incidents WHERE incident_key=?').get(protectedScope.incidentKey), protectedIncident);
    applyReset({...value,transcodeDir:null,subjectIds:[target.subjectId],nowMs:5001});
    assert.equal(value.database.prepare('SELECT last_seen_at_ms FROM fx_executor_incidents WHERE incident_key=?').get(selected.incidentKey).last_seen_at_ms, 5000);
  } finally { close(value); }
});

test('explicit Subject scope removes its missing-Work admission receipt and preserves other orphan receipts', () => {
  const value = fixture('helix-scoped-phantom-intake');
  try {
    const target = seedPhantomAdmissionReceipt(value.database, 'selected');
    const other = seedPhantomAdmissionReceipt(value.database, 'protected');
    const subjectIds = [target.subjectId];
    assert.equal(inspectPlan(value.database, { subjectIds }).counts.orphanPipelineAdmissionReceipts, 1);
    applyReset({ ...value, transcodeDir:null, subjectIds, nowMs:4100 });
    assert.equal(value.database.prepare('SELECT 1 FROM fx_command_receipts WHERE command_receipt_id=?').get(target.receiptId), undefined);
    assert.ok(value.database.prepare('SELECT 1 FROM fx_command_receipts WHERE command_receipt_id=?').get(other.receiptId));
  } finally { close(value); }
});

test('Formation Reset removes phantom Work Admission receipts that would replay a missing Intake Work', () => {
    const value = fixture('helix-formation-reset-phantom-admission');
    try {
      const seeded = seedPhantomAdmissionReceipt(value.database, 'formation');
      const plan = inspectPlan(value.database);
      assert.equal(plan.ready, true);
      assert.equal(plan.counts.orphanPipelineTokens, 1);
      assert.equal(plan.counts.orphanPipelineAdmissionReceipts, 1);
      assert.deepEqual(plan.scope.orphanPipelineAdmissionTargetIds, [seeded.targetWorkId]);

      const result = applyReset({ database:value.database, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3570 });
      assert.equal(result.verification.integrity, 'ok');
      assert.equal(inspectPlan(value.database).counts.orphanPipelineTokens, 0);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_command_receipts WHERE command_receipt_id=?')
        .get(seeded.receiptId).count, 0);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_predeck_pipeline_tokens WHERE subject_id=?')
        .get(seeded.subjectId).count, 0);
    } finally { close(value); }
});

test('Formation Reset removes the complete latent Libra phantom receipt pool before another Offer acquires a seat', () => {
    const value = fixture('helix-formation-reset-latent-admission');
    try {
      const seeded = seedLatentPhantomAdmissionReceipt(value.database, 'formation');
      const plan = inspectPlan(value.database);
      assert.equal(plan.ready, true);
      assert.equal(plan.counts.orphanPipelineTokens, 0);
      assert.equal(plan.counts.orphanPipelineAdmissionReceipts, 0);
      assert.equal(plan.counts.phantomLibraAdmissionReceipts, 1);
      assert.deepEqual(plan.scope.phantomLibraAdmissionReceiptIds, [seeded.receiptId]);

      const result = applyReset({ database:value.database, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3580 });
      assert.equal(result.verification.integrity, 'ok');
      assert.equal(inspectPlan(value.database).counts.phantomLibraAdmissionReceipts, 0);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_command_receipts WHERE command_receipt_id=?')
        .get(seeded.receiptId).count, 0);

      applyReset({ database:value.database, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3590 });
      assert.equal(inspectPlan(value.database).counts.phantomLibraAdmissionReceipts, 0);
    } finally { close(value); }
});

test('Formation Reset reopens the exact Handoff A boundary and rolls released Control history back to Procurement', () => {
  const value = fixture('helix-formation-reset-handoff-a-boundary');
  try {
    const seeded = seedClosedHandoffABoundary(value.database, 'formation');
    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.procurementHandoffAClosures, 1);
    assert.deepEqual(plan.scope.handoffAOfferIds, [seeded.offerId]);
    assert.deepEqual(plan.scope.handoffACandidatePackageIds, [seeded.candidatePackageId]);
    assert.equal(plan.scope.materialKeys.includes(seeded.materialKey), true);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3600 });
    assert.equal(result.result.reopenedDeliveries, 1);
    assert.equal(result.result.reopenedReservations, 1);
    assert.equal(result.result.deletedInboxClosures, 1);
    assert.equal(result.result.deletedOutboxMessages, 1);
    assert.equal(result.result.restoredProcurementControls, 1);
    assert.deepEqual(value.database.prepare(`SELECT state,handoff_decision_id,handoff_receipt_id,
      handoff_receipt_digest,terminal_evidence_digest,closed_at_ms FROM proc_candidate_deliveries WHERE offer_id=?`)
      .get(seeded.offerId), { state:'open', handoff_decision_id:null, handoff_receipt_id:null,
        handoff_receipt_digest:null, terminal_evidence_digest:null, closed_at_ms:null });
    assert.deepEqual(value.database.prepare(`SELECT selection_state,terminal_disposition,terminal_evidence_digest
      FROM proc_run_materials WHERE procurement_run_id=? AND ordinal=0`).get(seeded.procurementRunId),
      { selection_state:'candidate_delivery', terminal_disposition:null, terminal_evidence_digest:null });
    assert.deepEqual(value.database.prepare(`SELECT owner_domain,owner_scope_type,owner_scope_id,control_revision,state
      FROM fx_material_controls WHERE material_key=?`).get(seeded.materialKey), {
      owner_domain:'procurement', owner_scope_type:'material_field', owner_scope_id:'field-handoff-reset',
      control_revision:1, state:'controlled',
    });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions WHERE material_key=?')
      .get(seeded.materialKey).count, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_inbox WHERE dedup_key=?').get(seeded.dedupKey).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_outbox WHERE message_id=?').get(seeded.messageId).count, 0);

    applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3610 });
    assert.equal(inspectPlan(value.database).counts.procurementHandoffAClosures, 0);
  } finally { close(value); }
});

test('Formation Reset discovers a latent Procurement-only closed Handoff A boundary', () => {
  const value = fixture('helix-formation-reset-latent-handoff-a');
  try {
    const seeded = makeClosedHandoffALatent(value.database,
      seedClosedHandoffABoundary(value.database, 'latent'));
    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.orphanProcurementHandoffAClosures, 1);
    assert.equal(plan.counts.preservedCommittedHandoffAClosures, 0);
    assert.deepEqual(plan.scope.handoffAOfferIds, [seeded.offerId]);
    assert.equal(plan.counts.controlledMaterials, 1);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3620 });
    assert.equal(result.result.reopenedDeliveries, 1);
    assert.equal(result.result.reopenedReservations, 1);
    assert.equal(result.result.restoredProcurementControls, 1);
    assert.deepEqual(value.database.prepare(`SELECT owner_domain,owner_scope_type,owner_scope_id,control_revision,state
      FROM fx_material_controls WHERE material_key=?`).get(seeded.materialKey), {
      owner_domain:'procurement', owner_scope_type:'material_field', owner_scope_id:'field-handoff-reset',
      control_revision:1, state:'controlled',
    });
    assert.equal(inspectPlan(value.database).counts.orphanProcurementHandoffAClosures, 0);
  } finally { close(value); }
});

test('Formation Reset preserves a closed Handoff A boundary whose material belongs to a committed Shelf chain', () => {
  const value = fixture('helix-formation-reset-protected-handoff-a');
  try {
    const latent = makeClosedHandoffALatent(value.database,
      seedClosedHandoffABoundary(value.database, 'protected'));
    const kept = seedSubjectRun(value.database, 'protected-handoff', 'completed');
    const manifestId = 'manifest-protected-handoff';
    const packageId = 'package-protected-handoff';
    const custodyId = 'custody-protected-handoff';
    const onDeckRunId = 'ondeck-protected-handoff';
    value.database.prepare(`INSERT INTO libra_run_material_manifests
      (run_material_manifest_id,libra_run_id,manifest_role,scope_kind,manifest_revision,member_count,
       member_set_digest,manifest_digest,published_at_ms)
      VALUES (?,?,'run_input','single',1,1,?,?,1)`).run(manifestId,kept.runId,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO libra_run_material_members
      (run_material_manifest_id,ordinal,material_key,role,size_bytes,member_digest)
      VALUES (?,0,?,'primary_payload',1,?)`).run(manifestId,latent.materialKey,DIGEST);
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       run_material_manifest_id,product_structure_json,production_provenance_json,attestation_json,
       package_digest,state,published_at_ms)
      VALUES (?,'offer-protected-package',1,?,1,?,?,'{}','{}','{}',?,'published',1)`)
      .run(packageId,kept.runId,kept.subjectId,manifestId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions
      (acceptance_decision_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES ('decision-protected-handoff','accepted','offer-protected-package',?,?,1)`)
      .run(packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,'decision-protected-handoff',?,?,'committed',1)`).run(custodyId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms,terminal_at_ms)
      VALUES (?,?,'committed',1,2)`).run(onDeckRunId,custodyId);
    value.database.prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status,created_at_ms) VALUES ('entry-protected-handoff','active',1)").run();
    value.database.prepare(`INSERT INTO arca_ondeck_commit_receipts
      (receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,commit_digest,committed_at_ms)
      VALUES ('commit-protected-handoff',?,'entry-protected-handoff',1,1,?,2)`).run(onDeckRunId,DIGEST);

    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.orphanProcurementHandoffAClosures, 0);
    assert.equal(plan.counts.preservedCommittedHandoffAClosures, 1);
    assert.equal(plan.scope.handoffAOfferIds.includes(latent.offerId), false);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3630 });
    assert.equal(result.verification.integrity, 'ok');
    assert.equal(value.database.prepare('SELECT state FROM proc_candidate_deliveries WHERE offer_id=?')
      .get(latent.offerId).state, 'accepted');
  } finally { close(value); }
});

test('Formation Reset reopens only the newest non-overlapping Handoff A generation per Material', () => {
  const value = fixture('helix-formation-reset-overlapping-handoff-a');
  try {
    const older = seedClosedHandoffABoundary(value.database, 'overlap-older');
    const newer = seedClosedHandoffABoundary(value.database, 'overlap-newer');
    for(const item of [older,newer]) {
      value.database.prepare(`INSERT INTO fx_outbox
        (message_id,producer_domain,message_kind,aggregate_type,aggregate_id,aggregate_revision,dedup_key,
         consumer_set_digest,intended_consumer_count,payload_schema_ref,payload_json,payload_digest,state,
         available_at_ms,created_at_ms,all_acked_at_ms)
        VALUES (?,'procurement','procurement_candidate_offer_available','candidate_delivery',?,1,?,?,1,'message','{}',?,'fully_acked',1,1,2)`)
        .run('source-'+item.offerId,item.offerId,'procurement_candidate_offer_available:'+item.offerId,DIGEST,DIGEST);
    }
    value.database.prepare('DELETE FROM libra_predeck_pipeline_tokens WHERE subject_id IN (?,?)')
      .run(older.subjectId,newer.subjectId);
    value.database.prepare('UPDATE proc_candidate_deliveries SET offered_at_ms=2,closed_at_ms=3 WHERE offer_id=?')
      .run(newer.offerId);
    value.database.prepare('UPDATE proc_run_materials SET material_key=? WHERE candidate_package_id=?')
      .run(older.materialKey,newer.candidatePackageId);

    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.orphanProcurementHandoffAClosures, 1);
    assert.equal(plan.counts.preservedSupersededHandoffAClosures, 1);
    assert.deepEqual(plan.scope.handoffAOfferIds, [newer.offerId]);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3640 });
    assert.equal(result.verification.integrity, 'ok');
    assert.equal(value.database.prepare('SELECT state FROM proc_candidate_deliveries WHERE offer_id=?')
      .get(newer.offerId).state, 'open');
    assert.equal(value.database.prepare('SELECT state FROM proc_candidate_deliveries WHERE offer_id=?')
      .get(older.offerId).state, 'accepted');
    assert.equal(result.result.retiredSupersededOfferMessages,1);
    assert.equal(value.database.prepare('SELECT message_id FROM fx_outbox WHERE message_id=?').get('source-'+older.offerId),undefined);
    assert.ok(value.database.prepare('SELECT message_id FROM fx_outbox WHERE message_id=?').get('source-'+newer.offerId));
    assert.equal(inspectPlan(value.database).counts.orphanProcurementHandoffAClosures, 0);
  } finally { close(value); }
});

test('Formation Reset preserves a historical closure shadowed by a current active Procurement reservation', () => {
  const value = fixture('helix-formation-reset-shadowed-handoff-a');
  try {
    const historical = seedClosedHandoffABoundary(value.database, 'shadowed-old');
    const current = seedClosedHandoffABoundary(value.database, 'shadowed-current');
    value.database.prepare('DELETE FROM libra_predeck_pipeline_tokens WHERE subject_id IN (?,?)')
      .run(historical.subjectId,current.subjectId);
    value.database.prepare(`UPDATE proc_candidate_deliveries
      SET state='open',handoff_decision_id=NULL,handoff_receipt_id=NULL,handoff_receipt_digest=NULL,
          terminal_evidence_digest=NULL,closed_at_ms=NULL WHERE offer_id=?`).run(current.offerId);
    value.database.prepare(`UPDATE proc_run_materials
      SET material_key=?,selection_state='candidate_delivery',terminal_disposition=NULL,terminal_evidence_digest=NULL
      WHERE candidate_package_id=?`).run(historical.materialKey,current.candidatePackageId);

    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.orphanProcurementHandoffAClosures, 0);
    assert.equal(plan.counts.preservedSupersededHandoffAClosures, 1);
    assert.equal(plan.scope.handoffAOfferIds.includes(historical.offerId), false);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3650 });
    assert.equal(result.verification.integrity, 'ok');
    assert.equal(value.database.prepare('SELECT state FROM proc_candidate_deliveries WHERE offer_id=?')
      .get(historical.offerId).state, 'accepted');
  } finally { close(value); }
});

test('Formation Reset also partitions overlapping closures discovered from live Intake roots', () => {
  const value=fixture('helix-reset-rooted-overlap');
  try {
    const older=seedClosedHandoffABoundary(value.database,'rooted-old');
    const newer=seedClosedHandoffABoundary(value.database,'rooted-new');
    value.database.prepare('UPDATE proc_candidate_deliveries SET offered_at_ms=2 WHERE offer_id=?').run(newer.offerId);
    value.database.prepare('UPDATE proc_run_materials SET material_key=? WHERE candidate_package_id=?')
      .run(older.materialKey,newer.candidatePackageId);
    const plan=inspectPlan(value.database);
    assert.equal(plan.ready,true);
    assert.deepEqual(plan.scope.handoffAOfferIds,[newer.offerId]);
    const result=applyReset({database:value.database,dataDir:value.dataDir,transcodeDir:value.transcodeDir});
    assert.equal(result.verification.integrity,'ok');
    assert.equal(value.database.prepare('SELECT state FROM proc_candidate_deliveries WHERE offer_id=?').get(older.offerId).state,'accepted');
    assert.equal(value.database.prepare("SELECT COUNT(*) n FROM proc_run_materials WHERE material_key=? AND selection_state='candidate_delivery'").get(older.materialKey).n,1);
    assert.equal(inspectPlan(value.database).counts.procurementHandoffAClosures,0);
  } finally {close(value);}
});

test('an exact superseded Offer scope does not select unrelated active Subjects or reopen its Delivery',()=>{
  const value=fixture('helix-reset-superseded-scope');
  try{
    const old=seedClosedHandoffABoundary(value.database,'scoped-old');
    const current=seedClosedHandoffABoundary(value.database,'scoped-current');
    value.database.prepare('DELETE FROM libra_predeck_pipeline_tokens WHERE subject_id=?').run(old.subjectId);
    value.database.prepare("UPDATE proc_candidate_deliveries SET state='open',handoff_decision_id=NULL,handoff_receipt_id=NULL,handoff_receipt_digest=NULL,terminal_evidence_digest=NULL,closed_at_ms=NULL WHERE offer_id=?").run(current.offerId);
    value.database.prepare("UPDATE proc_run_materials SET material_key=?,selection_state='candidate_delivery',terminal_disposition=NULL,terminal_evidence_digest=NULL WHERE candidate_package_id=?").run(old.materialKey,current.candidatePackageId);
    const plan=inspectPlan(value.database,{supersededOfferIds:[old.offerId]});
    assert.deepEqual(plan.scope.disposableSubjectIds,[]);assert.deepEqual(plan.scope.handoffAOfferIds,[]);
    assert.throws(()=>inspectPlan(value.database,{supersededOfferIds:[current.offerId]}),/OFFER_NOT_SUPERSEDED/);
    const result=applyReset({database:value.database,dataDir:value.dataDir,transcodeDir:value.transcodeDir,supersededOfferIds:[old.offerId]});
    assert.equal(result.result.deletedSubjects,0);
    assert.equal(value.database.prepare('SELECT state FROM proc_candidate_deliveries WHERE offer_id=?').get(old.offerId).state,'accepted');
    assert.ok(value.database.prepare('SELECT subject_id FROM libra_predeck_pipeline_tokens WHERE subject_id=?').get(current.subjectId));
  }finally{close(value);}
});

test('Formation Reset deletes an orphan Run even when its admission head is missing', () => {
  const value = fixture('helix-formation-reset-orphan-run-head');
  try {
    const seeded = seedSubjectRun(value.database, 'missing-head');
    value.database.prepare('DELETE FROM libra_run_admission_heads WHERE subject_id=?').run(seeded.subjectId);
    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.orphanActiveRuns, 1);
    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3600 });
    assert.equal(result.result.deletedRuns, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_runs WHERE libra_run_id=?').get(seeded.runId).count, 0);
  } finally { close(value); }
});

test('Formation Reset rolls a package-owned Control back to its Procurement boundary', () => {
  const value = fixture('helix-formation-reset-package-control');
  try {
    const seeded = seedSubjectRun(value.database, 'package-control');
    const packageId = 'package-control';
    const materialKey = 'material-package-control';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,'offer-control',1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(packageId,seeded.runId,seeded.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO libra_product_package_materials
      (on_deck_package_id,ordinal,material_key,committed_control_revision,committed_control_projection_digest,member_digest)
      VALUES (?,0,?,2,?,?)`).run(packageId,materialKey,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
      fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
      control_revision,state,updated_at_ms) VALUES (?,'mount','inode-control',1,'middle','1','fp-control','libra','on_deck_package',?,2,'controlled',2)`)
      .run(materialKey,packageId);
    value.database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
      to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES (?,1,'acquire','procurement','procurement_run','proc-run-control',?,'control-1',1),
             (?,2,'transfer','libra','on_deck_package',?,?, 'control-2',2)`)
      .run(materialKey,DIGEST,materialKey,packageId,DIGEST);

    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.controlledMaterials, 1);
    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3700 });
    assert.equal(result.result.restoredProcurementControls, 1);
    assert.deepEqual(value.database.prepare(`SELECT owner_domain,owner_scope_type,owner_scope_id,control_revision,state
      FROM fx_material_controls WHERE material_key=?`).get(materialKey), {
      owner_domain:'procurement', owner_scope_type:'procurement_run', owner_scope_id:'proc-run-control',
      control_revision:1, state:'controlled',
    });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions WHERE material_key=?')
      .get(materialKey).count, 1);
  } finally { close(value); }
});

test('Formation Reset deletes an uncommitted Libra-to-Arca graph but preserves committed collection facts', () => {
  const value = fixture('helix-formation-reset-nuclear');
  try {
    const target = seedSubjectRun(value.database, 'target');
    const intakeDecision = 'intake-decision-target';
    value.database.transaction(() => {
      value.database.pragma('defer_foreign_keys = ON');
      value.database.prepare(`INSERT INTO libra_intake_decisions
        (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,package_revision,
         package_digest,target_subject_id,accepted_result,decision_digest,decided_at_ms,
         candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
         decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest)
        VALUES (?,1,'accepted_resolution','handoff-a-offer-target','candidate-target',1,?,?,'new_subject',?,1,
          'snapshot','{}','identity','{}',?)`)
        .run(intakeDecision,DIGEST,target.subjectId,DIGEST,DIGEST);
      value.database.prepare('UPDATE libra_subjects SET routing_anchor_intake_decision_id=? WHERE subject_id=?')
        .run(intakeDecision,target.subjectId);
      value.database.prepare(`INSERT INTO libra_handoff_a_receipts
        (receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,
         subject_id,subject_intake_revision,subject_continuity_head_revision,committed_at_ms)
        VALUES ('handoff-a-receipt-target',?,'accepted','handoff-a-offer-target','candidate-target',1,?,?,1,1,1)`)
        .run(intakeDecision,DIGEST,target.subjectId);
    })();
    seedExecution(value.database, 'libra', 'libra_intake', intakeDecision, 'intake-target');
    const targetPackage = 'package-target', targetOffer = 'offer-target', targetAttempt = 'acceptance-attempt-target',
      targetDecision = 'acceptance-decision-target', targetCustody = 'custody-target', targetOnDeck = 'on-deck-target';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,?,1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(targetPackage,targetOffer,target.runId,target.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_attempts
      (acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms)
      VALUES (?,?,?,?,'accepted',1)`).run(targetAttempt,targetOffer,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions
      (acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES (?,?,'accepted',?,?,?,1)`).run(targetDecision,targetAttempt,targetOffer,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_handoff_b_receipts
      (receipt_id,acceptance_decision_id,outcome,offer_id,custody_id,on_deck_package_id,package_digest,committed_at_ms)
      VALUES ('receipt-target',?,'accepted',?,?,?,?,1)`).run(targetDecision,targetOffer,targetCustody,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,?,?,?,'active',1)`).run(targetCustody,targetDecision,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms)
      VALUES (?,?,'offloading',1)`).run(targetOnDeck,targetCustody);
    value.database.prepare(`INSERT INTO arca_material_bindings
      (owner_object_type,owner_object_id,material_key,role,authority_kind,binding_revision,health_state,current)
      VALUES ('on_deck_custody',?,'material-target','primary_payload','product_control',1,'active',1)`).run(targetCustody);
    value.database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
      fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
      control_revision,state,updated_at_ms) VALUES ('material-target','mount','inode-target',1,'middle','1','fp-target','arca','on_deck_custody',?,1,'controlled',1)`)
      .run(targetCustody);
    value.database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
      to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES ('material-target',1,'transfer','arca','on_deck_custody',?,?,'target',1)`).run(targetCustody,DIGEST);
    value.database.prepare("DELETE FROM arca_material_bindings WHERE owner_object_type='on_deck_custody' AND owner_object_id=?").run(targetCustody);
    const targetExecution = seedExecution(value.database, 'arca', 'arca_ondeck_run', targetOnDeck, 'target');

    const kept = seedSubjectRun(value.database, 'kept', 'completed');
    const keptPackage = 'package-kept', keptCustody = 'custody-kept', keptOnDeck = 'on-deck-kept';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,'offer-kept',1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(keptPackage,kept.runId,kept.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms)
      VALUES ('attempt-kept','offer-kept',?,?,'accepted',1)`).run(keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions(acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES ('decision-kept','attempt-kept','accepted','offer-kept',?,?,1)`).run(keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,'decision-kept',?,?,'committed',1)`).run(keptCustody,keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms,terminal_at_ms)
      VALUES (?,?,'committed',1,2)`).run(keptOnDeck,keptCustody);
    value.database.prepare(`INSERT INTO arca_shelf_entries(shelf_entry_id,status,created_at_ms) VALUES ('entry-kept','active',1)`).run();
    value.database.prepare(`INSERT INTO arca_ondeck_commit_receipts
      (receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,commit_digest,committed_at_ms)
      VALUES ('commit-kept',?,'entry-kept',1,1,?,2)`).run(keptOnDeck,DIGEST);
    value.database.prepare('UPDATE libra_runs SET supersedes_run_id=? WHERE libra_run_id=?')
      .run(target.runId,kept.runId);
    value.database.prepare('UPDATE libra_runs SET superseded_by_run_id=? WHERE libra_run_id=?')
      .run(kept.runId,target.runId);

    fs.mkdirSync(path.join(value.transcodeDir, target.workspaceId));
    fs.mkdirSync(path.join(value.transcodeDir, kept.workspaceId));
    const before = inspectPlan(value.database);
    assert.equal(before.ready, true);
    assert.equal(before.scope.runIds.includes(target.runId), true);
    assert.equal(before.scope.runIds.includes(kept.runId), false);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:4000 });
    assert.equal(result.result.deletedRuns, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?').get(target.subjectId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_intake_decisions WHERE intake_decision_id=?').get(intakeDecision).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_runs WHERE on_deck_run_id=?').get(targetOnDeck).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?').get(targetExecution.workId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_controls WHERE material_key=?').get('material-target').count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?').get(kept.subjectId).count, 1);
    assert.deepEqual(value.database.prepare('SELECT supersedes_run_id,superseded_by_run_id FROM libra_runs WHERE libra_run_id=?')
      .get(kept.runId), { supersedes_run_id:null, superseded_by_run_id:null });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_commit_receipts WHERE on_deck_run_id=?').get(keptOnDeck).count, 1);
    assert.equal(fs.existsSync(path.join(value.transcodeDir, target.workspaceId)), false);
    assert.equal(fs.existsSync(path.join(value.transcodeDir, kept.workspaceId)), true);
    assert.equal(value.database.pragma('foreign_key_check').length, 0);
  } finally { close(value); }
});

test('Formation Reset deletes current and previously orphaned eventless Formation Fact markers and Results', () => {
  const value = fixture('helix-formation-reset-eventless-facts');
  try {
    const seeded = seedSubjectRun(value.database, 'eventless-facts');
    const basisId = 'basis-eventless-facts';
    const assessmentId = 'assessment-eventless-facts';
    const routingDecisionId = 'routing-decision-eventless-facts';
    const acceptanceSpecId = 'acceptance-spec-eventless-facts';
    value.database.prepare(`INSERT INTO libra_decision_basis_revisions
      (decision_basis_id,subject_id,basis_kind,basis_revision,expected_head_revision,
       expected_head_snapshot_digest,input_set_digest,status,basis_digest,committed_at_ms)
      VALUES (?,?,'routing',1,0,?,?,'ready',?,1)`)
      .run(basisId,seeded.subjectId,DIGEST,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO libra_routing_assessments
      (routing_assessment_id,subject_id,decision_basis_id,routing_authority_kind,
       routing_input_digest,assessment_schema_ref,assessment_json,assessment_digest,created_at_ms)
      VALUES (?,?,?,'policy',?,'test-assessment','{}',?,1)`)
      .run(assessmentId,seeded.subjectId,basisId,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO libra_routing_decisions
      (routing_decision_id,subject_id,assessment_id,decision_revision,decision,
       routing_authority_kind,routing_input_digest,shelf_priority_set_digest,decision_digest,decided_at_ms)
      VALUES (?,?,?,1,'unresolved','policy',?,?,?,1)`)
      .run(routingDecisionId,seeded.subjectId,assessmentId,DIGEST,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO libra_acceptance_specs
      (acceptance_spec_id,subject_id,decision_basis_id,product_scope_digest,spec_revision,
       spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms)
      VALUES (?,?,?,?,1,'test-spec','{}',?,?,'single','movie',1)`)
      .run(acceptanceSpecId,seeded.subjectId,basisId,DIGEST,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO fx_command_receipts
      (command_receipt_id,owner_domain,command_contract,caller_scope,idempotency_key,request_digest,
       target_type,target_id,result_schema_ref,result_ref_json,result_digest,committed_at_ms)
      VALUES ('receipt-eventless-basis','libra','test.decision-basis','test','basis-key',?,
       'decision_basis',?,'result','{}',?,1)`).run(DIGEST,basisId,DIGEST);

    seedEventlessMarker(value.database, { marker:'marker-current-routing', scopeType:'routing_decision',
      scopeId:routingDecisionId, resultId:'result-current-routing' });
    seedEventlessMarker(value.database, { marker:'marker-current-spec', scopeType:'acceptance_spec',
      scopeId:acceptanceSpecId, resultId:'result-current-spec' });
    seedEventlessMarker(value.database, { marker:'marker-orphan-routing', scopeType:'routing_decision',
      scopeId:'routing-decision-from-prior-reset', resultId:'result-orphan-routing' });
    seedEventlessMarker(value.database, { marker:'marker-orphan-spec', scopeType:'acceptance_spec',
      scopeId:'acceptance-spec-from-prior-reset', resultId:'result-orphan-spec' });

    const plan = inspectPlan(value.database);
    assert.equal(plan.counts.eventlessFactMarkerOrphans, 2);
    assert.equal(plan.counts.orphanRoutingDecisionMarkers, 1);
    assert.equal(plan.counts.orphanAcceptanceSpecMarkers, 1);
    assert.equal(plan.scope.routingDecisionIds.includes(routingDecisionId), true);
    assert.equal(plan.scope.acceptanceSpecIds.includes(acceptanceSpecId), true);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:4250 });
    assert.equal(result.verification.integrity, 'ok');
    assert.equal(inspectPlan(value.database).counts.eventlessFactMarkerOrphans, 0);
    assert.equal(value.database.prepare(`SELECT COUNT(*) count FROM fx_commit_markers
      WHERE commit_marker LIKE 'marker-%-routing' OR commit_marker LIKE 'marker-%-spec'`).get().count, 0);
    assert.equal(value.database.prepare(`SELECT COUNT(*) count FROM fx_event_result_bindings
      WHERE result_id LIKE 'result-%-routing' OR result_id LIKE 'result-%-spec'`).get().count, 0);
    assert.equal(value.database.prepare(`SELECT COUNT(*) count FROM fx_command_receipts
      WHERE command_receipt_id='receipt-eventless-basis'`).get().count, 0);
  } finally { close(value); }
});

test('Formation Reset removes an Accepted but uncommitted Arca On-deck responsibility', () => {
  const value = fixture('helix-formation-reset-normal-ondeck');
  try {
    const seeded = seedSubjectRun(value.database, 'normal-ondeck');
    const packageId = 'package-normal-ondeck', offerId = 'offer-normal-ondeck', attemptId = 'attempt-normal-ondeck',
      decisionId = 'decision-normal-ondeck', custodyId = 'custody-normal-ondeck', onDeckRunId = 'run-normal-ondeck';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,?,1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(packageId,offerId,seeded.runId,seeded.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_attempts
      (acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms,finished_at_ms)
      VALUES (?,?,?,?,'accepted',1,2)`).run(attemptId,offerId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions
      (acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES (?,?,'accepted',?,?,?,2)`).run(decisionId,attemptId,offerId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,?,?,?,'active',2)`).run(custodyId,decisionId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_handoff_b_receipts
      (receipt_id,acceptance_decision_id,outcome,offer_id,custody_id,on_deck_package_id,package_digest,committed_at_ms)
      VALUES ('receipt-normal-ondeck',?,'accepted',?,?,?,?,2)`)
      .run(decisionId,offerId,custodyId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms)
      VALUES (?,?,'offloading',2)`).run(onDeckRunId,custodyId);
    value.database.prepare(`INSERT INTO arca_material_bindings
      (owner_object_type,owner_object_id,material_key,role,authority_kind,binding_revision,health_state,current)
      VALUES ('on_deck_custody',?,'material-normal-ondeck','primary_payload','product_control',1,'active',1)`).run(custodyId);
    value.database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
      fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
      control_revision,state,updated_at_ms) VALUES ('material-normal-ondeck','mount','inode-ondeck',1,'middle','1','fp-ondeck','arca','on_deck_custody',?,1,'controlled',1)`)
      .run(custodyId);
    value.database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
      to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES ('material-normal-ondeck',1,'transfer','arca','on_deck_custody',?,?,'normal-ondeck',1)`).run(custodyId,DIGEST);
    const work = seedExecution(value.database, 'arca', 'arca_ondeck_run', onDeckRunId, 'normal-ondeck');
    value.database.prepare(`INSERT INTO libra_formation_projections(subject_id,classification,subject_status,
      display_identity,next_action_label,next_action_state,attention_state,current_package_id,current_offer_id,added_at_ms,updated_at_ms)
      VALUES (?,'in_progress','active','Accepted','整理中','running','none',?,?,1,1)`)
      .run(seeded.subjectId,packageId,offerId);

    applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:4500 });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_custodies WHERE custody_id=?').get(custodyId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_runs WHERE on_deck_run_id=?').get(onDeckRunId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?').get(work.workId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_controls WHERE material_key=?').get('material-normal-ondeck').count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_formation_projections WHERE subject_id=?').get(seeded.subjectId).count, 0);
  } finally { close(value); }
});

test('Formation Reset deletes presentation reservations, strategy availability and plan contracts before parents', () => {
  const value = fixture('helix-formation-reset-fk-children');
  try {
    const seeded = seedSubjectRun(value.database, 'fk-children');
    const packageId = 'package-fk-children', offerId = 'offer-fk-children', attemptId = 'attempt-fk-children',
      decisionId = 'decision-fk-children', custodyId = 'custody-fk-children', onDeckRunId = 'run-fk-children';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,?,1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(packageId,offerId,seeded.runId,seeded.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_attempts
      (acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms,finished_at_ms)
      VALUES (?,?,?,?,'accepted',1,2)`).run(attemptId,offerId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions
      (acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES (?,?,'accepted',?,?,?,2)`).run(decisionId,attemptId,offerId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,?,?,?,'active',2)`).run(custodyId,decisionId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_handoff_b_receipts
      (receipt_id,acceptance_decision_id,outcome,offer_id,custody_id,on_deck_package_id,package_digest,committed_at_ms)
      VALUES ('receipt-fk-children',?,'accepted',?,?,?,?,2)`)
      .run(decisionId,offerId,custodyId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms)
      VALUES (?,?,'offloading',2)`).run(onDeckRunId,custodyId);
    value.database.prepare(`INSERT INTO arca_series_presentation_scopes
      (scope_id,state_revision,state_digest,created_at_ms,updated_at_ms)
      VALUES ('scope-fk-children',1,?,1,1)`).run(DIGEST);
    value.database.prepare(`INSERT INTO arca_series_presentation_reservations
      (scope_id,on_deck_run_id,custody_id,state,target_binding_digest,created_at_ms,updated_at_ms)
      VALUES ('scope-fk-children',?,?,'pending',?,1,1)`).run(onDeckRunId,custodyId,DIGEST);
    value.database.prepare(`INSERT INTO libra_strategy_availability
      (libra_run_id,strategy_kind,condition_digest,check_ordinal,evidence_schema_ref,evidence_json,evidence_digest,checked_at_ms)
      VALUES (?,'tmdb',?,0,'test','{}',?,1)`).run(seeded.runId,DIGEST,DIGEST);
    const work = seedExecution(value.database, 'arca', 'arca_ondeck_run', onDeckRunId, 'fk-children');
    value.database.prepare(`INSERT INTO fx_execution_contracts
      (contract_digest,format_version,contract_schema_ref,contract_json,created_at_ms)
      VALUES (?,1,'test','{}',1)`).run(DIGEST);
    value.database.prepare(`INSERT INTO fx_plan_contracts
      (plan_id,contract_digest,graph_digest,catalog_digest,provenance_schema_ref,provenance_json,created_at_ms)
      VALUES (?,?,?,?,'test','{}',1)`).run(work.planId,DIGEST,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO fx_plan_history_audits
      (audit_id,plan_id,audit_schema_ref,audit_json,created_at_ms)
      VALUES ('audit-fk-children',?,'test','{}',1)`).run(work.planId);
    value.database.prepare(`INSERT INTO libra_formation_projections(subject_id,classification,subject_status,
      display_identity,next_action_label,next_action_state,attention_state,current_package_id,current_offer_id,added_at_ms,updated_at_ms)
      VALUES (?,'in_progress','active','Accepted','整理中','running','none',?,?,1,1)`)
      .run(seeded.subjectId,packageId,offerId);

    const result = applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:4600 });
    assert.equal(result.verification.integrity, 'ok');
    assert.deepEqual(value.database.pragma('foreign_key_check'), []);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_series_presentation_reservations').get().count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_strategy_availability').get().count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_plan_contracts').get().count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_plan_history_audits').get().count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_runs').get().count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_runs').get().count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_workflow_plans').get().count, 0);
  } finally { close(value); }
});

test('Formation Reset rejects broad transcode roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-formation-reset-guard-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  try {
    assert.throws(() => assertSafeTranscodeRoot(path.parse(root).root, dataDir), /UNSAFE_TRANSCODE_ROOT/);
    assert.throws(() => assertSafeTranscodeRoot(root, dataDir), /UNSAFE_TRANSCODE_ROOT/);
    assert.throws(() => assertSafeTranscodeRoot(dataDir, dataDir), /UNSAFE_TRANSCODE_ROOT/);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('Formation Reset rolls the whole database graph and Workspace back when a delete fails', () => {
  const value = fixture('helix-formation-reset-rollback');
  try {
    const seeded = seedSubjectRun(value.database, 'rollback');
    seedExecution(value.database, 'libra', 'libra_run', seeded.runId, 'rollback');
    fs.mkdirSync(path.join(value.transcodeDir, seeded.workspaceId));
    fs.writeFileSync(path.join(value.transcodeDir, seeded.workspaceId, 'partial.bin'), 'preserve-on-failure');
    value.database.exec(`CREATE TRIGGER block_formation_run_delete BEFORE DELETE ON libra_runs
      BEGIN SELECT RAISE(ABORT, 'forced reset failure'); END`);
    assert.throws(() => applyReset({ database:value.database, dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:5000 }), /forced reset failure/);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?').get(seeded.subjectId).count, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_runs WHERE libra_run_id=?').get(seeded.runId).count, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE process_id=?').get(seeded.runId).count, 1);
    assert.equal(value.database.pragma('foreign_keys', { simple:true }), 1);
    assert.equal(value.database.pragma('foreign_key_check').length, 0);
    assert.equal(fs.readFileSync(path.join(value.transcodeDir, seeded.workspaceId, 'partial.bin'), 'utf8'),
      'preserve-on-failure');
  } finally { close(value); }
});

test('Formation Reset deletes an Artifact owned directly by the unfinished Libra Run', () => {
  const value = fixture('helix-formation-reset-run-artifact');
  try {
    const seeded = seedSubjectRun(value.database, 'run-artifact');
    value.database.prepare(`INSERT INTO fx_artifact_registry
      (artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,storage_ref,
       digest_algorithm,digest_hex,size_bytes,media_type,provenance_ref,reference_revision,state,created_at_ms)
      VALUES ('artifact-run-owned','nfo','libra','libra_run',?,'workspace:nfo','sha256',?,10,
        'application/xml','test',1,'active',1)`).run(seeded.runId,DIGEST);
    const plan = inspectPlan(value.database);
    assert.deepEqual(plan.scope.artifactIds, ['artifact-run-owned']);
    applyReset({ database:value.database, dataDir:value.dataDir, transcodeDir:value.transcodeDir, nowMs:5100 });
    assert.equal(value.database.prepare(`SELECT COUNT(*) count FROM fx_artifact_registry
      WHERE artifact_handle_id='artifact-run-owned'`).get().count, 0);
  } finally { close(value); }
});

test('Formation Reset reverse-discovers orphan Foundation Work, Workspace, and Artifact after the business root is gone', () => {
  const value = fixture('helix-formation-reset-reverse-orphans');
  try {
    const workspaceId = canonicalDigest({ workspace:'reverse-orphan' });
    const work = seedExecution(value.database, 'libra', 'libra_run', 'missing-run-reverse-orphan', 'reverse-orphan');
    value.database.prepare(`INSERT INTO fx_workspace_registry
      (workspace_id,owner_domain,process_type,process_id,state,created_at_ms)
      VALUES (?,'libra','libra_run','missing-run-reverse-orphan','active',1)`).run(workspaceId);
    value.database.prepare(`INSERT INTO fx_artifact_registry
      (artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,digest_algorithm,
       digest_hex,size_bytes,reference_revision,state,created_at_ms)
      VALUES ('artifact-reverse-orphan','nfo','libra','libra_run','missing-run-reverse-orphan','sha256',?,1,1,'active',1)`)
      .run(DIGEST);
    fs.mkdirSync(path.join(value.transcodeDir, workspaceId));
    const plan = inspectPlan(value.database);
    assert.equal(plan.scope.works.some((row) => row.work_id === work.workId), true);
    assert.equal(plan.scope.workspaceIds.includes(workspaceId), true);
    assert.equal(plan.scope.artifactIds.includes('artifact-reverse-orphan'), true);
    applyReset({ database:value.database, dataDir:value.dataDir, transcodeDir:value.transcodeDir, nowMs:5150 });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?').get(work.workId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_workspace_registry WHERE workspace_id=?').get(workspaceId).count, 0);
    assert.equal(value.database.prepare(`SELECT COUNT(*) count FROM fx_artifact_registry
      WHERE artifact_handle_id='artifact-reverse-orphan'`).get().count, 0);
    assert.equal(fs.existsSync(path.join(value.transcodeDir, workspaceId)), false);
  } finally { close(value); }
});

test('Formation Reset removes a new unfinished Intake and Run without deleting the Subject older committed chain', () => {
  const value = fixture('helix-formation-reset-retained-subject');
  try {
    const kept = seedSubjectRun(value.database, 'retained-subject', 'completed');
    const keptPackage = 'package-retained-subject', keptCustody = 'custody-retained-subject';
    const keptOnDeck = 'on-deck-retained-subject';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,'offer-retained-old',1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(keptPackage,kept.runId,kept.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,?,?,'committed',1)`).run(keptCustody,keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms,terminal_at_ms)
      VALUES (?,?,'committed',1,2)`).run(keptOnDeck,keptCustody);
    value.database.prepare(`INSERT INTO arca_shelf_entries(shelf_entry_id,status,created_at_ms)
      VALUES ('entry-retained-subject','active',1)`).run();
    value.database.prepare(`INSERT INTO arca_ondeck_commit_receipts
      (receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,commit_digest,committed_at_ms)
      VALUES ('commit-retained-subject',?,'entry-retained-subject',1,1,?,2)`).run(keptOnDeck,DIGEST);

    const intakeDecisionId = 'intake-retained-new';
    const oldContinuity = DIGEST;
    const newContinuity = 'b'.repeat(64), newEpisode = 'c'.repeat(64);
    value.database.prepare(`INSERT INTO libra_intake_decisions
      (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,package_revision,
       package_digest,target_subject_id,accepted_result,expected_target_status,expected_target_intake_revision,
       expected_target_continuity_set_digest,expected_target_episode_scope_digest,committed_target_intake_revision,
       committed_subject_continuity_set_digest,committed_subject_episode_scope_digest,decision_digest,decided_at_ms,
       candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
       decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest)
      VALUES (?,1,'accepted_resolution','offer-retained-new','candidate-retained-new',1,?,?,'season_extension',
       'active',1,?,?,2,?,?,?,3,'snapshot','{}','identity','{}',?)`)
      .run(intakeDecisionId,DIGEST,kept.subjectId,oldContinuity,DIGEST,newContinuity,newEpisode,DIGEST,DIGEST);
    value.database.prepare(`UPDATE libra_subjects SET intake_revision=2,current_continuity_set_digest=?,
      current_episode_scope_digest=? WHERE subject_id=?`).run(newContinuity,newEpisode,kept.subjectId);
    value.database.prepare(`INSERT INTO libra_handoff_a_receipts
      (receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,
       subject_id,subject_intake_revision,subject_continuity_head_revision,committed_at_ms)
      VALUES ('receipt-retained-new',?,'accepted','offer-retained-new','candidate-retained-new',1,?,?,2,2,3)`)
      .run(intakeDecisionId,DIGEST,kept.subjectId);
    const newRunId = 'run-retained-new';
    const newState = { libraRunId:newRunId,stateRevision:1,state:'active',acceptanceSpecId:null,
      executionBasisDigest:DIGEST,runScopeDigest:DIGEST,priorityClass:'normal',priorityIntentDigest:DIGEST,
      transitionKind:'admitted',transitionEvidenceDigest:DIGEST };
    value.database.prepare(`INSERT INTO libra_runs
      (libra_run_id,subject_id,admission_revision,execution_basis_record_json,execution_basis_digest,
       run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,recovery_attempt_ordinal,created_at_ms)
      VALUES (?,?,2,'{}',?,?,'active',1,?,'normal',?,0,3)`)
      .run(newRunId,kept.subjectId,DIGEST,DIGEST,runStateDigest(newState),DIGEST);
    value.database.prepare(`INSERT INTO libra_predeck_pipeline_tokens
      (subject_id,source_field_id,source_process_id,acquired_at_ms)
      VALUES (?,'field-retained-new',?,3)`).run(kept.subjectId,intakeDecisionId);
    seedExecution(value.database, 'libra', 'libra_run', newRunId, 'retained-new');

    const plan = inspectPlan(value.database);
    assert.deepEqual(plan.scope.runIds, [newRunId]);
    assert.equal(plan.scope.intakeDecisionIds.includes(intakeDecisionId), true);
    const retirement=inspectRetirementPlan(value.database);
    assert.deepEqual(retirement.subjects.map(row=>row.subject_id),[kept.subjectId]);
    assert.deepEqual(retirement.runs.map(row=>row.libra_run_id),[newRunId]);
    assert.deepEqual(retirement.preserved.runs.map(row=>row.libra_run_id),[kept.runId]);
    assert.deepEqual(retirement.preserved.committedPackages.map(row=>row.on_deck_package_id),[keptPackage]);
    assert.deepEqual(retirement.custodies,[]);
    assert.deepEqual(retirement.onDeckRuns,[]);
    applyReset({ database:value.database, dataDir:value.dataDir, transcodeDir:value.transcodeDir, nowMs:5200 });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_runs WHERE libra_run_id=?').get(newRunId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_intake_decisions WHERE intake_decision_id=?')
      .get(intakeDecisionId).count, 0);
    assert.deepEqual(value.database.prepare(`SELECT intake_revision,current_continuity_set_digest,
      current_episode_scope_digest FROM libra_subjects WHERE subject_id=?`).get(kept.subjectId), {
      intake_revision:1, current_continuity_set_digest:oldContinuity, current_episode_scope_digest:DIGEST,
    });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_commit_receipts WHERE on_deck_run_id=?')
      .get(keptOnDeck).count, 1);
  } finally { close(value); }
});

test('full safe Formation Reset preserves retained Subject routing-anchor Intake referenced by uncommitted Run materials', () => {
  const value = fixture('helix-formation-reset-retained-routing-anchor');
  try {
    const kept = seedSubjectRun(value.database, 'anchor-kept', 'completed');
    const foundingIntake = 'intake-anchor-founding';
    const extensionIntake = 'intake-anchor-extension';
    const keptPackage = 'package-anchor-kept', keptCustody = 'custody-anchor-kept';
    const keptOnDeck = 'on-deck-anchor-kept';
    const newRunId = 'run-anchor-new';
    const newManifestId = 'manifest-anchor-new';
    const oldContinuity = DIGEST;
    const newContinuity = 'd'.repeat(64), newEpisode = 'e'.repeat(64);

    value.database.transaction(() => {
      value.database.pragma('defer_foreign_keys = ON');
      value.database.prepare(`INSERT INTO libra_intake_decisions
        (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,package_revision,
         package_digest,target_subject_id,accepted_result,decision_digest,decided_at_ms,
         candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
         decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest)
        VALUES (?,1,'accepted_resolution','offer-anchor-founding','candidate-anchor-founding',1,?,?,'new_subject',?,1,
          'snapshot','{}','identity','{}',?)`)
        .run(foundingIntake,DIGEST,kept.subjectId,DIGEST,DIGEST);
      value.database.prepare('UPDATE libra_subjects SET routing_anchor_intake_decision_id=? WHERE subject_id=?')
        .run(foundingIntake,kept.subjectId);
      value.database.prepare(`INSERT INTO libra_handoff_a_receipts
        (receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,
         subject_id,subject_intake_revision,subject_continuity_head_revision,committed_at_ms)
        VALUES ('receipt-anchor-founding',?,'accepted','offer-anchor-founding','candidate-anchor-founding',1,?,?,1,1,1)`)
        .run(foundingIntake,DIGEST,kept.subjectId);
      value.database.prepare(`INSERT INTO libra_material_bindings
        (subject_id,material_key,role,authority_kind,binding_revision,health_state,origin_intake_decision_id,current)
        VALUES (?,?,'primary_payload','primary_control',1,'active',?,1)`)
        .run(kept.subjectId,'material-anchor-founding',foundingIntake);
    })();

    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,'offer-anchor-kept',1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(keptPackage,kept.runId,kept.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,?,?,'committed',1)`).run(keptCustody,keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms,terminal_at_ms)
      VALUES (?,?,'committed',1,2)`).run(keptOnDeck,keptCustody);
    value.database.prepare(`INSERT INTO arca_shelf_entries(shelf_entry_id,status,created_at_ms)
      VALUES ('entry-anchor-kept','active',1)`).run();
    value.database.prepare(`INSERT INTO arca_ondeck_commit_receipts
      (receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,commit_digest,committed_at_ms)
      VALUES ('commit-anchor-kept',?,'entry-anchor-kept',1,1,?,2)`).run(keptOnDeck,DIGEST);

    value.database.prepare(`INSERT INTO libra_intake_decisions
      (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,package_revision,
       package_digest,target_subject_id,accepted_result,expected_target_status,expected_target_intake_revision,
       expected_target_continuity_set_digest,expected_target_episode_scope_digest,committed_target_intake_revision,
       committed_subject_continuity_set_digest,committed_subject_episode_scope_digest,decision_digest,decided_at_ms,
       candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
       decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest)
      VALUES (?,1,'accepted_resolution','offer-anchor-extension','candidate-anchor-extension',1,?,?,'season_extension',
       'active',1,?,?,2,?,?,?,3,'snapshot','{}','identity','{}',?)`)
      .run(extensionIntake,DIGEST,kept.subjectId,oldContinuity,DIGEST,newContinuity,newEpisode,DIGEST,DIGEST);
    value.database.prepare(`UPDATE libra_subjects SET intake_revision=2,current_continuity_set_digest=?,
      current_episode_scope_digest=? WHERE subject_id=?`).run(newContinuity,newEpisode,kept.subjectId);
    value.database.prepare(`INSERT INTO libra_handoff_a_receipts
      (receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,
       subject_id,subject_intake_revision,subject_continuity_head_revision,committed_at_ms)
      VALUES ('receipt-anchor-extension',?,'accepted','offer-anchor-extension','candidate-anchor-extension',1,?,?,2,2,3)`)
      .run(extensionIntake,DIGEST,kept.subjectId);

    const newState = { libraRunId:newRunId,stateRevision:1,state:'active',acceptanceSpecId:null,
      executionBasisDigest:DIGEST,runScopeDigest:DIGEST,priorityClass:'normal',priorityIntentDigest:DIGEST,
      transitionKind:'admitted',transitionEvidenceDigest:DIGEST };
    value.database.prepare(`INSERT INTO libra_runs
      (libra_run_id,subject_id,admission_revision,execution_basis_record_json,execution_basis_digest,
       run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,recovery_attempt_ordinal,created_at_ms)
      VALUES (?,?,2,'{}',?,?,'active',1,?,'normal',?,0,3)`)
      .run(newRunId,kept.subjectId,DIGEST,DIGEST,runStateDigest(newState),DIGEST);
    value.database.prepare(`INSERT INTO libra_run_material_manifests
      (run_material_manifest_id,libra_run_id,manifest_role,scope_kind,manifest_revision,member_count,
       member_set_digest,manifest_digest,published_at_ms)
      VALUES (?,?,'run_input','single',1,2,?,?,3)`).run(newManifestId,newRunId,DIGEST,DIGEST);
    value.database.prepare('UPDATE libra_runs SET run_material_manifest_id=? WHERE libra_run_id=?')
      .run(newManifestId,newRunId);
    value.database.prepare(`INSERT INTO libra_run_material_members
      (run_material_manifest_id,ordinal,material_key,role,size_bytes,member_digest,origin_intake_decision_id)
      VALUES (?,0,'material-anchor-founding','primary_payload',1,?,?),
             (?,1,'material-anchor-extension','primary_payload',1,?,?)`)
      .run(newManifestId,DIGEST,foundingIntake,newManifestId,DIGEST,extensionIntake);
    value.database.prepare(`INSERT INTO libra_predeck_pipeline_tokens
      (subject_id,source_field_id,source_process_id,acquired_at_ms)
      VALUES (?,'field-anchor-new',?,3)`).run(kept.subjectId,foundingIntake);
    seedExecution(value.database, 'libra', 'libra_run', newRunId, 'anchor-new');

    const plan = inspectPlan(value.database);
    assert.equal(plan.ready, true);
    assert.equal(plan.blockers.some((row) => row.code === 'RETAINED_SUBJECT_ROUTING_ANCHOR_IN_RESET'), false);
    assert.deepEqual(plan.scope.preservedRoutingAnchorIntakeIds, [foundingIntake]);
    assert.equal(plan.counts.preservedRoutingAnchorIntakes, 1);
    assert.equal(plan.scope.intakeDecisionIds.includes(foundingIntake), false);
    assert.equal(plan.scope.intakeDecisionIds.includes(extensionIntake), true);
    assert.deepEqual(plan.scope.runIds, [newRunId]);
    assert.equal(plan.scope.disposableSubjectIds.includes(kept.subjectId), false);
    assert.equal(plan.scope.resetSubjectIds.includes(kept.subjectId), true);

    applyReset({ database:value.database, dataDir:value.dataDir, transcodeDir:value.transcodeDir, nowMs:5400 });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_runs WHERE libra_run_id=?').get(newRunId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_intake_decisions WHERE intake_decision_id=?')
      .get(extensionIntake).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_intake_decisions WHERE intake_decision_id=?')
      .get(foundingIntake).count, 1);
    assert.deepEqual(value.database.prepare(`SELECT subject_id,routing_anchor_intake_decision_id,intake_revision,
      current_continuity_set_digest,current_episode_scope_digest FROM libra_subjects WHERE subject_id=?`)
      .get(kept.subjectId), {
      subject_id:kept.subjectId, routing_anchor_intake_decision_id:foundingIntake, intake_revision:1,
      current_continuity_set_digest:oldContinuity, current_episode_scope_digest:DIGEST,
    });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_material_bindings WHERE subject_id=? AND origin_intake_decision_id=?')
      .get(kept.subjectId,foundingIntake).count, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_commit_receipts WHERE on_deck_run_id=?')
      .get(keptOnDeck).count, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_predeck_pipeline_tokens WHERE subject_id=?')
      .get(kept.subjectId).count, 0);
  } finally { close(value); }
});

test('Formation Reset process scoping does not delete a Work with a colliding ID in another typed scope', () => {
  const value = fixture('helix-formation-reset-typed-collision');
  try {
    const seeded = seedSubjectRun(value.database, 'typed-collision');
    const target = seedExecution(value.database, 'libra', 'libra_run', seeded.runId, 'typed-target');
    const unrelated = seedExecution(value.database, 'arca', 'arca_shelf_entry', seeded.runId, 'typed-unrelated');
    applyReset({ database:value.database, dataDir:value.dataDir, transcodeDir:value.transcodeDir, nowMs:5300 });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?').get(target.workId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?').get(unrelated.workId).count, 1);
  } finally { close(value); }
});

test('the frozen-manifest verifier catches an Artifact omitted by discovery', () => {
  const value = fixture('helix-formation-reset-independent-verifier');
  try {
    value.database.prepare(`INSERT INTO fx_artifact_registry
      (artifact_handle_id,artifact_kind,owner_domain,owner_scope_type,owner_scope_id,digest_algorithm,
       digest_hex,size_bytes,reference_revision,state,created_at_ms)
      VALUES ('artifact-verifier-omission','nfo','libra','libra_run','run-verifier-omission','sha256',?,1,1,'active',1)`)
      .run(DIGEST);
    const emptyGraph = { workIds:[],attemptIds:[],planIds:[],eventIds:[],eventAttemptIds:[],resultIds:[],
      markerIds:[],messageIds:[],auditIds:[],commandReceiptIds:[] };
    const scope = { usAdultAnalysisIds:[],usAdultActorChoiceIntentIds:[],usAdultActorChoiceHeadSubjectIds:[],disposableSubjectIds:[],intakeDecisionIds:[],runIds:[],workspaceIds:[],packageIds:[],
      acceptanceAttemptIds:[],acceptanceDecisionIds:[],custodyIds:[],onDeckRunIds:[],artifactIds:[],
      processScopes:[],factScopes:[],materialKeys:[],handoffAOfferIds:[],
      phantomLibraAdmissionReceiptIds:[],orphanPipelineAdmissionReceiptIds:[],
      ownerScopes:[{ ownerDomain:'libra',scopeType:'libra_run',scopeId:'run-verifier-omission' }] };
    assert.throws(() => verifyFrozenManifest(value.database, { scope, graph:emptyGraph }), (error) =>
      error.message === 'FORMATION_RESET_RESIDUAL' && error.details.typedOwnerArtifacts.length === 1);
  } finally { close(value); }
});

test('scoped Reset preserves another active run, its execution graph and Workspace files', () => {
  const value=fixture('helix-scoped-reset');
  try {
    const target=seedSubjectRun(value.database,'selected','frozen');
    const other=seedSubjectRun(value.database,'protected');
    seedExecution(value.database,'libra','libra_run',target.runId,'selected');
    seedExecution(value.database,'libra','libra_run',other.runId,'protected');
    seedExecution(value.database,'libra','libra_run','orphan-outside-scope','unrelated-orphan');
    const protectedDir=path.join(value.transcodeDir,other.workspaceId);
    fs.mkdirSync(protectedDir,{recursive:true});fs.writeFileSync(path.join(protectedDir,'movie.mkv'),'preserve');
    const tables=['libra_runs','libra_workspaces','fx_supporting_works','fx_workflow_events','fx_event_attempts'];
    const before=Object.fromEntries(tables.map(table=>[table,value.database.prepare(`SELECT * FROM ${table}`).all()
      .filter(row=>JSON.stringify(row).includes('protected')||row.workspace_id===other.workspaceId)]));
    const subjectIds=[target.subjectId];
    const plan=inspectPlan(value.database,{subjectIds});
    assert.deepEqual(plan.scope.runIds,[target.runId]);
    assert.equal(plan.scope.works.length,1);
    applyReset({...value,subjectIds,nowMs:6000});
    for(const table of tables){const rows=value.database.prepare(`SELECT * FROM ${table}`).all();
      for(const row of before[table])assert.ok(rows.some(current=>JSON.stringify(current)===JSON.stringify(row)),table);}
    assert.equal(fs.readFileSync(path.join(protectedDir,'movie.mkv'),'utf8'),'preserve');
    assert.equal(inspectPlan(value.database,{subjectIds}).counts.runs,0);
    assert.throws(()=>inspectPlan(value.database,{subjectIds:[]}),/SCOPE_INVALID/);
  }finally{close(value);}
});

function seedOrphanCustodyControl(database, key, custodyId) {
  database.prepare("INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms) VALUES (?,'mount',?,1,'middle','1','fingerprint','arca','on_deck_custody',?,1,'controlled',1)").run(key,key,custodyId);
  database.prepare("INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms) VALUES (?,1,'transfer','arca','on_deck_custody',?,?,'orphan-'||?,1)").run(key,custodyId,DIGEST,key);
}

test('exact orphan custody cleanup removes only detached control and preserves unrelated runs',()=>{
  const value=fixture('orphan-custody-reset');
  try {
    const kept=seedSubjectRun(value.database,'keep-orphan-test');
    seedOrphanCustodyControl(value.database,'placed-detached','gone-custody');
    seedOrphanCustodyControl(value.database,'placed-unselected','other-gone-custody');
    const scope={orphanCustodyIds:['gone-custody']};
    const plan=inspectPlan(value.database,scope);
    assert.equal(plan.ready,true);
    assert.deepEqual(plan.scope.runIds,[]);
    assert.deepEqual(plan.scope.materialKeys,['placed-detached']);
    const result=applyReset({database:value.database,dataDir:value.dataDir,
      transcodeDir:process.platform==='linux'?'/transcode':value.transcodeDir,...scope});
    assert.equal(result.verification.integrity,'ok');
    assert.equal(value.database.prepare('SELECT COUNT(*) n FROM fx_material_controls WHERE material_key=?').get('placed-detached').n,0);
    assert.equal(value.database.prepare('SELECT COUNT(*) n FROM fx_material_controls WHERE material_key=?').get('placed-unselected').n,1);
    assert.equal(value.database.prepare('SELECT COUNT(*) n FROM libra_runs WHERE libra_run_id=?').get(kept.runId).n,1);
    assert.equal(inspectPlan(value.database,scope).scope.materialKeys.length,0);
  } finally {close(value);}
});

test('orphan custody scope refuses invalid ids and a custody that still exists',()=>{
  const value=fixture('orphan-custody-guard');
  try {
    for(const orphanCustodyIds of [null,false,'gone-custody',[],['../outside'],new Array(17).fill('x')])
      assert.throws(()=>inspectPlan(value.database,{orphanCustodyIds}),/FORMATION_RESET_ORPHAN_CUSTODY_SCOPE_INVALID/);
    value.database.pragma('foreign_keys = OFF');
    value.database.prepare("INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms) VALUES ('live-custody','decision','package',?,'active',1)").run(DIGEST);
    assert.throws(()=>inspectPlan(value.database,{orphanCustodyIds:['live-custody']}),/FORMATION_RESET_CUSTODY_NOT_ORPHAN/);
  } finally {close(value);}
});

test('orphan cleanup refuses any material already recorded in Shelf Inventory',()=>{
  const value=fixture('orphan-custody-inventory');
  try {
    seedOrphanCustodyControl(value.database,'inventory-material','gone-custody');
    value.database.pragma('foreign_keys = OFF');
    value.database.prepare("INSERT INTO arca_inventory_materials(shelf_entry_id,inventory_revision,ordinal,material_key,role,episode_claims_json) VALUES ('entry',1,0,'inventory-material','primary_payload','[]')").run();
    assert.throws(()=>inspectPlan(value.database,{orphanCustodyIds:['gone-custody']}),/FORMATION_RESET_ORPHAN_CUSTODY_INVENTORY_PROTECTED/);
  } finally {close(value);}
});


test('scoped Reset removes selected Run outcomes and preserves outcomes outside its scope', () => {
  const value=fixture('reset-run-outcomes');
  try {
    const target=seedSubjectRun(value.database,'outcome-selected','completed');
    const other=seedSubjectRun(value.database,'outcome-protected','completed');
    for(const run of [target,other])value.database.prepare(
      "INSERT INTO libra_run_outcomes(libra_run_id,subject_id,outcome,outcome_json) VALUES (?,?,'unable_to_on_deck','{}')"
    ).run(run.runId,run.subjectId);
    const before=value.database.prepare('SELECT * FROM libra_run_outcomes WHERE libra_run_id=?').get(other.runId);
    const subjectIds=[target.subjectId];
    assert.equal(inspectPlan(value.database,{subjectIds}).ready,true);
    applyReset({...value,subjectIds,transcodeDir:null,nowMs:7000});
    assert.deepEqual(value.database.prepare('SELECT * FROM libra_run_outcomes').all(),[before]);
    assert.deepEqual(value.database.pragma('foreign_key_check'),[]);
    applyReset({...value,subjectIds,transcodeDir:null,nowMs:7001});
    assert.deepEqual(value.database.prepare('SELECT * FROM libra_run_outcomes').all(),[before]);
  }finally{close(value);}
});


test('scoped Reset removes frozen US Adult analysis and actor choice leaves while protecting unrelated history',()=>{
  const f=fixture('reset-us-adult-leaves');
  try{
    const chosen=seedSubjectRun(f.database,'chosen-us-adult'),history=seedSubjectRun(f.database,'preserved-us-adult','discarded'),
      tables=['libra_us_adult_analysis_bases','libra_us_adult_match_completions','libra_us_adult_actor_choice_intents','libra_us_adult_actor_choice_heads'];
    for(const item of [chosen,history]){
      f.database.prepare('INSERT INTO libra_us_adult_analysis_bases(analysis_id,libra_run_id,subject_id,workspace_id) VALUES(?,?,?,?)').run('analysis-'+item.runId,item.runId,item.subjectId,item.workspaceId);
      f.database.prepare('INSERT INTO libra_us_adult_reference_pages(analysis_id,page_ordinal) VALUES(?,0)').run('analysis-'+item.runId);
      f.database.prepare('INSERT INTO libra_us_adult_match_completions(analysis_id,libra_run_id,subject_id) VALUES(?,?,?)').run('analysis-'+item.runId,item.runId,item.subjectId);
      f.database.prepare('INSERT INTO libra_us_adult_actor_choice_intents(intent_id,libra_run_id,subject_id,choice_revision) VALUES(?,?,?,1)').run('choice-'+item.runId,item.runId,item.subjectId);
      f.database.prepare('INSERT INTO libra_us_adult_actor_choice_heads(subject_id,current_revision,intent_id) VALUES(?,1,?)').run(item.subjectId,'choice-'+item.runId);
    }
    const pages=f.database.prepare('SELECT * FROM libra_us_adult_reference_pages WHERE analysis_id=?').all('analysis-'+history.runId);
    const before=tables.map(table=>f.database.prepare('SELECT * FROM '+table+' WHERE subject_id=?').all(history.subjectId)),plan=inspectPlan(f.database,{subjectIds:[chosen.subjectId]});
    assert.equal(plan.ready,true);assert.deepEqual(plan.scope.usAdultAnalysisIds,['analysis-'+chosen.runId]);
    assert.deepEqual(plan.scope.usAdultActorChoiceIntentIds,['choice-'+chosen.runId]);
    const result=applyReset({database:f.database,dataDir:f.dataDir,transcodeDir:f.transcodeDir,subjectIds:[chosen.subjectId]});
    assert.equal(f.database.prepare('SELECT count(*) n FROM libra_us_adult_reference_pages WHERE analysis_id=?').get('analysis-'+chosen.runId).n,0);
    assert.deepEqual(f.database.prepare('SELECT * FROM libra_us_adult_reference_pages WHERE analysis_id=?').all('analysis-'+history.runId),pages);
    assert.equal(result.result.deletedRuns,1);assert.deepEqual(f.database.pragma('foreign_key_check'),[]);
    for(const [index,table] of tables.entries()){
      assert.equal(f.database.prepare('SELECT count(*) n FROM '+table+' WHERE subject_id=?').get(chosen.subjectId).n,0);
      assert.deepEqual(f.database.prepare('SELECT * FROM '+table+' WHERE subject_id=?').all(history.subjectId),before[index]);
    }
    f.database.prepare('INSERT INTO libra_us_adult_analysis_bases(analysis_id) VALUES(?)').run('analysis-'+chosen.runId);
    assert.throws(()=>verifyFrozenManifest(f.database,{scope:plan.scope,graph:{workIds:[],attemptIds:[],planIds:[],eventIds:[],eventAttemptIds:[],resultIds:[],markerIds:[],messageIds:[],auditIds:[],commandReceiptIds:[],recoveryReservations:[]}}),error=>error.message==='FORMATION_RESET_RESIDUAL'&&error.details.libra_us_adult_analysis_bases.length===1);
  }finally{close(f);}
});

test('scoped Reset refuses US Adult leaves claiming another Subject',()=>{
  const f=fixture('reset-us-adult-foreign-owner');
  try{
    const chosen=seedSubjectRun(f.database,'selected'),other=seedSubjectRun(f.database,'foreign');
    f.database.prepare('INSERT INTO libra_us_adult_analysis_bases(analysis_id,libra_run_id,subject_id,workspace_id) VALUES(?,?,?,?)').run('cross-owner',chosen.runId,other.subjectId,other.workspaceId);
    assert.ok(inspectPlan(f.database,{subjectIds:[chosen.subjectId]}).blockers.some(row=>row.code==='US_ADULT_RESET_SCOPE_CONFLICT'));
    assert.throws(()=>applyReset({database:f.database,dataDir:f.dataDir,subjectIds:[chosen.subjectId]}),/FORMATION_RESET_BLOCKED/);
    assert.equal(f.database.prepare('SELECT count(*) n FROM libra_runs').get().n,2);
  }finally{close(f);}
});
