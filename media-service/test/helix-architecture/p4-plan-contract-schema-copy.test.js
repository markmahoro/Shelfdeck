'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { preparePlanContractSchemaCopy, assertAddition, verifyPreparedCopy } = require('../../scripts/helix-architecture/plan-contract-schema-copy');
const base = path.resolve(__dirname, '../../src/helix/foundation/persistence');
const sourceDigest = '14ba9e5ab6833fedf39adc6d4dd492d18ea6c9387a3e0a1671a3d1338b999d53';
const sourceSchema = { schemaDdl: zlib.gunzipSync(fs.readFileSync(path.join(base, 'release-schemas', sourceDigest + '.sql.gz'))).toString(),
  schemaManifest: JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(base, 'release-schemas', sourceDigest + '.manifest.json.gz')))) };
const targetSchema = { schemaDdl: fs.readFileSync(path.join(base, 'generated/clean-schema.sql'), 'utf8'),
  schemaManifest: JSON.parse(fs.readFileSync(path.join(base, 'generated/clean-schema.manifest.json'), 'utf8')) };

test('additive evidence copy preserves every existing fact and rejects target overwrite', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-contract-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.db'), targetPath = path.join(root, 'target.db');
  const source = openSqliteKernel({ Database, databasePath: sourcePath, ...sourceSchema });
  source.runPrimitive(db => {
    db.prepare("INSERT INTO libra_subjects(subject_id,status,structure_kind,content_profile,intake_revision,created_at_ms,updated_at_ms) VALUES ('history','ended','single','movie',1,1,1)").run();
    db.prepare("INSERT INTO fx_supporting_works(work_id,state) VALUES('history','succeeded')").run();
  });
  source.close();
  const bytes = fs.readFileSync(sourcePath);
  const proof = preparePlanContractSchemaCopy({ Database, sourcePath, targetPath, sourceSchema, targetSchema });
  assert.equal(proof.applied, false);
  assert.equal(proof.tables.length, sourceSchema.schemaManifest.tableCount - 1);
  assert.deepEqual(fs.readFileSync(sourcePath), bytes);
  const target = openSqliteKernel({ Database, databasePath: targetPath, ...targetSchema });
  assert.equal(target.runPrimitive(db => db.prepare("SELECT status FROM libra_subjects WHERE subject_id='history'").get().status), 'ended');
  assert.equal(target.runPrimitive(db => db.prepare('SELECT COUNT(*) n FROM fx_plan_contracts').get().n), 0);
  target.close();
  assert.equal(verifyPreparedCopy({ Database, databasePath: targetPath, receipt: proof, targetSchema }).verified, true);
  const changedReceipt = structuredClone(proof);
  changedReceipt.tables = changedReceipt.tables.filter(row => row.tableId !== 'libra_subjects');
  assert.throws(() => verifyPreparedCopy({ Database, databasePath: targetPath, receipt: changedReceipt, targetSchema }), /RECEIPT_SCOPE/);
  const changed = new Database(targetPath);
  changed.prepare("UPDATE libra_subjects SET status='active' WHERE subject_id='history'").run(); changed.close();
  assert.throws(() => verifyPreparedCopy({ Database, databasePath: targetPath, receipt: proof, targetSchema }), { code: 'CONTRACT_COPY_PROTECTED_FACT_DRIFT' });
  assert.throws(() => preparePlanContractSchemaCopy({ Database, sourcePath, targetPath, sourceSchema, targetSchema }), /TARGET_UNSAFE/);
});

test('evidence copy cannot hide an old table, index or CHECK change inside an additive upgrade', () => {
  const changed = structuredClone(targetSchema);
  changed.schemaDdl = changed.schemaDdl.replace("'administratively_retired'", "'different_state'");
  assert.throws(() => assertAddition(sourceSchema, changed), /EXISTING_DDL_CHANGED/);
  const missing = structuredClone(targetSchema);
  missing.schemaManifest.tables = missing.schemaManifest.tables.filter(table => table.tableId !== 'arca_shelf_entries');
  assert.throws(() => assertAddition(sourceSchema, missing));
});
