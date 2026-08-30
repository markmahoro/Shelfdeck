'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FINGERPRINT_SAMPLE_BYTES, computeBoundedMaterialFingerprint } = require('./helix/integrations/bounded-material-fingerprint');
const { CooperativeDeadlineError, assertWithinDeadline, awaitWithinDeadline } = require('./helix/integrations/cooperative-deadline');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const {
  identityBasis,
} = require('./helix/domains/procurement/model/field-observation-contracts');
const {
  isArcaTargetCommitSlotName,
} = require('./clean-arca-target-commit-slot');

const MAX_FILES_PER_SCAN = 100_000;
const MAX_FINGERPRINTED_FILES_PER_PAGE = 256;
// One observation page may sample at most 256 files. With the fixed 256 KiB
// fingerprint ceiling this is exactly a 64 MiB physical-read budget.
const DEFAULT_FINGERPRINTED_FILES_PER_BATCH = 256;
const INT64_MAX = 9_223_372_036_854_775_807n;

class CleanFieldObservationEnumeratorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanFieldObservationEnumeratorError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanFieldObservationEnumeratorError(code, message, details);
}

function normalizedLocation(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

function checkedInt64(value, field, location) {
  if (value < 0n || value > INT64_MAX) {
    fail('FIELD_OBSERVATION_FILE_FACT_INVALID', '文件事实超出Field Observation的整数范围。', {
      field,
      location,
    });
  }
  return value.toString();
}

function inspectObservationRootSync(rootLocation) {
  const resolved = path.resolve(rootLocation);
  let root;
  try {
    root = fs.statSync(resolved);
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch (error) {
    fail('FIELD_OBSERVATION_ROOT_UNAVAILABLE', 'Material Field当前物理访问位置不可读。', {
      rootLocation,
      cause: error.code || 'READ_FAILED',
    });
  }
  if (!root.isDirectory()) {
    fail('FIELD_OBSERVATION_ROOT_NOT_DIRECTORY', 'Material Field访问位置必须是目录。', {
      rootLocation,
    });
  }
  return resolved;
}

async function inspectObservationRoot(rootLocation, execution = {}, fsPromises = fs.promises) {
  const resolved = path.resolve(rootLocation);
  let root;
  try {
    root = await awaitWithinDeadline(() => fsPromises.stat(resolved, { bigint:true }), {
      ...execution, stage:'observation_root_stat', location:resolved,
    });
    await awaitWithinDeadline(() => fsPromises.access(resolved, fs.constants.R_OK), {
      ...execution, stage:'observation_root_access', location:resolved,
    });
  } catch (error) {
    if (error instanceof CooperativeDeadlineError) throw error;
    fail('FIELD_OBSERVATION_ROOT_UNAVAILABLE', 'Material Field当前物理访问位置不可读。', {
      rootLocation,
      cause: error.code || 'READ_FAILED',
    });
  }
  if (!root.isDirectory()) {
    fail('FIELD_OBSERVATION_ROOT_NOT_DIRECTORY', 'Material Field访问位置必须是目录。', {
      rootLocation,
    });
  }
  return resolved;
}

async function collectFiles(rootLocation, execution = {}, fsPromises = fs.promises) {
  const pending = [path.resolve(rootLocation)];
  const files = [];
  while (pending.length) {
    const directory = pending.pop();
    const entries = await awaitWithinDeadline(() => fsPromises.readdir(directory, { withFileTypes:true }), {
      ...execution, stage:'observation_directory_read', location:directory,
    });
    entries.sort((left, right) => Buffer.compare(
      Buffer.from(left.name, 'utf8'),
      Buffer.from(right.name, 'utf8'),
    ));
    for (const entry of entries) {
      const location = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (isArcaTargetCommitSlotName(entry.name)) continue;
        pending.push(location);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(location);
      if (files.length > MAX_FILES_PER_SCAN) {
        fail(
          'FIELD_OBSERVATION_SCAN_BUDGET_EXCEEDED',
          '一次显式观察超过Clean Service的有界文件预算。',
          { maximumFiles: MAX_FILES_PER_SCAN },
        );
      }
    }
  }
  files.sort((left, right) => Buffer.compare(
    Buffer.from(normalizedLocation(path.relative(rootLocation, left)), 'utf8'),
    Buffer.from(normalizedLocation(path.relative(rootLocation, right)), 'utf8'),
  ));
  return files;
}

function pathCursor(rootLocation, location) {
  return 'path:' + Buffer.from(normalizedLocation(path.relative(rootLocation, location)), 'utf8').toString('base64url');
}

function decodePathCursor(cursor) {
  if (cursor === null) return null;
  if (typeof cursor !== 'string' || !cursor.startsWith('path:')) fail('FIELD_OBSERVATION_CURSOR_INVALID', 'Field Observation cursor is invalid.');
  try { return Buffer.from(cursor.slice(5), 'base64url').toString('utf8'); }
  catch { fail('FIELD_OBSERVATION_CURSOR_INVALID', 'Field Observation cursor is invalid.'); }
}

async function observeFile(location, fieldAccessHandle, now, fingerprintOptions) {
  const sampled = await computeBoundedMaterialFingerprint(location, fingerprintOptions);
  const stat = sampled.stat;
  const inode = checkedInt64(stat.ino, 'inode', location);
  const materialKey = canonicalDigest(identityBasis({ mountScopeId:fieldAccessHandle.mountScopeId, inode,
    sizeBytes:Number(stat.size), fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
    contentFingerprint:sampled.contentFingerprint }));
  return Object.freeze({ materialKey, material:Object.freeze({ inode, contentFingerprint:sampled.contentFingerprint,
    fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, sampleOffset:sampled.sampleOffset,
    sampleLength:sampled.sampleLength, bytesSampled:sampled.bytesSampled, location:normalizedLocation(location),
    sizeBytes:Number(stat.size), mtimeNs:checkedInt64(stat.mtimeNs, 'mtimeNs', location),
    ctimeNs:checkedInt64(stat.ctimeNs, 'ctimeNs', location), fingerprintVerifiedAtMs:now() }) });
}

function createCleanFieldObservationEnumerator(options = {}) {
  const now = options.now || Date.now;
  const fsPromises = options.fsPromises || fs.promises;
  const batchLimit = options.batchLimit || DEFAULT_FINGERPRINTED_FILES_PER_BATCH;
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > MAX_FINGERPRINTED_FILES_PER_PAGE) {
    fail('FIELD_OBSERVATION_BATCH_LIMIT_INVALID', 'Field Observation batch limit is invalid.', {
      maximum: MAX_FINGERPRINTED_FILES_PER_PAGE,
    });
  }
  const locationSnapshots = new Map();
  async function locations(fieldAccessHandle, execution = {}) {
    const rootLocation=path.resolve(fieldAccessHandle.rootLocation);
    const key=fieldAccessHandle.handleId+'\u0000'+fieldAccessHandle.accessDigest;
    if(!locationSnapshots.has(key)){
      const pending=(async()=>{
        await inspectObservationRoot(rootLocation, execution, fsPromises);
        return collectFiles(rootLocation, execution, fsPromises);
      })();
      locationSnapshots.set(key,pending);
      pending.catch(()=>{if(locationSnapshots.get(key)===pending)locationSnapshots.delete(key);});
    }
    return Object.freeze({rootLocation,items:await locationSnapshots.get(key)});
  }
  return Object.freeze({
    async enumeratePage({ fieldAccessHandle, pageRequest, deadlineAtMs, abortSignal }) {
      const execution={signal:abortSignal,deadlineAtMs,now};
      const inventory=await locations(fieldAccessHandle,execution);const cursorRelative=decodePathCursor(pageRequest.cursorIn);
      const start=cursorRelative===null?0:inventory.items.findIndex((location)=>Buffer.compare(
        Buffer.from(normalizedLocation(path.relative(inventory.rootLocation,location)),'utf8'),Buffer.from(cursorRelative,'utf8'))>0);
      const startIndex=start<0?inventory.items.length:start;
      const selected=inventory.items.slice(startIndex,startIndex+Math.min(
        pageRequest.pageBudget,
        MAX_FINGERPRINTED_FILES_PER_PAGE,
        batchLimit,
      ));
      const fingerprintOptions={onRead:options.onFingerprintRead,fsPromises,signal:abortSignal,deadlineAtMs,now};
      const observed=(await Promise.all(selected.map((location)=>observeFile(location,fieldAccessHandle,now,fingerprintOptions)))).filter(Boolean);
      assertWithinDeadline({...execution,stage:'observation_page_before_return',location:inventory.rootLocation});
      observed.sort((left,right)=>Buffer.compare(Buffer.from(left.materialKey),Buffer.from(right.materialKey)));
      const boundary=selected.length?pathCursor(inventory.rootLocation,selected.at(-1)):null;
      const items=observed.map((item)=>Object.freeze({cursor:boundary,material:item.material}));
      return Object.freeze({items:Object.freeze(items),hasMore:startIndex+selected.length<inventory.items.length,
        sourceFileCount:inventory.items.length});
    },
    async scan(fieldAccessHandle) {
      const rootLocation = await inspectObservationRoot(fieldAccessHandle.rootLocation, {}, fsPromises);
      const locations = await collectFiles(rootLocation, {}, fsPromises);
      const items = [];
      for (const location of locations) {
        const observed=await observeFile(location,fieldAccessHandle,now,{onRead:options.onFingerprintRead,fsPromises});if(observed)items.push(Object.freeze({cursor:observed.materialKey,material:observed.material}));
      }
      items.sort((left, right) => Buffer.compare(
        Buffer.from(left.cursor, 'utf8'),
        Buffer.from(right.cursor, 'utf8'),
      ));
      return Object.freeze({
        rootLocation: normalizedLocation(rootLocation),
        items: Object.freeze(items),
        sourceFileCount: items.length,
      });
    },
  });
}

module.exports = Object.freeze({
  CleanFieldObservationEnumeratorError,
  MAX_FILES_PER_SCAN,
  FINGERPRINT_SAMPLE_BYTES,
  MAX_FINGERPRINTED_FILES_PER_PAGE,
  DEFAULT_FINGERPRINTED_FILES_PER_BATCH,
  inspectObservationRootSync,
  createCleanFieldObservationEnumerator,
});
