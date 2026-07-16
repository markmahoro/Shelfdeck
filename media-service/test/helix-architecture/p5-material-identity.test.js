'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { materialKey: p3MaterialKey } = require('../../src/helix/foundation/persistence/material-control');
const {
  canReuseFullHash,
  createPhysicalMaterialIdentityFactory
} = require('../../src/helix/platform/model/physical-material-identity');
const {
  assessLocationContinuity,
  evaluateBindingHealth
} = require('../../src/helix/platform/model/binding-health');

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const factory = createPhysicalMaterialIdentityFactory({ digest });
const contentA = digest('content-a');
const contentB = digest('content-b');

function identity(overrides = {}) {
  return factory.derive({
    mountScopeId: 'mount-1', inode: '1001', contentHashAlgorithm: 'sha256',
    contentHash: contentA, fullHashComplete: true, ...overrides
  });
}

function expectedBinding(material = identity()) {
  return { identity: material, endpointId: 'endpoint-1', location: '/media/movie.mkv', mountScopeRevision: 4 };
}

function observation(overrides = {}) {
  return {
    endpointReachable: true, endpointId: 'endpoint-1', locationState: 'resolved', location: '/media/movie.mkv',
    mountScopeId: 'mount-1', mountScopeRevision: 4, inode: '1001', contentHash: contentA,
    observationEvidenceDigest: digest('observation-1'), ...overrides
  };
}

test('derives exactly the P3 canonical Physical Material Identity from full SHA-256 evidence', () => {
  const material = identity();
  assert.equal(material.schemaRef, 'helix://contracts/types/PhysicalMaterialIdentity/v1');
  assert.equal(material.materialKey, p3MaterialKey(material));
  assert.equal(Object.isFrozen(material), true);
  assert.throws(() => identity({ fullHashComplete: false }),
    (error) => error.code === 'P5_MATERIAL_IDENTITY_FULL_HASH_REQUIRED');
  assert.throws(() => identity({ contentHash: digest('fast-fingerprint'), contentHashAlgorithm: 'fast' }),
    (error) => error.code === 'P5_MATERIAL_IDENTITY_FULL_HASH_REQUIRED');
});

test('location rename preserves identity while mount, inode, or bytes produce a new identity', () => {
  const original = identity();
  const renamed = identity();
  assert.equal(original.materialKey, renamed.materialKey);
  assert.notEqual(identity({ mountScopeId: 'mount-2' }).materialKey, original.materialKey);
  assert.notEqual(identity({ inode: '1002' }).materialKey, original.materialKey);
  assert.notEqual(identity({ contentHash: contentB }).materialKey, original.materialKey);
  assert.notEqual(identity({ inode: '1002', contentHash: contentA }).materialKey, original.materialKey);
});

test('reuses a full hash only under the exact trustworthy stat fence', () => {
  const previous = {
    mountScopeId: 'mount-1', mountScopeRevision: 4, inode: '1001', sizeBytes: 1000,
    mtimeNs: '1000000001', ctimeNs: '1000000002', contentHashAlgorithm: 'sha256',
    contentHash: contentA, fullHashComplete: true
  };
  const current = {
    mountScopeId: 'mount-1', mountScopeRevision: 4, inode: '1001', sizeBytes: 1000,
    mtimeNs: '1000000001', ctimeNs: '1000000002', trustworthyNanosecondStat: true
  };
  assert.equal(canReuseFullHash(previous, current), true);
  for (const drift of [
    { mountScopeId: 'mount-2' }, { mountScopeRevision: 5 }, { inode: '1002' }, { sizeBytes: 1001 },
    { mtimeNs: '1000000003' }, { ctimeNs: '1000000003' }, { trustworthyNanosecondStat: false }
  ]) assert.equal(canReuseFullHash(previous, { ...current, ...drift }), false);
  assert.equal(canReuseFullHash({
    contentHashAlgorithm: 'sha256', contentHash: contentA, fullHashComplete: true
  }, { trustworthyNanosecondStat: true }), false);
});

test('Binding Health requires endpoint, location, filesystem object, and content hash together', () => {
  const expected = expectedBinding();
  assert.deepEqual(evaluateBindingHealth({ expected, observation: observation() }).reasonCodes, []);
  assert.deepEqual(evaluateBindingHealth({
    expected, observation: observation({ endpointReachable: false, locationState: 'missing' })
  }).reasonCodes, ['endpoint_unreachable']);
  assert.deepEqual(evaluateBindingHealth({ expected, observation: observation({ locationState: 'missing' }) }).reasonCodes,
    ['location_missing']);
  assert.deepEqual(evaluateBindingHealth({ expected, observation: observation({ locationState: 'unreadable' }) }).reasonCodes,
    ['location_unreadable']);
  assert.deepEqual(evaluateBindingHealth({ expected, observation: observation({ inode: '1002' }) }).reasonCodes,
    ['filesystem_object_mismatch']);
  assert.deepEqual(evaluateBindingHealth({ expected, observation: observation({ contentHash: contentB }) }).reasonCodes,
    ['content_hash_mismatch']);
  assert.deepEqual(evaluateBindingHealth({ expected, observation: observation({ location: '/media/renamed.mkv' }) }).reasonCodes,
    ['location_mismatch']);
});

test('location changes require reliable exact-scope evidence and never mutate identity', () => {
  const currentBinding = expectedBinding();
  const reliable = assessLocationContinuity({
    candidateIdentity: identity(), currentBinding,
    locationEvidence: { reliable: true, endpointId: 'endpoint-1', mountScopeRevision: 4, location: '/media/renamed.mkv' }
  });
  assert.deepEqual(reliable, {
    identityChanged: false, mayUpdateLocation: true, nextLocation: '/media/renamed.mkv', requiresNewBinding: false
  });
  const weak = assessLocationContinuity({
    candidateIdentity: identity(), currentBinding,
    locationEvidence: { reliable: false, endpointId: 'endpoint-1', mountScopeRevision: 4, location: '/media/renamed.mkv' }
  });
  assert.equal(weak.mayUpdateLocation, false);
  assert.equal(weak.nextLocation, currentBinding.location);
  const changed = assessLocationContinuity({
    candidateIdentity: identity({ inode: '1002' }), currentBinding,
    locationEvidence: { reliable: true, endpointId: 'endpoint-1', mountScopeRevision: 4, location: '/media/renamed.mkv' }
  });
  assert.equal(changed.identityChanged, true);
  assert.equal(changed.requiresNewBinding, true);
});
