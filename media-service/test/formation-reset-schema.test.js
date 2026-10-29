'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { buildOwnerRetentionPolicy } = require('../scripts/formation-reset-owner-policy');
const { digest } = require('../src/helix/foundation/persistence/ddl-compiler');
const oldSchema = require('./helpers/plan-contract-target-schema');
const targetSchema = { schemaManifest: require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
  schemaDdl: fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8') };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.db'), targetPath = path.join(root, 'target.db');
  openSqliteKernel({ Database, databasePath: sourcePath, ...oldSchema }).close();
  return { Database, sourcePath, targetPath, targetSchema, policy: buildOwnerRetentionPolicy(targetSchema.schemaManifest) };
}
test('cold import creates the declared new relation and a native target marker without changing its source', t => {
  const f = fixture(t), before = fs.readFileSync(f.sourcePath), receipt = createRetainedDatabase(f);
  assert.deepEqual(receipt.schemaTransition.addedTables, ['arca_jav_short_stage_witnesses','libra_episode_metadata_mapping_heads','libra_episode_metadata_mapping_intents','libra_episode_metadata_reviews','proc_field_reset_barriers']);
  assert.equal(receipt.tables.find(t => t.table === 'platform_schema_marker').regenerated, true);
  assert.deepEqual(fs.readFileSync(f.sourcePath), before);
  const target = new Database(f.targetPath, { readonly: true });
  try {
    target.exec('BEGIN');
    verifyReadOnlySqliteSnapshot({ database: target, ...targetSchema });
    assert.equal(target.prepare('SELECT count(*) n FROM proc_field_reset_barriers').get().n, 0);
    assert.equal(target.prepare('SELECT schema_digest FROM platform_schema_marker').get().schema_digest, targetSchema.schemaManifest.ddlDigest);
  } finally { if (target.inTransaction) target.exec('ROLLBACK'); target.close(); }
});
test('unreviewed source tables or indexes cannot enter a new generation', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.exec('CREATE TABLE unreviewed(id TEXT PRIMARY KEY)'); source.close();
  assert.throws(() => createRetainedDatabase(f), { code: 'RESET_SOURCE_SCHEMA_UNREVIEWED' });
});
test('a modified source schema marker blocks import even when catalog definitions match', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.prepare('UPDATE platform_schema_marker SET schema_digest=?').run('a'.repeat(64)); source.close();
  assert.throws(() => createRetainedDatabase(f), { code: 'RESET_SOURCE_SCHEMA_MARKER_INVALID' });
});

test('the reviewed nullable mapping reference preserves all existing Run columns in the cold copy',t=>{
  const f=fixture(t),source=new Database(f.sourcePath);
  source.prepare('INSERT INTO libra_runs(libra_run_id,state,execution_basis_record_json) VALUES(?,?,?)').run('retained-run','completed','{}');
  const before=source.prepare('SELECT * FROM libra_runs').get();source.close();
  f.policy={...f.policy,tables:{...f.policy.tables,libra_runs:{owner:'libra',disposition:'root'}}};
  const result=createRetainedDatabase(f),target=new Database(f.targetPath,{readonly:true});
  try{
    assert.deepEqual(result.schemaTransition.addedNullableColumns,{libra_runs:['episode_metadata_mapping_intent_id']});
    assert.deepEqual(target.prepare('SELECT * FROM libra_runs').get(),{...before,episode_metadata_mapping_intent_id:null});
  }finally{target.close();}
});

