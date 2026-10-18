'use strict';

const {createHash} = require('node:crypto');
const {canonicalDigest, canonicalJson} = require('../contracts/canonical-json');
const {faceModelReference, referenceFeatureCacheKey} = require('../contracts/us-adult-face-model');
const {normalizeVector} = require('./local-face-math');
const {createUsAdultFrameAnalysis} = require('./us-adult-frame-analysis');
const {renderUsAdultPoster} = require('./us-adult-poster-renderer');
const pack = require('../contracts/us-adult-face-model-pack.json');

function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
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

function createUsAdultAnalysisEngine(options) {
  if (typeof options?.frameExtractor?.extract !== 'function' || typeof options.faceModel?.analyzeImage !== 'function' ||
      typeof options.referencePort?.readReferenceEmbedding !== 'function' || typeof options.referencePort.readReferenceImage !== 'function' ||
      typeof options.context?.assertExecutionActive !== 'function') {
    throw new TypeError('US Adult analysis requires controlled Service frame, CPU model, reference and execution ports.');
  }
  const active = () => options.context.assertExecutionActive();
  const frameModel = faceModelReference('western_frame_set'), referenceModel = faceModelReference('single_reference_face');
  const frameAnalysis = createUsAdultFrameAnalysis({faceModel:options.faceModel}), cache = options.referenceCache || new Map();

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

  function presentation(match) {
    const snapshot = options.actorPresentation;
    if (!snapshot || snapshot.libraryKind !== 'us_adult' || typeof snapshot.canonicalName !== 'string' || !snapshot.canonicalName.trim() ||
        !snapshot.originalName || typeof snapshot.originalName.originalFileName !== 'string' || !snapshot.internalIdentity) {
      fail('US_ADULT_PRESENTATION_REQUIRED', 'Rendering requires the actor selection and original name frozen by Libra.');
    }
    if (match && (match.matches.length !== 1 || match.matches[0].personId !== snapshot.personId ||
        match.matches[0].personRevision !== snapshot.personRevision || match.matches[0].referenceAssetId !== snapshot.referenceAssetId ||
        match.matches[0].artifactDigest !== snapshot.artifactDigest)) {
      fail('US_ADULT_PRESENTATION_CHANGED', 'The poster actor differs from the frozen selection.');
    }
    return snapshot;
  }

  return Object.freeze({
    async extractFrameSet({sourceHandle, samplingPlan, outputSink}) {
      if (samplingPlan.maxFrames !== 20 || samplingPlan.typedParameters.find(item => item.parameter === 'strategy')?.value !== 'uniform_centers') {
        fail('US_ADULT_SAMPLING_INVALID', 'US Adult frame extraction requires its frozen twenty-point sampling plan.');
      }
      const durationMs = samplingPlan.typedParameters.find(item => item.parameter === 'duration_ms')?.value;
      if (!Number.isSafeInteger(durationMs) || durationMs < 1) fail('US_ADULT_SAMPLING_INVALID', 'The sampling plan has no frozen duration.');
      const frames = await options.frameExtractor.extract({sourceHandle, context:options.context, durationMs});
      if (frames.length !== 20) fail('US_ADULT_SAMPLING_INVALID', 'Frame extraction did not complete every sampling point.');
      for (const frame of frames) { active(); outputSink.writeFrame(frame); }
      return Object.freeze({frameCount:frames.length});
    },
    async computeEmbeddings({frameComposite, faceModelRef}) {
      if (!same(faceModelRef, frameModel)) fail('US_ADULT_ANALYSIS_CHANGED', 'Frame inference model differs from the frozen model.');
      const frames = frameComposite.members.map((member, ordinal) => ({timestampMs:member.timestampMs,
        bytes:Buffer.from(frameComposite.memberPayloads[ordinal].bytesBase64, 'base64')}));
      const analysis = await frameAnalysis.analyze(frames, {assertActive:active});
      return Object.freeze({detectedFaceCount:analysis.detectedFaceCount, vectorCount:analysis.detectedFaceCount,
        dimension:pack.dimension, vectors:Object.freeze(analysis.faces.map(face => face.vector))});
    },
    async computeClusters({embeddingSet, clusterParameters}) {
      const algorithm = clusterParameters.typedParameters.find(item => item.parameter === 'algorithm')?.value;
      if (clusterParameters.modelRefDigest !== frameModel.digest || clusterParameters.distanceMetric !== 'cosine' ||
          clusterParameters.distanceThreshold !== 0.35 || clusterParameters.minClusterSize !== 1 || algorithm !== 'single_linkage' ||
          clusterParameters.typedParameters.find(item => item.parameter === 'preserve_member_vectors')?.value !== true ||
          embeddingSet.dimension !== pack.dimension || !Array.isArray(embeddingSet.vectors) || embeddingSet.vectors.length > 1280) {
        fail('US_ADULT_CLUSTER_PARAMETERS_CHANGED', 'Clustering parameters or feature payload differ from the frozen analysis basis.');
      }
      const vectors = embeddingSet.vectors.map(vector), parents = vectors.map((_, index) => index);
      const root = index => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
      for (let left = 0; left < vectors.length; left++) {
        active();
        if (left % 32 === 0) { await new Promise(resolve => setImmediate(resolve)); active(); }
        for (let right = left + 1; right < vectors.length; right++) {
          if (1 - similarity(vectors[left], vectors[right]) <= clusterParameters.distanceThreshold) {
            const a = root(left), b = root(right); parents[Math.max(a, b)] = Math.min(a, b);
          }
        }
      }
      const groups = new Map();
      vectors.forEach((feature, ordinal) => {
        const key = root(ordinal); if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ordinal, vector:feature});
      });
      return Object.freeze({clusters:Object.freeze([...groups].map(([ordinal, members]) => Object.freeze({
        clusterId:'face-cluster-' + String(ordinal).padStart(6, '0'),
        memberOrdinals:Object.freeze(members.map(member => member.ordinal)), vectors:Object.freeze(members.map(member => member.vector)),
      })))});
    },
    async matchReferences({faceClusterSetHandle, clusters, personReferenceProjections}) {
      if (faceClusterSetHandle.faceModelRefDigest !== frameModel.digest || clusters.length > 1280 || personReferenceProjections.length > 256) {
        fail('US_ADULT_ANALYSIS_CHANGED', 'Matching exceeds its frozen model or reference page.');
      }
      const allFaces = [];
      for (const cluster of clusters) {
        if (!Array.isArray(cluster.vectors) || !cluster.vectors.length || cluster.vectors.length !== cluster.memberOrdinals?.length) {
          fail('US_ADULT_FEATURE_INVALID', 'A cluster must preserve all member face vectors.');
        }
        for (const feature of cluster.vectors) allFaces.push({clusterId:cluster.clusterId, feature:vector(feature)});
      }
      if (allFaces.length > 1280) fail('US_ADULT_FEATURE_INVALID', 'The face set exceeds twenty frames of bounded detections.');
      let winner = null;
      for (const projection of personReferenceProjections) {
        const contribution = assertProjection(projection);
        for (const [referenceOrdinal, face] of contribution.activeFaces.entries()) {
          if (referenceOrdinal % 16 === 0) { await new Promise(resolve => setImmediate(resolve)); active(); }
          const {asset, feature} = referenceVector(projection, contribution, face);
          for (const detected of allFaces) {
            const score = similarity(detected.feature, feature);
            if (score < pack.matchThreshold) continue;
            const candidate = {personId:projection.personId, clusterId:detected.clusterId, score, referenceAssetId:asset.referenceAssetId,
              artifactDigest:asset.artifactDigest, threshold:pack.matchThreshold, faceModelRefDigest:frameModel.digest,
              referenceModelRefDigest:referenceModel.digest, confidenceClass:'strong'};
            if (!winner || candidate.score > winner.score || candidate.score === winner.score &&
                (ordered(candidate.personId, winner.personId) || ordered(candidate.referenceAssetId, winner.referenceAssetId) ||
                  ordered(candidate.clusterId, winner.clusterId)) < 0) winner = candidate;
          }
        }
      }
      active(); return Object.freeze({matches:Object.freeze(winner ? [Object.freeze(winner)] : [])});
    },
    async analyzeWestern({analysisSpec}) {
      active(); const selected = presentation();
      const expected = {actor_name:selected.canonicalName, original_file_name:selected.originalName.originalFileName, internal_identity:selected.internalIdentity};
      for (const [parameter, value] of Object.entries(expected)) {
        if (analysisSpec.typedParameters.find(item => item.parameter === parameter)?.value !== value) {
          fail('US_ADULT_PRESENTATION_CHANGED', 'Analysis metadata differs from its frozen actor and original filename.');
        }
      }
      const name = selected.originalName.originalFileName, dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name;
      return Object.freeze({identityAnchor:selected.internalIdentity, descriptiveFacts:Object.freeze([
        {key:'title', value:selected.canonicalName + ' ' + stem}, {key:'actor_name', value:selected.canonicalName}, {key:'original_file_name', value:name},
      ].map(Object.freeze))});
    },
    async renderPoster({frameComposite, personMatchEvidence}) {
      active(); const selected = presentation(personMatchEvidence);
      const portrait = options.referencePort.readReferenceImage({personId:selected.personId,
        artifactHandleId:selected.artifactHandleId, artifactDigest:selected.artifactDigest}).bytes;
      const ordinals = Array.from({length:4}, (_, index) => Math.min(frameComposite.members.length - 1,
        Math.floor((index + 1) * frameComposite.members.length / 5)));
      const frames = ordinals.map(ordinal => Buffer.from(frameComposite.memberPayloads[ordinal].bytesBase64, 'base64'));
      const name = selected.originalName.originalFileName, dot = name.lastIndexOf('.');
      const rendered = await renderUsAdultPoster({actorName:selected.canonicalName, originalTitle:dot > 0 ? name.slice(0, dot) : name, portrait, frames});
      active(); return rendered.bytes;
    },
  });
}

module.exports = Object.freeze({createUsAdultAnalysisEngine});
