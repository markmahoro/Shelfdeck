'use strict';

// BDMV topology is metadata-only. This reader may stat directories and read bounded
// MPLS/CLPI metadata, but it never opens an M2TS payload. Structure consumes the
// durable descriptor produced by Media Probe and never calls this module.

const fs = require('node:fs');
const { canonicalDigest } = require('../contracts/canonical-json');

const MAX_PLAYLIST_BYTES = 1024 * 1024;
const MAX_TOTAL_PLAYLIST_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 1024;

// The integration boundary intentionally exposes only fs/crypto.  These small
// path helpers keep the reader platform-neutral without importing a higher-level
// path package into the integration package.
function slash(value) { return String(value || '').replace(/\\/g, '/'); }
function absoluteLocation(value) {
  const normalized = slash(value);
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) return normalized.replace(/\/+$/, '');
  return slash(process.cwd()) + '/' + normalized.replace(/^\/+/, '');
}
function dirname(value) {
  const normalized = slash(value).replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '.';
  if (index === 0) return '/';
  if (index === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, index);
}
function basename(value) {
  const normalized = slash(value).replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index < 0 ? normalized : normalized.slice(index + 1);
}
function joinPath(...parts) {
  return slash(parts.filter((part) => part !== undefined && part !== null && String(part) !== '').join('/'))
    .replace(/\/+/g, '/');
}
function relativePath(root, target) {
  const base = slash(root).replace(/\/+$/, '');
  const value = slash(target);
  const baseFolded = base.toLowerCase();
  const valueFolded = value.toLowerCase();
  if (valueFolded === baseFolded) return '';
  if (valueFolded.startsWith(baseFolded + '/')) return value.slice(base.length + 1);
  return value;
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toUpperCase();
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function nearestBdmvRoot(location) {
  let current = absoluteLocation(location);
  try {
    if (!fs.statSync(current).isDirectory()) current = dirname(current);
  } catch (_) {
    current = dirname(current);
  }
  while (true) {
    if (basename(current).toUpperCase() === 'BDMV') return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = joinPath(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(absolute);
      files.push(Object.freeze({
        absolute,
        relative: relativePath(root, absolute),
        sizeBytes: Number(stat.size),
      }));
      if (files.length > MAX_FILES) {
        const error = new Error('BDMV topology file count exceeds bounded metadata scope.');
        error.code = 'BDMV_TOPOLOGY_SCOPE_TOO_LARGE';
        throw error;
      }
    }
  }
  return files.sort((left, right) => utf8Compare(left.relative, right.relative));
}

function readFrozenFiles(root, members) {
  if (!Array.isArray(members) || members.length < 1) return [];
  if (members.length > MAX_FILES) {
    const error = new Error('BDMV frozen topology scope exceeds the admitted Physical Material limit.');
    error.code = 'BDMV_TOPOLOGY_SCOPE_TOO_LARGE';
    throw error;
  }
  const files = [];
  const seen = new Set();
  for (const member of members) {
    const memberLocation = member?.readHandle?.location || member?.location;
    if (typeof memberLocation !== 'string' || !memberLocation) {
      const error = new Error('BDMV frozen topology member has no exact read location.');
      error.code = 'BDMV_TOPOLOGY_SCOPE_STALE';
      throw error;
    }
    const absolute = absoluteLocation(memberLocation);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) {
      const error = new Error('BDMV frozen topology member is no longer a regular file.');
      error.code = 'BDMV_TOPOLOGY_SCOPE_STALE';
      throw error;
    }
    const expectedSize = Number(member?.sizeBytes ?? member?.readHandle?.identity?.sizeBytes);
    if (Number.isSafeInteger(expectedSize) && expectedSize >= 0 && Number(stat.size) !== expectedSize) {
      const error = new Error('BDMV frozen topology member size changed after Run Admission.');
      error.code = 'BDMV_TOPOLOGY_SCOPE_STALE';
      throw error;
    }
    files.push(Object.freeze({
      absolute,
      relative: relativePath(root, absolute),
      sizeBytes: Number(stat.size),
    }));
  }
  return files.sort((left, right) => utf8Compare(left.relative, right.relative));
}

