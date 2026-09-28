'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../src/helix/foundation/persistence/ddl-compiler');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const {
  SOURCE_GENERATION,
  SOURCE_SCHEMA_DIGEST,
  INTERMEDIATE_GENERATION,
  INTERMEDIATE_SCHEMA_DIGEST,
  TARGET_GENERATION,
  TARGET_SCHEMA_DIGEST,
  PRE_UAT_EXECUTION_CATALOG_DIGEST,
  PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,
  PRE_FORMATION_THREE_STATE_SCHEMA_DIGEST,
  PRE_CASE_ADMISSION_SCHEMA_DIGEST,
  INTAKE_BINDING_REPLAN_CODE,
  PRE_PROJECTION_PLAN_REPLAN_CODE,
  migrateUatIdentitySelectionSchema,
} = require('../src/helix/foundation/persistence/uat-identity-selection-migration');

const generatedRoot = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

test('UAT-215 adds only an empty cleanup responsibility table to the exact production schema',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-cleanup-upgrade-')),databasePath=path.join(root,'shelfdeck.db');
  let db,check,kernel;
  try{
    const oldDdl=schemaDdl.replace(/CREATE TABLE "arca_source_cleanup_checks" \([\s\S]*?\n\);\nCREATE INDEX "idx_arca_source_cleanup_checks_hot_01"[^\n]*\n/,'');
    assert.notEqual(oldDdl,schemaDdl);
    db=new Database(databasePath);db.exec(oldDdl);
    db.prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status) VALUES('keep-entry','active')").run();
    db.prepare("INSERT INTO arca_inventory_representations(shelf_entry_id,revision) VALUES('keep-entry',7)").run();
    db.prepare("UPDATE arca_shelf_entries SET current_inventory_revision=7 WHERE shelf_entry_id='keep-entry'").run();
    db.prepare("INSERT INTO libra_runs(libra_run_id,state) VALUES('keep-in-flight','active')").run();
    db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
      .run('shelfdeck',TARGET_GENERATION,require('../src/helix/foundation/persistence/uat-identity-selection-migration').PRE_SOURCE_CLEANUP_SCHEMA_DIGEST,digest(catalogRows(db)),100);
    const beforeEntry=db.prepare('SELECT * FROM arca_shelf_entries').all(),beforeRuns=db.prepare('SELECT * FROM libra_runs').all();db.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,true);
    check=new Database(databasePath);
    assert.deepEqual(check.prepare('SELECT * FROM arca_shelf_entries').all(),beforeEntry);
    assert.deepEqual(check.prepare('SELECT * FROM libra_runs').all(),beforeRuns);
    assert.equal(check.prepare('SELECT count(*) n FROM arca_source_cleanup_checks').get().n,0);
    assert.deepEqual(check.pragma('foreign_key_check'),[]);check.close();
    kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});kernel.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,false);
  }finally{if(db?.open)db.close();if(check?.open)check.close();kernel?.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('UAT-213 adds empty Target Binding history without inventing prior targets',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-target-binding-upgrade-')),databasePath=path.join(root,'shelfdeck.db');
  let db,check,kernel;
  try{
    const oldDdl=schemaDdl.replace(/CREATE TABLE "arca_shelf_target_bindings" \([\s\S]*?\n\);\nCREATE INDEX "idx_arca_shelf_target_bindings_hot_01"[^\n]*\n/,'');
    assert.notEqual(oldDdl,schemaDdl);
    db=new Database(databasePath);db.exec(oldDdl);
    db.prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status) VALUES('keep-entry','active')").run();
    db.prepare("INSERT INTO arca_inventory_representations(shelf_entry_id,revision) VALUES('keep-entry',7)").run();
    db.prepare("UPDATE arca_shelf_entries SET current_inventory_revision=7 WHERE shelf_entry_id='keep-entry'").run();
    db.prepare("INSERT INTO libra_runs(libra_run_id,state) VALUES('keep-in-flight','active')").run();
    db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
      .run('shelfdeck',TARGET_GENERATION,require('../src/helix/foundation/persistence/uat-identity-selection-migration').PRE_TARGET_BINDING_SCHEMA_DIGEST,digest(catalogRows(db)),100);
    const beforeEntry=db.prepare('SELECT * FROM arca_shelf_entries').all(),beforeRuns=db.prepare('SELECT * FROM libra_runs').all();db.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,true);
    check=new Database(databasePath);
    assert.deepEqual(check.prepare('SELECT * FROM arca_shelf_entries').all(),beforeEntry);
    assert.deepEqual(check.prepare('SELECT * FROM libra_runs').all(),beforeRuns);
    assert.equal(check.prepare('SELECT count(*) n FROM arca_shelf_target_bindings').get().n,0);
    assert.deepEqual(check.pragma('foreign_key_check'),[]);check.close();
    kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});kernel.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,false);
  }finally{if(db?.open)db.close();if(check?.open)check.close();kernel?.close();fs.rmSync(root,{recursive:true,force:true});}
});

