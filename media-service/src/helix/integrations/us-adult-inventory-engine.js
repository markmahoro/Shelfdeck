'use strict';

const { createHash } = require('node:crypto');
const { canonicalDigest } = require('../contracts/canonical-json');
const { frameGeometry } = require('../contracts/us-adult-frame-geometry');
const { faceModelReference } = require('../contracts/us-adult-face-model');
const { buildUsAdultTitle } = require('../contracts/us-adult-presentation');
const { createUsAdultFrameAnalysis, uniformFrameTimes } = require('./us-adult-frame-analysis');
const { createUsAdultReferenceMatcher } = require('./us-adult-reference-matcher');
const { renderUsAdultPoster } = require('./us-adult-poster-renderer');
const { normalizeVector } = require('./local-face-math');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function assertAnalysis(analysis) {
  frameGeometry(analysis);
  if (analysis.frameMembers.length !== 20) fail('ARCA_US_ADULT_FRAME_SET_INCOMPLETE', 'Inventory preparation requires every frozen sampling point.');
  return analysis;
}
function assertFrames(analysis, frames) {
  assertAnalysis(analysis);
  if (!Array.isArray(frames) || frames.length !== 20 || frames.some((frame, ordinal) =>
    !Buffer.isBuffer(frame?.bytes) || frame.bytes.length === 0 || frame.bytes.length > 10 * 1024 * 1024 ||
    frame.timestampMs !== analysis.frameMembers[ordinal].timestampMs || sha(frame.bytes) !== analysis.frameMembers[ordinal].imageDigest)) {
    fail('ARCA_US_ADULT_FRAME_SOURCE_CHANGED', 'Inventory screenshots differ from their frozen analysis evidence.');
  }
}
function createUsAdultInventoryEngine(options) {
  const scope = options?.context?.ownerScope;
  if (scope?.domain !== 'arca' || scope.processType !== 'arca_shelf_entry' || !scope.processId ||
      typeof options.context.assertExecutionActive !== 'function' || typeof options.frameExtractor?.extract !== 'function' ||
      typeof options.faceModel?.analyzeImage !== 'function' || typeof options.referencePort?.readReferenceImage !== 'function') {
    throw new TypeError('Inventory preparation requires Arca execution authority and controlled frame, reference and CPU ports.');
  }
  const active = () => options.context.assertExecutionActive(), analysisEngine = createUsAdultFrameAnalysis({ faceModel:options.faceModel }),
    matcher = createUsAdultReferenceMatcher(options);
  return Object.freeze({
    async analyzeSource({ sourceHandle, durationMs }) {
      active();
      if (sourceHandle?.ownerDomain !== 'arca' || sourceHandle.ownerScope?.scopeType !== 'shelf_entry' ||
          sourceHandle.ownerScope.scopeId !== scope.processId || !Number.isSafeInteger(durationMs) || durationMs < 1) {
        fail('ARCA_US_ADULT_SOURCE_SCOPE_INVALID', 'Inventory analysis cannot borrow a different Owner or Entry source.');
      }
      const frames = await options.frameExtractor.extract({ sourceHandle, durationMs, context:options.context });
      active(); const times = uniformFrameTimes(durationMs);
      if (!Array.isArray(frames) || frames.length !== 20 ||
          frames.some((frame, ordinal) => frame?.timestampMs !== times[ordinal] || !Buffer.isBuffer(frame.bytes) ||
            frame.bytes.length === 0 || frame.bytes.length > 10 * 1024 * 1024)) {
        fail('ARCA_US_ADULT_FRAME_SET_INCOMPLETE', 'Inventory sampling did not finish all twenty frozen time points.');
      }
      const analysis = await analysisEngine.analyze(frames, { assertActive:active });
      assertFrames(analysis, frames); active();
      return Object.freeze({ analysis, frames:Object.freeze(frames) });
    },
    async matchPage({ analysis, personReferenceProjections }) {
      active(); assertAnalysis(analysis);
      return matcher.matchPage({ faceModelRefDigest:analysis.modelRef.digest,
        // Formation's frozen cluster members have this normalization before
        // entering the same matcher. Preserve the identical feature arithmetic.
        faces:analysis.faces.map(face => ({ faceGroupId:'arca-face-' + face.faceDigest, vector:normalizeVector(face.vector) })), personReferenceProjections });
    },
    async renderPoster({ analysis, frames, personSnapshot, referenceAssetId, originalName }) {
      active(); assertFrames(analysis, frames);
      const person = personSnapshot, { snapshotDigest, ...body } = person || {}, projection = person?.referenceProjection,
        contribution = projection?.contributions?.[0], asset = contribution?.activeAssets?.find(item => item.referenceAssetId === referenceAssetId),
        face = contribution?.activeFaces?.find(item => item.referenceAssetId === referenceAssetId),
        { projectionRevision, projectionDigest, ...projectionBody } = projection || {};
      if (person?.schemaRef !== 'helix://contracts/domain-types/UsAdultPersonSnapshot/v1' || person.libraryKind !== 'us_adult' ||
          snapshotDigest !== canonicalDigest(body) || projectionDigest !== canonicalDigest(projectionBody) ||
          projection?.personId !== person.personId || projection?.personRevision !== person.personRevision || projection?.contributions?.length !== 1 ||
          contribution.ownerPersonId !== person.personId || contribution.ownerReferenceRevision !== projection.currentReferenceRevision || contribution.inheritedReadOnly ||
          !asset || !face || face.modelRef !== faceModelReference('single_reference_face').digest) {
        fail('ARCA_US_ADULT_POSTER_PERSON_CHANGED', 'Inventory poster requires the selected frozen actor and exact usable reference asset.');
      }
      const named = buildUsAdultTitle({ actorName:person.canonicalName, originalName }),
        portrait = options.referencePort.readReferenceImage({ personId:person.personId, artifactHandleId:asset.artifactHandleId,
          artifactDigest:asset.artifactDigest })?.bytes;
      if (!Buffer.isBuffer(portrait) || portrait.length === 0 || portrait.length > 10 * 1024 * 1024 || sha(portrait) !== asset.artifactDigest) {
        fail('ARCA_US_ADULT_POSTER_PERSON_CHANGED', 'Inventory reference image bytes changed from their frozen digest.');
      }
      active();
      const rendered = await renderUsAdultPoster({ actorName:person.canonicalName, originalTitle:named.originalStem, portrait,
        frames:analysis.posterFrameOrdinals.map(ordinal => frames[ordinal].bytes) });
      active(); return rendered;
    },
  });
}
module.exports = Object.freeze({ createUsAdultInventoryEngine });
