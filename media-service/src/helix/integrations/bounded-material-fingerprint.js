'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { CooperativeDeadlineError, awaitWithinDeadline } = require('./cooperative-deadline');

const FINGERPRINT_SAMPLE_BYTES = 256 * 1024;

class BoundedMaterialFingerprintError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BoundedMaterialFingerprintError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new BoundedMaterialFingerprintError(code, message, details); }
function sameIdentity(left, right) {
  // inode+size only: a scanner or NAS can touch mtime/ctime without replacing bytes.
  return left.ino === right.ino && left.size === right.size;
}
function sameStableSnapshot(left, right) {
  return sameIdentity(left, right) && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}
function sampleBounds(sizeBytes) {
  const sampleLength = Math.min(sizeBytes, FINGERPRINT_SAMPLE_BYTES);
  return Object.freeze({ sampleLength, sampleOffset:Math.floor((sizeBytes - sampleLength) / 2) });
}
function fingerprintBuffer(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new TypeError('Bounded fingerprint input must be a Buffer.');
  const { sampleLength, sampleOffset } = sampleBounds(bytes.length);
  return Object.freeze({
    fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
    contentFingerprint:crypto.createHash('sha256').update(bytes.subarray(sampleOffset, sampleOffset + sampleLength)).digest('hex'),
    sampleOffset, sampleLength, bytesSampled:sampleLength,
  });
}
function validatePathStat(stat, location) {
  if (stat.isSymbolicLink() || !stat.isFile()) fail('PHYSICAL_MATERIAL_FILE_UNSAFE', 'Physical Material fingerprint requires a regular non-symbolic-link file.', { location });
  if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('PHYSICAL_MATERIAL_FILE_TOO_LARGE', 'Physical Material size exceeds the safe integer contract.', { location });
}

async function computeAsyncCore(location, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const bounded = (stage, operation) => awaitWithinDeadline(operation, {
    signal:options.signal, deadlineAtMs:options.deadlineAtMs, now:options.now,
    setTimeout:options.setTimeout, clearTimeout:options.clearTimeout, stage, location,
  });
  const pathBefore = await bounded('path_lstat_before', () => fsPromises.lstat(location, { bigint:true }));
  validatePathStat(pathBefore, location);
  const opening = Promise.resolve().then(() => fsPromises.open(location, 'r'));
  let handle;
  try { handle = await bounded('file_open', () => opening); }
  catch (error) {
    opening.then((lateHandle) => lateHandle.close()).catch(() => {});
    throw error;
  }
  try {
    const before = await bounded('file_stat_before', () => handle.stat({ bigint:true }));
    if (!sameIdentity(pathBefore, before)) fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed before fingerprint sampling.', { location });
    const sizeBytes = Number(before.size);
    const { sampleLength, sampleOffset } = sampleBounds(sizeBytes);
    const sample = Buffer.allocUnsafe(sampleLength);
    let bytesSampled = 0;
    while (bytesSampled < sampleLength) {
      const read = await bounded('file_sample_read', () => handle.read(
        sample, bytesSampled, sampleLength - bytesSampled, sampleOffset + bytesSampled));
      if (typeof options.onRead === 'function') options.onRead(Object.freeze({
        location,
        requestedBytes:sampleLength - bytesSampled,
        bytesRead:read.bytesRead,
        position:sampleOffset + bytesSampled,
      }));
      if (read.bytesRead === 0) fail('PHYSICAL_MATERIAL_FINGERPRINT_SHORT_READ', 'Physical Material fingerprint sampling ended early.', { location, sampleOffset, sampleLength, bytesSampled });
      bytesSampled += read.bytesRead;
    }
    const after = await bounded('file_stat_after', () => handle.stat({ bigint:true }));
    const pathAfter = await bounded('path_lstat_after', () => fsPromises.lstat(location, { bigint:true }));
    if (!sameIdentity(before, after) || pathAfter.isSymbolicLink() || !sameIdentity(after, pathAfter)) fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed during fingerprint sampling.', { location });
    return Object.freeze({ stat:after, ...fingerprintBuffer(sample), sampleOffset, sampleLength, bytesSampled });
  } finally {
    if (options.signal?.aborted || options.deadlineAtMs !== undefined && (options.now || Date.now)() >= options.deadlineAtMs) {
      Promise.resolve().then(() => handle.close()).catch(() => {});
    } else {
      await bounded('file_close', () => handle.close());
    }
  }
}

function computeSyncCore(location, options = {}) {
  const fileSystem = options.fs || fs;
  const pathBefore = fileSystem.lstatSync(location, { bigint:true });
  validatePathStat(pathBefore, location);
  const descriptor = fileSystem.openSync(location, 'r');
  try {
    const before = fileSystem.fstatSync(descriptor, { bigint:true });
    if (!sameIdentity(pathBefore, before)) fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed before fingerprint sampling.', { location });
    const sizeBytes = Number(before.size);
    const { sampleLength, sampleOffset } = sampleBounds(sizeBytes);
    const sample = Buffer.allocUnsafe(sampleLength);
    let bytesSampled = 0;
    while (bytesSampled < sampleLength) {
      const bytesRead = fileSystem.readSync(descriptor, sample, bytesSampled, sampleLength - bytesSampled, sampleOffset + bytesSampled);
      if (typeof options.onRead === 'function') options.onRead(Object.freeze({
        location,
        requestedBytes:sampleLength - bytesSampled,
        bytesRead,
        position:sampleOffset + bytesSampled,
      }));
      if (bytesRead === 0) fail('PHYSICAL_MATERIAL_FINGERPRINT_SHORT_READ', 'Physical Material fingerprint sampling ended early.', { location, sampleOffset, sampleLength, bytesSampled });
      bytesSampled += bytesRead;
    }
    const after = fileSystem.fstatSync(descriptor, { bigint:true });
    const pathAfter = fileSystem.lstatSync(location, { bigint:true });
    if (!sameIdentity(before, after) || pathAfter.isSymbolicLink() || !sameIdentity(after, pathAfter)) fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed during fingerprint sampling.', { location });
    return Object.freeze({ stat:after, ...fingerprintBuffer(sample), sampleOffset, sampleLength, bytesSampled });
  } finally { fileSystem.closeSync(descriptor); }
}

