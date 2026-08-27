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
    if (!pvd || pvd[0] !== 1 || pvd.subarray(1, 6).toString('ascii') !== 'CD001') {
      fs.closeSync(fd);
      return null;
    }
    const root = isoDirectoryRecord(pvd, 156);
    if (!root?.directory) {
      fs.closeSync(fd);
      return null;
    }
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
          extents: Object.freeze([{ sector: record.extent, length: record.sizeBytes }]),
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

function udfTag(bytes, offset = 0) {
  if (!bytes || offset + 16 > bytes.length) return null;
  const id = bytes.readUInt16LE(offset);
  if (!id) return null;
  return Object.freeze({
    id,
    version: bytes.readUInt16LE(offset + 2),
    location: bytes.readUInt32LE(offset + 12),
  });
}

function udfExtent(bytes, offset) {
  return Object.freeze({
    length: bytes.readUInt32LE(offset),
    location: bytes.readUInt32LE(offset + 4),
  });
}

function udfLongAd(bytes, offset) {
  return Object.freeze({
    length: bytes.readUInt32LE(offset) & 0x3fffffff,
    type: bytes.readUInt32LE(offset) >>> 30,
    lbn: bytes.readUInt32LE(offset + 4),
    partition: bytes.readUInt16LE(offset + 8),
  });
}

function udfDecodeName(bytes) {
  if (!bytes.length) return '';
  if (bytes[0] === 8) return bytes.subarray(1).toString('latin1').replace(/\0/g, '');
  if (bytes[0] === 16) {
    let name = '';
    for (let index = 1; index + 1 < bytes.length; index += 2) {
      name += String.fromCharCode(bytes.readUInt16BE(index));
    }
    return name.replace(/\0/g, '');
  }
  return bytes.toString('latin1').replace(/\0/g, '');
}

function udfReadSector(fd, sector) {
  return readAt(fd, SECTOR_BYTES, sector * SECTOR_BYTES);
}

function udfParseVolume(fd) {
  const bea = udfReadSector(fd, 16);
  if (!bea || bea.subarray(1, 6).toString('ascii') !== 'BEA01') return null;
  const avdp = udfReadSector(fd, 256);
  const avdpTag = udfTag(avdp);
  if (!avdpTag || avdpTag.id !== 2) return null;
  const mainVds = udfExtent(avdp, 16);
  if (!mainVds.location || mainVds.length < SECTOR_BYTES) return null;
  const vdsSectors = Math.min(32, Math.max(1, Math.floor(mainVds.length / SECTOR_BYTES)));
  let partitionStart = null;
  let partitionNumber = 0;
  let fileSet = null;
  const maps = [];
  for (let index = 0; index < vdsSectors; index += 1) {
    const sector = udfReadSector(fd, mainVds.location + index);
    const tag = udfTag(sector);
    if (!tag) break;
    if (tag.id === 5) {
      partitionNumber = sector.readUInt16LE(22);
      partitionStart = sector.readUInt32LE(188);
    } else if (tag.id === 6) {
      const logicalBlockSize = sector.readUInt32LE(212);
      if (logicalBlockSize !== SECTOR_BYTES) return null;
      fileSet = udfLongAd(sector, 248);
      const mapTableLength = sector.readUInt32LE(264);
      const mapCount = sector.readUInt32LE(268);
      if (mapCount > 8 || mapTableLength > 512) return null;
      let offset = 440;
      for (let mapIndex = 0; mapIndex < mapCount && offset + 2 <= sector.length; mapIndex += 1) {
        const type = sector[offset];
        const length = sector[offset + 1];
        if (!length || offset + length > sector.length) return null;
        const map = { type, partitionReference: maps.length, physicalPartition: 0, metadataDataStart: null };
        if (type === 1 && length >= 6) map.physicalPartition = sector.readUInt16LE(offset + 4);
        if (type === 2 && length >= 64) {
          const ident = sector.subarray(offset + 5, offset + 28).toString('latin1');
          map.physicalPartition = sector.readUInt16LE(offset + 38);
          if (ident.startsWith('*UDF Metadata Partition')) {
            map.metadataFileLocation = sector.readUInt32LE(offset + 40);
          }
        }
        maps.push(Object.freeze(map));
        offset += length;
      }
    } else if (tag.id === 8) break;
  }
  if (partitionStart === null || !fileSet || !maps.length) return null;
  const metadataMap = maps.find((map) => Number.isSafeInteger(map.metadataFileLocation));
  let metadataDataStart = null;
  if (metadataMap) {
    const metaFe = udfReadSector(fd, partitionStart + metadataMap.metadataFileLocation);
    const entry = udfParseFileEntry(metaFe);
    const extent = entry?.extents?.[0];
    if (!extent || extent.type !== 0) return null;
    metadataDataStart = extent.lbn;
  }
  return {
    partitionStart,
    partitionNumber,
    maps: Object.freeze(maps),
    fileSet,
    metadataDataStart,
    metadataBytes: 0,
  };
}