function catalogRows(database) {
  return database.prepare(
    "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name",
  ).all().map((row) => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
}

test('Case admission upgrades the prior constraint, preserves rows and references, and replays safely', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-case-admission-upgrade-'));
  const databasePath=path.join(root,'shelfdeck.db');
  const oldDdl=schemaDdl.replace("'queued', 'active', 'resolved', 'invalidated', 'unresolved'", "'active', 'resolved', 'invalidated', 'unresolved'");
  try {
    const db=new Database(databasePath);
    db.exec(oldDdl);
    db.exec('DROP INDEX uidx_fx_event_result_bindings_partial_01; CREATE UNIQUE INDEX uidx_fx_event_result_bindings_partial_01 ON fx_event_result_bindings(event_id) WHERE 1 = 1');
    db.exec('DROP TABLE arca_recycle_entries');
    for(const name of ['idx_fx_supporting_works_hot_02','idx_fx_supporting_works_hot_03','idx_fx_workflow_events_hot_02','idx_proc_run_materials_hot_01'])db.exec('DROP INDEX '+name);
    db.prepare('INSERT INTO arca_aftercare_cases(aftercare_case_id,state) VALUES(?,?)').run('preserved-case','active');
    db.prepare('INSERT INTO fx_audit_records(audit_id,occurred_at_ms) VALUES(?,?)').run('preserved-fact',100);
    db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
      .run('shelfdeck',TARGET_GENERATION,PRE_CASE_ADMISSION_SCHEMA_DIGEST,digest(catalogRows(db)),100);
    db.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,true);
    const check=new Database(databasePath);
    assert.equal(check.prepare('SELECT COUNT(*) n FROM arca_recycle_entries').get().n,0);
    assert.match(check.prepare('EXPLAIN QUERY PLAN SELECT result_json FROM fx_event_result_bindings WHERE event_id=?').get('event').detail,/USING INDEX/);
    for(const [table,column] of [['fx_supporting_works','process_id'],['fx_supporting_works','state'],['fx_workflow_events','work_id'],['proc_run_materials','candidate_package_id']]){
      assert.match(check.prepare('EXPLAIN QUERY PLAN SELECT * FROM '+table+' WHERE '+column+'=?').get('scope').detail,/USING INDEX/);
    }
    assert.equal(check.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get('preserved-case').state,'active');
    check.prepare('INSERT INTO arca_aftercare_cases(aftercare_case_id,state) VALUES(?,?)').run('new-case','queued');
    assert.equal(check.prepare('SELECT COUNT(*) n FROM fx_audit_records').get().n,1);
    assert.deepEqual(check.pragma('foreign_key_check'),[]);
    assert.equal(check.pragma('integrity_check',{simple:true}),'ok');
    check.close();
    assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,false);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

function sourceFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-uat-schema-migration-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 100 });
  kernel.close();
  const database = new Database(databasePath);
  database.exec('DROP TABLE arca_acceptance_recovery_cases');
  database.exec('DROP TABLE fx_executor_incidents');
  database.exec('DROP TABLE libra_product_identity_selection_intents');
  database.exec('DROP TABLE libra_formation_projections');
  database.prepare('INSERT INTO fx_audit_records(audit_id,occurred_at_ms) VALUES(?,?)').run('preserved-audit', 101);
  const sourceCatalogDigest = digest(catalogRows(database));
  database.prepare(
    'UPDATE platform_schema_marker SET generation=?,schema_digest=?,catalog_digest=?,applied_at_ms=? WHERE schema_name=?',
  ).run(SOURCE_GENERATION, SOURCE_SCHEMA_DIGEST, sourceCatalogDigest, 102, 'shelfdeck');
  database.close();
  try { return run({ root, databasePath }); } finally { fs.rmSync(root, { recursive:true, force:true }); }
}

