'use strict';

const {createHash} = require('node:crypto');
const {canonicalDigest, canonicalJson} = require('../contracts/canonical-json');
const {faceModelReference, referenceFeatureCacheKey} = require('../contracts/us-adult-face-model');
const {normalizeVector} = require('./local-face-math');
const pack = require('../contracts/us-adult-face-model-pack.json');

function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function ordered(left, right) { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }
function vector(value) {
  if (!Array.isArray(value) || value.length !== pack.dimension) fail('US_ADULT_FEATURE_INVALID', 'A face feature has the wrong dimension.');
  return Object.freeze(normalizeVector(value));
}
function similarity(left, right) {
  return Math.max(-1, Math.min(1, left.reduce((sum, value, ordinal) => sum + value * right[ordinal], 0)));
}
function assertProjection(projection) {
  const {projectionRevision, projectionDigest, ...basis} = projection || {};
  if (projection?.projectionContract !== 'people.person-reference-projection@1' ||
      !Number.isSafeInteger(projectionRevision) || projectionRevision < 1 || canonicalDigest(basis) !== projectionDigest ||
      !Array.isArray(projection.contributions) || projection.contributions.length !== 1 ||
      projection.contributions[0].ownerPersonId !== projection.personId || projection.contributions[0].inheritedReadOnly ||
      projection.contributions[0].ownerReferenceRevision !== projection.currentReferenceRevision) {
    fail('US_ADULT_REFERENCE_CHANGED', 'US Adult matching requires an exact isolated Person reference Projection.');
  }
  return projection.contributions[0];
}

// This technical matcher receives frozen vectors and People projections only.
// Domain Owners retain their own Work, Case, Result and selection authority.
function createUsAdultReferenceMatcher(options) {
  if (typeof options?.referencePort?.readReferenceEmbedding !== 'function' || typeof options.context?.assertExecutionActive !== 'function') {
    throw new TypeError('Reference matching requires controlled reference reads and active execution authority.');
  }
  const active = () => options.context.assertExecutionActive();
  const frameModel = faceModelReference('western_frame_set'), referenceModel = faceModelReference('single_reference_face');
  const cache = options.referenceCache || new Map();
  function referenceVector(projection, contribution, face) {
    if (face.modelRef !== referenceModel.digest) fail('US_ADULT_REFERENCE_MODEL_CHANGED', 'The reference feature model is not the frozen CPU model.');
    const asset = contribution.activeAssets.find(item => item.referenceAssetId === face.referenceAssetId);
    if (!asset) fail('US_ADULT_REFERENCE_CHANGED', 'A reference feature has no corresponding frozen image.');
    active();
    const bytes = options.referencePort.readReferenceEmbedding({personId:projection.personId,
      artifactHandleId:face.embeddingHandleId, artifactDigest:face.embeddingDigest});
    if (!Buffer.isBuffer(bytes) || bytes.length > 64 * 1024 || createHash('sha256').update(bytes).digest('hex') !== face.embeddingDigest) {
      fail('US_ADULT_REFERENCE_CHANGED', 'The reference feature bytes differ from their frozen digest.');
    }
    const key = canonicalDigest({featureKey:referenceFeatureCacheKey({personId:projection.personId,
      referenceRevision:projection.currentReferenceRevision, artifactDigest:asset.artifactDigest}),
      personRevision:projection.personRevision, referenceAssetId:asset.referenceAssetId, embeddingDigest:face.embeddingDigest});
    let feature = cache.get(key);
    if (!feature) {
      let payload;
      try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail('US_ADULT_FEATURE_INVALID', 'Reference feature JSON is invalid.'); }
      if (canonicalJson(payload) !== bytes.toString('utf8') || Object.keys(payload).sort().join(',') !== 'dimension,schema,vectors' ||
          payload.schema !== 'shared.face-embedding-set@1' || payload.dimension !== pack.dimension || payload.vectors?.length !== 1) {
        fail('US_ADULT_FEATURE_INVALID', 'Reference feature payload does not describe exactly one pinned face.');
      }
      feature = vector(payload.vectors[0]); cache.set(key, feature);
      if (cache.size > 1024) cache.delete(cache.keys().next().value);
    }
    return {asset, feature};
  }

  return Object.freeze({async matchPage({faceModelRefDigest, faces:inputFaces, personReferenceProjections}) {
    if (faceModelRefDigest !== frameModel.digest || !Array.isArray(inputFaces) || inputFaces.length > 1280 ||
        !Array.isArray(personReferenceProjections) || personReferenceProjections.length > 256) {
      fail('US_ADULT_ANALYSIS_CHANGED', 'Matching exceeds its frozen model or reference page.');
    }
    const faces = inputFaces.map(face => {
      if (typeof face?.faceGroupId !== 'string' || !face.faceGroupId || face.faceGroupId.length > 256) {
        fail('US_ADULT_FEATURE_INVALID', 'A detected face requires its frozen group identity.');
      }
      return {faceGroupId:face.faceGroupId, feature:vector(face.vector)};
    });
      let winner = null;
      for (const projection of structuredClone(personReferenceProjections)) {
        const contribution = assertProjection(projection);
        for (const [referenceOrdinal, face] of contribution.activeFaces.entries()) {
          if (referenceOrdinal % 16 === 0) { await new Promise(resolve => setImmediate(resolve)); active(); }
          const {asset, feature} = referenceVector(projection, contribution, face);
          for (const detected of faces) {
            const score = similarity(detected.feature, feature);
            if (score < pack.matchThreshold) continue;
            const candidate = {personId:projection.personId, faceGroupId:detected.faceGroupId, score, referenceAssetId:asset.referenceAssetId,
              artifactDigest:asset.artifactDigest, threshold:pack.matchThreshold, faceModelRefDigest:frameModel.digest,
              referenceModelRefDigest:referenceModel.digest, confidenceClass:'strong'};
            if (!winner || candidate.score > winner.score || candidate.score === winner.score &&
                (ordered(candidate.personId, winner.personId) || ordered(candidate.referenceAssetId, winner.referenceAssetId) ||
                  ordered(candidate.faceGroupId, winner.faceGroupId)) < 0) winner = candidate;
          }
        }
      }
      active(); return Object.freeze({matches:Object.freeze(winner ? [Object.freeze(winner)] : [])});
  }});
}
module.exports = Object.freeze({createUsAdultReferenceMatcher});