function udfAbsoluteSector(volume, partitionRef, lbn) {
  const map = volume.maps[partitionRef];
  if (!map) return null;
  if (map.type === 2 && Number.isSafeInteger(volume.metadataDataStart)) {
    return volume.partitionStart + volume.metadataDataStart + lbn;
  }
  return volume.partitionStart + lbn;
}

function udfParseFileEntry(bytes) {
  const tag = udfTag(bytes);
  if (!tag || (tag.id !== 261 && tag.id !== 266)) return null;
  const extended = tag.id === 266;
  const fileType = bytes[27];
  const flags = bytes.readUInt16LE(34);
  const infoLen = Number(bytes.readBigUInt64LE(56));
  const eaLen = extended ? bytes.readUInt32LE(208) : bytes.readUInt32LE(168);
  const adLen = extended ? bytes.readUInt32LE(212) : bytes.readUInt32LE(172);
  const adStart = (extended ? 216 : 176) + eaLen;
  if (adStart < 0 || adLen < 0 || adStart + adLen > bytes.length || adLen > 1024) return null;
  const ads = bytes.subarray(adStart, adStart + adLen);
  const adType = flags & 7;
  const stride = adType === 1 ? 16 : 8;
  if (adType !== 0 && adType !== 1) return null;
  const extents = [];
  for (let offset = 0; offset + stride <= ads.length; offset += stride) {
    if (adType === 0) {
      const word = ads.readUInt32LE(offset);
      const length = word & 0x3fffffff;
      const type = word >>> 30;
      if (!length) break;
      extents.push(Object.freeze({
        length, type, lbn: ads.readUInt32LE(offset + 4), partition: null,
      }));
    } else {
      const ad = udfLongAd(ads, offset);
      if (!ad.length) break;
      extents.push(Object.freeze({
        length: ad.length, type: ad.type, lbn: ad.lbn, partition: ad.partition,
      }));
    }
  }
  return Object.freeze({ fileType, flags, infoLen, extents: Object.freeze(extents) });
}

function udfReadEntry(fd, volume, icb) {
  const sector = udfAbsoluteSector(volume, icb.partition, icb.lbn);
  if (!Number.isSafeInteger(sector)) return null;
  return udfParseFileEntry(udfReadSector(fd, sector));
}

function udfTrackMetadata(volume, bytes) {
  volume.metadataBytes = (volume.metadataBytes || 0) + bytes;
  if (volume.metadataBytes > MAX_METADATA_BYTES) {
    const error = new Error('UDF directory metadata exceeds the bounded topology limit.');
    error.code = 'DISC_TOPOLOGY_METADATA_LIMIT';
    throw error;
  }
}

