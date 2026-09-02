'use strict';

const SPEC_EXTERNAL_CODES = new Set([
  'minimum_raster_unmet',
  'system_upscale_forbidden',
  'primary_audio_unmet',
]);
const HARD_BLOCK_CODES = new Set([
  'requirement_integrity_failure',
  'output_not_media',
  'output_handle_mismatch',
  'media_form_unmet',
  'playback_decode_failed',
]);
const TRANSCODE_FIXABLE_CODES = new Set([
  'video_codec_unmet',
  'container_unmet',
  'file_extension_unmet',
  'max_size_exceeded',
  'dynamic_range_conversion_unmet',
  'output_color_profile_unmet',
  'dolby_vision_metadata_not_removed',
]);

function reasonSet(verification) {
  return new Set(verification?.reasonCodes || []);
}

function classifyVerifyGap(verification) {
  if (!verification || verification.result === 'passed') return 'passed';
  const reasons = verification.reasonCodes || [];
  if (!reasons.length) return 'passed';
  if (reasons.some((code) => HARD_BLOCK_CODES.has(code))) return 'hard_block';
  if (reasons.every((code) => code === 'max_size_exceeded')) return 'volume_only';
  if (reasons.some((code) => SPEC_EXTERNAL_CODES.has(code))) return 'spec_external';
  if (reasons.every((code) => TRANSCODE_FIXABLE_CODES.has(code))) return 'transcode_fixable';
  return 'hard_block';
}

function requiresExternalSourceFromVerification(verification) {
  const reasons = reasonSet(verification);
  return SPEC_EXTERNAL_CODES.has('minimum_raster_unmet') && reasons.has('minimum_raster_unmet') ||
    SPEC_EXTERNAL_CODES.has('system_upscale_forbidden') && reasons.has('system_upscale_forbidden') ||
    reasons.has('primary_audio_unmet');
}

function onlyVolumeGapFromVerification(verification) {
  return classifyVerifyGap(verification) === 'volume_only';
}

function transcodeFixableWithoutSpecExternal(verification) {
  const kind = classifyVerifyGap(verification);
  return kind === 'volume_only' || kind === 'transcode_fixable';
}

function shouldTranscodeExternalImport(verification) {
  return transcodeFixableWithoutSpecExternal(verification);
}

module.exports = Object.freeze({
  HARD_BLOCK_CODES,
  SPEC_EXTERNAL_CODES,
  TRANSCODE_FIXABLE_CODES,
  classifyVerifyGap,
  onlyVolumeGapFromVerification,
  requiresExternalSourceFromVerification,
  shouldTranscodeExternalImport,
  transcodeFixableWithoutSpecExternal,
});
