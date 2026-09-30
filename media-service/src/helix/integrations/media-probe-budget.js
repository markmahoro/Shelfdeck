'use strict';

// Disc transport streams can place codec headers beyond FFmpeg's default
// five-megabyte probe. Keep discovery finite and identical for Probe and remux.
const MEDIA_PROBE_INPUT_ARGS = Object.freeze([
  '-analyzeduration', '30000000',
  '-probesize', '50000000',
]);

module.exports = Object.freeze({ MEDIA_PROBE_INPUT_ARGS });
