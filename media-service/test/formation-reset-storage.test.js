'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectTemporaryStorage, assertStorageUnchanged, buildStorageBudget } = require('../scripts/formation-reset-storage');
const { linuxMountPoints, assertNoNestedMounts } = require('../scripts/formation-reset-storage');

test('Linux same-device bind mounts and escaped mount names are rejected under a private root', () => {
  const points = linuxMountPoints('29 1 8:1 / /transcode rw - ext4 /dev/a rw\n30 29 8:1 /collection /transcode/other\\040media rw - ext4 /dev/a rw\n');
  assert.deepEqual(points, ['/transcode', '/transcode/other media']);
  assert.doesNotThrow(() => assertNoNestedMounts(['/transcode'], ['/transcode']));
  // Use the host separator too, so the mount-boundary predicate is covered
  // on Windows without pretending to create an actual Linux bind mount.
  const root = path.resolve('private');
  assert.throws(() => assertNoNestedMounts([root], [root, path.join(root, 'other media')]),
    { code: 'RESET_STORAGE_NESTED_MOUNT_REFUSED' });
  assert.throws(() => linuxMountPoints('invalid mount record'), { code: 'RESET_STORAGE_MOUNT_TABLE_INVALID' });
});

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'reset-storage-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), workspace = path.join(root, 'workspace');
  fs.mkdirSync(source); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(source, 'original.mkv'), 'source media');
  fs.writeFileSync(path.join(workspace, 'partial.mp4'), 'partial output');
  return { root, source, workspace, options: { roots: [workspace], protectedDirectories: [source] } };
}
test('inventory freezes exact private bytes without touching source files', t => {
  const f = fixture(t), inventory = inspectTemporaryStorage(f.options);
  assert.equal(inventory.bytes, '14');
  assert.equal(inventory.entries.filter(x => x.kind === 'file').length, 1);
  assert.equal(assertStorageUnchanged(inventory, f.options).digest, inventory.digest);
  assert.equal(fs.readFileSync(path.join(f.source, 'original.mkv'), 'utf8'), 'source media');
});
test('source ancestor, source descendant and duplicate roots cannot be cleaned', t => {
  const f = fixture(t), nested = path.join(f.source, 'nested'); fs.mkdirSync(nested);
  for (const root of [f.source, f.root, nested])
    assert.throws(() => inspectTemporaryStorage({ ...f.options, roots: [root] }), { code: 'RESET_STORAGE_BOUNDARY_OVERLAP' });
  assert.throws(() => inspectTemporaryStorage({ ...f.options, roots: [f.workspace, f.workspace] }),
    { code: 'RESET_STORAGE_ROOT_DUPLICATE' });
});
test('new files and changed bytes invalidate the frozen inventory', t => {
  const f = fixture(t), inventory = inspectTemporaryStorage(f.options);
  fs.writeFileSync(path.join(f.workspace, 'new.mp4'), 'late worker');
  assert.throws(() => assertStorageUnchanged(inventory, f.options), { code: 'RESET_STORAGE_CHANGED' });
  fs.unlinkSync(path.join(f.workspace, 'new.mp4'));
  const next = inspectTemporaryStorage(f.options);
  fs.writeFileSync(path.join(f.workspace, 'partial.mp4'), 'changed output');
  assert.throws(() => assertStorageUnchanged(next, f.options), { code: 'RESET_STORAGE_CHANGED' });
});
test('a directory junction into source is refused', t => {
  const f = fixture(t);
  fs.symlinkSync(f.source, path.join(f.workspace, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inspectTemporaryStorage(f.options), { code: 'RESET_STORAGE_ALIAS_REFUSED' });
});
test('hard-linked collection references are protected even under a private root', t => {
  const f = fixture(t), original = path.join(f.source, 'original.mkv');
  fs.linkSync(original, path.join(f.workspace, 'linked.mkv'));
  assert.throws(() => inspectTemporaryStorage({ ...f.options, protectedFiles: [original] }),
    { code: 'RESET_STORAGE_PROTECTED_FILE' });
});
test('same-volume backup and staging are added before any future cleanup', t => {
  const f = fixture(t);
  const budget = buildStorageBudget({ reserveBytes: 10n,
    allocations: [{ directory: f.source, purpose: 'backup', bytes: 60n },
      { directory: f.workspace, purpose: 'database-generation', bytes: 40n }],
    statfs: () => ({ bavail: 100n, bsize: 1n }), stat: () => ({ dev: 1n }) });
  assert.equal(budget.ready, false);
  assert.equal(budget.volumes.length, 1);
  assert.equal(budget.volumes[0].requiredBytes, '110');
});
test('capacity on a different device cannot pay for the full device', t => {
  const f = fixture(t);
  const budget = buildStorageBudget({ reserveBytes: 10n,
    allocations: [{ directory: f.source, purpose: 'image', bytes: 90n },
      { directory: f.workspace, purpose: 'backup', bytes: 90n }],
    statfs: p => ({ bavail: p === f.source ? 99n : 1000n, bsize: 1n }),
    stat: p => ({ dev: p === f.source ? 1n : 2n }) });
  assert.equal(budget.ready, false);
  assert.equal(budget.volumes.filter(v => !v.sufficient).length, 1);
});
