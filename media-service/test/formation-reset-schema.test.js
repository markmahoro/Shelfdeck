'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { buildOwnerRetentionPolicy } = require('../scripts/formation-reset-owner-policy');
const oldSchema = require('./helpers/plan-contract-target-schema');
const targetSchema = require('./helpers/formation-reset-239-schema');
const currentManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
function historicalPolicy() {
  const current=buildOwnerRetentionPolicy(currentManifest), names=new Set(targetSchema.schemaManifest.tables.map(t=>t.tableId));
  return {tables:Object.fromEntries(Object.entries(current.tables).filter(([name])=>names.has(name))),
    edges:current.edges.filter(edge=>names.has(edge.parent)&&names.has(edge.child)),seeds:[]};
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.db'), targetPath = path.join(root, 'target.db');
  openSqliteKernel({ Database, databasePath: sourcePath, ...oldSchema }).close();
  return { Database, sourcePath, targetPath, targetSchema, policy: historicalPolicy() };
}
test('cold import creates the declared new relation and a native target marker without changing its source', t => {
  const f = fixture(t), before = fs.readFileSync(f.sourcePath), receipt = createRetainedDatabase(f);
  assert.deepEqual(receipt.schemaTransition.addedTables, ['libra_episode_metadata_mapping_heads','libra_episode_metadata_mapping_intents','libra_episode_metadata_reviews','proc_field_reset_barriers']);
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
