'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createOnDeckStore}=require('../../src/helix/domains/arca/persistence/on-deck-store');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createOnDeckProjections}=require('../../src/helix/domains/arca/planning/on-deck-projections');
const {P}=require('../../src/helix/domains/arca/planning/on-deck-planners');

test('Target reservation survives reopen and blocks only the exact final target until Commit',t=>{
  const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
  const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
  const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
  const databasePath=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'series-target-')),'test.sqlite');
  const config={Database,databasePath,schemaDdl,schemaManifest};
  let kernel=openSqliteKernel(config);
  kernel.close();
  const db=new Database(databasePath);
  const digest=canonicalDigest({decision:'target'});
  for(const [id,endpoint,location] of [['a','endpoint','season'],['b','endpoint','season'],
    ['c','endpoint','other-season'],['d','other-endpoint','season']]) {
    db.prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id,final_inventory_decision_digest,state,created_at_ms) VALUES (?, ?, ?, ?)')
      .run(id,digest,'ready',1);
    db.prepare('INSERT INTO arca_final_inventory_decisions(final_inventory_decision_id,on_deck_run_id,target_endpoint_id,target_location,decision_json,decision_digest) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id,id,endpoint,location,'{}',digest);
  }
  kernel=openSqliteKernel(config);
  const store=()=>createOnDeckStore({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
  t.after(()=>{kernel.close();db.close();});
  let onDeck=store();
  assert.equal(onDeck.readTargetAvailability('a',digest).available,true);
  assert.deepEqual(onDeck.readTargetAvailability('b',digest),{available:false,blockingRunId:'a'});
  assert.throws(()=>onDeck.setOffloading('b',digest),{code:'P14_ONDECK_TARGET_RESERVED'});
  assert.equal(db.prepare('SELECT state FROM arca_ondeck_runs WHERE on_deck_run_id=?').get('b').state,'ready');
  assert.throws(()=>onDeck.readTargetAvailability('a','bad'),{code:'P14_ONDECK_RUN_MISSING'});
  onDeck.block('b',digest);
  assert.equal(onDeck.readTargetAvailability('a',digest).available,true);
  assert.throws(()=>onDeck.resume('b',digest),{code:'P14_ONDECK_TARGET_RESERVED'});
  db.exec("CREATE TRIGGER fixture_reservation_crash BEFORE UPDATE OF target_reserved_at_ms ON arca_ondeck_runs BEGIN SELECT RAISE(ABORT,'Injected reservation write failure'); END");
  assert.throws(()=>onDeck.setOffloading('a',digest),/Injected reservation write failure/);
  assert.deepEqual(db.prepare('SELECT state,target_reserved_at_ms FROM arca_ondeck_runs WHERE on_deck_run_id=?').get('a'),
    {state:'ready',target_reserved_at_ms:null});
  db.exec('DROP TRIGGER fixture_reservation_crash');
  onDeck.setOffloading('a',digest);
  onDeck.block('a',digest);
  kernel.close();kernel=openSqliteKernel(config);onDeck=store();
  assert.equal(onDeck.readTargetAvailability('b',digest).available,false);
  assert.equal(onDeck.readTargetAvailability('a',digest).available,true);
  assert.ok(db.prepare('SELECT target_reserved_at_ms FROM arca_ondeck_runs WHERE on_deck_run_id=?').get('a').target_reserved_at_ms>0);
  assert.equal(db.prepare('SELECT target_reserved_at_ms FROM arca_ondeck_runs WHERE on_deck_run_id=?').get('b').target_reserved_at_ms,null);
  for(const id of ['c','d'])assert.equal(onDeck.setOffloading(id,digest),'offloading');
  // Seed the terminal state; the full Host fixture exercises the actual Commit.
  db.prepare("UPDATE arca_ondeck_runs SET state='committed',terminal_at_ms=2 WHERE on_deck_run_id='a'").run();
  assert.equal(onDeck.resume('b',digest).state,'offloading');
  assert.equal(onDeck.setOffloading('b',digest),'offloading');
});

test('Reserved target remains an Owner input wait and does not prepare a physical slot',()=>{
  let prepared=0;
  const context={responsibility:{onDeckRunId:'b'},finalInventoryDecision:{decisionDigest:'digest'}};
  const projections=new Map(createOnDeckProjections({contextReader:{readAccepted:()=>context,
    onDeck:{readTargetAvailability:()=>({available:false,blockingRunId:'a'})}},
    inventoryPort:{slotHandle(){prepared++;}}}).map(item=>[item.projectionRef,item.projection]));
  assert.throws(()=>projections.get(P.targetHandle).project({ownerScope:{processType:'arca_ondeck_run',processId:'b'},parameters:{}}),
    error=>error.code==='P4_EXECUTION_INPUT_TEMPORARILY_UNAVAILABLE'&&error.details.dependencyRef==='a');
  assert.equal(prepared,0);
});

for(const state of ['committed','ready','blocked'])test('Reservation schema upgrade protects '+state+' responsibility',t=>{
  const {digest}=require('../../src/helix/foundation/persistence/ddl-compiler');
  const {migrateUatIdentitySelectionSchema,PRE_TARGET_RESERVATION_SCHEMA_DIGEST}=
    require('../../src/helix/foundation/persistence/uat-identity-selection-migration');
  const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
  const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
  const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
  const databasePath=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'series-target-upgrade-')),'test.sqlite');
  const oldDdl=schemaDdl.split('\n').filter(line=>!line.includes('"target_reserved_at_ms"')).join('\n');
  assert.equal(digest(oldDdl),PRE_TARGET_RESERVATION_SCHEMA_DIGEST);
  const db=new Database(databasePath);t.after(()=>db.close());db.exec(oldDdl);
  db.prepare('INSERT INTO arca_ondeck_runs(on_deck_run_id,state) VALUES (?,?)').run('historical',state);
  const catalog=()=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  db.prepare('INSERT INTO platform_schema_marker(schema_name,generation,schema_digest,catalog_digest,applied_at_ms) VALUES (?,?,?,?,?)')
    .run('shelfdeck','helix-clean-v3',PRE_TARGET_RESERVATION_SCHEMA_DIGEST,digest(catalog()),1);
  const before=db.prepare('SELECT * FROM arca_ondeck_runs').all(),beforeCatalog=catalog();
  const migrate=now=>migrateUatIdentitySelectionSchema({Database,databasePath,schemaManifest,now});
  if(state!=='committed') {
    assert.throws(()=>migrate(()=>2),{code:'ARCA_TARGET_RESERVATION_FORMATION_RESET_REQUIRED'});
    assert.deepEqual(catalog(),beforeCatalog);assert.deepEqual(db.prepare('SELECT * FROM arca_ondeck_runs').all(),before);
    return;
  }
  assert.throws(()=>migrate(()=>-1),{code:'UAT_MIGRATION_INVALID_TIME'});
  assert.deepEqual(catalog(),beforeCatalog);
  assert.equal(migrate(()=>2).migrated,true);
  assert.deepEqual(db.prepare('SELECT * FROM arca_ondeck_runs').all(),before.map(row=>({...row,target_reserved_at_ms:null})));
  assert.equal(migrate(()=>3).migrated,false);
  openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest}).close();
});
