'use strict';

const {canonicalDigest, canonicalJson} = require('../contracts/canonical-json');
const {faceModelReference} = require('../contracts/us-adult-face-model');
const {originalNameProvenance}=require('../contracts/us-adult-presentation');
const {normalizeVector} = require('./local-face-math');
const {createUsAdultFrameAnalysis} = require('./us-adult-frame-analysis');
const {createUsAdultReferenceMatcher} = require('./us-adult-reference-matcher');
const {renderUsAdultPoster} = require('./us-adult-poster-renderer');
const pack = require('../contracts/us-adult-face-model-pack.json');
const {frameGeometry}=require('../contracts/us-adult-frame-geometry');

function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function same(left, right) { return canonicalJson(left) === canonicalJson(right); }
function vector(value) {
  if (!Array.isArray(value) || value.length !== pack.dimension) fail('US_ADULT_FEATURE_INVALID', 'A face feature has the wrong dimension.');
  return Object.freeze(normalizeVector(value));
}
function similarity(left, right) {
  return Math.max(-1, Math.min(1, left.reduce((sum, value, ordinal) => sum + value * right[ordinal], 0)));
}

function createUsAdultAnalysisEngine(options) {
  if (typeof options?.frameExtractor?.extract !== 'function' || typeof options.faceModel?.analyzeImage !== 'function' ||
      typeof options.referencePort?.readReferenceEmbedding !== 'function' || typeof options.referencePort.readReferenceImage !== 'function' ||
      typeof options.context?.assertExecutionActive !== 'function') {
    throw new TypeError('US Adult analysis requires controlled Service frame, CPU model, reference and execution ports.');
  }
  const active = () => options.context.assertExecutionActive();
  const frameModel = faceModelReference('western_frame_set');
  const frameAnalysis = createUsAdultFrameAnalysis({faceModel:options.faceModel}), matcher = createUsAdultReferenceMatcher(options);


  function presentation(selection) {
    const snapshot = options.actorPresentation;
    if (!snapshot || snapshot.libraryKind !== 'us_adult' || typeof snapshot.canonicalName !== 'string' || !snapshot.canonicalName.trim() ||
        !snapshot.originalName || typeof snapshot.originalName.originalFileName !== 'string' || !snapshot.internalIdentity ||
        !/^[a-f0-9]{64}$/.test(snapshot.actorSelectionDigest||'') ||
        !same(snapshot.originalName,originalNameProvenance(snapshot.originalName.originalFileName))) {
      fail('US_ADULT_PRESENTATION_REQUIRED', 'Rendering requires the actor selection and original name frozen by Libra.');
    }
    if(selection){
      const {selectionDigest,...body}=selection,person=selection.selectionOrigin==='user_choice'?
        selection.actorChoiceRecord?.personSnapshot:selection.matchCompletion?.winner?.personSnapshot,
        asset=person?.referenceProjection?.contributions.find(item=>item.ownerPersonId===person.personId)?.activeAssets
          .find(item=>item.referenceAssetId===selection.referenceAssetId);
      if(selection.schemaRef!=='helix://contracts/domain-types/UsAdultActorSelectionBasis/v1'||canonicalDigest(body)!==selectionDigest||
        selectionDigest!==snapshot.actorSelectionDigest||person?.personId!==snapshot.personId||person.personRevision!==snapshot.personRevision||
        person.canonicalName!==snapshot.canonicalName||selection.referenceAssetId!==snapshot.referenceAssetId||
        asset?.artifactHandleId!==snapshot.artifactHandleId||asset.artifactDigest!==snapshot.artifactDigest)
        fail('US_ADULT_PRESENTATION_CHANGED','The poster actor or portrait differs from the frozen actor selection.');
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
        dimension:pack.dimension, vectors:Object.freeze(analysis.faces.map(face => face.vector)),frameGeometry:frameGeometry(analysis)});
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
    async matchReferences({faceClusterSetHandle, clusters, personReferenceProjections, threshold}) {
      if (!Array.isArray(clusters) || clusters.length > 1280) fail('US_ADULT_ANALYSIS_CHANGED', 'Matching exceeds its frozen face groups.');
      const faces = [];
      for (const cluster of clusters) {
        if (!Array.isArray(cluster.vectors) || !cluster.vectors.length || cluster.vectors.length !== cluster.memberOrdinals?.length) {
          fail('US_ADULT_FEATURE_INVALID', 'A cluster must preserve all member face vectors.');
        }
        for (const feature of cluster.vectors) faces.push({faceGroupId:cluster.clusterId, vector:feature});
      }
      const result = await matcher.matchPage({faceModelRefDigest:faceClusterSetHandle?.faceModelRefDigest, faces, personReferenceProjections, threshold});
      return Object.freeze({matches:Object.freeze(result.matches.map(({faceGroupId, ...match}) => Object.freeze({...match, clusterId:faceGroupId})))});
    },
    async analyzeWestern({analysisSpec}) {
      active(); const selected = presentation();
      const expected = {actor_name:selected.canonicalName, original_file_name:selected.originalName.originalFileName,
        internal_identity:selected.internalIdentity,actor_selection_digest:selected.actorSelectionDigest};
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
    async renderPoster({frameComposite, actorSelectionBasis}) {
      active(); const selected = presentation(actorSelectionBasis);
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
