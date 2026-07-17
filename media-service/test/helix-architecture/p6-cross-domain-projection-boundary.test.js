'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const perception = require('../../src/helix/domains/perception/public');
const people = require('../../src/helix/domains/people/public');

function frozenBasisCopy(projection) {
  return Object.freeze({ ownerDomain: projection.ownerDomain, contractRef: projection.schemaRef,
    revision: projection.revision, digest: projection.projectionDigest });
}

test('synthetic Libra consumer can retain only a Perception-owned revision/digest basis copy', () => {
  const projection = Object.freeze({ schemaRef: 'helix://contracts/types/PerceptionResolutionRevision/v1', schemaVersion: 1,
    ownerDomain: 'perception', kind: 'found', factKind: 'rating', revision: 4, projectionDigest: 'a'.repeat(64) });
  const facade = perception.PerceptionResolutionFacade({ resolveDecisionFact: () => projection });
  const received = facade.resolveDecisionFact({ factKind: 'rating' });
  const basis = frozenBasisCopy(received);
  assert.deepEqual(basis, { ownerDomain: 'perception', contractRef: projection.schemaRef, revision: 4, digest: 'a'.repeat(64) });
  assert.equal(Object.keys(facade).includes('pushToLibra'), false);
  assert.equal(Object.keys(facade).includes('createRun'), false);
  assert.equal(Object.isFrozen(basis), true);
});

test('synthetic Arca consumer sees one People-owned Reference Image projection and no Face or Media-Cast command', () => {
  const projection = Object.freeze({ schemaRef: 'helix://contracts/domain-types/PersonReferenceProjection/v1', schemaVersion: 1,
    ownerDomain: 'people', personId: 'person-1', revision: 7, projectionDigest: 'b'.repeat(64),
    referenceImages: Object.freeze([{ referenceAssetId: 'asset-1', artifactHandleId: 'artifact-1', artifactDigest: 'c'.repeat(64) }]) });
  const facade = people.PersonReferenceQueryFacade({ getPersonReferenceProjection: () => projection });
  const received = facade.getPersonReferenceProjection({ personId: 'person-1' });
  assert.equal(received.referenceImages.length, 1);
  assert.equal(received.referenceFaces, undefined);
  assert.equal(facade.writeMediaCast, undefined);
  assert.equal(facade.updatePerson, undefined);
  assert.deepEqual(frozenBasisCopy(received), { ownerDomain: 'people', contractRef: projection.schemaRef,
    revision: 7, digest: 'b'.repeat(64) });
});

test('duplicate, missing, or reordered wake signals cannot mutate canonical projection results', () => {
  const canonical = Object.freeze({ schemaRef: 'helix://contracts/domain-types/PersonReferenceProjection/v1', schemaVersion: 1,
    ownerDomain: 'people', revision: 2, projectionDigest: 'd'.repeat(64) });
  const facade = people.PersonReferenceQueryFacade({ getPersonReferenceProjection: () => canonical });
  const wakeSignals = [{ sequence: 2 }, { sequence: 1 }, { sequence: 2 }];
  for (const signal of wakeSignals) assert.ok(signal.sequence > 0);
  assert.equal(facade.getPersonReferenceProjection({ personId: 'person-1' }), canonical);
  assert.equal(facade.getPersonReferenceProjection({ personId: 'person-1' }), canonical);
});
