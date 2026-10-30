'use strict';
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  SOURCE_DIGEST,
  TARGET_DIGEST,
  EXTRA_TABLES,
  schemas,
  prepareUsAdultCatalogueSchemaCopy: copy,
} = require('../../scripts/helix-architecture/us-adult-catalogue-schema-copy');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function seedPeople(db) {
  db.pragma('foreign_keys=ON');
  db.exec('BEGIN');
  db.pragma('defer_foreign_keys=ON');
  db.prepare("INSERT INTO people_persons(person_id,library_kind,status,current_revision,current_reference_projection_revision,current_reference_projection_digest,created_at_ms) VALUES('person','us_adult','active',1,1,?,1)")
    .run('a'.repeat(64));
  db.prepare("INSERT INTO people_person_revisions(person_id,revision,person_status,canonical_name,origin_kind,origin_decision_id,origin_decision_digest,fact_digest,committed_at_ms) VALUES('person',1,'active','Actor','direct','decision',?,?,1)")
    .run('b'.repeat(64), 'c'.repeat(64));
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.exec('COMMIT');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'us-adult-catalogue-schema-'));
  const sourcePath = path.join(root, 'source.sqlite');
  const targetPath = path.join(root, 'prepared.sqlite');
  openSqliteKernel({ Database, databasePath: sourcePath, ...schemas().source }).close();
  const db = new Database(sourcePath);
  seedPeople(db);
  db.pragma('journal_mode=DELETE');
  db.close();
  return {
    root,
    sourcePath,
    targetPath,
    close() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

describe('us-adult catalogue schema copy', { concurrency: false }, () => {
test('frozen digests stay 239→242 with only the declared catalogue scope', () => {
  const frozen = schemas();
  assert.equal(frozen.source.schemaManifest.ddlDigest, SOURCE_DIGEST);
  assert.equal(frozen.target.schemaManifest.ddlDigest, TARGET_DIGEST);
  assert.equal(frozen.source.schemaManifest.tableCount, 239);
  assert.equal(frozen.target.schemaManifest.tableCount, 242);
});

test('exact schema copy preserves every table and original file, supports pre-use rollback and normal Kernel startup', () => {
  const f = fixture();
  try {
    const originalHash = hash(f.sourcePath);
    const prepared = copy({ Database, ...f });
    assert.equal(prepared.copiedTableCount, 238);
    assert.equal(prepared.applied, false);
    assert.deepEqual(prepared.addedTables, EXTRA_TABLES);
    assert.equal(hash(f.sourcePath), originalHash);
    assert.equal(prepared.tableProofs.find(row => row.tableId === 'people_person_revisions').rowCount, 1);
    const upgraded = new Database(f.targetPath, { readonly: true });
    for (const tableId of EXTRA_TABLES)
      assert.equal(upgraded.prepare('SELECT count(*) n FROM ' + tableId).get().n, 0);
    assert.equal(upgraded.prepare("SELECT origin_kind FROM people_person_revisions WHERE person_id='person'").get().origin_kind, 'direct');
    upgraded.close();
    openSqliteKernel({ Database, databasePath: f.targetPath, ...schemas().target }).close();
    const catalogueAuto = new Database(f.targetPath);
    assert.doesNotThrow(() => catalogueAuto.prepare("INSERT INTO people_person_revisions(person_id,revision,person_status,canonical_name,origin_kind,origin_decision_id,origin_decision_digest,fact_digest,committed_at_ms) VALUES('person',2,'active','Actor','catalogue_auto','catalogue-decision',?,?,2)")
      .run('4'.repeat(64), '5'.repeat(64)));
    catalogueAuto.prepare("DELETE FROM people_person_revisions WHERE revision=2").run();
    catalogueAuto.close();
    const reverted = copy({
      Database,
      sourcePath: f.targetPath,
      targetPath: path.join(f.root, 'rollback.sqlite'),
      rollback: true,
    });
    assert.deepEqual(reverted.tableProofs, prepared.tableProofs);
    assert.throws(() => copy({ Database, ...f }), { code: 'CATALOGUE_SCHEMA_TARGET_UNSAFE' });
    assert.equal(hash(f.sourcePath), originalHash);
  } finally { f.close(); }
});

test('schema rollback refuses catalogue table facts and catalogue_auto revisions', () => {
  const f = fixture();
  try {
    copy({ Database, ...f });
    const withTable = new Database(f.targetPath);
    withTable.pragma('foreign_keys=OFF');
    withTable.prepare("INSERT INTO libra_us_adult_catalogue_bases(analysis_id,libra_run_id,subject_id,workspace_id,basis_schema_ref,basis_json,basis_digest,created_at_ms) VALUES('analysis','run','subject','workspace','fixture','{}',?,1)")
      .run('1'.repeat(64));
    withTable.close();
    assert.throws(
      () => copy({ Database, sourcePath: f.targetPath, targetPath: path.join(f.root, 'rejected-table.sqlite'), rollback: true }),
      { code: 'CATALOGUE_SCHEMA_ROLLBACK_NEW_FACTS' }
    );
    assert.equal(fs.existsSync(path.join(f.root, 'rejected-table.sqlite')), false);
  } finally { f.close(); }

  const clean = fixture();
  try {
    copy({ Database, ...clean });
    const withKind = new Database(clean.targetPath);
    withKind.prepare("INSERT INTO people_person_revisions(person_id,revision,person_status,canonical_name,origin_kind,origin_decision_id,origin_decision_digest,fact_digest,committed_at_ms) VALUES('person',2,'active','Actor','catalogue_auto','catalogue-decision',?,?,2)")
      .run('2'.repeat(64), '3'.repeat(64));
    withKind.close();
    assert.throws(
      () => copy({ Database, sourcePath: clean.targetPath, targetPath: path.join(clean.root, 'rejected-kind.sqlite'), rollback: true }),
      { code: 'CATALOGUE_SCHEMA_ROLLBACK_NEW_FACTS' }
    );
    assert.equal(fs.existsSync(path.join(clean.root, 'rejected-kind.sqlite')), false);
  } finally { clean.close(); }
});

test('copy refuses target overwrite and interrupted publication leaves no residue', () => {
  const f = fixture();
  try {
    const before = hash(f.sourcePath);
    assert.throws(() => copy({ Database, ...f, targetPath: f.sourcePath }), { code: 'CATALOGUE_SCHEMA_TARGET_UNSAFE' });
    function FailingDatabase(file, options) {
      const db = new Database(file, options);
      const prepare = db.prepare.bind(db);
      if (path.basename(file).startsWith('.us-adult-catalogue-schema-preparing-') && !options?.readonly)
        db.prepare = sql => sql.startsWith('INSERT INTO "people_persons"')
          ? { run() { throw Error('injected copy interruption'); } }
          : prepare(sql);
      return db;
    }
    assert.throws(() => copy({ Database: FailingDatabase, ...f }), /injected copy interruption/);
    assert.equal(hash(f.sourcePath), before);
    assert.equal(fs.existsSync(f.targetPath), false);
    assert.equal(fs.readdirSync(f.root).filter(name => name.startsWith('.us-adult-catalogue-schema-preparing-')).length, 0);
  } finally { f.close(); }
});
});
