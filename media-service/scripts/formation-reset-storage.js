'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function key(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function contains(parent, child) {
  return key(parent) === key(child) || key(child).startsWith(key(parent + path.sep));
}
function actualDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('RESET_STORAGE_PATH_INVALID');
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail('RESET_STORAGE_ROOT_REFUSED');
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink() || key(fs.realpathSync.native(resolved)) !== key(resolved))
    fail('RESET_STORAGE_ALIAS_REFUSED');
  return resolved;
}
function checksum(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const bytes = Buffer.allocUnsafe(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, bytes, 0, bytes.length, null))) hash.update(bytes.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}
function identity(stat) {
  return { device: String(stat.dev), inode: String(stat.ino), bytes: String(stat.size),
    modifiedNs: String(stat.mtimeNs), changedNs: String(stat.ctimeNs) };
}

function linuxMountPoints(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const fields = line.split(' ');
    if (fields.length < 10 || !fields.includes('-') || !fields[4].startsWith('/'))
      fail('RESET_STORAGE_MOUNT_TABLE_INVALID');
    return fields[4].replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  });
}

function assertNoNestedMounts(roots, mountPoints) {
  for (const root of roots) {
    // st_dev does not detect a bind mount on the same filesystem. A private
    // root may itself be mounted, but descendants must never cross a mount.
    if (mountPoints.some(mount => key(root) !== key(mount) && contains(root, mount)))
      fail('RESET_STORAGE_NESTED_MOUNT_REFUSED');
  }
}

// Only the Operator supplies configured private roots and the Owner-proven
// protected set. This helper cannot infer deletion rights from missing DB rows.
function inspectTemporaryStorage({ roots, protectedDirectories, protectedFiles = [], retainedPaths = [] }) {
  if (!Array.isArray(roots) || !Array.isArray(protectedDirectories) || !protectedDirectories.length)
    fail('RESET_STORAGE_BOUNDARIES_REQUIRED');
  const protectedRoots = protectedDirectories.map(actualDirectory);
  const privateRoots = roots.map(actualDirectory).sort();
  if (process.platform === 'linux')
    assertNoNestedMounts(privateRoots, linuxMountPoints(fs.readFileSync('/proc/self/mountinfo', 'utf8')));
  if (new Set(privateRoots.map(key)).size !== privateRoots.length) fail('RESET_STORAGE_ROOT_DUPLICATE');
  for (const [index, root] of privateRoots.entries()) {
    if (protectedRoots.some(p => contains(root, p) || contains(p, root)) ||
        privateRoots.some((p, other) => other !== index && (contains(root, p) || contains(p, root))))
      fail('RESET_STORAGE_BOUNDARY_OVERLAP');
  }
  // Owner-proven collection maintenance may still need files inside a private
  // Workspace. Keep those exact subtrees/files and their ancestors; this is not
  // permission to infer that any unowned path in a source directory is trash.
  if (!Array.isArray(retainedPaths)) fail('RESET_STORAGE_RETENTION_INVALID');
  const kept = retainedPaths.map(file => {
    if (typeof file !== 'string' || !path.isAbsolute(file) || !privateRoots.some(root => contains(root, path.resolve(file))))
      fail('RESET_STORAGE_RETENTION_OUTSIDE_ROOT');
    file = path.resolve(file);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile() || key(fs.realpathSync.native(file)) !== key(path.resolve(file)))
      fail('RESET_STORAGE_ALIAS_REFUSED');
    return path.resolve(file);
  });
  if (new Set(kept.map(key)).size !== kept.length) fail('RESET_STORAGE_RETENTION_INVALID');
  const protectedIds = new Set();
  for (const file of protectedFiles) {
    if (!path.isAbsolute(file)) fail('RESET_STORAGE_PATH_INVALID');
    const stat = fs.statSync(file, { bigint: true });
    protectedIds.add(String(stat.dev) + ':' + String(stat.ino));
  }
  const entries = [];
  function visit(root, relative, rootDevice) {
    const absolute = path.join(root, relative);
    const before = fs.lstatSync(absolute, { bigint: true });
    if (before.isSymbolicLink() || key(fs.realpathSync.native(absolute)) !== key(absolute))
      fail('RESET_STORAGE_ALIAS_REFUSED');
    if (String(before.dev) !== rootDevice) fail('RESET_STORAGE_NESTED_MOUNT_REFUSED');
    const disposition = kept.some(file => contains(file, absolute) || before.isDirectory() && contains(absolute, file)) ? 'retain' : 'clear';
    if (disposition === 'clear' && protectedIds.has(String(before.dev) + ':' + String(before.ino))) fail('RESET_STORAGE_PROTECTED_FILE');
    if (before.isDirectory()) {
      entries.push({ root, relative, kind: 'directory', disposition, ...identity(before) });
      for (const name of fs.readdirSync(absolute).sort()) visit(root, path.join(relative, name), rootDevice);
    } else if (before.isFile()) {
      const sha256 = checksum(absolute);
      const after = fs.lstatSync(absolute, { bigint: true });
      if (canonicalDigest(identity(before)) !== canonicalDigest(identity(after))) fail('RESET_STORAGE_CHANGED');
      entries.push({ root, relative, kind: 'file', disposition, ...identity(after), sha256 });
    } else fail('RESET_STORAGE_SPECIAL_FILE_REFUSED');
  }
  for (const root of privateRoots) visit(root, '', String(fs.statSync(root, { bigint: true }).dev));
  const retainedIdentities = new Set(entries.filter(entry => entry.kind === 'file' && entry.disposition === 'retain')
    .map(entry => entry.device + ':' + entry.inode));
  if (entries.some(entry => entry.kind === 'file' && entry.disposition === 'clear' && retainedIdentities.has(entry.device + ':' + entry.inode)))
    fail('RESET_STORAGE_PROTECTED_FILE');
  const value = { schemaRef: 'formation-reset-storage@1', roots: privateRoots, entries,
    bytes: entries.filter(e => e.kind === 'file' && e.disposition === 'clear').reduce((n, e) => n + BigInt(e.bytes), 0n).toString(),
    retainedBytes: entries.filter(e => e.kind === 'file' && e.disposition === 'retain').reduce((n, e) => n + BigInt(e.bytes), 0n).toString() };
  return Object.freeze({ ...value, digest: canonicalDigest(value) });
}

