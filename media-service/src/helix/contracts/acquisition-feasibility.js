'use strict';

// Shared interpretation of advertised input claims, not product acceptance.
// Unknown claims and irreparable gaps never become acquisition permission.
function isProcessableCandidate(candidate) {
  if (!candidate || candidate.availability !== 'available' ||
      candidate.availabilityEvidence?.status !== 'known' ||
      !(candidate.availabilityEvidence.seederCount > 0)) return false;
  const media = candidate.advertisedMedia;
  if (!media) return false;
  if (candidate.requirementAssessment === 'compliant') return true;
  return candidate.requirementAssessment === 'noncompliant' &&
    media.videoCodec?.status === 'known' &&
    ['hevc', 'h264'].includes(media.videoCodec.value) &&
    candidate.assessmentReasonCodes.length > 0 &&
    candidate.assessmentReasonCodes.every(code =>
      ['video_codec_unmet', 'max_size_exceeded'].includes(code));
}

module.exports = Object.freeze({ isProcessableCandidate });
