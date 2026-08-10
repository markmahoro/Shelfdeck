'use strict';

const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { createBdmvTopologyReader } = require('./helix/integrations/bdmv-topology');

const MAX_RAW_STDOUT_BYTES = 256 * 1024;
const MAX_RAW_STDERR_BYTES = 16 * 1024;

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
      // Fatal-only diagnostics keep non-fatal packet warnings from overflowing the
      // bounded transport channel while preserving ffprobe's exit-code contract.
      '-v', 'fatal', '-of', 'json=compact=1',
      '-show_entries', [
        'format=format_name,duration,size',
        'stream=index,codec_type,codec_name,profile,width,height,channels,channel_layout,disposition:stream_tags=language,title',
      ].join(':'), location,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const stopForOverflow = (kind, limit) => {
      if (overflow) return;
      overflow = new CleanMediaProbeError('CLEAN_MEDIA_PROBE_OUTPUT_LIMIT',
        `ffprobe ${kind} exceeded the bounded transport limit.`, { kind, limit });
      child.kill();
    };
    child.stdout.on('data', (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      if (stdoutBytes > MAX_RAW_STDOUT_BYTES) return stopForOverflow('stdout', MAX_RAW_STDOUT_BYTES);
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += Buffer.byteLength(chunk, 'utf8');
      if (stderrBytes > MAX_RAW_STDERR_BYTES) return stopForOverflow('stderr', MAX_RAW_STDERR_BYTES);
      stderr.push(chunk);
    });
    child.once('error', (error) => {
      // Killing a child after a bounded-channel overflow can surface a secondary
      // process error. Preserve the primary protocol failure instead of masking it.
      if (overflow) return;
      reject(error);
    });
    child.once('close', (code) => {
      if (overflow) return reject(overflow);
      resolve({ code, stdout:stdout.join(''), stderr:stderr.join('') });
    });
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

function evidence(readHandle, parsed, discTopology = null) {
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const value = {
    resultKind: 'probed',
    sourceHandleDigest: canonicalDigest(readHandle),
    durationMs: Math.max(0, Math.round(Number(parsed.format?.duration || 0) * 1000)),
    videoStreams: Object.freeze(streams.filter((stream) => stream.codec_type === 'video').map(normalizedStream)),
    audioStreams: Object.freeze(streams.filter((stream) => stream.codec_type === 'audio').map(normalizedStream)),
    subtitleStreams: Object.freeze(streams.filter((stream) => stream.codec_type === 'subtitle').map(normalizedStream)),
    discTopology,
    payloadDigest: '',
  };
  value.payloadDigest = canonicalDigest(without(value, 'payloadDigest'));
  return Object.freeze(value);
}

function bdmvTopologyLocation(location) {
  const normalized = String(location || '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (parts[index].toUpperCase() === 'BDMV') return parts.slice(0, index + 1).join('/');
  }
  const certificateIndex = parts.length - 2;
  if (certificateIndex >= 0 && parts[certificateIndex].toUpperCase() === 'CERTIFICATE') {
    const root = parts.slice(0, certificateIndex).concat('BDMV').join('/');
    return root;
  }
  return null;
}

function isBdmvStructuralLocation(location) {
  const normalized = String(location || '').replace(/\\/g, '/').toUpperCase();
  // BACKUP is a legal BDMV metadata subtree.  Structural files must be
  // represented as typed topology evidence at any depth, otherwise a copied
  // disc's BACKUP/*.mpls/*.clpi files are sent to ffprobe and become false
  // probe_not_media business failures.
  return /(?:^|\/)BDMV\/(?:.*\/)?(?:[^/]+\.MPLS|[^/]+\.CLPI|INDEX\.BDMV|MOVIEOBJECT\.BDMV)$/.test(normalized) ||
    /(?:^|\/)CERTIFICATE\/ID\.BDMV$/.test(normalized);
}

function createCleanMediaProbe(options = {}) {
  const binary = options.binary || commandPath();
  if (!binary) {
    throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_UNAVAILABLE',
      'ShelfDeck Service requires its bundled ffprobe artifact for Triage.');
  }
  const topologyReader = options.bdmvTopologyReader || createBdmvTopologyReader(options.bdmv || {});
  return Object.freeze({
    // The Procurement BDMV Assessment Capability receives this typed,
    // read-only topology port from the Composition Root.  It is deliberately
    // not embedded in MediaProbeEvidence or stream payloads.
    bdmvTopologyReader: topologyReader,
    async probe(readHandle) {
      if (!readHandle || typeof readHandle.location !== 'string' || !readHandle.identity) {
        throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_INPUT',
          'Media Probe requires an immutable Field read handle.');
      }
      if (isBdmvStructuralLocation(readHandle.location)) {
        const topology = await topologyReader.inspect(bdmvTopologyLocation(readHandle.location));
        const value = {
          resultKind:'not_media', sourceHandleDigest:canonicalDigest(readHandle), durationMs:0,
          videoStreams:Object.freeze([]), audioStreams:Object.freeze([]), subtitleStreams:Object.freeze([]),
          discTopology:topology, payloadDigest:'',
        };
        value.payloadDigest = canonicalDigest(without(value, 'payloadDigest'));
        return Object.freeze(value);
      }
      let result;
      try {
        result = await run(binary, readHandle.location);
      } catch (error) {
        throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_EXECUTION',
          'Bundled ffprobe could not be executed.', { cause: error.code || 'EXECUTION_FAILED' });
      }
      if (result.code !== 0) {
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
        const parsed = JSON.parse(result.stdout);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.streams) ||
            parsed.streams.length > 256 || !parsed.format || typeof parsed.format !== 'object') {
          throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_CONTRACT',
            'ffprobe output does not match the bounded typed projection.');
        }
        const discTopology = await topologyReader.inspect(readHandle.location, readHandle);
        return evidence(readHandle, parsed, discTopology);
      } catch (error) {
        if (error instanceof CleanMediaProbeError) throw error;
        throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_CONTRACT',
          'ffprobe output could not be normalized to MediaProbeEvidence.', { cause:error.code || 'INVALID_JSON' });
      }
    },
  });
}

module.exports = Object.freeze({ CleanMediaProbeError, createCleanMediaProbe,
  MAX_RAW_STDOUT_BYTES, MAX_RAW_STDERR_BYTES });