async function readBoundedFileSnapshotCore(location, maxBytes, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const pathBefore = await fsPromises.lstat(location, { bigint:true });
  validatePathStat(pathBefore, location);
  if (pathBefore.size > BigInt(maxBytes)) {
    fail('PHYSICAL_MATERIAL_FILE_TOO_LARGE', 'Physical Material exceeds the bounded snapshot contract.', {
      location, maxBytes,
    });
  }
  const handle = await fsPromises.open(location, 'r');
  try {
    const before = await handle.stat({ bigint:true });
    if (!sameStableSnapshot(pathBefore, before)) {
      fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed before bounded snapshot read.', { location });
    }
    const bytes = Buffer.allocUnsafe(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) {
        fail('PHYSICAL_MATERIAL_FINGERPRINT_SHORT_READ', 'Physical Material bounded snapshot ended early.', {
          location, expectedBytes:bytes.length, bytesRead:offset,
        });
      }
      offset += read.bytesRead;
    }
    const after = await handle.stat({ bigint:true });
    const pathAfter = await fsPromises.lstat(location, { bigint:true });
    if (!sameStableSnapshot(before, after) || pathAfter.isSymbolicLink() ||
        !sameStableSnapshot(after, pathAfter)) {
      fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed during bounded snapshot read.', { location });
    }
    return Object.freeze({ bytes, stat:after, ...fingerprintBuffer(bytes), bytesSampled:bytes.length });
  } finally { await handle.close(); }
}

function readBoundedFileSnapshotSyncCore(location, maxBytes, options = {}) {
  const fileSystem = options.fs || fs;
  const pathBefore = fileSystem.lstatSync(location, { bigint:true });
  validatePathStat(pathBefore, location);
  if (pathBefore.size > BigInt(maxBytes)) {
    fail('PHYSICAL_MATERIAL_FILE_TOO_LARGE', 'Physical Material exceeds the bounded snapshot contract.', {
      location, maxBytes,
    });
  }
  const descriptor = fileSystem.openSync(location, 'r');
  try {
    const before = fileSystem.fstatSync(descriptor, { bigint:true });
    if (!sameStableSnapshot(pathBefore, before)) {
      fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed before bounded snapshot read.', { location });
    }
    const bytes = Buffer.allocUnsafe(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const bytesRead = fileSystem.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) {
        fail('PHYSICAL_MATERIAL_FINGERPRINT_SHORT_READ', 'Physical Material bounded snapshot ended early.', {
          location, expectedBytes:bytes.length, bytesRead:offset,
        });
      }
      offset += bytesRead;
    }
    const after = fileSystem.fstatSync(descriptor, { bigint:true });
    const pathAfter = fileSystem.lstatSync(location, { bigint:true });
    if (!sameStableSnapshot(before, after) || pathAfter.isSymbolicLink() ||
        !sameStableSnapshot(after, pathAfter)) {
      fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed during bounded snapshot read.', { location });
    }
    return Object.freeze({ bytes, stat:after, ...fingerprintBuffer(bytes), bytesSampled:bytes.length });
  } finally { fileSystem.closeSync(descriptor); }
}

async function computeBoundedMaterialFingerprint(location, options = {}) {
  try { return await computeAsyncCore(location, options); }
  catch (error) {
    if (error instanceof BoundedMaterialFingerprintError || error instanceof CooperativeDeadlineError) throw error;
    fail('PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED', 'Physical Material fingerprint I/O failed.', {
      location, causeCode:error?.code || 'UNKNOWN_IO_ERROR',
    });
  }
}

function computeBoundedMaterialFingerprintSync(location, options = {}) {
  try { return computeSyncCore(location, options); }
  catch (error) {
    if (error instanceof BoundedMaterialFingerprintError) throw error;
    fail('PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED', 'Physical Material fingerprint I/O failed.', {
      location, causeCode:error?.code || 'UNKNOWN_IO_ERROR',
    });
  }
}

async function readBoundedFileSnapshot(location, maxBytes, options = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('Bounded snapshot maxBytes is invalid.');
  try { return await readBoundedFileSnapshotCore(location, maxBytes, options); }
  catch (error) {
    if (error instanceof BoundedMaterialFingerprintError) throw error;
    fail('PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED', 'Physical Material bounded snapshot I/O failed.', {
      location, causeCode:error?.code || 'UNKNOWN_IO_ERROR',
    });
  }
}

function readBoundedFileSnapshotSync(location, maxBytes, options = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('Bounded snapshot maxBytes is invalid.');
  try { return readBoundedFileSnapshotSyncCore(location, maxBytes, options); }
  catch (error) {
    if (error instanceof BoundedMaterialFingerprintError) throw error;
    fail('PHYSICAL_MATERIAL_FINGERPRINT_IO_FAILED', 'Physical Material bounded snapshot I/O failed.', {
      location, causeCode:error?.code || 'UNKNOWN_IO_ERROR',
    });
  }
}

module.exports = Object.freeze({
  BoundedMaterialFingerprintError, FINGERPRINT_SAMPLE_BYTES,
  computeBoundedMaterialFingerprint, computeBoundedMaterialFingerprintSync, fingerprintBuffer,
  readBoundedFileSnapshot, readBoundedFileSnapshotSync,
});