function parseMpls(buffer, playlistFile, streamByRelative) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'MPLS') return null;
  const playlistStart = buffer.readUInt32BE(8);
  if (playlistStart <= 0 || playlistStart + 10 > buffer.length) return null;
  const itemCount = buffer.readUInt16BE(playlistStart + 6);
  let offset = playlistStart + 10;
  let durationTicks = 0;
  const clips = [];
  for (let index = 0; index < itemCount; index += 1) {
    if (offset + 2 > buffer.length) return null;
    const itemLength = buffer.readUInt16BE(offset);
    if (itemLength < 22 || offset + 2 + itemLength > buffer.length) return null;
    const clipId = buffer.toString('ascii', offset + 2, offset + 7);
    const codec = buffer.toString('ascii', offset + 7, offset + 11);
    const inTime = buffer.readUInt32BE(offset + 14);
    const outTime = buffer.readUInt32BE(offset + 18);
    if (/^\d{5}$/.test(clipId) && codec === 'M2TS') {
      const relative = 'STREAM/' + clipId + '.M2TS';
      const stream = streamByRelative.get(normalizeRelative(relative));
      clips.push(Object.freeze({
        clipId,
        relativeLocation: stream ? stream.relative : relative,
        present: Boolean(stream),
        sizeBytes: stream ? stream.sizeBytes : null,
        inTime,
        outTime,
      }));
      durationTicks += Math.max(0, outTime - inTime);
    }
    offset += 2 + itemLength;
  }
  const uniqueStreamBytes = [...new Map(clips.map((clip) => [clip.clipId, clip.sizeBytes || 0])).values()]
    .reduce((sum, sizeBytes) => sum + sizeBytes, 0);
  return Object.freeze({
    relativeLocation: playlistFile,
    clips: Object.freeze(clips),
    missingClipCount: clips.filter((clip) => !clip.present).length,
    durationMs: Math.round(durationTicks / 45),
    uniqueStreamBytes,
  });
}

function choosePlaylist(playlists) {
  return [...playlists].sort((left, right) =>
    right.uniqueStreamBytes - left.uniqueStreamBytes || right.durationMs - left.durationMs ||
    new Set(right.clips.map((clip) => clip.clipId)).size - new Set(left.clips.map((clip) => clip.clipId)).size ||
    utf8Compare(left.relativeLocation, right.relativeLocation))[0] || null;
}