function udfReadExtents(fd, volume, entry, asMetadata) {
  const chunks = [];
  let remaining = Math.min(entry.infoLen, MAX_DIRECTORY_BYTES);
  for (const extent of entry.extents) {
    if (remaining <= 0) break;
    if (extent.type !== 0 || extent.length <= 0) continue;
    const partition = asMetadata
      ? (extent.partition === null ? volume.fileSet.partition : extent.partition)
      : (extent.partition === null ? 0 : extent.partition);
    const length = Math.min(extent.length, remaining);
    const sector = udfAbsoluteSector(volume, partition, extent.lbn);
    if (!Number.isSafeInteger(sector)) return null;
    udfTrackMetadata(volume, length);
    const bytes = readAt(fd, length, sector * SECTOR_BYTES);
    if (!bytes) return null;
    chunks.push(bytes);
    remaining -= length;
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

function udfListDirectory(fd, volume, icb) {
  const entry = udfReadEntry(fd, volume, icb);
  if (!entry) return null;
  const data = udfReadExtents(fd, volume, entry, true);
  if (!data) return [];
  const items = [];
  for (let offset = 0; offset + 38 <= data.length;) {
    const tag = udfTag(data, offset);
    if (!tag || tag.id !== 257) break;
    const characteristics = data[offset + 18];
    const identLen = data[offset + 19];
    const implLen = data.readUInt16LE(offset + 36);
    const identStart = offset + 38 + implLen;
    const rawLen = 38 + implLen + identLen;
    const padded = (rawLen + 3) & ~3;
    if (identStart + identLen > data.length || offset + padded > data.length) break;
    if (!(characteristics & 4) && !(characteristics & 8)) {
      items.push(Object.freeze({
        directory: Boolean(characteristics & 2),
        name: udfDecodeName(data.subarray(identStart, identStart + identLen)),
        icb: udfLongAd(data, offset + 20),
      }));
    }
    offset += padded;
  }
  return items;
}

function udfWalk(fd, volume, icb, prefix, files) {
  const items = udfListDirectory(fd, volume, icb);
  if (!items) return;
  for (const item of items) {
    if (!item.name) continue;
    const relativeLocation = prefix ? prefix + '/' + item.name : item.name;
    if (item.directory) {
      udfWalk(fd, volume, item.icb, relativeLocation, files);
      continue;
    }
    const entry = udfReadEntry(fd, volume, item.icb);
    if (!entry || !entry.extents?.length) continue;
    const extents = [];
    for (const extent of entry.extents) {
      if (extent.type !== 0 || extent.length <= 0) continue;
      const partition = extent.partition === null ? 0 : extent.partition;
      const sector = udfAbsoluteSector(volume, partition, extent.lbn);
      if (!Number.isSafeInteger(sector)) continue;
      extents.push(Object.freeze({ sector, length: extent.length }));
    }
    if (!extents.length || !Number.isSafeInteger(entry.infoLen) || entry.infoLen < 1) continue;
    files.push(Object.freeze({
      relativeLocation,
      extent: extents[0].sector,
      sizeBytes: entry.infoLen,
      extents: Object.freeze(extents),
    }));
    if (files.length > MAX_FILES) {
      const error = new Error('ISO topology exceeds the Physical Material member limit.');
      error.code = 'DISC_TOPOLOGY_SCOPE_TOO_LARGE';
      throw error;
    }
  }
}

function udfFiles(location) {
  const fd = fs.openSync(location, 'r');
  try {
    const volume = udfParseVolume(fd);
    if (!volume) {
      fs.closeSync(fd);
      return null;
    }
    const fsdSector = udfAbsoluteSector(volume, volume.fileSet.partition, volume.fileSet.lbn);
    const fsd = Number.isSafeInteger(fsdSector) ? udfReadSector(fd, fsdSector) : null;
    const fsdTag = udfTag(fsd);
    if (!fsdTag || fsdTag.id !== 256) {
      fs.closeSync(fd);
      return null;
    }
    const root = udfLongAd(fsd, 400);
    const files = [];
    udfWalk(fd, volume, root, '', files);
    return Object.freeze({
      fd,
      files: Object.freeze(files.sort((left, right) => utf8(left.relativeLocation, right.relativeLocation))),
    });
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
      clips.push(Object.freeze({ clipId, relativeLocation:stream.relativeLocation,
        sizeBytes:stream.sizeBytes, inTimeTicks:inTime, outTimeTicks:outTime }));
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

function inspectIsoPlaybackPlan(location) {
  let listed;
  try { listed = isoFiles(location) || udfFiles(location); } catch (_) { return null; }
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
    ].map((member) => {
      const listed = byPath.get(normalized(member.relativeLocation).toUpperCase());
      if (!listed) return null;
      return member;
    }).filter(Boolean);
    const topology = finishTopology('iso',
      canonicalDigest({ location, sizeBytes:fs.fstatSync(fd).size }), candidates, selected, members);
    const playItems = Object.freeze(selected.clips.map((clip, index) => Object.freeze({
      sequence:index,
      clipId:clip.clipId,
      relativeLocation:clip.relativeLocation,
      sizeBytes:clip.sizeBytes,
      inTimeTicks:clip.inTimeTicks,
      outTimeTicks:clip.outTimeTicks,
    })));
    const selectedPlan = {
      playlistRelativeLocation:selected.relativeLocation,
      durationMs:selected.durationMs,
      playItems,
      selectedPlanDigest:'',
    };
    selectedPlan.selectedPlanDigest = canonicalDigest({
      schema:'helix.iso-selected-playback-plan@1',
      topologyDigest:topology.topologyDigest,
      playlistRelativeLocation:selectedPlan.playlistRelativeLocation,
      durationMs:selectedPlan.durationMs,
      playItems:selectedPlan.playItems,
    });
    return Object.freeze({ topology, selectedPlan:Object.freeze(selectedPlan), files });
  } finally {
    fs.closeSync(fd);
  }
}

function inspectIso(location) {
  return inspectIsoPlaybackPlan(location)?.topology || null;
}

function listIsoImageFiles(location) {
  let listed;
  try { listed = isoFiles(location) || udfFiles(location); } catch (error) {
    if (error?.code === 'DISC_TOPOLOGY_METADATA_LIMIT' || error?.code === 'DISC_TOPOLOGY_SCOPE_TOO_LARGE') throw error;
    return null;
  }
  if (!listed) return null;
  try {
    return listed.files;
  } finally {
    fs.closeSync(listed.fd);
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
  inspectIsoPlaybackPlan,
  inspectDvd,
  listIsoImageFiles,
  MAX_FILES,
  MAX_METADATA_BYTES,
});
