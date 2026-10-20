'use strict';

const { canonicalDigest } = require('./canonical-json');
const pack = require('./us-adult-face-model-pack.json');

function faceModelReference(mode) {
  if (!['single_reference_face', 'western_frame_set'].includes(mode)) throw new TypeError('Face Model mode must be explicit.');
  const modelDigest = canonicalDigest(pack.models.map(({ role, sha256, size }) => ({ role, sha256, size })));
  const parameters = { detection_threshold: pack.detectionThreshold, match_threshold: pack.matchThreshold,
    onnxruntime_version: pack.runtimeVersion, preprocessing_version: pack.preprocessingVersion };
  const typedParameters = Object.keys(parameters).sort().map(parameter => {
    const value = { parameter, valueType: typeof parameters[parameter], value: parameters[parameter] };
    return Object.freeze({ ...value, valueDigest: canonicalDigest(value) });
  });
  const basis = { contractId: canonicalDigest({ schema: 'shared.us-adult-face-model-contract@1', modelId: pack.modelRef, modelDigest, mode }),
    revision: 1, schemaRef: 'helix://contracts/domain-types/FaceModelRef/v1', mode, modelId: pack.modelRef, modelRevision: 1,
    modelDigest, runtimeKind: 'onnx',
    inputContractDigest: canonicalDigest({ schema: 'shared.us-adult-face-input@1', preprocessingVersion: pack.preprocessingVersion,
      detectorSize: pack.detectorSize, recognitionSize: pack.recognitionSize, detectionThreshold: pack.detectionThreshold }),
    outputContractDigest: canonicalDigest({ schema: 'shared.us-adult-face-output@1', dimension: pack.dimension, normalization: 'unit_l2' }),
    licenseDigest: canonicalDigest(pack.licenses), typedParameters: Object.freeze(typedParameters) };
  return Object.freeze({ ...basis, digest: canonicalDigest(basis) });
}

function referenceFeatureCacheKey({ personId, referenceRevision, artifactDigest, modelRef = faceModelReference('single_reference_face') }) {
  if (typeof personId !== 'string' || !personId || !Number.isSafeInteger(referenceRevision) || referenceRevision < 1 ||
      !/^[a-f0-9]{64}$/.test(artifactDigest || '') || modelRef.digest !== faceModelReference('single_reference_face').digest) throw new TypeError('Reference feature cache requires exact Person, image revision and pinned model.');
  return canonicalDigest({ schema: 'people.reference-feature-cache@1', personId, referenceRevision, artifactDigest, modelRefDigest: modelRef.digest });
}

module.exports = Object.freeze({ faceModelReference, referenceFeatureCacheKey });
