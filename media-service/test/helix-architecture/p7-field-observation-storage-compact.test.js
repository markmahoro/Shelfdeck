'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');

const SCRIPT = path.resolve(__dirname, '../../scripts/helix-observation-storage-compact.js');

function invoke(databasePath, apply = false) {
  const result = spawnSync(process.execPath, [SCRIPT, '--database', databasePath, ...(apply ? ['--apply'] : [])], {
    encoding:'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('offline compaction is dry-run by default and atomically converts a legacy database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-observation-compact-'));
  try {
    const databasePath = path.join(directory, 'shelfdeck.sqlite');
    const source = new Database(databasePath);
    source.exec('CREATE TABLE platform_schema_marker(schema_name TEXT,generation TEXT,schema_digest TEXT,catalog_digest TEXT);' +
      "INSERT INTO platform_schema_marker VALUES('shelfdeck','helix-clean-v3','schema','catalog');" +
      'CREATE TABLE proc_field_observation_entries(id INTEGER PRIMARY KEY, payload TEXT);' +
      "INSERT INTO proc_field_observation_entries(id,payload) VALUES(1,'retained');");
    source.close();

    const dryRun = invoke(databasePath);
    assert.equal(dryRun.mode, 'dry_run');
    assert.equal(dryRun.entryRows, 1);
    assert.equal(dryRun.before.autoVacuum, 0);
    assert.equal(fs.readdirSync(directory).length, 1);

    const applied = invoke(databasePath, true);
    assert.equal(applied.status, 'completed');
    assert.equal(applied.after.autoVacuum, 2);
    assert.match(path.basename(applied.backupPath), /^shelfdeck\.sqlite\.pre-observation-compact-.+\.bak$/);
    assert.equal(fs.existsSync(applied.backupPath), true);

    const compacted = new Database(databasePath, { readonly:true });
    assert.equal(compacted.pragma('auto_vacuum', { simple:true }), 2);
    assert.deepEqual(compacted.prepare('SELECT id,payload FROM proc_field_observation_entries').all(), [
      { id:1, payload:'retained' },
    ]);
    compacted.close();
  } finally {
    fs.rmSync(directory, { recursive:true, force:true });
  }
});
