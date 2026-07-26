'use strict';

const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');

class CleanMediaProbeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CleanMediaProbeError';
    this.code = code;
    this.details = details;
  }
}

function without(value, field) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
}

function commandPath() {
  try {
    const installed = require('@ffprobe-installer/ffprobe');
    if (typeof installed.path === 'string' && installed.path) return installed.path;
  } catch (_) {
    // The service fails closed below if the bundled service dependency is unavailable.
  }
  return null;
}

function run(binary, location) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', location,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function normalizedStream(stream) {
  return Object.freeze({
    streamIndex: Number(stream.index),
    codec: String(stream.codec_name || ''),
    dispositionDefault: Boolean(stream.disposition?.default),
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    profile: typeof stream.profile === 'string' ? stream.profile : '',
    channels: Number(stream.channels || 0),
    channelLayout: typeof stream.channel_layout === 'string' ? stream.channel_layout : '',
  });
}

function evidence(readHandle, parsed) {
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const value = {
    resultKind: 'probed',
    sourceHandleDigest: canonicalDigest(readHandle),
    durationMs: Math.max(0, Math.round(Number(parsed.format?.duration || 0) * 1000)),
    videoStreams: Object.freeze(streams.filter((stream) => stream.codec_type === 'video').map(normalizedStream)),
    audioStreams: Object.freeze(streams.filter((stream) => stream.codec_type === 'audio').map(normalizedStream)),
    subtitleStreams: Object.freeze(streams.filter((stream) => stream.codec_type === 'subtitle').map(normalizedStream)),
    discTopology: null,
    payloadDigest: '',
  };
  value.payloadDigest = canonicalDigest(without(value, 'payloadDigest'));
  return Object.freeze(value);
}

function createCleanMediaProbe(options = {}) {
  const binary = options.binary || commandPath();
  if (!binary) {
    throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_UNAVAILABLE',
      'ShelfDeck Service requires its bundled ffprobe artifact for Triage.');
  }
  return Object.freeze({
    async probe(readHandle) {
      if (!readHandle || typeof readHandle.location !== 'string' || !readHandle.identity) {
        throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_INPUT',
          'Media Probe requires an immutable Field read handle.');
      }
      let result;
      try {
        result = await run(binary, readHandle.location);
      } catch (error) {
        throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_EXECUTION',
          'Bundled ffprobe could not be executed.', { cause: error.code || 'EXECUTION_FAILED' });
      }
      if (result.code !== 0 || Buffer.byteLength(result.stdout, 'utf8') > 65536) {
        const value = {
          resultKind: 'not_media',
          sourceHandleDigest: canonicalDigest(readHandle),
          durationMs: 0,
          videoStreams: Object.freeze([]),
          audioStreams: Object.freeze([]),
          subtitleStreams: Object.freeze([]),
          discTopology: null,
          payloadDigest: '',
        };
        value.payloadDigest = canonicalDigest(without(value, 'payloadDigest'));
        return Object.freeze(value);
      }
      try {
        return evidence(readHandle, JSON.parse(result.stdout));
      } catch (_) {
        const value = {
          resultKind: 'not_media', sourceHandleDigest: canonicalDigest(readHandle), durationMs: 0,
          videoStreams: Object.freeze([]), audioStreams: Object.freeze([]), subtitleStreams: Object.freeze([]),
          discTopology: null, payloadDigest: '',
        };
        value.payloadDigest = canonicalDigest(without(value, 'payloadDigest'));
        return Object.freeze(value);
      }
    },
  });
}

module.exports = Object.freeze({ CleanMediaProbeError, createCleanMediaProbe });
