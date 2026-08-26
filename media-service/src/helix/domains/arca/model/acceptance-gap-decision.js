'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../../../contracts/canonical-json');

const ACCEPTANCE_CHECK_KINDS = Object.freeze([
  'identity',
  'mandatory_media',
  'metadata',
  'space',
  'structure',
]);

const ACCEPTANCE_GAP_ORDER = Object.freeze([
  'identity_unmet',
  'season_identity_unmet',
  'structure_unmet',
  'episode_coverage_unmet',
  'metadata_field_unmet',
  'metadata_artifact_unmet',
  'sidecar_unrenderable',
  'image_undecodable',
  'media_form_unmet',
  'video_codec_unmet',
  'container_unmet',
  'file_extension_unmet',
  'minimum_raster_unmet',
  'system_upscale_forbidden',
  'primary_audio_unmet',
  'dynamic_range_conversion_unmet',
  'output_color_profile_unmet',
  'dolby_vision_metadata_not_removed',
  'playback_decode_failed',
  'max_size_exceeded',
]);
const GAP_CODES_BY_CHECK = Object.freeze({
  identity: Object.freeze(['identity_unmet', 'season_identity_unmet']),
  structure: Object.freeze(['structure_unmet', 'episode_coverage_unmet']),
  metadata: Object.freeze([
    'metadata_field_unmet', 'metadata_artifact_unmet',
    'sidecar_unrenderable', 'image_undecodable',
  ]),
  mandatory_media: Object.freeze([
    'media_form_unmet', 'video_codec_unmet', 'container_unmet',
    'file_extension_unmet', 'minimum_raster_unmet',
    'system_upscale_forbidden', 'primary_audio_unmet',
    'dynamic_range_conversion_unmet', 'output_color_profile_unmet',
    'dolby_vision_metadata_not_removed', 'playback_decode_failed',
  ]),
  space: Object.freeze(['max_size_exceeded']),
});

function without(value, key) {
  return Object.fromEntries(Object.entries(value || {})
    .filter(([name]) => name !== key));
}

function gapSetDigest(checkKind, items) {
  return canonicalDigest({
    schema: 'arca.acceptance-check-actual-gap-set@1',
    checkKind,
    items,
  });
}

function observationSetDigest(items) {
  return canonicalDigest({
    schema: 'arca.mandatory-media-primary-observation-set@1',
    items,
  });
}

function sortChecks(checks) {
  return Object.freeze([...checks].sort((left, right) =>
    Buffer.compare(Buffer.from(left.checkKind), Buffer.from(right.checkKind))));
}