test('the exact 239-table generation cold-copies into the 240-table witness schema',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-short-schema-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const start=targetSchema.schemaDdl.indexOf('CREATE TABLE "arca_jav_short_stage_witnesses"'),
    end=targetSchema.schemaDdl.indexOf('CREATE TABLE "arca_material_bindings"',start),
    ddl=targetSchema.schemaDdl.slice(0,start)+targetSchema.schemaDdl.slice(end),oldDigest='906ecacce4d6de62e875d1293cec93dd198564c1c53e2f7f7979d75b2eac2d0a';
  assert.ok(start>=0&&end>start);assert.equal(digest(ddl),oldDigest);
  const manifest={...targetSchema.schemaManifest,tableCount:239,ddlDigest:oldDigest,
    tables:targetSchema.schemaManifest.tables.filter(item=>item.tableId!=='arca_jav_short_stage_witnesses')},
    sourcePath=path.join(root,'source.db'),targetPath=path.join(root,'target.db');
  openSqliteKernel({Database,databasePath:sourcePath,schemaManifest:manifest,schemaDdl:ddl}).close();
  const before=fs.readFileSync(sourcePath),receipt=createRetainedDatabase({Database,sourcePath,targetPath,targetSchema,
    policy:buildOwnerRetentionPolicy(targetSchema.schemaManifest)});
  assert.deepEqual(receipt.schemaTransition.addedTables,['arca_jav_short_stage_witnesses']);
  assert.deepEqual(fs.readFileSync(sourcePath),before);
  const target=new Database(targetPath,{readonly:true});try{
    assert.equal(target.prepare('SELECT count(*) n FROM arca_jav_short_stage_witnesses').get().n,0);
    assert.deepEqual(target.pragma('foreign_key_check'),[]);
  }finally{target.close();}
});

test('cold Reset retains committed On-deck witness closure and clears unrelated uncommitted records',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-short-retention-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const sourcePath=path.join(root,'source.db'),targetPath=path.join(root,'target.db');
  openSqliteKernel({Database,databasePath:sourcePath,...targetSchema}).close();
  const source=new Database(sourcePath),hex='a'.repeat(64);
  source.exec("INSERT INTO arca_shelf_entries(shelf_entry_id,status) VALUES ('kept-entry','active');"+
    "INSERT INTO arca_ondeck_runs(on_deck_run_id,state) VALUES ('kept-run','committed'),('old-run','blocked');"+
    "INSERT INTO arca_ondeck_commit_receipts(receipt_id,on_deck_run_id,shelf_entry_id) VALUES ('commit','kept-run','kept-entry');"+
    "INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,definition_json,state) VALUES "+
    "('kept-work','arca','arca_ondeck_run','kept-run','on_deck_execution','{}','succeeded'),"+
    "('old-work','arca','arca_ondeck_run','old-run','on_deck_execution','{}','failed')");
  const insert=source.prepare("INSERT INTO arca_jav_short_stage_witnesses(witness_id,on_deck_run_id,work_id,event_id,event_attempt_id,effect_id,target_commit_slot_id,decision_digest,member_key,kind,state,revision,witness_schema_ref,witness_json,witness_digest,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,'stage_member','linked',1,?,'{}',?,1)");
  for(const [id,run,work] of [['kept','kept-run','kept-work'],['old','old-run','old-work']])
    insert.run(id,run,work,id+'-event',id+'-attempt',id+'-effect',id+'-slot',hex,id+'-member','helix://implementation/arca/JavShortStageWitness/v1',hex);
  source.close();
  const before=fs.readFileSync(sourcePath),receipt=createRetainedDatabase({Database,sourcePath,targetPath,targetSchema,
    policy:buildOwnerRetentionPolicy(targetSchema.schemaManifest)}),target=new Database(targetPath,{readonly:true});
  try{
    assert.deepEqual(target.prepare('SELECT witness_id FROM arca_jav_short_stage_witnesses ORDER BY witness_id').all(),[{witness_id:'kept'}]);
    assert.deepEqual(target.prepare('SELECT on_deck_run_id FROM arca_ondeck_runs ORDER BY on_deck_run_id').all(),[{on_deck_run_id:'kept-run'}]);
    assert.deepEqual(target.pragma('foreign_key_check'),[]);assert.deepEqual(fs.readFileSync(sourcePath),before);
    assert.equal(receipt.tables.find(item=>item.table==='arca_jav_short_stage_witnesses').removed,1);
  }finally{target.close();}
});
