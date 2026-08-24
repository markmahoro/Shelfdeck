'use strict';

const path = require('node:path');
const {
  normalizeAudioClass,
} = require('../../../contracts/normalized-audio-class');

const MIN_VIDEO_BITRATE_BPS = 100_000;
const DEFAULT_SUBTITLE_BITRATE_BPS = 64_000;

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function streamIndex(value) {
  const index = Number(value?.streamIndex);
  return Number.isSafeInteger(index) && index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function defaultFirstStreams(streams) {
  const ordered = [...(Array.isArray(streams) ? streams : [])]
    .sort((left, right) => streamIndex(left) - streamIndex(right));
  const defaults = ordered.filter((item) => item?.dispositionDefault === true);
  return Object.freeze(defaults.length ? defaults : ordered.slice(0, 1));
}

function primaryVideoStreams(probe) {
  return defaultFirstStreams(probe?.videoStreams);
}

function primaryAudioStreams(probe) {
  return defaultFirstStreams(probe?.audioStreams);
}

function audioCodec(stream) {
  return String(stream?.codecName || stream?.codec || '').toLowerCase();
}

function audioClass(stream) {
  if (typeof stream?.normalizedAudioClass === 'string' &&
      stream.normalizedAudioClass.length > 0) {
    return stream.normalizedAudioClass;
  }
  return normalizeAudioClass({
    ...stream,
    codec: audioCodec(stream),
  });
}

function estimatedAudioBitrateBps(stream) {
  const observed = finitePositive(stream?.bitRateBps);
  if (observed !== null) return Math.floor(observed);
  const codec = audioCodec(stream);
  const normalized = audioClass(stream);
  if (['truehd', 'truehd_atmos', 'dts_hd_ma', 'dts_x'].includes(normalized) ||
      /truehd|dts[_ -]?hd/.test(codec)) return 8_000_000;
  return 1_536_000;
}

function sizeBudgetFor(fillBytes, durationSeconds, nonVideoBitrateBps) {
  const reserveBytes = Math.max(16 * 1024 * 1024, Math.ceil(fillBytes * 0.02));
  const videoBitrateBps = Math.floor(
    ((fillBytes - reserveBytes) * 8 / durationSeconds) - nonVideoBitrateBps,
  );
  return Object.freeze({ fillBytes, reserveBytes, videoBitrateBps });
}

function deriveAftercareSizeBudget(value) {
  const maxSizeBytes = Number(value?.maxSizeBytes);
  const durationMs = Number(value?.durationMs);
  if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes < 1 ||
      !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new TypeError('Aftercare size budget requires a positive max size and duration.');
  }
  const audioStreams = Object.freeze([...(Array.isArray(value?.audioStreams)
    ? value.audioStreams : [])]);
  const subtitleStreams = Object.freeze([...(Array.isArray(value?.subtitleStreams)
    ? value.subtitleStreams : [])]);
  const audioBitrateBps = audioStreams.reduce(
    (sum, item) => sum + estimatedAudioBitrateBps(item), 0,
  );
  const subtitleBitrateBps = subtitleStreams.length * DEFAULT_SUBTITLE_BITRATE_BPS;
  const nonVideoBitrateBps = audioBitrateBps + subtitleBitrateBps;
  const sourceSizeBytes = Number.isSafeInteger(value?.sourceSizeBytes) &&
    value.sourceSizeBytes > 0 ? value.sourceSizeBytes : null;
  const durationSeconds = durationMs / 1000;
  const cap = sizeBudgetFor(maxSizeBytes, durationSeconds, nonVideoBitrateBps);
  const target = sizeBudgetFor(
    sourceSizeBytes === null ? maxSizeBytes : Math.min(maxSizeBytes, sourceSizeBytes),
    durationSeconds,
    nonVideoBitrateBps,
  );
  const capFeasible = cap.videoBitrateBps >= MIN_VIDEO_BITRATE_BPS;
  const sourceBoundFeasible = target.videoBitrateBps >= MIN_VIDEO_BITRATE_BPS;
  return Object.freeze({
    maxSizeBytes,
    sourceSizeBytes,
    targetFillBytes: target.fillBytes,
    capReserveBytes: cap.reserveBytes,
    targetReserveBytes: target.reserveBytes,
    audioBitrateBps,
    subtitleBitrateBps,
    nonVideoBitrateBps,
    capVideoBitrateBps: cap.videoBitrateBps,
    targetVideoBitrateBps: capFeasible && sourceBoundFeasible
      ? Math.min(cap.videoBitrateBps, target.videoBitrateBps) : null,
    capFeasible,
    sourceBoundFeasible,
    feasible: capFeasible && sourceBoundFeasible,
  });
}