function finalGapDecision(input) {
  const acceptanceChecks = sortChecks(input.acceptanceChecks || []);
  const kinds = acceptanceChecks.map((item) => item.checkKind);
  if (canonicalJson(kinds) !== canonicalJson(ACCEPTANCE_CHECK_KINDS) ||
      acceptanceChecks.some((item) =>
        item.schemaRef !== 'helix://contracts/types/AcceptanceCheck/v1' ||
        item.acceptanceAttemptId !== input.acceptanceAttemptId ||
        item.packageDigest !== input.packageDigest ||
        item.standardRevision !== input.standardRevision)) {
    throw Object.assign(
      new TypeError('Acceptance Check set is incomplete or crosses one Acceptance basis.'),
      { code: 'ARCA_ACCEPTANCE_CHECK_SET_INVALID' },
    );
  }
  const manifest = input.authorizedDefectManifest || null;
  const expectedManifestDigest = manifest?.manifestDigest || null;
  const expectedComparison = manifest ? 'pending_final_union' : 'not_applicable';
  const authorized = manifest?.waivedRequirementCodes || [];
  const observedAcrossChecks = [];
  for (const item of acceptanceChecks) {
    const gaps = item.actualGapCodes;
    const observations = item.primaryMediaObservations;
    const allowed = GAP_CODES_BY_CHECK[item.checkKind] || [];
    const canonicalGaps = allowed.filter((value) => gaps?.includes(value));
    const expectedPassed = item.evidenceStatus === 'complete' &&
      (manifest
        ? canonicalJson(canonicalGaps) === canonicalJson(
          allowed.filter((value) => authorized.includes(value)))
        : canonicalGaps.length === 0);
    if (!Array.isArray(gaps) ||
        canonicalJson(gaps) !== canonicalJson(canonicalGaps) ||
        item.actualGapSetDigest !== gapSetDigest(item.checkKind, gaps) ||
        item.authorizedDefectManifestDigestOrNull !== expectedManifestDigest ||
        item.authorizedGapComparison !== expectedComparison ||
        !['complete', 'stale_basis'].includes(item.evidenceStatus) ||
        item.result !== (expectedPassed ? 'passed' : 'failed') ||
        !Array.isArray(item.reasonCodes) ||
        (expectedPassed ? item.reasonCodes.length !== 0 : item.reasonCodes.length === 0) ||
        (item.evidenceStatus === 'stale_basis' &&
          (gaps.length !== 0 || canonicalJson(item.reasonCodes) !==
            canonicalJson(['stale_decision_basis'])))) {
      throw Object.assign(
        new TypeError('Acceptance Check actual Gap evidence is not canonical.'),
        { code: 'ARCA_ACCEPTANCE_CHECK_GAP_INVALID', checkKind:item.checkKind },
      );
    }
    if (item.checkKind !== 'mandatory_media') {
      if (!Array.isArray(observations) || observations.length !== 0 ||
          item.primaryMediaObservationSetDigest !== observationSetDigest([])) {
        throw Object.assign(
          new TypeError('Non-media Acceptance Check contains Primary media observations.'),
          { code: 'ARCA_ACCEPTANCE_CHECK_OBSERVATION_INVALID', checkKind:item.checkKind },
        );
      }
    } else {
      if (!Array.isArray(observations) ||
          item.primaryMediaObservationSetDigest !==
            observationSetDigest(observations) ||
          (item.evidenceStatus === 'complete' && observations.length === 0) ||
          (item.evidenceStatus === 'stale_basis' && observations.length !== 0)) {
        throw Object.assign(
          new TypeError('Mandatory media observation set is not canonical.'),
          { code: 'ARCA_ACCEPTANCE_CHECK_OBSERVATION_INVALID', checkKind:item.checkKind },
        );
      }
      const observedGaps = new Set();
      for (let ordinal = 0; ordinal < observations.length; ordinal += 1) {
        const observation = observations[ordinal];
        const observationGaps = allowed.filter((value) =>
          observation.actualGapCodes?.includes(value));
        if (observation.ordinal !== ordinal ||
            canonicalJson(observation.actualGapCodes) !==
              canonicalJson(observationGaps) ||
            observation.actualGapSetDigest !==
              gapSetDigest('mandatory_media', observation.actualGapCodes) ||
            observation.observationDigest !==
              canonicalDigest(without(observation, 'observationDigest'))) {
          throw Object.assign(
            new TypeError('Primary media observation is not canonical.'),
            { code: 'ARCA_ACCEPTANCE_CHECK_OBSERVATION_INVALID', ordinal },
          );
        }
        observationGaps.forEach((value) => observedGaps.add(value));
      }
      if (canonicalJson(gaps) !== canonicalJson(
        allowed.filter((value) => observedGaps.has(value)))) {
        throw Object.assign(
          new TypeError('Mandatory media Check Gap set does not equal its observations.'),
          { code: 'ARCA_ACCEPTANCE_CHECK_OBSERVATION_INVALID' },
        );
      }
    }
    observedAcrossChecks.push(...gaps);
  }
  const found = new Set(observedAcrossChecks);
  if ([...found].some((item) => !ACCEPTANCE_GAP_ORDER.includes(item))) {
    throw Object.assign(
      new TypeError('Acceptance Check contains an unknown actual Gap code.'),
      { code: 'ARCA_ACCEPTANCE_GAP_INVALID' },
    );
  }
  const actualGapUnionCodes = Object.freeze(
    ACCEPTANCE_GAP_ORDER.filter((item) => found.has(item)),
  );
  const canonicalAuthorized = ACCEPTANCE_GAP_ORDER.filter((item) =>
    authorized.includes(item));
  const authorizedGapComparison = manifest
    ? canonicalJson(actualGapUnionCodes) === canonicalJson(canonicalAuthorized) &&
      canonicalJson(authorized) === canonicalJson(canonicalAuthorized)
      ? 'exact_match'
      : 'mismatch'
    : actualGapUnionCodes.length === 0
      ? 'not_applicable'
      : 'mismatch';
  return Object.freeze({
    acceptanceChecks,
    acceptanceCheckSetDigest: canonicalDigest({
      schema: 'arca.acceptance-check-set@1',
      items: acceptanceChecks,
    }),
    actualGapUnionCodes,
    actualGapUnionDigest: canonicalDigest({
      schema: 'arca.acceptance-actual-gap-union@1',
      items: actualGapUnionCodes,
    }),
    authorizedDefectManifestDigestOrNull: manifest?.manifestDigest || null,
    authorizedGapComparison,
  });
}

module.exports = Object.freeze({
  ACCEPTANCE_CHECK_KINDS,
  ACCEPTANCE_GAP_ORDER,
  GAP_CODES_BY_CHECK,
  finalGapDecision,
});
