'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

const temporaryRoots = new Set();

function removeTemporaryRoot(root) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (error.code !== 'EPERM') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  throw lastError;
}

test.after(() => {
  for (const root of temporaryRoots) removeTemporaryRoot(root);
});

function temporaryDatabase(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-sqlite-kernel-'));
  temporaryRoots.add(root);
  const databasePath = path.join(root, 'shelfdeck.db');
  return run(databasePath);
}

const open = (databasePath, options = {}) => openSqliteKernel({
  Database, databasePath, schemaDdl, schemaManifest, now: options.now
});

test('creates and reopens the only clean 179-table WAL generation with hard startup gates', () => {
  temporaryDatabase((databasePath) => {
    let firstGeneration;
    {
      const first = open(databasePath, { now: () => 1700000000000 });
    assert.equal(first.generation.tableCount, 180);
      assert.equal(first.generation.indexCount, 81);
      assert.equal(first.generation.partialUniqueCount, 21);
      assert.equal(first.generation.schemaDigest, schemaManifest.ddlDigest);
      assert.deepEqual(first.diagnostics(), { foreignKeys: 1, journalMode: 'wal', synchronous: 1, busyTimeout: 5000 });
      firstGeneration = first.generation;
      first.close();
    }

    const second = open(databasePath);
    assert.deepEqual(second.generation, firstGeneration);
    second.close();
  });
});

test('injects one commit time, commits atomically, rolls back failures, and rejects nesting', () => {
  temporaryDatabase((databasePath) => {
    let clock = 1700000000100;
    const kernel = open(databasePath, { now: () => clock++ });
    kernel.runPrimitive((transaction) => {
      const firstTime = transaction.commitTimeMs;
      transaction.prepare('INSERT INTO fx_audit_records(audit_id,occurred_at_ms) VALUES(?,?)').run('audit-1', firstTime);
      transaction.prepare('INSERT INTO fx_audit_records(audit_id,occurred_at_ms) VALUES(?,?)').run('audit-2', transaction.commitTimeMs);
      assert.equal(transaction.commitTimeMs, firstTime);
    });
    assert.throws(() => kernel.runPrimitive((transaction) => {
      transaction.prepare('INSERT INTO fx_audit_records(audit_id,occurred_at_ms) VALUES(?,?)').run('audit-rollback', transaction.commitTimeMs);
      throw new Error('crash fixture');
    }), /crash fixture/);
    assert.equal(kernel.runPrimitive((transaction) => transaction.prepare(
      "SELECT COUNT(*) count FROM fx_audit_records WHERE audit_id='audit-rollback'"
    ).get().count), 0);
    assert.throws(() => kernel.runPrimitive(() => kernel.runPrimitive(() => null)), (error) => error.code === 'P3_SQLITE_NESTED_TRANSACTION');
    kernel.close();
  });
});

test('refuses non-empty legacy or mixed schema without creating clean objects', () => {
  temporaryDatabase((databasePath) => {
    const legacy = new Database(databasePath);
    legacy.exec('CREATE TABLE legacy_task(id TEXT PRIMARY KEY)');
    legacy.close();
    assert.throws(() => open(databasePath), (error) => error.code === 'P3_SQLITE_MIXED_OR_LEGACY_SCHEMA');
    const inspected = new Database(databasePath);
    assert.deepEqual(inspected.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(), [{ name: 'legacy_task' }]);
    inspected.close();
  });
});

test('rejects DDL bytes before opening and rejects marker or catalog tampering on reopen', () => {
  temporaryDatabase((databasePath) => {
    let opens = 0;
    function CountingDatabase(filePath) {
      opens += 1;
      return new Database(filePath);
    }
    assert.throws(() => openSqliteKernel({
      Database: CountingDatabase, databasePath, schemaDdl: schemaDdl + '\n-- drift', schemaManifest
    }), (error) => error.code === 'P3_SQLITE_DDL_DIGEST_MISMATCH');
    assert.equal(opens, 0);

    const kernel = open(databasePath);
    kernel.close();
    const changed = new Database(databasePath);
    changed.prepare('UPDATE platform_schema_marker SET schema_digest=?').run('0'.repeat(64));
    changed.close();
    assert.throws(() => open(databasePath), (error) => error.code === 'P3_SQLITE_SCHEMA_GENERATION_MISMATCH');
  });

  temporaryDatabase((databasePath) => {
    const kernel = open(databasePath);
    kernel.close();
    const changed = new Database(databasePath);
    changed.exec('DROP INDEX uidx_fx_work_attempts_partial_01');
    changed.close();
    assert.throws(() => open(databasePath), (error) => error.code === 'P3_SQLITE_CATALOG_SHAPE_MISMATCH');
  });

  temporaryDatabase((databasePath) => {
    const kernel = open(databasePath);
    kernel.close();
    const changed = new Database(databasePath);
    changed.exec('DROP INDEX uidx_fx_work_attempts_partial_01');
    changed.exec("CREATE INDEX uidx_fx_work_attempts_partial_01 ON fx_work_attempts(work_id) WHERE state IN ('ready','running','blocked')");
    const catalog = changed.prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
    ).all().map((row) => ({ ...row, sql: row.sql && row.sql.replaceAll('\r\n', '\n') }));
    changed.prepare('UPDATE platform_schema_marker SET catalog_digest=?').run(digest(catalog));
    changed.close();
    assert.throws(() => open(databasePath), (error) => error.code === 'P3_SQLITE_PARTIAL_UNIQUE_MISSING');
  });
});

test('rejects foreign-key corruption and cross-table guard projection drift', () => {
  temporaryDatabase((databasePath) => {
    const kernel = open(databasePath);
    kernel.close();
    const changed = new Database(databasePath);
    changed.pragma('foreign_keys = OFF');
    changed.prepare('INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,shelf_id) VALUES(?,?)').run('attempt', 'missing-shelf');
    changed.close();
    assert.throws(() => open(databasePath), (error) => error.code === 'P3_SQLITE_FOREIGN_KEY_CHECK_FAILED');
  });

  temporaryDatabase((databasePath) => {
    const kernel = open(databasePath);
    kernel.close();
    const changed = new Database(databasePath);
    changed.pragma('foreign_keys = OFF');
    changed.exec("INSERT INTO arca_shelves(shelf_id,status) VALUES('shelf','active')");
    changed.exec("INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,status,current_inventory_revision) VALUES('entry','shelf','active',1)");
    changed.exec("INSERT INTO arca_inventory_representations(shelf_entry_id,revision) VALUES('entry',1)");
    changed.exec("INSERT INTO arca_inventory_materials(shelf_entry_id,inventory_revision,ordinal,material_key,role,active_guard) VALUES('entry',1,0,'material','primary',0)");
    changed.close();
    assert.throws(() => open(databasePath), (error) => error.code === 'P3_SQLITE_GUARD_PROJECTION_DRIFT');
  });
});