test('the exact live v1 catalog upgrades once to v3 without changing durable business facts', () => sourceFixture(({ databasePath }) => {
  const first = migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: () => 200 });
  assert.deepEqual(first, {
    migrated:true,
    sourceSchemaDigest:SOURCE_SCHEMA_DIGEST,
    targetSchemaDigest:TARGET_SCHEMA_DIGEST,
  });
  const database = new Database(databasePath, { readonly:true });
  const marker = database.prepare(
    'SELECT generation,schema_digest FROM platform_schema_marker WHERE schema_name=?',
  ).get('shelfdeck');
  assert.deepEqual(marker, { generation:TARGET_GENERATION, schema_digest:TARGET_SCHEMA_DIGEST });
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='libra_product_identity_selection_intents'",
  ).get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_audit_records WHERE audit_id=?').get('preserved-audit').count, 1);
  assert.equal(database.pragma('integrity_check', { simple:true }), 'ok');
  database.close();
  assert.deepEqual(
    migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: () => 201 }),
    { migrated:false, reason:'already_current' },
  );
}));

test('the prior four-state Formation projection is rebuilt without changing Owner facts', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-three-state-formation-migration-'));
  const databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});kernel.close();
  try{
    const database=new Database(databasePath);
    database.prepare('INSERT INTO fx_audit_records(audit_id,occurred_at_ms) VALUES(?,?)').run('owner-fact',101);
    const sourceCatalogDigest=digest(catalogRows(database));
    database.prepare('UPDATE platform_schema_marker SET generation=?,schema_digest=?,catalog_digest=?,applied_at_ms=? WHERE schema_name=?')
      .run(TARGET_GENERATION,PRE_FORMATION_THREE_STATE_SCHEMA_DIGEST,sourceCatalogDigest,102,'shelfdeck');
    database.close();
    assert.deepEqual(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>200}),{
      migrated:true,sourceSchemaDigest:PRE_FORMATION_THREE_STATE_SCHEMA_DIGEST,targetSchemaDigest:TARGET_SCHEMA_DIGEST,
    });
    const check=new Database(databasePath,{readonly:true});
    try {
      assert.equal(check.prepare('SELECT COUNT(*) count FROM libra_formation_projections').get().count,0);
      assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_audit_records WHERE audit_id=?').get('owner-fact').count,1);
      const tableSql=check.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='libra_formation_projections'").get().sql;
      assert.match(tableSql,/"classification" TEXT CHECK \("classification" IN \('in_progress', 'attention_required', 'completed'\)\)/);
      assert.equal(check.pragma('integrity_check',{simple:true}),'ok');
    } finally { check.close(); }
  }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('the exact live v2 catalog adds the empty formation projection and executor closure stores before advancing to v3', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-formation-schema-migration-'));
  const databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});kernel.close();
  try{
    const database=new Database(databasePath);
    database.exec('DROP TABLE arca_acceptance_recovery_cases');
    database.exec('DROP TABLE fx_executor_incidents');
    database.exec('DROP TABLE libra_formation_projections');
    const sourceCatalogDigest=digest(catalogRows(database));
    database.prepare('UPDATE platform_schema_marker SET generation=?,schema_digest=?,catalog_digest=?,applied_at_ms=? WHERE schema_name=?')
      .run(INTERMEDIATE_GENERATION,INTERMEDIATE_SCHEMA_DIGEST,sourceCatalogDigest,101,'shelfdeck');
    database.close();
    assert.deepEqual(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>200}),{
      migrated:true,sourceSchemaDigest:INTERMEDIATE_SCHEMA_DIGEST,targetSchemaDigest:TARGET_SCHEMA_DIGEST,
    });
    let check=null;
    try {
      check=new Database(databasePath,{readonly:true});
      assert.equal(check.prepare('SELECT COUNT(*) count FROM libra_formation_projections').get().count,0);
      assert.equal(check.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='index' AND tbl_name='libra_formation_projections' AND name NOT LIKE 'sqlite_autoindex_%'").get().count,3);
      assert.equal(check.pragma('integrity_check',{simple:true}),'ok');
    } finally { check?.close(); }
  }finally{fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

test('an unapproved source digest is rejected before schema mutation', () => sourceFixture(({ databasePath }) => {
  const database = new Database(databasePath);
  database.prepare('UPDATE platform_schema_marker SET schema_digest=? WHERE schema_name=?')
    .run('0'.repeat(64), 'shelfdeck');
  database.close();
  assert.throws(
    () => migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest, now: () => 300 }),
    (error) => error?.code === 'UAT_MIGRATION_SOURCE_SCHEMA_UNSUPPORTED',
  );
  const check = new Database(databasePath, { readonly:true });
  assert.equal(check.prepare(
    "SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name='libra_product_identity_selection_intents'",
  ).get().count, 0);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_audit_records WHERE audit_id=?').get('preserved-audit').count, 1);
  check.close();
}));