function videoCodec(stream) {
  return String(stream?.codecName || stream?.codec || '').toLowerCase();
}

function displayDimensions(stream) {
  const width = finitePositive(stream?.displayWidth) || finitePositive(stream?.width) ||
    finitePositive(stream?.codedWidth) || 0;
  const height = finitePositive(stream?.displayHeight) || finitePositive(stream?.height) ||
    finitePositive(stream?.codedHeight) || 0;
  return Object.freeze({
    width,
    height,
    longEdge: Math.max(width, height),
    shortEdge: Math.min(width, height),
  });
}

function isFourK(stream) {
  const dimensions = displayDimensions(stream);
  return dimensions.longEdge >= 3800 && dimensions.shortEdge >= 1600;
}

function extensionOf(location) {
  return path.extname(String(location || '')).slice(1).toLowerCase();
}

function evaluateMandatoryMedia(value) {
  const mandatory = value?.mandatoryMedia || {};
  const probe = value?.probe;
  const reasons = [];
  if (!probe || probe.resultKind !== 'probed') {
    reasons.push('primary_decode_failed');
  } else {
    const videos = primaryVideoStreams(probe);
    const video = videos[0] || {};
    const codec = videoCodec(video);
    const container = String(probe.container || probe.formatName || '').toLowerCase();
    if (mandatory.mediaForm === 'stream_file' && probe.discTopology) {
      reasons.push('media_form_unmet');
    }
    if (mandatory.videoCodec && mandatory.videoCodec !== 'any' &&
        codec !== mandatory.videoCodec) reasons.push('video_codec_unmet');
    if (mandatory.container && mandatory.container !== 'any' &&
        !container.includes(mandatory.container === 'matroska'
          ? 'matroska' : mandatory.container)) reasons.push('container_unmet');
    if (mandatory.fileExtension && mandatory.fileExtension !== 'any' &&
        extensionOf(value?.location) !== mandatory.fileExtension) {
      reasons.push('file_extension_unmet');
    }
    if (mandatory.minimumRasterClass === '4k' &&
        (!videos.length || !videos.every(isFourK))) reasons.push('minimum_raster_unmet');
    const sourceVideos = value?.sourceProbe ? primaryVideoStreams(value.sourceProbe) : null;
    if (mandatory.forbidSystemUpscaleFor4k && videos.length && videos.every(isFourK) &&
        sourceVideos && (!sourceVideos.length || !sourceVideos.every(isFourK))) {
      reasons.push('system_upscale_forbidden');
    }
    const acceptedAudio = Array.isArray(mandatory.acceptedPrimaryAudioClasses)
      ? mandatory.acceptedPrimaryAudioClasses : [];
    const primaryAudioClasses = primaryAudioStreams(probe).map(audioClass);
    if (acceptedAudio.length &&
        !primaryAudioClasses.some((item) => acceptedAudio.includes(item))) {
      reasons.push('primary_audio_unmet');
    }
  }
  return Object.freeze([...new Set(reasons)].sort());
}

