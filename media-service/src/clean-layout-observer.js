'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { computeBoundedMaterialFingerprint } = require('./helix/integrations/bounded-material-fingerprint');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const {
  identityBasis,
} = require('./helix/domains/procurement/model/field-observation-contracts');

const RELATED_EXTENSIONS = new Set([
  '.aac', '.ac3', '.ass', '.chapters', '.dts', '.flac', '.jpg', '.jpeg',
  '.mka', '.nfo', '.png', '.srt', '.ssa', '.vtt', '.webp', '.xml',
]);

class CleanLayoutObserverError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanLayoutObserverError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanLayoutObserverError(code, message, details);
}

function without(value, ...fields) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
}

function normalizedLocation(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

function entry(value) {
  return Object.freeze({ ...value, entryDigest: canonicalDigest(value) });
}

function createCleanLayoutObserver(options = {}) {
  const now = options.now || (() => 0);
  return Object.freeze({
    async observe(readHandle, boundedScope) {
      if (!readHandle?.identity || typeof readHandle.location !== 'string' ||
          !readHandle.endpointId || !boundedScope ||
          boundedScope.rootHandleDigest !== canonicalDigest(readHandle) ||
          boundedScope.digest !== canonicalDigest(without(boundedScope, 'digest'))) {
        fail('CLEAN_LAYOUT_OBSERVER_INPUT', 'Layout observation requires an exact read handle and bounded scope.');
      }
      const primaryLocation = path.resolve(readHandle.location);
      const directory = path.dirname(primaryLocation);
      let names;
      try {
        names = await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error) {
        fail('CLEAN_LAYOUT_OBSERVER_DIRECTORY_UNAVAILABLE', 'The bounded material directory is not readable.', {
          cause: error.code || 'READ_FAILED',
        });
      }
      names.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
      const selected = names.filter((item) => {
        if (item.isSymbolicLink() || !item.isFile()) return false;
        const location = path.join(directory, item.name);
        return path.resolve(location) === primaryLocation || RELATED_EXTENSIONS.has(path.extname(item.name).toLowerCase());
      });
      if (selected.length + 1 > boundedScope.maxMembers || selected.length + 1 > 256) {
        fail('CLEAN_LAYOUT_OBSERVER_MEMBER_BUDGET_EXCEEDED', 'The bounded layout exceeds its member budget.');
      }

      const values = [entry({
        entryOrdinal: 0,
        entryKind: 'directory',
        relativeLocation: '.',
        baseName: path.basename(directory),
        endpointId: readHandle.endpointId,
        location: normalizedLocation(directory),
      })];
      for (const item of selected) {
        const location = path.join(directory, item.name);
        const isPrimary = path.resolve(location) === primaryLocation;
        const sampled = isPrimary ? null : await computeBoundedMaterialFingerprint(location);
        const stat = sampled ? sampled.stat : await fs.promises.stat(location, { bigint:true });
        const sizeBytes = Number(stat.size);
        const contentFingerprint = isPrimary ? readHandle.identity.contentFingerprint : sampled.contentFingerprint;
        const inode = isPrimary ? readHandle.identity.inode : String(stat.ino);
        const identity = {
          schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
          schemaVersion: 2,
          materialKey: isPrimary ? readHandle.identity.materialKey : canonicalDigest(identityBasis({
            mountScopeId: readHandle.identity.mountScopeId,
            inode,
            sizeBytes,
            fingerprintAlgorithm:'middle-256k-sha256',
            fingerprintVersion:1,
            contentFingerprint,
          })),
          mountScopeId: readHandle.identity.mountScopeId,
          inode,
          sizeBytes,
          fingerprintAlgorithm:'middle-256k-sha256',
          fingerprintVersion:1,
          contentFingerprint,
        };
        values.push(entry({
          entryOrdinal: values.length,
          entryKind: 'file',
          relativeLocation: item.name,
          baseName: item.name,
          extension: path.extname(item.name).toLowerCase() || '.unknown',
          identity: Object.freeze(identity),
          endpointId: readHandle.endpointId,
          location: normalizedLocation(location),
          sizeBytes,
          mtimeNs: String(stat.mtimeNs),
        }));
      }
      const entries = Object.freeze(values);
      const entriesDigest = canonicalDigest({ schema: 'shared.material.layout.entries@1', items: entries });
      const base = {
        schemaRef: 'helix://contracts/types/LayoutEvidence/v1',
        schemaVersion: 1,
        evidenceId: 'layout-evidence-' + canonicalDigest({
          sourceHandleDigest: canonicalDigest(readHandle),
          boundedScopeDigest: boundedScope.digest,
          entriesDigest,
        }).slice(0, 40),
        evidenceKind: 'bounded_parent_directory',
        producerRef: 'shared.material.layout.observe@1',
        basisDigest: canonicalDigest({
          sourceHandleDigest: canonicalDigest(readHandle),
          boundedScopeDigest: boundedScope.digest,
        }),
        payloadDigest: '',
        observedAtMs: now(),
        sourceHandleDigest: canonicalDigest(readHandle),
        boundedScopeDigest: boundedScope.digest,
        entries,
        entriesDigest,
        layoutDigest: canonicalDigest({
          schema: 'shared.material.layout@1',
          sourceHandleDigest: canonicalDigest(readHandle),
          boundedScopeDigest: boundedScope.digest,
          entriesDigest,
        }),
      };
      return Object.freeze({ ...base, payloadDigest: canonicalDigest(without(base, 'payloadDigest')) });
    },
  });
}

module.exports = Object.freeze({ CleanLayoutObserverError, createCleanLayoutObserver });