test('an exact executing pre-correction Intake Binding attempt is retired once for Owner replan', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-uat-intake-replan-'));
  const databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});kernel.close();
  try{
    const database=new Database(databasePath),hex='1'.repeat(64);
    database.prepare(`INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,
      priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('work-1','libra','libra_intake','intake-1','acceptance',hex,'normal_foreground',
        'helix://test/work/v1','{}',hex,'running','key-1',100,100);
    database.prepare(`INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms)
      VALUES(?,?,?,?,?,?)`).run('work-attempt-1','work-1',1,hex,'running',101);
    database.prepare(`INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`).run('plan-1','work-attempt-1','planner',1,PRE_UAT_EXECUTION_CATALOG_DIGEST,hex,hex,'planned',102);
    const insertNode=database.prepare(`INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,
      input_bindings_json,parameter_schema_ref,parameters_json,when_schema_ref,when_json,effect_class,fence_schema_ref,fence_basis_json,
      resource_demand_schema_ref,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insertNode.run('plan-1','binding_resolution','libra.intake.binding.resolve@1',1,'inputs','{}','parameters','{}',null,'null',
      'pure_observation','fence','{}','demand','{}');
    insertNode.run('plan-1','acceptance_commit','libra.intake.accept.commit@1',1,'inputs','{}','parameters','{}',null,'null',
      'responsibility_control_commit','fence','{}','demand','{}');
    database.prepare(`INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,
      contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run('event-binding','plan-1','binding_resolution','work-1','work-attempt-1','libra','libra.intake.binding.resolve@1',1,'executing','normal_foreground',102);
    database.prepare(`INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,
      contract_version,state,priority_class) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run('event-accept','plan-1','acceptance_commit','work-1','work-attempt-1','libra','libra.intake.accept.commit@1',1,'pending','normal_foreground');
    database.prepare(`INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,
      input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,started_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('event-attempt-1','event-binding',1,'libra.intake.binding.resolve@1',1,'inputs',hex,hex,'executing',103);
    database.close();
    assert.deepEqual(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>200}),
      {migrated:false,reason:'already_current',retiredIntakeBindingAttempts:1});
    const check=new Database(databasePath,{readonly:true});
    assert.deepEqual(check.prepare('SELECT state,outcome_kind,failure_class,failure_code,finished_at_ms FROM fx_event_attempts WHERE event_attempt_id=?')
      .get('event-attempt-1'),{state:'completed',outcome_kind:'failed',failure_class:'contract_upgrade',failure_code:INTAKE_BINDING_REPLAN_CODE,finished_at_ms:200});
    assert.equal(check.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event-binding').state,'failed');
    assert.equal(check.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('event-accept').state,'cancelled');
    assert.deepEqual(check.prepare('SELECT state,failure_code FROM fx_work_attempts WHERE attempt_id=?').get('work-attempt-1'),
      {state:'failed',failure_code:INTAKE_BINDING_REPLAN_CODE});
    check.close();
    assert.deepEqual(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>201}),
      {migrated:false,reason:'already_current'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('pre-projection active Works retire atomically without deleting immutable execution history', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-pre-projection-retirement-'));
  const databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});kernel.close();
  try{
    const database=new Database(databasePath),hex='2'.repeat(64);
    const insertWork=database.prepare(`INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,
      priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertAttempt=database.prepare(`INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms)
      VALUES(?,?,?,?,?,?)`);
    const insertPlan=database.prepare(`INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    const insertNode=database.prepare(`INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,
      input_bindings_json,parameter_schema_ref,parameters_json,when_schema_ref,when_json,effect_class,fence_schema_ref,fence_basis_json,
      resource_demand_schema_ref,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertEvent=database.prepare(`INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,
      contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    insertWork.run('retire-intake','libra','libra_intake','intake-retire','acceptance',hex,'normal_foreground','work','{}',hex,'running','retire-intake-key',100,100);
    insertAttempt.run('retire-intake:attempt:1','retire-intake',1,hex,'running',101);
    insertPlan.run('retire-intake-plan','retire-intake:attempt:1','planner',1,PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,hex,hex,'planned',102);
    insertNode.run('retire-intake-plan','binding','libra.intake.binding.resolve@1',1,'inputs','{}','parameters','{}',null,'null','pure_observation','fence','{}','demand','{}');
    insertNode.run('retire-intake-plan','commit','libra.intake.accept.commit@1',1,'inputs','{}','parameters','{}',null,'null','responsibility_control_commit','fence','{}','demand','{}');
    insertEvent.run('retire-intake-binding','retire-intake-plan','binding','retire-intake','retire-intake:attempt:1','libra','libra.intake.binding.resolve@1',1,'executing','normal_foreground',102);
    insertEvent.run('retire-intake-commit','retire-intake-plan','commit','retire-intake','retire-intake:attempt:1','libra','libra.intake.accept.commit@1',1,'pending','normal_foreground',null);
    database.prepare(`INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,
      input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,started_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('retire-intake-event-attempt','retire-intake-binding',1,'libra.intake.binding.resolve@1',1,'inputs',hex,hex,'executing',103);
    insertWork.run('retire-perception','perception','perception_resolution','subject:retire','resolution',hex,'normal_foreground','work','{}',hex,'running','retire-perception-key',100,100);
    insertAttempt.run('retire-perception:attempt:1','retire-perception',1,hex,'running',101);
    insertPlan.run('retire-perception-plan','retire-perception:attempt:1','planner',1,PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,hex,hex,'planned',102);
    insertNode.run('retire-perception-plan','dedup','perception.dedup.resolve@1',1,'inputs','{}','parameters','{}',null,'null','pure_observation','fence','{}','demand','{}');
    insertNode.run('retire-perception-plan','commit','perception.resolution.commit@1',1,'inputs','{}','parameters','{}',null,'null','domain_fact_commit','fence','{}','demand','{}');
    insertEvent.run('retire-perception-dedup','retire-perception-plan','dedup','retire-perception','retire-perception:attempt:1','perception','perception.dedup.resolve@1',1,'ready','normal_foreground',102);
    insertEvent.run('retire-perception-commit','retire-perception-plan','commit','retire-perception','retire-perception:attempt:1','perception','perception.resolution.commit@1',1,'pending','normal_foreground',null);
    database.close();
    assert.deepEqual(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>200}),{
      migrated:false,reason:'already_current',retiredPreProjectionWorks:2,retiredPreProjectionEvents:4,
      retiredPreProjectionExecutingEvents:1,
    });
    const check=new Database(databasePath,{readonly:true});
    assert.deepEqual(check.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get('retire-intake'),{state:'running'});
    assert.deepEqual(check.prepare('SELECT state,failure_code FROM fx_work_attempts WHERE attempt_id=?').get('retire-intake:attempt:1'),
      {state:'failed',failure_code:PRE_PROJECTION_PLAN_REPLAN_CODE});
    assert.deepEqual(check.prepare('SELECT state,outcome_kind,failure_class,failure_code FROM fx_event_attempts WHERE event_attempt_id=?')
      .get('retire-intake-event-attempt'),{state:'completed',outcome_kind:'failed',failure_class:'contract_upgrade',failure_code:PRE_PROJECTION_PLAN_REPLAN_CODE});
    assert.equal(check.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('retire-intake-binding').state,'failed');
    assert.equal(check.prepare('SELECT state FROM fx_workflow_events WHERE event_id=?').get('retire-intake-commit').state,'cancelled');
    assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_workflow_events WHERE plan_id=? AND state IN (?,?,?,?,?,?)')
      .get('retire-perception-plan','pending','ready','waiting_for_resource','waiting_for_external','waiting_for_approval','executing').count,0);
    assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_workflow_plans WHERE catalog_digest=?').get(PRE_PROJECTION_EXECUTION_CATALOG_DIGEST).count,2);
    assert.equal(check.pragma('integrity_check',{simple:true}),'ok');
    check.close();
    assert.deepEqual(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now:()=>201}),
      {migrated:false,reason:'already_current'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});