function evaluateAftercareConformance(value) {
  const reasons = [...evaluateMandatoryMedia(value)];
  const maximum = value?.space?.maxSizeBytes;
  if (Number.isSafeInteger(maximum) && maximum > 0 &&
      Number(value?.sizeBytes) > maximum) reasons.push('max_size_exceeded');
  const reasonCodes = Object.freeze([...new Set(reasons)].sort());
  return Object.freeze({ passed:reasonCodes.length === 0, reasonCodes });
}

function streamSignature(kind, stream) {
  const common = [
    kind === 'audio' ? audioCodec(stream) : String(stream?.codecName || stream?.codec || '').toLowerCase(),
    String(stream?.language || ''),
    stream?.dispositionDefault === true ? 'default' : 'nondefault',
  ];
  if (kind === 'audio') {
    common.push(String(stream?.profile || '').toLowerCase(), String(Number(stream?.channels || 0)),
      String(stream?.channelLayout || '').toLowerCase(), audioClass(stream));
  }
  return JSON.stringify(common);
}

function signatureCounts(kind, streams) {
  const counts = new Map();
  for (const stream of Array.isArray(streams) ? streams : []) {
    const signature = streamSignature(kind, stream);
    counts.set(signature, (counts.get(signature) || 0) + 1);
  }
  return counts;
}

function sameStreamSet(kind, expected, actual) {
  const left = signatureCounts(kind, expected);
  const right = signatureCounts(kind, actual);
  if (left.size !== right.size) return false;
  for (const [key, count] of left) if (right.get(key) !== count) return false;
  return true;
}

function sameVideoTopology(expected, actual) {
  const left = [...(Array.isArray(expected) ? expected : [])]
    .map((item) => item?.dispositionDefault === true ? 'default' : 'nondefault').sort();
  const right = [...(Array.isArray(actual) ? actual : [])]
    .map((item) => item?.dispositionDefault === true ? 'default' : 'nondefault').sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function verifyOutputContinuity(value) {
  const source = value?.sourceProbe;
  const output = value?.outputProbe;
  const reasons = [];
  if (!source || source.resultKind !== 'probed') reasons.push('source_not_media');
  if (!output || output.resultKind !== 'probed') reasons.push('output_not_media');
  if (!reasons.length) {
    if (!primaryVideoStreams(output).length) reasons.push('primary_video_missing');
    if (!sameVideoTopology(source.videoStreams, output.videoStreams)) {
      reasons.push('video_stream_set_changed');
    }
    const expectedAudio = value?.expectedAudioStreams || source.audioStreams || [];
    const expectedSubtitles = value?.expectedSubtitleStreams || source.subtitleStreams || [];
    if (!sameStreamSet('audio', expectedAudio, output.audioStreams || [])) {
      reasons.push('audio_stream_set_changed');
    }
    if (!sameStreamSet('subtitle', expectedSubtitles, output.subtitleStreams || [])) {
      reasons.push('subtitle_stream_set_changed');
    }
    const sourceDurationMs = finitePositive(source.durationMs);
    const outputDurationMs = finitePositive(output.durationMs);
    const toleranceMs = Number.isFinite(value?.durationToleranceMs) &&
      value.durationToleranceMs >= 0 ? value.durationToleranceMs :
      Math.max(2_000, Math.min(10_000, Math.floor((sourceDurationMs || 0) * 0.001)));
    if (sourceDurationMs === null || outputDurationMs === null ||
        Math.abs(sourceDurationMs - outputDurationMs) > toleranceMs) {
      reasons.push('duration_continuity_unmet');
    }
  }
  const reasonCodes = Object.freeze([...new Set(reasons)].sort());
  return Object.freeze({ passed:reasonCodes.length === 0, reasonCodes });
}

module.exports = Object.freeze({
  MIN_VIDEO_BITRATE_BPS,
  defaultFirstStreams,
  primaryVideoStreams,
  primaryAudioStreams,
  estimatedAudioBitrateBps,
  deriveAftercareSizeBudget,
  evaluateMandatoryMedia,
  evaluateAftercareConformance,
  verifyOutputContinuity,
});
