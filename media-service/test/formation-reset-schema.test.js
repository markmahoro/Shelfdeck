'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { buildOwnerRetentionPolicy } = require('../scripts/formation-reset-owner-policy');
const {canonicalDigest:D,canonicalJson}=require('../src/helix/contracts/canonical-json');
const {fixture:specFixture}=require('./helix-architecture/fixtures/custom-acceptance-spec-harness');
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
  assert.deepEqual(receipt.schemaTransition.addedTables, ['arca_collection_target_heads','arca_collection_target_intents','arca_offer_withdrawal_receipts','libra_custom_target_heads','libra_custom_target_intents','libra_custom_target_previews','libra_episode_metadata_mapping_heads','libra_episode_metadata_mapping_intents','libra_episode_metadata_reviews','proc_field_reset_barriers']);
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
  const f=fixture(t),source=new Database(f.sourcePath),base=specFixture('movie','retained-run').baseSpec,
    basisDigest=D('retained-run-basis'),basis={subjectSnapshot:{subjectId:base.subjectId},executionBasisDigest:basisDigest,
      acceptanceSpec:{acceptanceSpecId:base.acceptanceSpecId,specDigest:base.specDigest,recordDigest:base.recordDigest,
        specRevision:base.specRevision,productScopeDigest:base.productScope.scopeDigest,shelfId:base.targetShelfId}};
  source.prepare('INSERT INTO libra_subjects(subject_id,status,content_profile,structure_kind,intake_revision) VALUES(?,?,?,?,?)')
    .run(base.subjectId,'active',base.contentProfile,base.structureKind,1);
  source.prepare('INSERT INTO libra_decision_basis_revisions(decision_basis_id,subject_id,basis_kind,basis_revision,status) VALUES(?,?,?,?,?)')
    .run(base.decisionBasisId,base.subjectId,'acceptance_spec',1,'ready');
  source.prepare('INSERT INTO libra_acceptance_specs(acceptance_spec_id,subject_id,shelf_id,decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(base.acceptanceSpecId,base.subjectId,base.targetShelfId,base.decisionBasisId,base.productScope.scopeDigest,
      base.specRevision,base.schemaRef,canonicalJson(base),base.specDigest,base.recordDigest,base.structureKind,base.contentProfile,base.publishedAtMs);
  source.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state,acceptance_spec_id,execution_basis_digest,execution_basis_record_json) VALUES(?,?,?,?,?,?)')
    .run('retained-run',base.subjectId,'completed',base.acceptanceSpecId,basisDigest,canonicalJson(basis));
  const before=source.prepare('SELECT * FROM libra_runs').get();source.close();
  f.policy={...f.policy,tables:{...f.policy.tables,libra_runs:{owner:'libra',disposition:'root'},
    libra_acceptance_specs:{owner:'libra',disposition:'dependent'},libra_subjects:{owner:'libra',disposition:'dependent'},
    libra_decision_basis_revisions:{owner:'libra',disposition:'dependent'}}};
  const result=createRetainedDatabase(f),target=new Database(f.targetPath,{readonly:true});
  try{
    assert.deepEqual(result.schemaTransition.addedNullableColumns,{libra_runs:['episode_metadata_mapping_intent_id']});
    assert.deepEqual(target.prepare('SELECT * FROM libra_runs').get(),{...before,episode_metadata_mapping_intent_id:null});
  }finally{target.close();}
});