test('UAT-139 adds nullable coverage snapshots without inventing historical review evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-offdeck-coverage-upgrade-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let db, kernel;
  try {
    const oldDdl = schemaDdl.split('\n').filter((line) => !line.includes('"shelf_coverage_json"') && !line.includes('"shelf_coverage_schema_ref"')).join('\n');
    db = new Database(databasePath); db.exec(oldDdl);
    db.prepare("INSERT INTO arca_offdeck_reviews(review_id,state) VALUES('review-keep','selection_confirmed')").run();
    db.prepare("INSERT INTO arca_offdeck_selection_receipts(selection_receipt_id,review_id,shelf_coverage_digest,entry_count) VALUES('selection-keep','review-keep',?,5)").run('a'.repeat(64));
    db.prepare("INSERT INTO libra_runs(libra_run_id,state) VALUES('keep-in-flight','active')").run();
    db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
      .run('shelfdeck', TARGET_GENERATION, '42281705d35e3aa6d5103525544ce7d9a199bd2660c93e2faf2729d333475066', digest(catalogRows(db)), 1);
    const before = db.prepare('SELECT * FROM arca_offdeck_selection_receipts').get(); db.close();
    assert.equal(migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest }).migrated, true);
    db = new Database(databasePath);
    assert.deepEqual(db.prepare('SELECT * FROM arca_offdeck_selection_receipts').get(),
      { ...before, shelf_coverage_schema_ref:null, shelf_coverage_json:null });
    assert.equal(db.prepare("SELECT state FROM libra_runs WHERE libra_run_id='keep-in-flight'").get().state, 'active');
    assert.throws(() => db.prepare("UPDATE arca_offdeck_selection_receipts SET shelf_coverage_json='not-json'").run(), /CHECK/);
    db.close();
    kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest }); kernel.close();
    assert.equal(migrateUatIdentitySelectionSchema({ Database, databasePath, schemaManifest }).migrated, false);
  } finally { if (db?.open) db.close(); kernel?.close(); fs.rmSync(root, { recursive:true, force:true }); }
});


