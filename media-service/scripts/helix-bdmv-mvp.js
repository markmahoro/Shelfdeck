'use strict';

// Read-only BDMV parsing MVP. This is intentionally not wired into the Helix
// runtime. It proves that a real BDMV directory can be mapped from Playlist
// files to the referenced STREAM clips without reading video payload bytes.

const fs = require('node:fs');
const path = require('node:path');

const MAX_PLAYLIST_BYTES = 1024 * 1024;

function fail(message) {
  const error = new Error(message);
  error.code = 'HELIX_BDMV_MVP_ERROR';
  throw error;
}

function normalizeRelative(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toUpperCase();
}

function readFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(absolute);
      files.push(Object.freeze({
        absolute,
        relative: path.relative(root, absolute).replace(/\\/g, '/'),
        sizeBytes: stat.size,
      }));
    }
  }
  return files.sort((left, right) => Buffer.compare(Buffer.from(left.relative), Buffer.from(right.relative)));
}

function parseMpls(buffer, playlistFile, streamByRelative) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'MPLS') {
    fail(`Invalid MPLS header: ${playlistFile}`);
  }
  const playlistStart = buffer.readUInt32BE(8);
  if (playlistStart <= 0 || playlistStart + 10 > buffer.length) {
    fail(`Invalid MPLS playlist offset: ${playlistFile}`);
  }
  const itemCount = buffer.readUInt16BE(playlistStart + 6);
  let offset = playlistStart + 10;
  let durationTicks = 0;
  const clips = [];
  for (let index = 0; index < itemCount; index += 1) {
    if (offset + 2 > buffer.length) fail(`Truncated MPLS item header: ${playlistFile}`);
    const itemLength = buffer.readUInt16BE(offset);
    if (itemLength < 22 || offset + 2 + itemLength > buffer.length) {
      fail(`Invalid MPLS item length: ${playlistFile}`);
    }
    const clipId = buffer.toString('ascii', offset + 2, offset + 7);
    const codec = buffer.toString('ascii', offset + 7, offset + 11);
    const inTime = buffer.readUInt32BE(offset + 14);
    const outTime = buffer.readUInt32BE(offset + 18);
    if (/^\d{5}$/.test(clipId) && codec === 'M2TS') {
      const relative = `STREAM/${clipId}.M2TS`;
      const stream = streamByRelative.get(normalizeRelative(relative));
      clips.push(Object.freeze({
        clipId,
        relative: stream ? stream.relative : relative,
        present: Boolean(stream),
        sizeBytes: stream ? stream.sizeBytes : null,
        inTime,
        outTime,
        durationSec: Math.max(0, outTime - inTime) / 45000,
      }));
      durationTicks += Math.max(0, outTime - inTime);
    }
    offset += 2 + itemLength;
  }
  const uniqueStreamBytes = [...new Map(clips.map((clip) => [clip.clipId, clip.sizeBytes || 0])).values()]
    .reduce((sum, sizeBytes) => sum + sizeBytes, 0);
  return Object.freeze({
    playlist: path.basename(playlistFile),
    clips: Object.freeze(clips),
    missingClipCount: clips.filter((clip) => !clip.present).length,
    durationSec: durationTicks / 45000,
    uniqueStreamBytes,
  });
}

function choosePlaylist(playlists) {
  return [...playlists].sort((left, right) => {
    const leftBytes = left.uniqueStreamBytes || 0;
    const rightBytes = right.uniqueStreamBytes || 0;
    return rightBytes - leftBytes || right.durationSec - left.durationSec || right.clips.length - left.clips.length ||
      Buffer.compare(Buffer.from(left.playlist), Buffer.from(right.playlist));
  })[0] || null;
}

function resolveBdmvPath(input) {
  const absolute = path.resolve(input);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory() && path.basename(absolute).toUpperCase() === 'BDMV') return absolute;
  if (stat.isDirectory()) {
    const nested = path.join(absolute, 'BDMV');
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) return nested;
  }
  fail(`Input is not a BDMV directory or movie root: ${input}`);
}

