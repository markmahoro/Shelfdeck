'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { initializeResetTarget } = require('../scripts/formation-reset-schema');
const { createRetainedDatabase } = require('../scripts/formation-reset-copy');
const { buildOwnerRetentionPolicy } = require('../scripts/formation-reset-owner-policy');
const { readResetOwnerSnapshot } = require('../scripts/formation-reset-owner-snapshot');
const { verifyRetainedCollections } = require('../scripts/formation-reset-verify');
const { canonicalDigest,canonicalJson } = require('../src/helix/contracts/canonical-json');
const olderSchema = require('./helpers/plan-contract-target-schema');
const sourceSchema = require('./helpers/formation-reset-239-schema');
const priorTargetSchema = require('./helpers/formation-reset-244-schema');

const targetSchema = {
  schemaDdl: fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8'),
  schemaManifest: require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
};

function fixture(t, schema = sourceSchema) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-239-transition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.db'), targetPath = path.join(root, 'target.db');
  openSqliteKernel({ Database, databasePath: sourcePath, ...schema }).close();
  return { sourcePath, targetPath };
}

function initialize({ sourcePath, targetPath }, schema = targetSchema) {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma('query_only=ON');
    source.exec('BEGIN');
    return initializeResetTarget({ Database, targetPath, source, ...schema });
  } finally {
    if (source.inTransaction) source.exec('ROLLBACK');
    source.close();
  }
}

test('the exact 239-table production schema can create an isolated 246-table cold target', t => {
  const f = fixture(t), before = fs.readFileSync(f.sourcePath), transition = initialize(f);
  assert.deepEqual(transition.addedTables, [
    'arca_offer_withdrawal_receipts', 'libra_custom_target_heads', 'libra_custom_target_intents',
    'libra_custom_target_previews', 'libra_us_adult_catalogue_actor_decisions', 'libra_us_adult_catalogue_bases',
    'people_us_adult_catalogue_registration_origins',
  ]);
  assert.deepEqual(transition.changedTables, ['people_person_revisions']);
  assert.deepEqual(transition.addedNullableColumns, {});
  assert.deepEqual(fs.readFileSync(f.sourcePath), before);
  const target = new Database(f.targetPath, { readonly: true, fileMustExist: true });
  try {
    target.exec('BEGIN');
    verifyReadOnlySqliteSnapshot({ database: target, ...targetSchema });
    for (const table of transition.addedTables) assert.equal(target.prepare('SELECT count(*) n FROM ' + table).get().n, 0);
  } finally {
    if (target.inTransaction) target.exec('ROLLBACK');
    target.close();
  }
});

test('a 239 source with an unreviewed object cannot use the cold transition', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.exec('CREATE INDEX reset_unreviewed ON arca_shelf_entries(status)');
  source.close();
  assert.throws(() => initialize(f), { code: 'RESET_SOURCE_SCHEMA_UNREVIEWED' });
});

test('a resealed source with an unreviewed Person origin CHECK is still rejected', t => {
  const f=fixture(t),source=new Database(f.sourcePath);
  source.pragma('foreign_keys=OFF');
  const row=source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='people_person_revisions'").get();
  const modified=row.sql.replace("'direct', 'candidate'", "'direct', 'candidate', 'unreviewed'");
  assert.notEqual(modified,row.sql);
  source.exec('DROP TABLE people_person_revisions');
  source.exec(modified);
  const catalog=source.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
    .all().map(item=>({...item,sql:item.sql?.replaceAll('\r\n','\n')??null}));
  source.prepare('UPDATE platform_schema_marker SET catalog_digest=?').run(canonicalDigest(catalog));
  source.close();
  assert.throws(()=>initialize(f),{code:'RESET_SOURCE_SCHEMA_UNREVIEWED'});
});

test('a 239 source with an altered marker cannot use the cold transition', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.prepare('UPDATE platform_schema_marker SET schema_digest=?').run('a'.repeat(64));
  source.close();
  assert.throws(() => initialize(f), { code: 'RESET_SOURCE_SCHEMA_MARKER_INVALID' });
});

