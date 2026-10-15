'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { openSqliteKernel, verifyReadOnlySqliteSnapshot } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { historicalSchema } = require('../fixtures/helix-historical-ddl/schema-snapshot');
const { SOURCE_DIGEST, TARGET_DIGEST, inspectJavSchemaSource, prepareJavSchemaCopy, verifyJavSchemaRollback } = require('../../scripts/helix-architecture/jav-release-schema-copy');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-jav-release-')), sourcePath = path.join(root, 'source.sqlite'), targetPath = path.join(root, 'target.sqlite');
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('helix-jav-release-')); fs.rmSync(root, { recursive: true, force: true }); });
  const schema = historicalSchema(SOURCE_DIGEST), kernel = openSqliteKernel({ Database, databasePath: sourcePath, ...schema });
  kernel.runPrimitive(({ prepare }) => {
    prepare('INSERT INTO arca_shelves(shelf_id,name,status) VALUES(?,?,?)').run('retained-shelf', '保留收藏架', 'active');
    prepare('INSERT INTO platform_secret_refs(secret_ref,owner_scope_type,owner_scope_id,secret_kind,encrypted_ref,revision,state,updated_at_ms) VALUES(?,?,?,?,?,?,?,?)')
      .run('retained-secret', 'integration', 'test-integration', 'api_key', 'opaque-secret-reference-never-report', 1, 'active', 1000);
    prepare('INSERT INTO fx_audit_records(audit_id,owner_domain,actor_type,actor_id,action,scope_type,scope_id,occurred_at_ms) VALUES(?,?,?,?,?,?,?,?)')
      .run('retained-audit', 'arca', 'user', 'test-user', 'test-history', 'shelf', 'retained-shelf', 9223372036854775806n);
    // Structural fixtures exercise the two expanded tables; full Owner-history
    // qualification uses a separately produced historical service dataset.
    prepare('INSERT INTO libra_product_identity_selection_intents(selection_intent_id,selection_kind,provider,namespace,provider_key) VALUES(?,?,?,?,?)')
      .run('retained-choice', 'provider_id', 'tmdb', 'tmdb_movie', '17');
    prepare('INSERT INTO proc_candidate_packages(candidate_package_id,content_profile,material_input_form,state) VALUES(?,?,?,?)')
      .run('retained-package', 'movie', 'stream_file', 'published');
  }); kernel.close();
  return { root, sourcePath, targetPath, schema };
}
test('offline release copy preserves all 199 existing row sets and the source bytes with exact 200-to-203 schema proof', t => {
  const value = fixture(t), before = hash(value.sourcePath);
  assert.equal(inspectJavSchemaSource({ Database, sourcePath: value.sourcePath }).eligible, true);
  const receipt = prepareJavSchemaCopy({ Database, ...value });
  assert.equal(receipt.prepared, true); assert.equal(receipt.copiedTableCount, 199);
  assert.equal(receipt.source.schemaDigest, SOURCE_DIGEST); assert.equal(receipt.target.schemaDigest, TARGET_DIGEST);
  assert.equal(receipt.sourceMode, 'readonly_snapshot'); assert.equal(hash(value.sourcePath), before);
  assert.ok(!JSON.stringify(receipt).includes('opaque-secret-reference-never-report'));
  const database = new Database(value.targetPath, { readonly: true });
  try {
    assert.equal(database.prepare('SELECT name FROM arca_shelves').get().name, '保留收藏架');
    assert.equal(database.prepare('SELECT occurred_at_ms FROM fx_audit_records').safeIntegers().get().occurred_at_ms, 9223372036854775806n);
    for (const table of ['arca_jav_identity_corrections', 'arca_jav_correction_directory_checks']) assert.equal(database.prepare('SELECT count(*) n FROM ' + table).get().n, 0);
    assert.deepEqual(database.prepare('SELECT selection_record_schema_ref,selection_record_json FROM libra_product_identity_selection_intents').get(), { selection_record_schema_ref: null, selection_record_json: null });
    assert.deepEqual(database.prepare('SELECT jav_part_set_schema_ref,jav_part_set_json FROM proc_candidate_packages').get(), { jav_part_set_schema_ref: null, jav_part_set_json: null });
  } finally { database.close(); }
  assert.equal(fs.readdirSync(value.root).filter(n => n.startsWith('.jav-schema-preparing-')).length, 0);
});
test('same source, existing target and changed source catalog are refused without overwrite or marker repair', t => {
  const value = fixture(t), before = hash(value.sourcePath);
  assert.throws(() => prepareJavSchemaCopy({ Database, ...value, targetPath: value.sourcePath }), { code: 'JAV_SCHEMA_TARGET_EXISTS' });
  fs.writeFileSync(value.targetPath, 'Owned by someone else');
  assert.throws(() => prepareJavSchemaCopy({ Database, ...value }), { code: 'JAV_SCHEMA_TARGET_EXISTS' });
  assert.equal(fs.readFileSync(value.targetPath, 'utf8'), 'Owned by someone else'); assert.equal(hash(value.sourcePath), before);
  const database = new Database(value.sourcePath); database.exec('CREATE TABLE unexpected_table(value TEXT)'); database.close();
  const altered = hash(value.sourcePath);
  assert.throws(() => inspectJavSchemaSource({ Database, sourcePath: value.sourcePath }), { code: 'P3_SQLITE_CATALOG_SHAPE_MISMATCH' });
  assert.equal(hash(value.sourcePath), altered);
});
test('unfinished old Work is reported and cannot acquire compatibility through an upgraded copy', t => {
  const value = fixture(t), database = new Database(value.sourcePath);
  database.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,state) VALUES(?,?,?,?,?,?)')
    .run('unfinished-work', 'libra', 'libra_run', 'old-run', 'evidence', 'ready'); database.close();
  const before = hash(value.sourcePath), inspection = inspectJavSchemaSource({ Database, sourcePath: value.sourcePath });
  assert.deepEqual(inspection.blockers, [{ tableId: 'fx_supporting_works', count: 1 }]); assert.equal(inspection.eligible, false);
  assert.throws(() => prepareJavSchemaCopy({ Database, ...value }), { code: 'JAV_SCHEMA_UNFINISHED_RESPONSIBILITY' });
  assert.equal(fs.existsSync(value.targetPath), false); assert.equal(hash(value.sourcePath), before);
});
test('late row insertion failure rolls back the private target and never publishes a qualified copy', t => {
  const value = fixture(t), before = hash(value.sourcePath);
  function FailingDatabase(filename, options) {
    const database = new Database(filename, options), prepare = database.prepare.bind(database);
    if (path.basename(filename).startsWith('.jav-schema-preparing-') && !options?.readonly)
      database.prepare = sql => sql.startsWith('INSERT INTO "platform_secret_refs"')
        ? { run() { throw Object.assign(new Error('Injected late insertion failure.'), { code: 'TEST_LATE_INSERTION_FAILURE' }); } } : prepare(sql);
    return database;
  }
  assert.throws(() => prepareJavSchemaCopy({ Database: FailingDatabase, ...value }), { code: 'TEST_LATE_INSERTION_FAILURE' });
  assert.equal(fs.existsSync(value.targetPath), false); assert.equal(hash(value.sourcePath), before);
  assert.equal(fs.readdirSync(value.root).filter(n => n.startsWith('.jav-schema-preparing-')).length, 0);
});
test('read-only rollback proof accepts an unchanged copy and rejects later facts without restoring a baseline', t => {
  const value = fixture(t); prepareJavSchemaCopy({ Database, ...value });
  const before = hash(value.sourcePath), targetBefore = hash(value.targetPath);
  assert.deepEqual(verifyJavSchemaRollback({ Database, sourcePath: value.sourcePath, upgradedPath: value.targetPath }), { eligible: true, verifiedTableCount: 199, applied: false });
  assert.equal(hash(value.sourcePath), before); assert.equal(hash(value.targetPath), targetBefore);
  const database = new Database(value.targetPath); database.prepare('UPDATE arca_shelves SET name=?').run('New user fact'); database.close();
  const altered = hash(value.targetPath);
  assert.throws(() => verifyJavSchemaRollback({ Database, sourcePath: value.sourcePath, upgradedPath: value.targetPath }), { code: 'JAV_SCHEMA_ROLLBACK_CHANGED_FACTS' });
  assert.equal(hash(value.targetPath), altered); assert.equal(hash(value.sourcePath), before);
});
test('an output occupied during final verification is never replaced by atomic publication', t => {
  const value = fixture(t), before = hash(value.sourcePath);
  function RacingDatabase(filename, options) {
    if (path.basename(filename).startsWith('.jav-schema-preparing-') && options?.readonly)
      fs.writeFileSync(value.targetPath, 'Foreign output');
    return new Database(filename, options);
  }
  assert.throws(() => prepareJavSchemaCopy({ Database: RacingDatabase, ...value }), { code: 'JAV_SCHEMA_TARGET_EXISTS' });
  assert.equal(fs.readFileSync(value.targetPath, 'utf8'), 'Foreign output'); assert.equal(hash(value.sourcePath), before);
});
test('hard-link source aliases and any non-null new JAV column prevent release or baseline rollback', t => {
  const value = fixture(t), alias = path.join(value.root, 'source-alias.sqlite');
  fs.linkSync(value.sourcePath, alias);
  assert.throws(() => inspectJavSchemaSource({ Database, sourcePath: alias }), { code: 'JAV_SCHEMA_PATH_UNSAFE' });
  fs.unlinkSync(alias); prepareJavSchemaCopy({ Database, ...value });
  const database = new Database(value.targetPath);
  try {
    for (const [table, column] of [['libra_product_identity_selection_intents', 'selection_record_schema_ref'],
      ['libra_product_identity_selection_intents', 'selection_record_json'], ['proc_candidate_packages', 'jav_part_set_schema_ref'], ['proc_candidate_packages', 'jav_part_set_json']]) {
      database.prepare('UPDATE ' + table + ' SET ' + column + '=?').run(column.endsWith('_json') ? '{}' : 'New-JAV-record');
      assert.throws(() => verifyJavSchemaRollback({ Database, sourcePath: value.sourcePath, upgradedPath: value.targetPath }), { code: 'JAV_SCHEMA_ROLLBACK_CHANGED_FACTS' });
      database.prepare('UPDATE ' + table + ' SET ' + column + '=NULL').run();
    }
  } finally { database.close(); }
});
test('snapshot verifier requires a real read-only transaction and operator CLI emits only bounded proof', t => {
  const value = fixture(t), database = new Database(value.sourcePath, { readonly: true });
  try { assert.throws(() => verifyReadOnlySqliteSnapshot({ database, ...value.schema }), { code: 'P3_SQLITE_READONLY_SNAPSHOT_REQUIRED' }); } finally { database.close(); }
  const script = path.resolve(__dirname, '../../scripts/helix-jav-schema-copy.js'), before = hash(value.sourcePath);
  const inspection = spawnSync(process.execPath, [script, '--source', value.sourcePath, '--inspect'], { encoding: 'utf8', windowsHide: true });
  assert.equal(inspection.status, 0, inspection.stderr); assert.equal(JSON.parse(inspection.stdout).source.tableCount, 200);
  const prepared = spawnSync(process.execPath, [script, '--source', value.sourcePath, '--target', value.targetPath], { encoding: 'utf8', windowsHide: true });
  assert.equal(prepared.status, 0, prepared.stderr); assert.equal(JSON.parse(prepared.stdout).target.tableCount, 203);
  assert.ok(!prepared.stdout.includes('opaque-secret-reference-never-report')); assert.equal(hash(value.sourcePath), before);
});

