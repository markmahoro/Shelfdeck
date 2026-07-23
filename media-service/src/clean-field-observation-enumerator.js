'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const {
  identityBasis,
} = require('./helix/domains/procurement/model/field-observation-contracts');

const MAX_FILES_PER_SCAN = 10_000;
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

async function sha256File(location) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(location, { flags: 'r' });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function collectFiles(rootLocation) {
  const pending = [path.resolve(rootLocation)];
  const files = [];
  while (pending.length) {
    const directory = pending.pop();
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(
      Buffer.from(left.name, 'utf8'),
      Buffer.from(right.name, 'utf8'),
    ));
    for (const entry of entries) {
      const location = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
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
  return files;
}

function createCleanFieldObservationEnumerator(options = {}) {
  const now = options.now || Date.now;
  return Object.freeze({
    async scan(fieldAccessHandle) {
      const rootLocation = path.resolve(fieldAccessHandle.rootLocation);
      let root;
      try {
        root = await fs.promises.stat(rootLocation, { bigint: true });
        await fs.promises.access(rootLocation, fs.constants.R_OK);
      } catch (error) {
        fail('FIELD_OBSERVATION_ROOT_UNAVAILABLE', 'Material Field当前物理访问位置不可读。', {
          rootLocation: fieldAccessHandle.rootLocation,
          cause: error.code || 'READ_FAILED',
        });
      }
      if (!root.isDirectory()) {
        fail('FIELD_OBSERVATION_ROOT_NOT_DIRECTORY', 'Material Field访问位置必须是目录。', {
          rootLocation: fieldAccessHandle.rootLocation,
        });
      }

      const locations = await collectFiles(rootLocation);
      const items = [];
      for (const location of locations) {
        const stat = await fs.promises.stat(location, { bigint: true });
        if (!stat.isFile()) continue;
        if (stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
          fail('FIELD_OBSERVATION_FILE_TOO_LARGE', '文件大小超出Field Observation安全整数范围。', {
            location: normalizedLocation(location),
          });
        }
        const inode = checkedInt64(stat.ino, 'inode', location);
        const contentHash = await sha256File(location);
        const materialKey = canonicalDigest(identityBasis({
          mountScopeId: fieldAccessHandle.mountScopeId,
          inode,
          contentHashAlgorithm: 'sha256',
          contentHash,
        }));
        items.push(Object.freeze({
          cursor: materialKey,
          material: Object.freeze({
            inode,
            contentHash,
            location: normalizedLocation(location),
            sizeBytes: Number(stat.size),
            mtimeNs: checkedInt64(stat.mtimeNs, 'mtimeNs', location),
            ctimeNs: checkedInt64(stat.ctimeNs, 'ctimeNs', location),
            hashVerifiedAtMs: now(),
          }),
        }));
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
  createCleanFieldObservationEnumerator,
});
