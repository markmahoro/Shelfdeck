'use strict';
const { canonicalDigest } = require('../../../src/helix/contracts/canonical-json');

// Persistence fixtures consume already validated producer results. Real inference is tested separately.
function initialReference(personId, actorId = 'admin-1') {
  const artifactDigest = canonicalDigest({ personId, kind: 'validated-reference-image' });
  const modelRef = canonicalDigest({ model: 'opencv-yunet-2023mar-sface-2021dec@1' });
  const imageHandle = { schemaRef: 'helix://contracts/types/ArtifactHandle/v1', schemaVersion: 1,
    artifactHandleId: 'image-' + personId, artifactKind: 'reference-image', ownerDomain: 'people',
    ownerScope: { scopeType: 'person', scopeId: personId }, storageRef: 'fixture:' + personId,
    digestAlgorithm: 'sha256', digestHex: artifactDigest, sizeBytes: 100, mediaType: 'image/jpeg',
    provenanceRef: { objectType: 'user-upload', objectId: 'upload-' + personId, revision: 1, digest: artifactDigest }, referenceRevision: 1 };
  const embeddingDigest = canonicalDigest({ personId, kind: 'validated-embedding' });
  const embedding = { schemaRef: 'helix://contracts/types/FaceEmbeddingSetHandle/v1', schemaVersion: 1,
    artifactHandleId: 'embedding-' + personId, artifactHandle: { ...imageHandle, artifactHandleId: 'embedding-' + personId,
      artifactKind: 'reference-embedding', digestHex: embeddingDigest, mediaType: 'application/json' },
    computationMode: 'single_reference_face', libraRunId: null, workspaceId: null, faceModelRefDigest: modelRef,
    sourceArtifactSetDigest: artifactDigest, detectedFaceCount: 1, vectorCount: 1, dimension: 128, embeddingDigest };
  const value = { decisionId: 'initial-reference-' + personId, operationKind: 'add_image', personId,
    expectedPersonRevision: 1, expectedReferenceRevision: 0, actorId,
    referenceAssetId: 'asset-' + personId, referenceFaceId: 'face-' + personId,
    artifactHandle: imageHandle, artifactDigest, faceEmbeddingSetHandle: { ...embedding, handleDigest: canonicalDigest(embedding) },
    modelRef, initialState: 'active' };
  return { ...value, decisionDigest: canonicalDigest(value) };
}

module.exports = { initialReference };
