'use strict';

// Disc topology inspection is metadata-only. It uses filesystem/content
// signatures to prove ISO/DVD input form and reads only bounded directory,
// playlist and IFO metadata. It never reads an entire ISO or VOB payload.

const fs = require('node:fs');
const { canonicalDigest } = require('../contracts/canonical-json');

const SECTOR_BYTES = 2048;
const MAX_FILES = 1024;
const MAX_DIRECTORY_BYTES = 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_PLAYLIST_BYTES = 1024 * 1024;
const SELECTION_RULE = 'unique_payload_bytes_then_duration_then_distinct_clip_count_then_playlist_path';

function utf8(left, right) {
  return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8'));
}

function normalized(value) {
  return String(value || '').replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
}

function dirname(value) {
  const location = String(value || '').replace(/\\/gu, '/').replace(/\/+$/gu, '');
  const index = location.lastIndexOf('/');
  if (index < 0) return '.';
  if (index === 0) return '/';
  if (index === 2 && /^[A-Za-z]:/u.test(location)) return location.slice(0, 3);
  return location.slice(0, index);
}

function basename(value) {
  const location = String(value || '').replace(/\\/gu, '/').replace(/\/+$/gu, '');
  const index = location.lastIndexOf('/');
  return index < 0 ? location : location.slice(index + 1);
}

function joinPath(left, right) {
  return (String(left || '').replace(/\\/gu, '/').replace(/\/+$/gu, '') + '/' +
    String(right || '').replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '')).replace(/\/+/gu, '/');
}

function readAt(fd, length, position) {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DIRECTORY_BYTES) return null;
  const bytes = Buffer.alloc(length);
  const read = fs.readSync(fd, bytes, 0, length, position);
  return read === length ? bytes : null;
}

function isoDirectoryRecord(bytes, offset) {
  const length = bytes[offset];
  if (!length || length < 34 || offset + length > bytes.length) return null;
  const nameLength = bytes[offset + 32];
  if (offset + 33 + nameLength > bytes.length) return null;
  const rawName = bytes.subarray(offset + 33, offset + 33 + nameLength);
  let name;
  if (nameLength === 1 && rawName[0] === 0) name = '.';
  else if (nameLength === 1 && rawName[0] === 1) name = '..';
  else name = rawName.toString('ascii').replace(/;[0-9]+$/u, '');
  return Object.freeze({
    length,
    extent: bytes.readUInt32LE(offset + 2),
    sizeBytes: bytes.readUInt32LE(offset + 10),
    directory: Boolean(bytes[offset + 25] & 0x02),
    name,
  });
}

function isoFiles(location) {
  const fd = fs.openSync(location, 'r');
  let metadataBytes = 0;
  try {
    const pvd = readAt(fd, SECTOR_BYTES, 16 * SECTOR_BYTES);
    if (!pvd || pvd[0] !== 1 || pvd.subarray(1, 6).toString('ascii') !== 'CD001') return null;
    const root = isoDirectoryRecord(pvd, 156);
    if (!root?.directory) return null;
    const files = [];
    const visit = (directory, prefix) => {
      if (directory.sizeBytes > MAX_DIRECTORY_BYTES || metadataBytes + directory.sizeBytes > MAX_METADATA_BYTES) {
        const error = new Error('ISO directory metadata exceeds the bounded topology limit.');
        error.code = 'DISC_TOPOLOGY_METADATA_LIMIT';
        throw error;
      }
      const bytes = readAt(fd, directory.sizeBytes, directory.extent * SECTOR_BYTES);
      if (!bytes) throw new Error('ISO directory metadata could not be read exactly.');
      metadataBytes += bytes.length;
      for (let offset = 0; offset < bytes.length;) {
        const length = bytes[offset];
        if (!length) {
          offset = (Math.floor(offset / SECTOR_BYTES) + 1) * SECTOR_BYTES;
          continue;
        }
        const record = isoDirectoryRecord(bytes, offset);
        offset += length;
        if (!record || record.name === '.' || record.name === '..') continue;
        const relativeLocation = prefix ? prefix + '/' + record.name : record.name;
        if (record.directory) visit(record, relativeLocation);
        else files.push(Object.freeze({
          relativeLocation,
          extent: record.extent,
          sizeBytes: record.sizeBytes,
        }));
        if (files.length > MAX_FILES) {
          const error = new Error('ISO topology exceeds the Physical Material member limit.');
          error.code = 'DISC_TOPOLOGY_SCOPE_TOO_LARGE';
          throw error;
        }
      }
    };
    visit(root, '');
    return Object.freeze({ fd, files:Object.freeze(files.sort((a, b) => utf8(a.relativeLocation, b.relativeLocation))) });
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function parseMpls(bytes, relativeLocation, streamByPath) {
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'MPLS') return null;
  const start = bytes.readUInt32BE(8);
  if (start <= 0 || start + 10 > bytes.length) return null;
  const count = bytes.readUInt16BE(start + 6);
  let offset = start + 10;
  let durationTicks = 0;
  const clips = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 22 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 22 || offset + 2 + length > bytes.length) return null;
    const clipId = bytes.toString('ascii', offset + 2, offset + 7);
    const codec = bytes.toString('ascii', offset + 7, offset + 11);
    const inTime = bytes.readUInt32BE(offset + 14);
    const outTime = bytes.readUInt32BE(offset + 18);
    if (/^\d{5}$/u.test(clipId) && codec === 'M2TS') {
      const stream = streamByPath.get('BDMV/STREAM/' + clipId + '.M2TS');
      if (!stream) return null;
      clips.push(Object.freeze({ clipId, relativeLocation:stream.relativeLocation, sizeBytes:stream.sizeBytes }));
      durationTicks += Math.max(0, outTime - inTime);
    }
    offset += 2 + length;
  }
  if (!clips.length || durationTicks <= 0) return null;
  return Object.freeze({
    relativeLocation,
    clips:Object.freeze(clips),
    durationMs:Math.round(durationTicks / 45),
    uniqueStreamBytes:[...new Map(clips.map((clip) => [clip.clipId, clip.sizeBytes])).values()]
      .reduce((total, sizeBytes) => total + sizeBytes, 0),
  });
}

