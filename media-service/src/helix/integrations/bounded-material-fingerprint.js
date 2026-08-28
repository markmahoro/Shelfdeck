'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

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
  const pathBefore = await fsPromises.lstat(location, { bigint:true });
  validatePathStat(pathBefore, location);
  const handle = await fsPromises.open(location, 'r');
  try {
    const before = await handle.stat({ bigint:true });
    if (!sameIdentity(pathBefore, before)) fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed before fingerprint sampling.', { location });
    const sizeBytes = Number(before.size);
    const { sampleLength, sampleOffset } = sampleBounds(sizeBytes);
    const sample = Buffer.allocUnsafe(sampleLength);
    let bytesSampled = 0;
    while (bytesSampled < sampleLength) {
      const read = await handle.read(sample, bytesSampled, sampleLength - bytesSampled, sampleOffset + bytesSampled);
      if (typeof options.onRead === 'function') options.onRead(Object.freeze({
        location,
        requestedBytes:sampleLength - bytesSampled,
        bytesRead:read.bytesRead,
        position:sampleOffset + bytesSampled,
      }));
      if (read.bytesRead === 0) fail('PHYSICAL_MATERIAL_FINGERPRINT_SHORT_READ', 'Physical Material fingerprint sampling ended early.', { location, sampleOffset, sampleLength, bytesSampled });
      bytesSampled += read.bytesRead;
    }
    const after = await handle.stat({ bigint:true });
    const pathAfter = await fsPromises.lstat(location, { bigint:true });
    if (!sameIdentity(before, after) || pathAfter.isSymbolicLink() || !sameIdentity(after, pathAfter)) fail('PHYSICAL_MATERIAL_STAT_FENCE_CHANGED', 'Physical Material changed during fingerprint sampling.', { location });
    return Object.freeze({ stat:after, ...fingerprintBuffer(sample), sampleOffset, sampleLength, bytesSampled });
  } finally { await handle.close(); }
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

async function computeBoundedMaterialFingerprint(location, options = {}) {
  try { return await computeAsyncCore(location, options); }
  catch (error) {
    if (error instanceof BoundedMaterialFingerprintError) throw error;
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

module.exports = Object.freeze({
  BoundedMaterialFingerprintError, FINGERPRINT_SAMPLE_BYTES,
  computeBoundedMaterialFingerprint, computeBoundedMaterialFingerprintSync, fingerprintBuffer,
});
