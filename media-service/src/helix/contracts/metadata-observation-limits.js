'use strict';

const METADATA_OBSERVATION_LIMITS = Object.freeze({movie:16, series:128, jav:16});

function metadataObservationLimit(contentProfile) {
  const limit = METADATA_OBSERVATION_LIMITS[contentProfile];
  if (!limit) throw new TypeError('Metadata Observation requires a supported content profile.');
  return limit;
}

module.exports = Object.freeze({METADATA_OBSERVATION_LIMITS, metadataObservationLimit});