test('UAT-251 secondary target constraint upgrade preserves every existing Run revision',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-secondary-target-upgrade-')),databasePath=path.join(root,'shelfdeck.db');
  let db;
  try{
    db=new Database(databasePath);db.exec(schemaDdl.replace("'frozen', 'secondary_target', 'defect_admitted'","'frozen', 'defect_admitted'"));
    db.prepare("INSERT INTO libra_runs(libra_run_id,state) VALUES('unchanged-run','frozen')").run();
    db.prepare("INSERT INTO libra_run_revisions(libra_run_id,state_revision,transition_kind,expected_admission_head_revision) VALUES('unchanged-run',1,'frozen',0)").run();
    const before=db.prepare('SELECT * FROM libra_run_revisions').all();
    db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES(?,?,?,?,?)')
      .run('shelfdeck',TARGET_GENERATION,require('../src/helix/foundation/persistence/uat-identity-selection-migration').PRE_SECONDARY_TARGET_SCHEMA_DIGEST,digest(catalogRows(db)),100);
    db.close();
    const upgraded=migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest});assert.equal(upgraded.migrated,true);
    db=new Database(databasePath);assert.deepEqual(db.prepare('SELECT * FROM libra_run_revisions').all(),before);
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
    assert.match(db.prepare("SELECT sql FROM sqlite_master WHERE name='libra_run_revisions'").get().sql,/'secondary_target'/);
    db.close();assert.equal(migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest}).migrated,false);
    const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});kernel.close();
  }finally{if(db?.open)db.close();fs.rmSync(root,{recursive:true,force:true});}
});
