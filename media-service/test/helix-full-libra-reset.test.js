'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  applyReset,
  assertSafeTranscodeRoot,
  inspectPlan,
} = require('../scripts/helix-full-libra-reset');

const schemaDdl = fs.readFileSync(path.join(
  __dirname,
  '../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

test('full Libra reset is import-safe and preserves an empty clean database', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-full-libra-reset-'));
  const dataDir = path.join(root, 'data');
  const transcodeDir = path.join(root, 'transcode');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(transcodeDir);
  fs.writeFileSync(path.join(transcodeDir, 'stale.part'), 'stale');
  const database = new Database(path.join(dataDir, 'shelfdeck.db'));
  try {
    database.exec(schemaDdl);
    assert.deepEqual(inspectPlan(database), {
      resetRuns: [],
      workspaces: [],
      tokens: [],
      policies: [],
      libraWorks: [],
    });
    const result = applyReset({ database, dataDir, transcodeDir, nowMs: 1000 });
    assert.equal(result.discardedRuns, 0);
    assert.equal(result.clearedTokens, 0);
    assert.equal(result.retiredWorks, 0);
    assert.equal(result.transcode.removedEntries, 1);
    assert.deepEqual(fs.readdirSync(transcodeDir), []);
    assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('full Libra reset rejects broad or data-containing transcode roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-full-libra-guard-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  try {
    assert.throws(() => assertSafeTranscodeRoot(path.parse(root).root, dataDir),
      /UNSAFE_TRANSCODE_ROOT/);
    assert.throws(() => assertSafeTranscodeRoot(root, dataDir),
      /UNSAFE_TRANSCODE_ROOT/);
    assert.throws(() => assertSafeTranscodeRoot(dataDir, dataDir),
      /UNSAFE_TRANSCODE_ROOT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