function assertStorageUnchanged(expected, options) {
  const actual = inspectTemporaryStorage(options);
  if (expected.digest !== actual.digest) fail('RESET_STORAGE_CHANGED');
  return actual;
}

// All allocations on the same filesystem share one budget. Future cleanup is
// deliberately not subtracted: backup and staging precede deletion.
function buildStorageBudget({ allocations, reserveBytes, statfs = fs.statfsSync, stat = fs.statSync }) {
  if (typeof reserveBytes !== 'bigint' || reserveBytes < 0n || !Array.isArray(allocations))
    fail('RESET_STORAGE_BUDGET_INVALID');
  const volumes = new Map();
  for (const allocation of allocations) {
    if (typeof allocation.bytes !== 'bigint' || allocation.bytes < 0n ||
        typeof allocation.purpose !== 'string' || !allocation.purpose) fail('RESET_STORAGE_BUDGET_INVALID');
    const root = actualDirectory(allocation.directory);
    const device = String(stat(root, { bigint: true }).dev);
    const space = statfs(root, { bigint: true });
    const available = space.bavail * space.bsize;
    let volume = volumes.get(device);
    if (!volume) volumes.set(device, volume = { device, available, required: reserveBytes, allocations: [] });
    if (available < volume.available) volume.available = available;
    volume.required += allocation.bytes;
    volume.allocations.push({ directory: root, purpose: allocation.purpose, bytes: allocation.bytes.toString() });
  }
  const result = [...volumes.values()].map(v => ({ device: v.device, availableBytes: v.available.toString(),
    requiredBytes: v.required.toString(), reserveBytes: reserveBytes.toString(),
    sufficient: v.available >= v.required, allocations: v.allocations })).sort((a, b) => a.device.localeCompare(b.device));
  return Object.freeze({ ready: result.every(v => v.sufficient), volumes: result, digest: canonicalDigest(result) });
}

module.exports = Object.freeze({ inspectTemporaryStorage, assertStorageUnchanged, buildStorageBudget,
  linuxMountPoints, assertNoNestedMounts });
