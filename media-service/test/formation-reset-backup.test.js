'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { inventoryBackupSources, createVerifiedBackup, verifyBackupFiles } = require('../scripts/formation-reset-backup');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-backup-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['data', 'workspace', 'backups']) fs.mkdirSync(path.join(root, name));
  fs.mkdirSync(path.join(root, 'data', 'archives'));
  fs.writeFileSync(path.join(root, 'data', 'shelfdeck.db'), 'cold database');
  fs.writeFileSync(path.join(root, 'data', 'config.json'), 'configuration');
  fs.writeFileSync(path.join(root, 'data', 'archives', 'old.db'), 'previous backup');
  fs.writeFileSync(path.join(root, 'workspace', 'encode.mp4'), 'interrupted encode');
  const sourceOptions = { roots: [{ id: 'data', path: path.join(root, 'data') }, { id: 'workspace', path: path.join(root, 'workspace') }],
    excludedArchives: [{ path: path.join(root, 'data', 'archives'), reason: 'verified_backup_archive', inventoryDigest: 'a'.repeat(64) }] };
  return { root, sourceOptions, targetRoot: path.join(root, 'backups', 'reset-before'), assertStopped: () => {}, reserveBytes: 0n };
}

test('verified backup preserves cold database, config and private output without recursively copying an inventoried archive', async t => {
  const f = fixture(t), manifest = inventoryBackupSources(f.sourceOptions);
  assert.equal(manifest.entries.filter(row => row.kind === 'file').length, 3);
  const result = await createVerifiedBackup({ ...f, manifest });
  assert.equal(result.fileCount, 3);
  assert.equal(fs.readFileSync(path.join(f.targetRoot, 'workspace', 'encode.mp4'), 'utf8'), 'interrupted encode');
  assert.equal(fs.existsSync(path.join(f.targetRoot, 'data', 'archives')), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'data', 'archives', 'old.db'), 'utf8'), 'previous backup');
  verifyBackupFiles({ targetRoot: f.targetRoot, manifest });
  fs.writeFileSync(path.join(f.targetRoot, 'data', 'config.json'), 'corrupt');
  assert.throws(() => verifyBackupFiles({ targetRoot: f.targetRoot, manifest }), { code: 'RESET_BACKUP_VERIFICATION_FAILED' });
});

test('directory names alone do not authorize an archive exclusion', t => {
  const f = fixture(t);
  assert.throws(() => inventoryBackupSources({ ...f.sourceOptions, excludedArchives: [{ path: path.join(f.root, 'data', 'archives'), reason: 'old' }] }),
    { code: 'RESET_BACKUP_EXCLUSION_UNREVIEWED' });
  assert.equal(inventoryBackupSources({ ...f.sourceOptions, excludedArchives: [] }).entries.filter(row => row.kind === 'file').length, 4);
});

test('space, stopped fence, hot WAL and source drift fail before a successful backup can be claimed', async t => {
  const f = fixture(t), manifest = inventoryBackupSources(f.sourceOptions);
  await assert.rejects(createVerifiedBackup({ ...f, manifest, reserveBytes: 2n ** 62n }), { code: 'RESET_BACKUP_SPACE_INSUFFICIENT' });
  assert.equal(fs.existsSync(f.targetRoot), false);
  await assert.rejects(createVerifiedBackup({ ...f, manifest, assertStopped() { throw Error('not stopped'); } }), /not stopped/);
  fs.writeFileSync(path.join(f.root, 'data', 'shelfdeck.db-wal'), 'uncheckpointed');
  assert.throws(() => inventoryBackupSources(f.sourceOptions), { code: 'RESET_BACKUP_DATABASE_NOT_COLD' });
  fs.unlinkSync(path.join(f.root, 'data', 'shelfdeck.db-wal'));
  fs.writeFileSync(path.join(f.root, 'workspace', 'late-output'), 'late');
  await assert.rejects(createVerifiedBackup({ ...f, manifest }), { code: 'RESET_BACKUP_SOURCE_CHANGED' });
  assert.equal(fs.existsSync(f.targetRoot), false);
});

test('a failed backup remains recognizable and resumes only its exact frozen inventory', async t => {
  const f = fixture(t), manifest = inventoryBackupSources(f.sourceOptions);
  await assert.rejects(createVerifiedBackup({ ...f, manifest, checkpoint() { throw Error('copy interrupted'); } }), /copy interrupted/);
  assert.throws(() => verifyBackupFiles({ targetRoot: f.targetRoot, manifest }));
  const result = await createVerifiedBackup({ ...f, manifest });
  assert.equal(result.fileCount, 3);
  verifyBackupFiles({ targetRoot: f.targetRoot, manifest });
});

for (const phase of ['file_copy_staged', 'file_published', 'file_copied']) {
  test('backup crash at ' + phase + ' cannot publish partial bytes or overwrite an existing archive', async t => {
    const f = fixture(t), manifest = inventoryBackupSources(f.sourceOptions);
    await assert.rejects(createVerifiedBackup({ ...f, manifest, checkpoint(point) { if (point === phase) throw Error('crash'); } }), /crash/);
    const result = await createVerifiedBackup({ ...f, manifest });
    assert.equal(result.fileCount, 3);
    assert.equal(result.retainedPartialCopies.length, phase === 'file_copied' ? 0 : 1);
    for (const partial of result.retainedPartialCopies) assert.equal(fs.existsSync(partial.path), true);
    assert.deepEqual(await createVerifiedBackup({ ...f, manifest }), result);
    assert.notEqual(fs.statSync(path.join(f.targetRoot, 'data/config.json')).ino, fs.statSync(path.join(f.root, 'data/config.json')).ino);
  });
}

test('a preexisting destination or corrupted copied file is never accepted by backup replay', async t => {
  const f = fixture(t), manifest = inventoryBackupSources(f.sourceOptions);
  fs.mkdirSync(f.targetRoot);
  await assert.rejects(createVerifiedBackup({ ...f, manifest }), { code: 'RESET_BACKUP_TARGET_UNSAFE' });
  fs.rmdirSync(f.targetRoot);
  await assert.rejects(createVerifiedBackup({ ...f, manifest, checkpoint(point) { if (point === 'file_copied') throw Error('crash'); } }), /crash/);
  fs.writeFileSync(path.join(f.targetRoot, 'data/config.json'), 'corrupt');
  await assert.rejects(createVerifiedBackup({ ...f, manifest }), { code: 'RESET_BACKUP_VERIFICATION_FAILED' });
});

test('an archive destination cannot be nested in its own input and directory aliases are refused', async t => {
  const f = fixture(t), manifest = inventoryBackupSources(f.sourceOptions);
  await assert.rejects(createVerifiedBackup({ ...f, manifest, targetRoot: path.join(f.root, 'data', 'recursive') }), { code: 'RESET_BACKUP_TARGET_UNSAFE' });
  const link = path.join(f.root, 'alias');
  fs.symlinkSync(path.join(f.root, 'data'), link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inventoryBackupSources({ roots: [{ id: 'data', path: link }] }), { code: 'RESET_BACKUP_PATH_UNSAFE' });
});