function parseBdmv(input) {
  const bdmvPath = resolveBdmvPath(input);
  const movieRoot = path.dirname(bdmvPath);
  const files = readFiles(bdmvPath);
  const byRelative = new Map(files.map((file) => [normalizeRelative(file.relative), file]));
  const streamByRelative = new Map(files
    .filter((file) => /^STREAM\/\d{5}\.M2TS$/i.test(file.relative))
    .map((file) => [normalizeRelative(file.relative), file]));
  const playlistFiles = files
    .filter((file) => /^PLAYLIST\/[^/]+\.MPLS$/i.test(file.relative))
    .sort((left, right) => Buffer.compare(Buffer.from(left.relative), Buffer.from(right.relative)));
  const playlists = [];
  const invalidPlaylists = [];
  let playlistBytesRead = 0;
  for (const file of playlistFiles) {
    try {
      if (file.sizeBytes > MAX_PLAYLIST_BYTES) fail(`MPLS exceeds bounded MVP read: ${file.relative}`);
      const bytes = fs.readFileSync(file.absolute, { flag: 'r' });
      if (bytes.length > MAX_PLAYLIST_BYTES) fail(`MPLS changed beyond bounded MVP read: ${file.relative}`);
      playlistBytesRead += bytes.length;
      const parsed = parseMpls(bytes, file.relative, streamByRelative);
      if (parsed.clips.length > 0 && parsed.durationSec > 0) playlists.push(parsed);
    } catch (error) {
      invalidPlaylists.push({ playlist: file.relative, reason: error.message });
    }
  }
  const selected = choosePlaylist(playlists);
  const selectedClipKeys = new Set((selected?.clips || []).map((clip) => normalizeRelative(`STREAM/${clip.clipId}.M2TS`)));
  const selectedMembers = [];
  const selectedMemberKeys = new Set();
  const addSelectedMember = (role, file) => {
    if (!file) return;
    const key = `${role}:${normalizeRelative(file.relative)}`;
    if (selectedMemberKeys.has(key)) return;
    selectedMemberKeys.add(key);
    selectedMembers.push({ role, relative: file.relative, sizeBytes: file.sizeBytes });
  };
  if (selected) {
    const playlist = byRelative.get(normalizeRelative(`PLAYLIST/${selected.playlist}`));
    addSelectedMember('structural_dependency', playlist);
    for (const clip of selected.clips) {
      const stream = byRelative.get(normalizeRelative(`STREAM/${clip.clipId}.M2TS`));
      addSelectedMember('primary_payload', stream);
      const clipInfo = byRelative.get(normalizeRelative(`CLIPINF/${clip.clipId}.CLPI`));
      addSelectedMember('structural_dependency', clipInfo);
    }
  }
  return Object.freeze({
    schema: 'helix.bdmv-mvp@1',
    input: input,
    movieRoot,
    bdmvRoot: bdmvPath,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    streamCount: streamByRelative.size,
    playlistCount: playlistFiles.length,
    validPlaylistCount: playlists.length,
    invalidPlaylists: Object.freeze(invalidPlaylists),
    playlists: Object.freeze(playlists),
    selectedPlaylist: selected,
    selectedMembers: Object.freeze(selectedMembers),
    unreferencedStreamCount: [...streamByRelative.keys()].filter((key) => !selectedClipKeys.has(key)).length,
    readPolicy: Object.freeze({
      videoPayloadBytesRead: 0,
      playlistBytesRead,
      playlistReadLimitBytes: MAX_PLAYLIST_BYTES,
    }),
  });
}

function main() {
  const input = process.argv[2];
  if (!input) fail('Usage: node scripts/helix-bdmv-mvp.js <BDMV-directory-or-movie-root>');
  process.stdout.write(`${JSON.stringify(parseBdmv(input), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ parseBdmv });
