'use strict';

// Shared interpretation of advertised input claims, not product acceptance.
// Only the explicit Series allocation exception can admit unknown space.
function isProcessableCandidate(candidate) {
  if (!candidate || candidate.availability !== 'available' ||
      candidate.availabilityEvidence?.status !== 'known' ||
      !(candidate.availabilityEvidence.seederCount > 0)) return false;
  const media = candidate.advertisedMedia;
  if (!media) return false;
  if (candidate.requirementAssessment === 'compliant') return true;
  if (candidate.requirementAssessment === 'unknown' && candidate.structureKind === 'season' &&
      candidate.episodeKeys?.length > 1 && candidate.identityAnchors?.some(item => item.namespace === 'tmdb_series' && item.seasonNumber > 0) &&
      media.sizeBytes?.status === 'known' && Number.isSafeInteger(media.sizeBytes.value) && media.sizeBytes.value >= 0 &&
      candidate.assessmentReasonCodes?.length === 1 && candidate.assessmentReasonCodes[0] === 'size_unknown') return true;
  return candidate.requirementAssessment === 'noncompliant' &&
    media.videoCodec?.status === 'known' &&
    ['hevc', 'h264'].includes(media.videoCodec.value) &&
    candidate.assessmentReasonCodes.length > 0 &&
    candidate.assessmentReasonCodes.every(code =>
      ['video_codec_unmet', 'max_size_exceeded'].includes(code));
}

module.exports = Object.freeze({ isProcessableCandidate });