function finishTopology(discKind, identity, candidates, selected, members) {
  const titleSelectionEvidence = Object.freeze({
    selectionRule:SELECTION_RULE,
    candidateTitleCount:candidates.length,
    selectedPlaylist:selected.relativeLocation,
    candidateDigests:Object.freeze(candidates.map((candidate) => Object.freeze({
      signature:candidate.signature,
      playlist:candidate.relativeLocation,
      uniqueStreamBytes:candidate.uniqueStreamBytes,
      durationMs:candidate.durationMs,
      distinctClipCount:candidate.distinctClipCount,
    })).sort((left, right) => utf8(left.signature, right.signature))),
  });
  const descriptor = Object.freeze({
    discKind,
    titleCount:candidates.length,
    selectedPlaylist:Object.freeze({
      relativeLocation:selected.relativeLocation,
      durationMs:selected.durationMs,
      clipIds:Object.freeze(selected.clipIds),
    }),
    members:Object.freeze(members.sort((left, right) =>
      utf8(left.relativeLocation, right.relativeLocation) || utf8(left.role, right.role))),
  });
  return Object.freeze({
    ...descriptor,
    topologyVersion:1,
    titleSelectionEvidence,
    singleTitleEvidenceDigest:canonicalDigest({ schema:'helix.disc-title-selection@1', identity, descriptor, titleSelectionEvidence }),
    topologyDigest:canonicalDigest({ schema:'helix.disc-topology@1', identity, descriptor }),
  });
}

function inspectIso(location) {
  let listed;
  try { listed = isoFiles(location); } catch (_) { return null; }
  if (!listed) return null;
  const { fd, files } = listed;
  try {
    const byPath = new Map(files.map((file) => [normalized(file.relativeLocation).toUpperCase(), file]));
    const streams = new Map(files.filter((file) => /^BDMV\/STREAM\/\d{5}\.M2TS$/iu.test(normalized(file.relativeLocation)))
      .map((file) => [normalized(file.relativeLocation).toUpperCase(), file]));
    const candidatesBySignature = new Map();
    for (const playlist of files.filter((file) => /^BDMV\/PLAYLIST\/[^/]+\.MPLS$/iu.test(normalized(file.relativeLocation)))) {
      if (playlist.sizeBytes > MAX_PLAYLIST_BYTES) continue;
      const bytes = readAt(fd, playlist.sizeBytes, playlist.extent * SECTOR_BYTES);
      const parsed = bytes && parseMpls(bytes, normalized(playlist.relativeLocation), streams);
      if (!parsed) continue;
      const clipIds = [...new Set(parsed.clips.map((clip) => clip.clipId))].sort(utf8);
      const signature = canonicalDigest({ schema:'helix.iso-title-signature@1', clipIds });
      if (!candidatesBySignature.has(signature)) candidatesBySignature.set(signature, Object.freeze({
        ...parsed,
        clipIds,
        distinctClipCount:clipIds.length,
        signature,
      }));
    }
    const candidates = [...candidatesBySignature.values()].sort((left, right) =>
      right.uniqueStreamBytes - left.uniqueStreamBytes || right.durationMs - left.durationMs ||
      right.distinctClipCount - left.distinctClipCount || utf8(left.relativeLocation, right.relativeLocation));
    const selected = candidates[0];
    if (!selected) return null;
    const members = [
      { relativeLocation:selected.relativeLocation, role:'structural_dependency' },
      ...selected.clips.map((clip) => ({ relativeLocation:clip.relativeLocation, role:'primary_payload', clipId:clip.clipId })),
      ...selected.clipIds.map((clipId) => ({ relativeLocation:'BDMV/CLIPINF/' + clipId + '.CLPI', role:'structural_dependency', clipId })),
      { relativeLocation:'BDMV/INDEX.BDMV', role:'structural_dependency' },
      { relativeLocation:'BDMV/MOVIEOBJECT.BDMV', role:'structural_dependency' },
    ].filter((member) => byPath.has(normalized(member.relativeLocation).toUpperCase()));
    return finishTopology('iso', canonicalDigest({ location, sizeBytes:fs.fstatSync(fd).size }), candidates, selected, members);
  } finally {
    fs.closeSync(fd);
  }
}

