'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { files } = require('../../scripts/helix-operational-safety');

function fixture(t) {
  const parent = fs.realpathSync.native(os.tmpdir());
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(parent, 'helix-p13-hash-')));
  t.after(() => {
    const actual = fs.realpathSync.native(root);
    assert.equal(path.dirname(actual), parent);
    assert.ok(path.basename(actual).startsWith('helix-p13-hash-'));
    fs.rmSync(actual, { recursive: true, force: true });
  });
  return root;
}

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function withUnchangedStatTimes(run) {
  const original = fs.fstatSync;
  let initial;
  fs.fstatSync = function(...args) {
    const stat = original.apply(fs, args);
    if (stat.isFile() && typeof stat.mtimeNs === 'bigint') {
      if (!initial) initial = { mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs };
      stat.mtimeNs = initial.mtimeNs;
      stat.ctimeNs = initial.ctimeNs;
    }
    return stat;
  };
  try { return run(); } finally { fs.fstatSync = original; }
}

test('backup evidence preserves stable binary and empty file digests', t => {
  const root = fixture(t), binary = Buffer.alloc(2 * 1024 * 1024 + 17, 0x5a);
  binary[binary.length - 1] = 0x31;
  fs.writeFileSync(path.join(root, 'binary.dat'), binary);
  fs.writeFileSync(path.join(root, 'empty.dat'), Buffer.alloc(0));
  assert.deepEqual(files(root), [
    { path: 'binary.dat', bytes: binary.length, digest: sha(binary) },
    { path: 'empty.dat', bytes: 0, digest: sha(Buffer.alloc(0)) },
  ]);
});

for (const changedPass of [1, 2]) test(`backup rejects changed bytes during pass ${changedPass} even with unchanged timestamps`, t => {
  const root = fixture(t), file = path.join(root, 'changing.dat'), size = 2 * 1024 * 1024;
  fs.writeFileSync(file, Buffer.alloc(size));
  const read = fs.readSync; let starts = 0, changed = false;
  fs.readSync = function(descriptor, buffer, offset, length, position) {
    const count = read.call(fs, descriptor, buffer, offset, length, position);
    if (count > 0 && (position === 0 || position === null && starts === 0)) starts++;
    if (!changed && count > 0 && starts === changedPass) {
      changed = true;
      fs.writeFileSync(file, Buffer.alloc(size, 1));
    }
    return count;
  };
  try {
    withUnchangedStatTimes(() => assert.throws(() => files(root), /P13_BACKUP_FILE_CHANGED/));
    assert.equal(changed, true, 'The intended read pass must actually encounter the mutation.');
  } finally { fs.readSync = read; }
});

test('backup rejects a path replaced during hashing even when the open file stays unchanged', t => {
  const root = fixture(t), source = path.join(root, 'source');
  fs.mkdirSync(source);
  const file = path.join(source, 'changing.dat'), replacement = path.join(root, 'replacement.dat');
  const size = 2 * 1024 * 1024;
  fs.writeFileSync(file, Buffer.alloc(size));
  fs.writeFileSync(replacement, Buffer.alloc(size, 1));
  const read = fs.readSync; let replaced = false, denied;
  fs.readSync = function(descriptor, ...args) {
    const count = read.call(fs, descriptor, ...args);
    if (!replaced && count > 0) {
      try { fs.renameSync(replacement, file); } catch (error) { denied = error; throw error; }
      replaced = true;
    }
    return count;
  };
  try {
    let error;
    try { withUnchangedStatTimes(() => files(source)); } catch (caught) { error = caught; }
    if (!replaced && process.platform === 'win32' && error === denied && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
      t.skip('This Windows filesystem denied replacing an open file.');
      return;
    }
    assert.match(error && error.message || '', /P13_BACKUP_FILE_CHANGED/);
    assert.equal(replaced, true, 'The path replacement must actually occur.');
    assert.equal(sha(fs.readFileSync(file)), sha(Buffer.alloc(size, 1)));
  } finally { fs.readSync = read; }
});

for (const phase of ['before', 'after']) test(`backup rejects a different path identity ${phase} reading`, t => {
  const root = fixture(t), source = path.join(root, 'source');
  fs.mkdirSync(source);
  const file = path.join(source, 'data.dat'), replacement = path.join(root, 'other.dat');
  fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024));
  fs.writeFileSync(replacement, Buffer.alloc(2 * 1024 * 1024, 1));
  const alternative = fs.lstatSync(replacement, { bigint: true });
  const stat = fs.lstatSync, read = fs.readSync; let reading = false, injected = false;
  fs.readSync = function(...args) { reading = true; return read.apply(fs, args); };
  fs.lstatSync = function(location, ...args) {
    if (location === file && (phase === 'before' || reading)) {
      injected = true;
      return alternative;
    }
    return stat.call(fs, location, ...args);
  };
  try {
    assert.throws(() => files(source), /P13_BACKUP_FILE_CHANGED/);
    assert.equal(injected, true, 'A different path identity must actually be observed.');
  } finally { fs.lstatSync = stat; fs.readSync = read; }
});

test('backup rejects a path that disappears during reading', t => {
  const root = fixture(t), file = path.join(root, 'data.dat');
  fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024));
  const stat = fs.lstatSync, read = fs.readSync; let reading = false, injected = false;
  fs.readSync = function(...args) { reading = true; return read.apply(fs, args); };
  fs.lstatSync = function(location, ...args) {
    if (location === file && reading) {
      injected = true;
      throw Object.assign(new Error('injected missing path'), { code: 'ENOENT' });
    }
    return stat.call(fs, location, ...args);
  };
  try {
    assert.throws(() => files(root), /P13_BACKUP_FILE_CHANGED/);
    assert.equal(injected, true, 'The missing-path condition must actually be observed.');
  } finally { fs.lstatSync = stat; fs.readSync = read; }
});
