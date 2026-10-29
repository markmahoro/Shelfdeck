'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createGenerationSwitch, fileDigest } = require('../scripts/formation-reset-generation');
function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-generation-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const activePath = path.join(root, 'active.db'), candidatePath = path.join(root, 'candidate.db'), backupPath = path.join(root, 'backup.db');
  fs.writeFileSync(activePath, 'old database'); fs.copyFileSync(activePath, backupPath); fs.writeFileSync(candidatePath, 'new database');
  return { activePath, candidatePath, backupPath, journalPath: path.join(root, 'receipt.json'), markerPath: path.join(root, 'generation.json'),
    generationId: 'a'.repeat(64), sourceDigest: fileDigest(activePath), candidateDigest: fileDigest(candidatePath),
    retainedDigest: 'b'.repeat(64), assertStopped: () => {} };
}
for (const phase of ['prepared', 'switching', 'old_database_moved', 'new_database_moved', 'generation_marked', 'database_switched']) {
  test('interruption at ' + phase + ' resumes the same generation without losing the backup', t => {
    const f = fixture(t), operation = createGenerationSwitch({ ...f, checkpoint: p => { if(p === phase)throw Error('interrupted'); } });
    assert.throws(() => operation.switchDatabase(), /interrupted/);
    const resumed = createGenerationSwitch(f), result = resumed.switchDatabase();
    assert.equal(result.phase, 'database_switched');
    assert.equal(fs.readFileSync(f.activePath, 'utf8'), 'new database');
    assert.equal(fs.readFileSync(f.backupPath, 'utf8'), 'old database');
    assert.notEqual(result.phase, 'complete');
    const receipt = { generationId: f.generationId, complete: true, manifestDigest: 'c'.repeat(64) };
    assert.equal(resumed.completeCleanup(receipt).phase, 'complete');
    assert.equal(resumed.completeCleanup(receipt).phase, 'complete');
  });
}
test('a missing stopped fence, changed backup or non-cold WAL blocks switching', t => {
  const f = fixture(t);
  assert.throws(() => createGenerationSwitch({ ...f, assertStopped: () => { throw Error('running'); } }).prepare(), /running/);
  fs.writeFileSync(f.activePath + '-wal', 'uncheckpointed');
  assert.throws(() => createGenerationSwitch(f).prepare(), { code: 'RESET_GENERATION_NOT_COLD' });
  fs.unlinkSync(f.activePath + '-wal'); fs.writeFileSync(f.backupPath, 'not the backup');
  assert.throws(() => createGenerationSwitch(f).prepare(), { code: 'RESET_GENERATION_FILE_CHANGED' });
  assert.equal(fs.readFileSync(f.activePath, 'utf8'), 'old database');
});
test('incomplete cleanup and tampered receipts are never reported as successful Reset', t => {
  const f = fixture(t), operation = createGenerationSwitch(f); operation.switchDatabase();
  assert.throws(() => operation.completeCleanup({ generationId: f.generationId, complete: false }),
    { code: 'RESET_GENERATION_CLEANUP_INCOMPLETE' });
  const record = JSON.parse(fs.readFileSync(f.journalPath, 'utf8')); record.phase = 'complete';
  fs.writeFileSync(f.journalPath, JSON.stringify(record));
  assert.throws(() => createGenerationSwitch(f).switchDatabase(), { code: 'RESET_GENERATION_RECEIPT_CORRUPT' });
});

test('a switched marker cannot authorize cleanup of a changed live database', t => {
  const f = fixture(t), operation = createGenerationSwitch(f); operation.switchDatabase();
  fs.writeFileSync(f.activePath, 'unexpected writes after switch');
  assert.throws(() => operation.completeCleanup({ generationId: f.generationId, complete: true, manifestDigest: 'c'.repeat(64) }),
    { code: 'RESET_GENERATION_FILE_CHANGED' });
  assert.equal(operation.read().phase, 'database_switched');
});
