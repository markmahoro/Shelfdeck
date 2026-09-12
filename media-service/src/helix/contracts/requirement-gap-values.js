'use strict';

const { canonicalDigest } = require('./canonical-json');

// Canonical field addressing for the shared Requirements value contract.
// Owners still decide whether a measured gap can be authorized.
function requirementGapValue(requirements, code, field) {
  const media = requirements?.mandatoryMedia || {};
  if (code === 'metadata_field_unmet') return { field, required:requirements?.metadata?.requiredFieldCodes?.includes(field) === true };
  if (code === 'artifact_unmet'||code === 'metadata_artifact_unmet') return { artifact:field,
    required:require('./artifact-requirement-gaps').requiredArtifactKinds(requirements||{}).includes(field) };
  const values = {
    video_codec_unmet:media.videoCodec, container_unmet:media.container,
    file_extension_unmet:media.fileExtension, minimum_raster_unmet:media.minimumRasterClass,
    system_upscale_forbidden:{raster:media.minimumRasterClass,forbidden:media.forbidSystemUpscaleFor4k},
    primary_audio_unmet:[...(media.acceptedPrimaryAudioClasses || [])].sort(),
    max_size_exceeded:requirements?.space?.maxSizeBytes,
    dynamic_range_conversion_unmet:media,
    output_color_profile_unmet:media,
    dolby_vision_metadata_not_removed:media,
  };
  return Object.hasOwn(values,code) ? { code, value:values[code] ?? null } : null;
}
function requirementGapValueDigest(requirements, code, field) {
  return canonicalDigest(requirementGapValue(requirements,code,field));
}
module.exports = Object.freeze({ requirementGapValue, requirementGapValueDigest });