test('a 239 catalog with the older 235 marker cannot claim the reviewed transition', t => {
  const f = fixture(t), source = new Database(f.sourcePath);
  source.prepare('UPDATE platform_schema_marker SET schema_digest=?').run(olderSchema.schemaManifest.ddlDigest);
  source.close();
  assert.throws(() => initialize(f), { code: 'RESET_SOURCE_SCHEMA_UNREVIEWED' });
});

test('the reviewed 244 source only changes Person origin checks and adds the two actor evidence tables', t => {
  const f = fixture(t, priorTargetSchema), transition = initialize(f);
  assert.deepEqual(transition.addedTables, ['libra_us_adult_catalogue_actor_decisions','people_us_adult_catalogue_registration_origins']);
  assert.deepEqual(transition.changedTables, ['people_person_revisions']);
  assert.deepEqual(transition.addedNullableColumns, {});
});

test('a current 246-table source needs no structural transition', t => {
  const f = fixture(t, targetSchema), transition = initialize(f);
  assert.deepEqual(transition.addedTables, []);
  assert.deepEqual(transition.changedTables, []);
  assert.deepEqual(transition.addedNullableColumns, {});
});

test('the existing 235-to-239 cold qualification remains available', t => {
  const f = fixture(t, olderSchema), transition = initialize(f, sourceSchema);
  assert.deepEqual(transition.addedTables, ['libra_episode_metadata_mapping_heads',
    'libra_episode_metadata_mapping_intents', 'libra_episode_metadata_reviews', 'proc_field_reset_barriers']);
  assert.deepEqual(transition.addedNullableColumns, { libra_runs: ['episode_metadata_mapping_intent_id'] });
});

test('an isolated empty 239 source can copy and verify a 246 candidate under the Owner classifications', t => {
  const f=fixture(t),before=fs.readFileSync(f.sourcePath),owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),
    policy=buildOwnerRetentionPolicy(targetSchema.schemaManifest,owner);
  const copy=createRetainedDatabase({Database,...f,targetSchema,policy});
  assert.equal(copy.schemaTransition.addedTables.length,7);
  assert.deepEqual(fs.readFileSync(f.sourcePath),before);
  const result=verifyRetainedCollections({Database,...f,...targetSchema});
  assert.equal(result.withdrawals.count,0);
  assert.equal(result.customTargets.count,0);
  assert.equal(result.reconstructedCommits,0);
});

test('the 239 cold copy preserves historical direct and candidate Person rows byte-for-byte', t => {
  const f=fixture(t),source=new Database(f.sourcePath),D=canonicalDigest;
  source.pragma('foreign_keys=ON');source.exec('BEGIN');
  for(const [id,kind] of [['old-direct','direct'],['old-candidate','candidate']]){
    source.prepare('INSERT INTO people_persons(person_id,library_kind,status,current_revision,current_reference_projection_revision,current_reference_projection_digest,created_at_ms) VALUES(?,?,?,?,?,?,?)')
      .run(id,'normal','active',1,1,D({id,projection:true}),1);
    source.prepare('INSERT INTO people_person_revisions(person_id,revision,person_status,canonical_name,merged_into_person_id,origin_kind,origin_decision_id,origin_decision_digest,origin_candidate_kind,origin_candidate_id,origin_candidate_revision,origin_candidate_payload_digest,fact_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id,1,'active',id,null,kind,kind==='direct'?'old-user-decision':null,kind==='direct'?D('direct'):null,
        kind==='candidate'?'registration':null,kind==='candidate'?'old-candidate-id':null,kind==='candidate'?1:null,
        kind==='candidate'?D('candidate'):null,D({id,fact:true}),1);
  }
  source.exec('COMMIT');const before=source.prepare('SELECT * FROM people_person_revisions ORDER BY person_id').all();source.close();
  const owner=readResetOwnerSnapshot({Database,sourcePath:f.sourcePath}),policy=buildOwnerRetentionPolicy(targetSchema.schemaManifest,owner);
  createRetainedDatabase({Database,...f,targetSchema,policy});
  const target=new Database(f.targetPath,{readonly:true});
  try{
    assert.equal(canonicalJson(target.prepare('SELECT * FROM people_person_revisions ORDER BY person_id').all()),canonicalJson(before));
    assert.deepEqual(target.pragma('foreign_key_check'),[]);assert.equal(target.pragma('integrity_check',{simple:true}),'ok');
  }finally{target.close();}
});
