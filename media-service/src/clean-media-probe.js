'use strict';

const { spawn } = require('node:child_process');
const { canonicalDigest } = require('./helix/contracts/canonical-json');
const { collectFormatTags, normalizeAudioClass } =
  require('./helix/contracts/normalized-audio-class');
const { createBdmvTopologyReader } = require('./helix/integrations/bdmv-topology');
const { createDiscTopologyReader } = require('./helix/integrations/disc-topology');

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
        'stream=index,codec_type,codec_name,profile,pix_fmt,bits_per_raw_sample,bit_rate,chroma_location,color_range,color_space,color_transfer,color_primaries,width,height,channels,channel_layout,disposition',
        'stream_tags',
        'stream_side_data',
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
  const formatTags = collectFormatTags(stream);
  const value = {
    streamIndex: Number(stream.index),
    codec: String(stream.codec_name || ''),
    dispositionDefault: Boolean(stream.disposition?.default),
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    profile: typeof stream.profile === 'string' ? stream.profile : '',
    channels: Number(stream.channels || 0),
    channelLayout: typeof stream.channel_layout === 'string' ? stream.channel_layout : '',
    formatTags,
  };
  if (stream.codec_type === 'audio') {
    const bitRateBps = Number(stream.bit_rate);
    if (Number.isSafeInteger(bitRateBps) && bitRateBps > 0) value.bitRateBps = bitRateBps;
    value.normalizedAudioClass = normalizeAudioClass({
      codec: value.codec,
      profile: value.profile,
      formatTags,
    });
    if (typeof stream.tags?.language === 'string' && stream.tags.language) {
      value.language = stream.tags.language;
    }
  }
  if (stream.codec_type === 'video') Object.assign(value, normalizeVideoTechnicalFacts(stream));
  return Object.freeze(value);
}

function normalizedColor(value) {
  const text=String(value || '').trim().toLowerCase();
  if(!text||text==='unknown'||text==='unspecified')return 'unknown';
  if(text==='tv'||text==='mpeg')return 'limited';
  if(text==='pc'||text==='jpeg')return 'full';
  if(text==='smpte2084')return 'pq';
  if(text==='arib-std-b67')return 'hlg';
  return text;
}

function bitDepth(stream) {
  const explicit=Number(stream.bits_per_raw_sample || 0);
  if(Number.isSafeInteger(explicit)&&explicit>0)return explicit;
  const match=String(stream.pix_fmt || '').match(/(?:p|le|be)(9|10|12|14|16)(?:le|be)?$/i);
  return match?Number(match[1]):8;
}

function chroma(pixelFormat) {
  const value=String(pixelFormat || '').toLowerCase();
  if(value.includes('420'))return '4:2:0';
  if(value.includes('422'))return '4:2:2';
  if(value.includes('444'))return '4:4:4';
  if(value.includes('gray'))return 'monochrome';
  return 'unknown';
}

function doviConfiguration(stream) {
  const side=(stream.side_data_list || []).find((item)=>/dovi configuration record/i.test(String(item.side_data_type || '')));
  if(!side)return null;
  const blPresent=Number(side.bl_present_flag || 0)===1;
  const primaries=normalizedColor(stream.color_primaries),transfer=normalizedColor(stream.color_transfer),matrix=normalizedColor(stream.color_space);
  const knownColor=primaries!=='unknown'&&transfer!=='unknown'&&matrix!=='unknown';
  const pqCompatible=blPresent&&primaries==='bt2020'&&transfer==='pq'&&['bt2020nc','bt2020ncl','bt2020_cl','bt2020c'].includes(matrix);
  return Object.freeze({profile:Number(side.dv_profile || 0),level:Number(side.dv_level || 0),
    rpuPresent:Number(side.rpu_present_flag || 0)===1,elPresent:Number(side.el_present_flag || 0)===1,blPresent,
    compatibilityId:Number(side.dv_bl_signal_compatibility_id || 0),
    baseLayerKind:pqCompatible?'pq_bt2020_compatible':knownColor?'non_compatible':'unknown'});
}

