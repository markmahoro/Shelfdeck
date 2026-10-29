'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { inspectTemporaryStorage } = require('../scripts/formation-reset-storage');
const { cleanTemporaryStorage } = require('../scripts/formation-reset-cleanup');
function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-cleanup-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace'), source = path.join(root, 'source');
  fs.mkdirSync(path.join(workspace, 'nested'), { recursive: true }); fs.mkdirSync(source);
  fs.writeFileSync(path.join(workspace, 'nested', 'partial.mp4'), 'partial');
  fs.writeFileSync(path.join(workspace, 'other'), 'other');
  fs.writeFileSync(path.join(source, 'source.mkv'), 'source bytes');
  const storage = { roots: [workspace], protectedDirectories: [source] };
  return { workspace, source, storage, manifest: inspectTemporaryStorage(storage), generationId: 'a'.repeat(64),
    journalPath: path.join(root, 'cleanup.json'), assertStopped: () => {} };
}
for (const phase of ['prepared', 'delete_intent', 'deleted', 'recorded']) {
  test('private cleanup recovers interruption at ' + phase + ' without deleting source or root', t => {
    const f = fixture(t);
    assert.throws(() => cleanTemporaryStorage({ ...f, checkpoint: p => { if (p === phase) throw Error('crash'); } }), /crash/);
    const receipt = cleanTemporaryStorage(f);
    assert.equal(receipt.complete, true); assert.equal(receipt.deletedEntries, 3);
    assert.deepEqual(fs.readdirSync(f.workspace), []);
    assert.equal(fs.readFileSync(path.join(f.source, 'source.mkv'), 'utf8'), 'source bytes');
    assert.deepEqual(cleanTemporaryStorage(f), receipt);
  });
}
test('a new late output blocks resuming cleanup instead of being recursively deleted', t => {
  const f = fixture(t);
  assert.throws(() => cleanTemporaryStorage({ ...f, checkpoint: p => { if (p === 'deleted') throw Error('crash'); } }), /crash/);
  fs.writeFileSync(path.join(f.workspace, 'late.mp4'), 'late writer');
  assert.throws(() => cleanTemporaryStorage(f), { code: 'RESET_STORAGE_CHANGED' });
  assert.equal(fs.readFileSync(path.join(f.workspace, 'late.mp4'), 'utf8'), 'late writer');
});
test('unexplained missing files and replacement directories invalidate cleanup', t => {
  const f = fixture(t);
  assert.throws(() => cleanTemporaryStorage({ ...f, checkpoint: p => { if (p === 'prepared') throw Error('crash'); } }), /crash/);
  fs.unlinkSync(path.join(f.workspace, 'other'));
  assert.throws(() => cleanTemporaryStorage(f), { code: 'RESET_STORAGE_CHANGED' });
});
test('loss of stopped fence and journals inside source are refused before deletion', t => {
  const f = fixture(t);
  assert.throws(() => cleanTemporaryStorage({ ...f, assertStopped: () => { throw Error('running'); } }), /running/);
  assert.throws(() => cleanTemporaryStorage({ ...f, journalPath: path.join(f.source, 'receipt.json') }),
    { code: 'RESET_CLEANUP_JOURNAL_UNSAFE' });
  assert.equal(fs.readFileSync(path.join(f.workspace, 'other'), 'utf8'), 'other');
});

test('collection maintenance retains its exact private subtree while unrelated temporary siblings are cleared', t => {
  const f = fixture(t), retained = path.join(f.workspace, 'nested', 'maintenance');
  fs.mkdirSync(retained); fs.writeFileSync(path.join(retained, 'repair.mkv'), 'owned maintenance output');
  f.storage.retainedPaths = [retained]; f.manifest = inspectTemporaryStorage(f.storage);
  assert.equal(f.manifest.bytes, '12'); assert.equal(f.manifest.retainedBytes, '24');
  assert.throws(() => cleanTemporaryStorage({ ...f, checkpoint: phase => { if (phase === 'deleted') throw Error('crash'); } }), /crash/);
  const receipt = cleanTemporaryStorage(f);
  assert.equal(receipt.releasedFileBytes, '12'); assert.equal(receipt.retainedFileBytes, '24');
  assert.deepEqual(fs.readdirSync(f.workspace), ['nested']);
  assert.deepEqual(fs.readdirSync(path.join(f.workspace, 'nested')), ['maintenance']);
  assert.equal(fs.readFileSync(path.join(retained, 'repair.mkv'), 'utf8'), 'owned maintenance output');
  assert.equal(fs.readFileSync(path.join(f.source, 'source.mkv'), 'utf8'), 'source bytes');
  assert.deepEqual(cleanTemporaryStorage(f), receipt);
});

test('a single retained file keeps its ancestors but not adjacent incomplete output', t => {
  const f = fixture(t), retained = path.join(f.workspace, 'nested', 'proof.json');
  fs.writeFileSync(retained, 'collection proof');
  f.storage.retainedPaths = [retained]; f.manifest = inspectTemporaryStorage(f.storage);
  const receipt = cleanTemporaryStorage(f);
  assert.equal(receipt.releasedFileBytes, '12');
  assert.deepEqual(fs.readdirSync(path.dirname(retained)), ['proof.json']);
  assert.equal(fs.readFileSync(retained, 'utf8'), 'collection proof');
});

test('retained bytes are rechecked after cleanup and cannot be changed by a delayed writer', t => {
  const f = fixture(t), retained = path.join(f.workspace, 'retained.bin');
  fs.writeFileSync(retained, 'kept'); f.storage.retainedPaths = [retained]; f.manifest = inspectTemporaryStorage(f.storage);
  assert.throws(() => cleanTemporaryStorage({ ...f, checkpoint(phase) {
    if (phase === 'recorded') fs.writeFileSync(retained, 'late mutation');
  } }), { code: 'RESET_STORAGE_CHANGED' });
  const journal = JSON.parse(fs.readFileSync(f.journalPath, 'utf8'));
  assert.equal(journal.phase, 'cleaning', 'changed collection maintenance cannot be reported complete');
});

test('hard-link aliases of retained private output and outside-root retention declarations are refused', t => {
  const f = fixture(t), kept = path.join(f.workspace, 'kept.bin');
  fs.writeFileSync(kept, 'kept'); fs.linkSync(kept, path.join(f.workspace, 'alias.bin'));
  assert.throws(() => inspectTemporaryStorage({ ...f.storage, retainedPaths: [kept] }), { code: 'RESET_STORAGE_PROTECTED_FILE' });
  assert.throws(() => inspectTemporaryStorage({ ...f.storage, retainedPaths: [f.source] }), { code: 'RESET_STORAGE_RETENTION_OUTSIDE_ROOT' });
  assert.throws(() => inspectTemporaryStorage({ ...f.storage, retainedPaths: [f.workspace + path.sep + '..' + path.sep + 'source'] }),
    { code: 'RESET_STORAGE_RETENTION_OUTSIDE_ROOT' });
});
