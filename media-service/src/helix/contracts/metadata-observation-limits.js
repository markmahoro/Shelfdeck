'use strict';

const METADATA_OBSERVATION_LIMITS = Object.freeze({movie:16, series:1024, jav:16});

function metadataObservationLimit(contentProfile) {
  const limit = METADATA_OBSERVATION_LIMITS[contentProfile];
  if (!limit) throw new TypeError('Metadata Observation requires a supported content profile.');
  return limit;
}

function metadataObservationSetByteLimit(contentProfile) {
  metadataObservationLimit(contentProfile);
  return contentProfile === 'series' ? 8 * 1024 * 1024 : 512 * 1024;
}

module.exports = Object.freeze({METADATA_OBSERVATION_LIMITS, metadataObservationLimit, metadataObservationSetByteLimit});