function nearestVideoTs(location) {
  let current;
  try {
    current = fs.statSync(location).isDirectory() ? location : dirname(location);
  } catch (_) { return null; }
  while (true) {
    if (basename(current).toUpperCase() === 'VIDEO_TS') return current;
    const child = joinPath(current, 'VIDEO_TS');
    try { if (fs.statSync(child).isDirectory()) return child; } catch (_) {}
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function prefix(location, length = 12) {
  const fd = fs.openSync(location, 'r');
  try {
    const bytes = Buffer.alloc(length);
    const read = fs.readSync(fd, bytes, 0, length, 0);
    return bytes.subarray(0, read).toString('ascii');
  } finally { fs.closeSync(fd); }
}

function inspectDvd(location) {
  const videoTs = nearestVideoTs(location);
  if (!videoTs) return null;
  const manager = joinPath(videoTs, 'VIDEO_TS.IFO');
  try { if (prefix(manager) !== 'DVDVIDEO-VMG') return null; } catch (_) { return null; }
  let entries;
  try { entries = fs.readdirSync(videoTs, { withFileTypes:true }); } catch (_) { return null; }
  const files = entries.filter((entry) => !entry.isSymbolicLink() && entry.isFile()).map((entry) => {
    const absolute = joinPath(videoTs, entry.name);
    return Object.freeze({ name:entry.name.toUpperCase(), absolute, sizeBytes:fs.statSync(absolute).size });
  }).sort((left, right) => utf8(left.name, right.name));
  if (files.length > MAX_FILES) return null;
  const groups = new Map();
  for (const file of files) {
    const match = /^VTS_(\d{2})_(\d+)\.VOB$/u.exec(file.name);
    if (!match || Number(match[2]) < 1) continue;
    const title = match[1];
    const titleIfo = files.find((candidate) => candidate.name === 'VTS_' + title + '_0.IFO');
    try { if (!titleIfo || prefix(titleIfo.absolute) !== 'DVDVIDEO-VTS') continue; } catch (_) { continue; }
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(Object.freeze({ ...file, part:Number(match[2]) }));
  }
  const candidates = [...groups.entries()].map(([title, clips]) => {
    const ordered = clips.sort((left, right) => left.part - right.part);
    const clipIds = ordered.map((clip) => clip.name);
    const uniqueStreamBytes = ordered.reduce((total, clip) => total + clip.sizeBytes, 0);
    const relativeLocation = 'VIDEO_TS/VTS_' + title;
    return Object.freeze({ title, clips:Object.freeze(ordered), clipIds:Object.freeze(clipIds), uniqueStreamBytes,
      durationMs:0, distinctClipCount:ordered.length, relativeLocation,
      signature:canonicalDigest({ schema:'helix.dvd-title-signature@1', title, clipIds }) });
  }).sort((left, right) => right.uniqueStreamBytes - left.uniqueStreamBytes || utf8(left.relativeLocation, right.relativeLocation));
  const selected = candidates[0];
  if (!selected) return null;
  const include = new Set(['VIDEO_TS.IFO', 'VIDEO_TS.BUP', 'VTS_' + selected.title + '_0.IFO', 'VTS_' + selected.title + '_0.BUP']);
  const members = [
    ...selected.clips.map((clip) => ({ relativeLocation:'VIDEO_TS/' + clip.name, role:'primary_payload', clipId:clip.name })),
    ...files.filter((file) => include.has(file.name)).map((file) => ({ relativeLocation:'VIDEO_TS/' + file.name, role:'structural_dependency' })),
  ];
  return finishTopology('dvd', canonicalDigest({ videoTs, managerSizeBytes:fs.statSync(manager).size }), candidates, selected, members);
}

function createDiscTopologyReader(options = {}) {
  const bdmvTopologyReader = options.bdmvTopologyReader;
  const cache = new Map();
  return Object.freeze({
    async inspect(location, frozenScope = null) {
      if (bdmvTopologyReader) {
        const bdmv = await bdmvTopologyReader.inspect(location, frozenScope);
        if (bdmv) return bdmv;
      }
      let stat;
      try { stat = fs.statSync(location); } catch (_) { return null; }
      const key = String(location) + '\0' + String(stat.size) + '\0' + String(stat.mtimeMs) + '\0' + String(stat.ctimeMs || 0);
      if (!cache.has(key)) cache.set(key, stat.isFile() ? inspectIso(location) || inspectDvd(location) : inspectDvd(location));
      return cache.get(key);
    },
  });
}

module.exports = Object.freeze({
  createDiscTopologyReader,
  inspectIso,
  inspectDvd,
  MAX_FILES,
  MAX_METADATA_BYTES,
});
