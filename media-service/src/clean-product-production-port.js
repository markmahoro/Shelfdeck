'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('./helix/contracts/canonical-json');

class CleanProductProductionPortError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanProductProductionPortError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new CleanProductProductionPortError(code, message, details);
}

function bytesDigest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedLocation(value) {
  if (typeof value !== 'string' || !value) {
    fail('CLEAN_PRODUCT_LOCATION_INVALID', 'A frozen material location is required.');
  }
  return path.resolve(value.replace(/\//g, path.sep));
}

function createCleanProductProductionPort(options = {}) {
  if (!options.mediaProbe || typeof options.mediaProbe.probe !== 'function') {
    fail('CLEAN_PRODUCT_PROBE_REQUIRED', 'Product production requires the typed media probe port.');
  }

  function exactPhysicalReality(value) {
    const location = normalizedLocation(value.location);
    const bytes = fs.readFileSync(location);
    const stat = fs.statSync(location, { bigint: true });
    const digestHex = bytesDigest(bytes);
    if (digestHex !== value.physicalIdentity.contentHash ||
        bytes.length !== value.sizeBytes ||
        String(stat.ino) !== value.physicalIdentity.inode) {
      fail('CLEAN_PRODUCT_REALITY_MISMATCH',
        'Physical material no longer matches the immutable Libra Run input.', {
          materialKey: value.physicalIdentity.materialKey,
        });
    }
    return Object.freeze({ location, bytes, stat, digestHex });
  }

  function issuePhysicalReadHandle(value) {
    const reality = exactPhysicalReality(value);
    const identity = Object.freeze({
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v1',
      schemaVersion: 1,
      ...value.physicalIdentity,
    });
    const basis = {
      schemaRef: 'helix://contracts/types/PhysicalMaterialReadHandle/v1',
      schemaVersion: 1,
      handleId: '',
      identity,
      ownerDomain: 'libra',
      ownerScope: Object.freeze({ scopeType: 'libra_run', scopeId: value.libraRunId }),
      bindingRevision: value.bindingRevision,
      endpointId: value.endpointId,
      location: reality.location.replace(/\\/g, '/'),
      mountScopeRevision: value.mountScopeRevision,
      expectedSizeBytes: value.sizeBytes,
      expectedMtimeNs: Number(reality.stat.mtimeNs / 1_000_000n),
      expectedCtimeNs: Number(reality.stat.ctimeNs / 1_000_000n),
      hashVerifiedAtMs: value.runCreatedAtMs,
      readScope: 'material_read',
      expiresAtMs: 4_102_444_800_000,
      fenceDigest: '',
    };
    basis.handleId = canonicalDigest({
      schema: 'libra.run-input-read-handle-id@1',
      libraRunId: value.libraRunId,
      materialKey: identity.materialKey,
      bindingRevision: value.bindingRevision,
      runExecutionBasisDigest: value.runExecutionBasisDigest,
    });
    basis.fenceDigest = canonicalDigest({
      schema: 'libra.run-input-read-handle-fence@1',
      ...Object.fromEntries(Object.entries(basis).filter(([key]) => key !== 'fenceDigest')),
      runExecutionBasisDigest: value.runExecutionBasisDigest,
    });
    return Object.freeze(basis);
  }

  function readRelatedNfo(value) {
    if (!value?.reference || value.reference.role !== 'nfo' ||
        value.reference.primaryMaterialKey !== value.primaryMaterialKey) {
      fail('CLEAN_PRODUCT_NFO_REFERENCE_INVALID',
        'Related NFO must bind the exact primary Run input.');
    }
    const location = normalizedLocation(value.reference.location);
    const bytes = fs.readFileSync(location);
    if (bytesDigest(bytes) !== value.reference.checksumHex ||
        value.reference.checksumAlgorithm !== 'sha256') {
      fail('CLEAN_PRODUCT_NFO_REALITY_MISMATCH',
        'Related NFO bytes do not match the immutable Handoff A reference.');
    }
    const xml = bytes.toString('utf8');
    const entries = [];
    const fields = [
      ['title', 'title'],
      ['year_or_release_date', 'year'],
      ['release_date', 'releasedate'],
      ['plot', 'plot'],
      ['genre', 'genre'],
      ['director', 'director'],
      ['actor', 'name'],
      ['tmdb_movie_id', 'tmdbid'],
    ];
    for (const [key, tag] of fields) {
      const match = xml.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([^<]+)</' + tag + '>', 'i'));
      if (match && match[1].trim()) entries.push({ key, value: match[1].trim() });
    }
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
    return Object.freeze({ bytes, entries: Object.freeze(entries) });
  }

  async function fetchProvider(intent) {
    if (typeof options.fetchProviderMetadata !== 'function') {
      fail('CLEAN_PRODUCT_PROVIDER_UNAVAILABLE',
        'The required typed Product Metadata provider is unavailable.');
    }
    const response = await options.fetchProviderMetadata(Object.freeze({ ...intent }));
    if (!response || response.providerKind !== 'tmdb' ||
        response.integrationId !== intent.integrationId ||
        response.configRevision !== intent.configRevision ||
        !Array.isArray(response.descriptiveEntries) ||
        !Array.isArray(response.providerIdentities) ||
        !Array.isArray(response.peopleHints) ||
        !Buffer.isBuffer(response.posterBytes) ||
        !response.posterBytes.length) {
      fail('CLEAN_PRODUCT_PROVIDER_RESULT_INVALID',
        'Typed TMDB Product Metadata result is incomplete.');
    }
    return Object.freeze({
      ...response,
      descriptiveEntries: Object.freeze([...response.descriptiveEntries]),
      providerIdentities: Object.freeze([...response.providerIdentities]),
      peopleHints: Object.freeze([...response.peopleHints]),
    });
  }

  async function searchProviderIdentity(request) {
    if (typeof options.searchProviderIdentity !== 'function') {
      fail('CLEAN_PRODUCT_IDENTITY_PROVIDER_UNAVAILABLE',
        'The required typed Provider identity search is unavailable.');
    }
    const response = await options.searchProviderIdentity(Object.freeze({ ...request }));
    if (!response || response.provider !== 'tmdb' ||
        response.namespace !== 'tmdb_movie' ||
        typeof response.providerKey !== 'string' || !response.providerKey) {
      fail('CLEAN_PRODUCT_IDENTITY_PROVIDER_RESULT_INVALID',
        'Typed TMDB identity search did not return one stable Movie identity.');
    }
    return Object.freeze({ ...response, seasonNumber: null });
  }

  async function probe(readHandle) {
    return options.mediaProbe.probe(readHandle);
  }

  return Object.freeze({
    fetchProvider,
    issuePhysicalReadHandle,
    probe,
    readRelatedNfo,
    searchProviderIdentity,
  });
}

module.exports = Object.freeze({
  CleanProductProductionPortError,
  createCleanProductProductionPort,
});