function normalizeVideoTechnicalFacts(stream) {
  const colorRange=normalizedColor(stream.color_range),colorPrimaries=normalizedColor(stream.color_primaries),
    colorTransfer=normalizedColor(stream.color_transfer),colorMatrix=normalizedColor(stream.color_space),dolbyVision=doviConfiguration(stream);
  let dynamicRangeKind='unknown';
  if(dolbyVision)dynamicRangeKind='dolby_vision';
  else if(colorTransfer==='pq'&&colorPrimaries==='bt2020')dynamicRangeKind='hdr10_compatible';
  else if(colorTransfer==='hlg')dynamicRangeKind='hlg';
  else if(colorTransfer==='bt709'||colorPrimaries==='bt709')dynamicRangeKind='sdr';
  return Object.freeze({codecProfile:String(stream.profile || 'unknown'),pixelFormat:String(stream.pix_fmt || 'unknown'),
    bitDepth:bitDepth(stream),chroma:chroma(stream.pix_fmt),colorRange,colorPrimaries,colorTransfer,colorMatrix,
    dynamicRangeKind,...(dolbyVision?{dolbyVision}:{})});
}

function evidence(readHandle, parsed, discTopology = null) {
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const formatName = String(parsed.format?.format_name || '').split(',')[0];
  const value = {
    resultKind: 'probed',
    sourceHandleDigest: canonicalDigest(readHandle),
    container: formatName || 'unknown',
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
  const discTopologyReader = options.discTopologyReader || createDiscTopologyReader({ bdmvTopologyReader:topologyReader });
  return Object.freeze({
    // The Procurement BDMV Assessment Capability receives this typed,
    // read-only topology port from the Composition Root.  It is deliberately
    // not embedded in MediaProbeEvidence or stream payloads.
    bdmvTopologyReader: topologyReader,
    async probe(readHandle) {
      const workspace = readHandle?.schemaRef === 'helix://contracts/types/WorkspaceMaterialHandle/v1';
      const location = workspace && typeof options.workspaceMaterialLocationResolver === 'function'
        ? options.workspaceMaterialLocationResolver(readHandle) : readHandle?.location;
      const identity = workspace ? readHandle?.physicalIdentity : readHandle?.identity;
      if (!readHandle || typeof location !== 'string' || !identity) {
        throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_INPUT',
          'Media Probe requires an immutable Physical or Workspace Material read handle.');
      }
      if (isBdmvStructuralLocation(location)) {
        const topology = await topologyReader.inspect(bdmvTopologyLocation(location));
        const value = {
          resultKind:'not_media', sourceHandleDigest:canonicalDigest(readHandle), durationMs:0,
          videoStreams:Object.freeze([]), audioStreams:Object.freeze([]), subtitleStreams:Object.freeze([]),
          discTopology:topology, payloadDigest:'',
        };
        value.payloadDigest = canonicalDigest(without(value, 'payloadDigest'));
        return Object.freeze(value);
      }
      const detectedTopology = await discTopologyReader.inspect(location, readHandle);
      let result;
      try {
        result = await run(binary, location);
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
          discTopology: detectedTopology,
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
        return evidence(readHandle, parsed, detectedTopology);
      } catch (error) {
        if (error instanceof CleanMediaProbeError) throw error;
        throw new CleanMediaProbeError('CLEAN_MEDIA_PROBE_CONTRACT',
          'ffprobe output could not be normalized to MediaProbeEvidence.', { cause:error.code || 'INVALID_JSON' });
      }
    },
  });
}

module.exports = Object.freeze({ CleanMediaProbeError, createCleanMediaProbe,
  MAX_RAW_STDOUT_BYTES, MAX_RAW_STDERR_BYTES, normalizeVideoTechnicalFacts });