test('release inspection copy and rollback verify large Outbox history under a bounded heap and still reject late corruption', t => {
  const value=fixture(t),database=new Database(value.sourcePath),payload=JSON.stringify({fixture:'x'.repeat(15000)}),
    payloadDigest=crypto.createHash('sha256').update(payload).digest('hex'),consumerDigest=crypto.createHash('sha256').update('[]').digest('hex');
  try {
    database.transaction(()=>{
      const insert=database.prepare('INSERT INTO fx_outbox(message_id,consumer_set_digest,intended_consumer_count,payload_json,payload_digest,state) VALUES(?,?,0,?,?,?)');
      for(let i=0;i<8192;i++)insert.run('bounded-fixture-'+i,consumerDigest,payload,payloadDigest,'tombstoned');
    })();
  } finally { database.close(); }
  assert.ok(fs.statSync(value.sourcePath).size>120*1024*1024);
  const operatorPath=path.resolve(__dirname,'../../scripts/helix-architecture/jav-release-schema-copy'),
    driverPath=require.resolve('better-sqlite3'),program='const Database=require('+JSON.stringify(driverPath)+');const operator=require('+JSON.stringify(operatorPath)+');'+
      'try{const proof=operator.inspectJavSchemaSource({Database,sourcePath:'+JSON.stringify(value.sourcePath)+'});'+
      'if(!proof.eligible)throw new Error("SOURCE_NOT_ELIGIBLE");'+
      'if(process.argv[1]==="copy"){const targetPath='+JSON.stringify(value.targetPath)+';'+
      'const copied=operator.prepareJavSchemaCopy({Database,sourcePath:'+JSON.stringify(value.sourcePath)+',targetPath});'+
      'const rollback=operator.verifyJavSchemaRollback({Database,sourcePath:'+JSON.stringify(value.sourcePath)+',upgradedPath:targetPath});'+
      'console.log(JSON.stringify({eligible:proof.eligible,tableCount:proof.source.tableCount,copiedTableCount:copied.copiedTableCount,'+
      'outboxRows:copied.tableProofs.find(table=>table.tableId==="fx_outbox").rowCount,rollbackTables:rollback.verifiedTableCount}));}'+
      'else console.log(JSON.stringify({eligible:proof.eligible,tableCount:proof.source.tableCount}));}'+
      'catch(error){console.error(error.code||"INSPECTION_FAILED");process.exitCode=1;}';
  const inspect=(mode='verify')=>spawnSync(process.execPath,['--max-old-space-size=64','-e',program,'--',mode],
    {encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:256*1024,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});
  const valid=inspect('copy');assert.equal(valid.error,undefined);assert.equal(valid.status,0,valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout),{eligible:true,tableCount:200,copiedTableCount:199,outboxRows:8192,rollbackTables:199});
  const altered=new Database(value.sourcePath);
  try { altered.prepare('UPDATE fx_outbox SET payload_digest=? WHERE message_id=?').run('0'.repeat(64),'bounded-fixture-8191'); }
  finally { altered.close(); }
  const rejected=inspect();assert.equal(rejected.error,undefined);assert.equal(rejected.status,1,rejected.stderr);
  assert.equal(rejected.stderr.trim(),'P3_SQLITE_OUTBOX_CONSISTENCY_DRIFT');
});
