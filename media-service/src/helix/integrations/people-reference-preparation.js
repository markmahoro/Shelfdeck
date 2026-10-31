'use strict';

const { canonicalDigest, canonicalJson } = require('../contracts/canonical-json');
const { buffaloModelReference } = require('../contracts/buffalo-model-reference');
const { faceModelReference, referenceFeatureCacheKey } = require('../contracts/us-adult-face-model');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function createPeopleReferencePreparation(options) {
  if (typeof options?.imagePort?.readUpload !== 'function' || typeof options.imagePort.readArtifact !== 'function' ||
      typeof options.imagePort.materialize !== 'function' || typeof options.faceModel?.analyzeImage !== 'function') {
    throw new TypeError('People Reference preparation requires controlled image storage and the pinned local CPU model.');
  }
  const modelRef = faceModelReference('single_reference_face'), buffaloRef = buffaloModelReference('single_reference_face'), cache = new Map();

  function importImage({ context, personId, operationId, selectedImage }) {
    const bytes = options.imagePort.readUpload(selectedImage);
    context.assertExecutionActive();
    return options.imagePort.materialize({ context, personId, operationId, artifactKind: 'reference-image', bytes,
      provenanceRef: { objectType: 'user_selected_image', objectId: selectedImage.uploadId, revision: 1, digest: selectedImage.handleDigest } });
  }

  async function computeEmbedding({ context, personId, operationId, referenceRevision, artifactHandle, faceModelRef }) {
    if (faceModelRef && canonicalDigest(faceModelRef) === canonicalDigest(buffaloRef)) {
      if (typeof options.buffaloPreparation?.computeEmbedding !== 'function') {
        fail('PEOPLE_REFERENCE_PREPARATION_FENCE', 'Buffalo reference preparation is not configured for this face model.');
      }
      return options.buffaloPreparation.computeEmbedding({ context, personId, operationId, referenceRevision, artifactHandle, faceModelRef });
    }
    if (canonicalJson(faceModelRef) !== canonicalJson(modelRef) || artifactHandle?.ownerDomain !== 'people' ||
        artifactHandle.ownerScope?.scopeType !== 'person' || artifactHandle.ownerScope.scopeId !== personId || artifactHandle.artifactKind !== 'reference-image') {
      fail('PEOPLE_REFERENCE_PREPARATION_FENCE', '参考图或人脸模型版本与建档操作不一致。');
    }
    const bytes = options.imagePort.readArtifact(artifactHandle);
    const key = referenceFeatureCacheKey({ personId, referenceRevision, artifactDigest: artifactHandle.digestHex, modelRef });
    let payload = cache.get(key);
    if (!payload) {
      const analyzed = await options.faceModel.analyzeImage(bytes, { requireSingleFace: true });
      if (analyzed.modelRef !== modelRef.modelId || analyzed.detectedFaceCount !== 1 || analyzed.faces.length !== 1 || analyzed.faces[0].vector.length !== 128) {
        fail('PEOPLE_REFERENCE_PREPARATION_RESULT_INVALID', '参考图未产生有效的唯一人脸特征。');
      }
      payload = Object.freeze({ schema: 'shared.face-embedding-set@1', dimension: 128,
        vectors: Object.freeze([Object.freeze([...analyzed.faces[0].vector])]) });
      cache.set(key, payload);
      if (cache.size > 256) cache.delete(cache.keys().next().value);
    }
    context.assertExecutionActive();
    const embeddingArtifact = options.imagePort.materialize({ context, personId, operationId, artifactKind: 'reference-embedding',
      bytes: Buffer.from(canonicalJson(payload)), provenanceRef: { objectType: 'people_reference_embedding', objectId: operationId,
        revision: referenceRevision, digest: canonicalDigest({ imageDigest: artifactHandle.digestHex, modelRefDigest: modelRef.digest }) } });
    const basis = { schemaRef: 'helix://contracts/types/FaceEmbeddingSetHandle/v1', schemaVersion: 1,
      artifactHandleId: embeddingArtifact.artifactHandleId, artifactHandle: embeddingArtifact, computationMode: 'single_reference_face',
      libraRunId: null, workspaceId: null, faceModelRefDigest: modelRef.digest, sourceArtifactSetDigest: artifactHandle.digestHex,
      detectedFaceCount: 1, vectorCount: 1, dimension: 128, embeddingDigest: embeddingArtifact.digestHex };
    return Object.freeze({ ...basis, handleDigest: canonicalDigest(basis) });
  }

  return Object.freeze({ modelReference: () => modelRef, importImage, computeEmbedding, clearCache: () => cache.clear() });
}

module.exports = Object.freeze({ createPeopleReferencePreparation });