function topologyForRoot(root, files, readLimitBytes) {
  const byRelative = new Map(files.map((file) => [normalizeRelative(file.relative), file]));
  const streamByRelative = new Map(files
    .filter((file) => /^STREAM\/\d{5}\.M2TS$/i.test(file.relative))
    .map((file) => [normalizeRelative(file.relative), file]));
  const playlistFiles = files.filter((file) => /^PLAYLIST\/[^/]+\.MPLS$/i.test(file.relative));
  const playlists = [];
  let playlistBytesRead = 0;
  for (const file of playlistFiles) {
    if (file.sizeBytes > MAX_PLAYLIST_BYTES || playlistBytesRead + file.sizeBytes > readLimitBytes) continue;
    try {
      const bytes = fs.readFileSync(file.absolute, { flag: 'r' });
      if (bytes.length > MAX_PLAYLIST_BYTES || playlistBytesRead + bytes.length > readLimitBytes) continue;
      playlistBytesRead += bytes.length;
      const parsed = parseMpls(bytes, file.relative, streamByRelative);
      if (parsed && parsed.clips.length > 0 && parsed.missingClipCount === 0 && parsed.durationMs > 0) playlists.push(parsed);
    } catch (_) {
      // A malformed or disappearing playlist makes the topology incomplete; another
      // valid playlist may still prove a single title.
    }
  }
  if (!playlists.length) return null;
  const signatures = new Map();
  for (const playlist of playlists) {
    // A playlist can repeat the same clip for loop points or menu branches.
    // Such repetitions are not a second title family; normalize by the
    // unique M2TS member set before counting titles.
    const signature = canonicalDigest({ clips: [...new Set(playlist.clips.map((clip) => clip.clipId))].sort(utf8Compare) });
    if (!signatures.has(signature)) signatures.set(signature, playlist);
  }
  const titleCount = signatures.size;
  const selected = choosePlaylist([...signatures.values()]);
  if (!selected) return null;
  const members = [];
  const seen = new Set();
  const add = (entry) => {
    if (!entry) return;
    const relativeLocation = entry.relativeLocation || entry.relative;
    const key = normalizeRelative(relativeLocation);
    if (seen.has(key)) return;
    seen.add(key);
    members.push(entry);
  };
  add({ relativeLocation: selected.relativeLocation, role: 'structural_dependency' });
  for (const clip of selected.clips) {
    add({ relativeLocation: clip.relativeLocation, role: 'primary_payload', clipId: clip.clipId });
    add({ relativeLocation: 'CLIPINF/' + clip.clipId + '.CLPI', role: 'structural_dependency' });
  }
  add({ relativeLocation: 'index.bdmv', role: 'structural_dependency' });
  add({ relativeLocation: 'MovieObject.bdmv', role: 'structural_dependency' });
  const presentMembers = members.filter((member) => byRelative.has(normalizeRelative(member.relativeLocation)))
    .map((member) => Object.freeze({ ...member, relativeLocation: byRelative.get(normalizeRelative(member.relativeLocation)).relative }));
  const descriptor = {
    discKind: 'bdmv',
    titleCount,
    selectedPlaylist: Object.freeze({ relativeLocation: selected.relativeLocation, durationMs: selected.durationMs,
      clipIds: Object.freeze([...new Set(selected.clips.map((clip) => clip.clipId))]) }),
    members: Object.freeze(presentMembers.sort((left, right) =>
      utf8Compare(left.relativeLocation, right.relativeLocation) || utf8Compare(left.role, right.role))),
  };
  const titleSelectionEvidence = Object.freeze({
    selectionRule: 'unique_payload_bytes_then_duration_then_distinct_clip_count_then_playlist_path',
    candidateTitleCount: titleCount,
    selectedPlaylist: selected.relativeLocation,
    candidateDigests: Object.freeze([...signatures.entries()].map(([signature, playlist]) => Object.freeze({
      signature, playlist: playlist.relativeLocation, uniqueStreamBytes: playlist.uniqueStreamBytes,
      durationMs: playlist.durationMs, distinctClipCount: new Set(playlist.clips.map((clip) => clip.clipId)).size,
    })).sort((left, right) => utf8Compare(left.signature, right.signature))),
  });
  const singleTitleEvidenceDigest = canonicalDigest({ schema: 'helix.bdmv-main-title-selection@2', root, descriptor, titleSelectionEvidence });
  return Object.freeze({ ...descriptor, topologyVersion: 2, titleSelectionEvidence, singleTitleEvidenceDigest,
    topologyDigest: canonicalDigest({ schema: 'helix.bdmv-topology@1', root, descriptor }) });
}

function createBdmvTopologyReader(options = {}) {
  const readLimitBytes = Number.isSafeInteger(options.maxPlaylistBytes) && options.maxPlaylistBytes > 0
    ? Math.min(options.maxPlaylistBytes, MAX_TOTAL_PLAYLIST_BYTES) : MAX_TOTAL_PLAYLIST_BYTES;
  const cache = new Map();
  return Object.freeze({
    async inspect(location, frozenScope = null) {
      const root = nearestBdmvRoot(location);
      if (!root) return null;
      let stat;
      try { stat = fs.statSync(root); } catch (_) { return null; }
      const frozenMembers = Array.isArray(frozenScope?.members) ? frozenScope.members : null;
      const scopeKey = frozenMembers ? String(frozenScope.memberSetDigest || canonicalDigest(frozenMembers.map((member) => ({
        location:member?.readHandle?.location || member?.location,
        materialKey:member?.identity?.materialKey || member?.readHandle?.identity?.materialKey,
        sizeBytes:Number((member?.sizeBytes ?? member?.readHandle?.identity?.sizeBytes) || 0),
      })))) : 'recursive';
      const key = root + '\0' + scopeKey + '\0' + String(stat.mtimeMs) + '\0' + String(stat.ctimeMs || 0);
      if (!cache.has(key)) {
        for (const oldKey of cache.keys()) if (!oldKey.startsWith(root + '\0')) cache.delete(oldKey);
        if (frozenMembers) {
          cache.set(key, topologyForRoot(root, readFrozenFiles(root, frozenMembers), readLimitBytes));
        } else {
          try { cache.set(key, topologyForRoot(root, readFiles(root), readLimitBytes)); } catch (_) { cache.set(key, null); }
        }
      }
      return cache.get(key);
    },
  });
}

module.exports = Object.freeze({ createBdmvTopologyReader, MAX_PLAYLIST_BYTES, MAX_TOTAL_PLAYLIST_BYTES });
