'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const LIBRARY_ID = 'shelfdeck-helix-movie-vertical-v1';
const CONTROL_DIRECTORY = '.shelfdeck-test-library';
const MANIFEST_SCHEMA = 'shelfdeck.movie-test-library-manifest@2';
const OWNERSHIP_SCHEMA = 'shelfdeck.movie-test-library-ownership@1';
const CONTROL_ASSETS = Object.freeze([
  'seeds/G04-collision-target.mkv.seed',
  'seeds/G06-poster-mutated.jpg.seed',
]);
const FORBIDDEN_ROOTS = new Set(['', '.', path.parse(process.cwd()).root]);

const SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'M01',
    name: 'root standalone H.264 with exact-stem Related',
    scopeKind: 'standalone_file',
    primary: 'SDT-M01-Standalone-H264 (2008).mkv',
    expectedProcurement: Object.freeze({ candidateCount: 1, materialInputForm: 'stream_file', displayIdentity: 'SDT-M01-Standalone-H264 (2008)', relatedRoles: ['fanart', 'nfo', 'poster', 'subtitle'] }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'no_rating', expectedPath: 'direct_input', currentReadiness: 'implemented' }),
      Object.freeze({ perception: 'rating_1', expectedPath: 'transcode_to_hevc', currentReadiness: 'contract_only' }),
    ]),
  }),
  Object.freeze({
    id: 'M02',
    name: 'single-movie directory with generic and exact-stem Related',
    scopeKind: 'ordinary_directory',
    primary: 'SDT-M02-Single-Directory (2008)/SDT-M02-Single-Directory (2008).mkv',
    expectedProcurement: Object.freeze({ candidateCount: 1, materialInputForm: 'stream_file', displayIdentity: 'SDT-M02-Single-Directory (2008)', relatedRoles: ['chapter', 'external_audio', 'fanart', 'nfo', 'poster', 'subtitle'] }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'no_rating', expectedPath: 'direct_input', currentReadiness: 'implemented' }),
      Object.freeze({ perception: 'rating_1', expectedPath: 'direct_input', currentReadiness: 'implemented' }),
    ]),
  }),
  Object.freeze({
    id: 'M03',
    name: 'two movies sharing one ordinary directory',
    scopeKind: 'ordinary_directory',
    primary: 'SDT-M03-Multi-Movie-Directory',
    expectedProcurement: Object.freeze({ candidateCount: 2, materialInputForm: 'stream_file', displayIdentity: 'each primary filename stem', genericPosterAssociationCount: 0 }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'rating_1', input: 'M03A H.264', expectedPath: 'transcode_to_hevc', currentReadiness: 'contract_only' }),
      Object.freeze({ perception: 'rating_1', input: 'M03B HEVC MP4', expectedPath: 'direct_input', currentReadiness: 'implemented' }),
    ]),
  }),
  Object.freeze({
    id: 'M04',
    name: '4K HEVC E-AC-3 input for five-star quality assessment',
    scopeKind: 'ordinary_directory',
    primary: 'SDT-M04-4K-Premium (2008)/SDT-M04-4K-Premium (2008).mkv',
    expectedProcurement: Object.freeze({ candidateCount: 1, materialInputForm: 'stream_file', displayIdentity: 'SDT-M04-4K-Premium (2008)' }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'rating_5', expectedPath: 'direct_if_audio_normalizes_to_eac3_atmos_else_external_upgrade', currentReadiness: 'diagnostic' }),
    ]),
  }),
  Object.freeze({
    id: 'M05',
    name: 'low-resolution H.264 input that cannot satisfy five-star 4K by upscale',
    scopeKind: 'ordinary_directory',
    primary: 'SDT-M05-External-Upgrade (2008)/SDT-M05-External-Upgrade (2008).mkv',
    expectedProcurement: Object.freeze({ candidateCount: 1, materialInputForm: 'stream_file', displayIdentity: 'SDT-M05-External-Upgrade (2008)' }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'rating_5', expectedPath: 'external_acquisition', currentReadiness: 'contract_only' }),
    ]),
  }),
  Object.freeze({
    id: 'M06',
    name: 'single-title BDMV with sibling CERTIFICATE and external Related',
    scopeKind: 'bdmv_container',
    primary: 'SDT-M06-BDMV-Single (2008)/BDMV',
    expectedProcurement: Object.freeze({ candidateCount: 1, materialInputForm: 'bdmv', displayIdentity: 'SDT-M06-BDMV-Single (2008)', selectedPlaylist: 'PLAYLIST/00000.mpls', selectedClipIds: ['00000'], relatedRoles: ['fanart', 'nfo', 'poster'] }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'no_rating', expectedPath: 'remux_to_stream_file', currentReadiness: 'contract_only' }),
    ]),
  }),
  Object.freeze({
    id: 'M07',
    name: 'multi-title BDMV with deterministic main-title selection',
    scopeKind: 'bdmv_container',
    primary: 'SDT-M07-BDMV-Multi-Title (2008)/BDMV',
    expectedProcurement: Object.freeze({ candidateCount: 1, materialInputForm: 'bdmv', displayIdentity: 'SDT-M07-BDMV-Multi-Title (2008)', titleCount: 2, selectedPlaylist: 'PLAYLIST/00001.mpls', selectedClipIds: ['00001'] }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'rating_1', expectedPath: 'remux_then_transcode_if_needed', currentReadiness: 'contract_only' }),
    ]),
  }),
  Object.freeze({
    id: 'M08',
    name: 'playable movie without Related NFO',
    scopeKind: 'ordinary_directory',
    primary: 'SDT-M08-Missing-NFO (2008)/SDT-M08-Missing-NFO (2008).mkv',
    expectedProcurement: Object.freeze({ candidateCount: 1, materialInputForm: 'stream_file', displayIdentity: 'SDT-M08-Missing-NFO (2008)' }),
    libraCases: Object.freeze([
      Object.freeze({ perception: 'no_rating', expectedPath: 'provider_metadata_then_sidecar_render', expectedArtifact:'movie.nfo', currentReadiness: 'not_implemented' }),
    ]),
  }),
  Object.freeze({
    id: 'M09',
    name: 'corrupt MKV business failure',
    scopeKind: 'ordinary_directory',
    primary: 'SDT-M09-Corrupt-Media/SDT-M09-Corrupt-Media.mkv',
    expectedProcurement: Object.freeze({ candidateCount: 0, releasedReasonCode: 'probe_not_media' }),
    libraCases: Object.freeze([]),
  }),
  Object.freeze({
    id: 'M10',
    name: 'sidecar-only directory',
    scopeKind: 'ordinary_directory',
    primary: null,
    expectedProcurement: Object.freeze({ candidateCount: 0, reason: 'no primary media input' }),
    libraCases: Object.freeze([]),
  }),
]);

const REAL_SOURCE_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'M11',
    name: 'bounded excerpt from a real Chinese-name Matroska movie',
    scopeKind: 'ordinary_directory',
    primary: 'SDT-M11-Real-Chinese-MKV (2014)/SDT-M11-Real-Chinese-MKV (2014).mkv',
    expectedProcurement: Object.freeze({ candidateCount:1, materialInputForm:'stream_file', displayIdentity:'SDT-M11-Real-Chinese-MKV (2014)', relatedRoles:['fanart', 'nfo', 'poster', 'sidecar'] }),
    libraCases: Object.freeze([
      Object.freeze({ perception:'no_rating', expectedPath:'direct_input', currentReadiness:'implemented' }),
      Object.freeze({ perception:'rating_1', expectedPath:'direct_input', currentReadiness:'implemented',
        note:'The real source filename says x264, but typed ffprobe evidence proves HEVC.' }),
    ]),
  }),
  Object.freeze({
    id: 'M12',
    name: 'bounded main-title excerpt with real BDMV metadata',
    scopeKind: 'bdmv_container',
    primary: 'SDT-M12-Real-BDMV (2025)/BDMV',
    expectedProcurement: Object.freeze({ candidateCount:1, materialInputForm:'bdmv', displayIdentity:'SDT-M12-Real-BDMV (2025)', selectedPlaylist:'PLAYLIST/00001.mpls', selectedClipIds:['00001'], relatedRoles:['fanart', 'nfo', 'poster', 'sidecar'] }),
    libraCases: Object.freeze([
      Object.freeze({ perception:'no_rating', expectedPath:'remux_to_stream_file', currentReadiness:'contract_only' }),
    ]),
  }),
]);

const E2E_SCENARIOS = Object.freeze([
  Object.freeze({
    id:'G01', name:'existing Related replaced by generated Product artifacts', fixtureMode:'static_input',
    primary:'SDT-G01-Related-Replacement (2008)/SDT-G01-Related-Replacement (2008).mkv',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'stream_file', relatedRoles:['nfo', 'poster'] }),
    libraCases:Object.freeze([Object.freeze({ perception:'no_rating', expectedPath:'replace_nonconforming_related', currentReadiness:'contract_only' })]),
    arcaCases:Object.freeze([Object.freeze({ expectedDisposition:'old_related_replaced_and_settled' })]),
  }),
  Object.freeze({
    id:'G02', name:'Input Settlement authorization rejects then approves exact scope', fixtureMode:'multi_phase',
    primary:'SDT-G02-Settlement-Authorization (2008)/SDT-G02-Settlement-Authorization (2008).mkv',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'stream_file', relatedRoles:['nfo', 'poster', 'subtitle'] }),
    libraCases:Object.freeze([Object.freeze({ perception:'rating_1', expectedPath:'transcode_to_hevc_and_replace_related', currentReadiness:'contract_only' })]),
    arcaCases:Object.freeze([Object.freeze({ phases:['deny_without_exclusive_related_scope', 'approve_new_revision', 'settle_exact_scope'] })]),
  }),
  Object.freeze({
    id:'G03', name:'crash recovery during per-member Related settlement', fixtureMode:'fault_injection',
    primary:'SDT-G03-Settlement-Recovery (2008)/SDT-G03-Settlement-Recovery (2008).mkv',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'stream_file', relatedRoles:['fanart', 'nfo', 'poster', 'subtitle'] }),
    libraCases:Object.freeze([Object.freeze({ perception:'rating_1', expectedPath:'transcode_and_replace_nonconforming_related', currentReadiness:'contract_only' })]),
    arcaCases:Object.freeze([Object.freeze({ faultPoint:'after_two_settlement_effect_receipts', expectedRecovery:'forward_recovery_without_duplicate_effect' })]),
  }),
  Object.freeze({
    id:'G04', name:'target collision rejects without overwrite', fixtureMode:'target_precondition',
    primary:'SDT-G04-Collision-Source (2008)/SDT-G04-Collision-Source (2008).mkv',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'stream_file', relatedRoles:['nfo', 'poster'] }),
    libraCases:Object.freeze([Object.freeze({ perception:'no_rating', expectedPath:'direct_input', currentReadiness:'implemented' })]),
    arcaCases:Object.freeze([Object.freeze({ seedAsset:'.shelfdeck-test-library/seeds/G04-collision-target.mkv.seed',
      materializeAfter:'handoff_b_accepted', targetRelativePath:'SDT-G04-Collision (2008)/SDT-G04-Collision (2008).mkv', expectedOutcome:'collision_reject_no_source_settlement' })]),
  }),
  Object.freeze({
    id:'G05', name:'cross-volume copy verify switch and settle', fixtureMode:'environment_recipe',
    primary:'SDT-G05-Cross-Volume (2008)/SDT-G05-Cross-Volume (2008).mkv',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'stream_file', relatedRoles:['nfo', 'poster', 'subtitle'] }),
    libraCases:Object.freeze([Object.freeze({ perception:'no_rating', expectedPath:'direct_input', currentReadiness:'implemented' })]),
    arcaCases:Object.freeze([Object.freeze({ requires:'secondary_local_filesystem_root', expectedPath:'copy_verify_switch_then_settle_source' })]),
  }),
  Object.freeze({
    id:'G06', name:'Related Reality changes after Handoff A', fixtureMode:'mutation_recipe',
    primary:'SDT-G06-Stale-Related (2008)/SDT-G06-Stale-Related (2008).mkv',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'stream_file', relatedRoles:['nfo', 'poster'] }),
    libraCases:Object.freeze([Object.freeze({ mutationAsset:'.shelfdeck-test-library/seeds/G06-poster-mutated.jpg.seed',
      mutationTarget:'SDT-G06-Stale-Related (2008)/poster.jpg', mutateAfter:'handoff_a_offer', expectedOutcome:'stale_defer_rebuild_basis', currentReadiness:'contract_only' })]),
  }),
  Object.freeze({
    id:'G07', name:'same-root Finished Goods excluded by second Observation', fixtureMode:'replay_recipe',
    reuseScenario:'M02',
    expectedProcurement:Object.freeze({ phases:['initial_candidate', 'on_deck_commit', 'second_observation'], finalCandidateDelta:0,
      expectedEligibility:'ineligible/outside_procurement_region' }),
    libraCases:Object.freeze([]),
  }),
  Object.freeze({
    id:'G08', name:'ISO disc input with bounded synthetic BDMV payload', fixtureMode:'static_input',
    primary:'SDT-G08-ISO (2008)/SDT-G08-ISO (2008).iso',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'iso', relatedRoles:['nfo', 'poster'], isoContains:'BDMV' }),
    libraCases:Object.freeze([Object.freeze({ perception:'no_rating', expectedPath:'iso_mount_then_remux', currentReadiness:'not_implemented' })]),
  }),
  Object.freeze({
    id:'G09', name:'DVD VIDEO_TS input with bounded real or synthetic VOB', fixtureMode:'static_input',
    primary:'SDT-G09-DVD (1989)/VIDEO_TS',
    expectedProcurement:Object.freeze({ candidateCount:1, materialInputForm:'dvd', relatedRoles:['nfo', 'poster'], requiredMembers:['VIDEO_TS.IFO', 'VTS_01_0.IFO', 'VTS_01_1.VOB'] }),
    libraCases:Object.freeze([Object.freeze({ perception:'no_rating', expectedPath:'dvd_title_remux', currentReadiness:'not_implemented' })]),
  }),
  Object.freeze({
    id:'G10', name:'Candidate disposition scope exceeds 1024 exclusive Related', fixtureMode:'contract_boundary',
    primary:'SDT-G10-Disposition-Overflow (2008)/SDT-G10-Disposition-Overflow (2008).mkv',
    expectedProcurement:Object.freeze({ candidateCount:0, expectedState:'not_ready', relatedCandidateCount:1025,
      expectedReasonClass:'candidate_disposition_scope_unrepresentable', truncationAllowed:false }),
    libraCases:Object.freeze([]),
  }),
]);

function parseArguments(argv) {
  const options = { root: null, sourceRoot: null, apply: false, verify: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = argv[++index];
    else if (argument === '--source-root') options.sourceRoot = argv[++index];
    else if (argument === '--apply') options.apply = true;
    else if (argument === '--verify') options.verify = true;
    else throw new Error('Unknown argument: ' + argument);
  }
  if (!options.root) throw new Error('--root is required.');
  if (options.apply && options.verify) throw new Error('--apply and --verify are mutually exclusive.');
  return options;
}

function normalizedRoot(root) {
  const resolved = path.resolve(root);
  const parsed = path.parse(resolved);
  if (FORBIDDEN_ROOTS.has(resolved) || resolved === parsed.root) throw new Error('A filesystem root cannot be used as the test library.');
  if (/^z:\\/i.test(resolved) || /^\\\\/.test(resolved)) throw new Error('Remote/NAS paths are forbidden for this local test library.');
  return resolved;
}

function assertInside(root, target) {
  const relative = path.relative(root, path.resolve(target));
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('Managed target escapes or aliases the test root: ' + target);
  }
  return target;
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function runTool(binary, args, label, timeout = 180000) {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(label + ' failed: ' + String(result.error?.message || result.stderr || result.stdout || result.status));
  }
  return result.stdout;
}

function ensureParent(filePath) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); }
function writeText(root, relative, value) {
  const target = assertInside(root, path.join(root, relative));
  ensureParent(target);
  fs.writeFileSync(target, value, 'utf8');
  return target;
}
function writeBytes(root, relative, value) {
  const target = assertInside(root, path.join(root, relative));
  ensureParent(target);
  fs.writeFileSync(target, value);
  return target;
}
function copyFile(root, source, relative) {
  const target = assertInside(root, path.join(root, relative));
  ensureParent(target);
  fs.copyFileSync(source, target);
  return target;
}

function extractSegment(ffmpeg, source, target, container) {
  ensureParent(target);
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0', '-i', source, '-t', '8'];
  if (container === 'm2ts') {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-f', 'mpegts', '-mpegts_m2ts_mode', '1');
  } else if (container === 'vob') {
    args.push('-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-f', 'vob');
  } else {
    args.push('-map', '0', '-map_chapters', '-1', '-c', 'copy');
  }
  args.push(target);
  runTool(ffmpeg, args, 'bounded real-media excerpt ' + path.basename(source), 180000);
}

function nfo(title, year, tmdbId) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<movie>\n  <title>${title}</title>\n  <year>${year}</year>\n  <releasedate>${year}-01-01</releasedate>\n  <plot>Synthetic ShelfDeck vertical test media.</plot>\n  <genre>Animation</genre>\n  <director>ShelfDeck Test Director</director>\n  <actor><name>ShelfDeck Test Actor</name></actor>\n  <tmdbid>${tmdbId}</tmdbid>\n</movie>\n`;
}

function subtitle(title) {
  return `1\n00:00:00,000 --> 00:00:02,000\n${title} - ShelfDeck synthetic subtitle\n`;
}

function writeMpls(root, relative, clips) {
  const value = Buffer.alloc(30 + clips.length * 24);
  value.write('MPLS0200', 0, 'ascii');
  value.writeUInt32BE(20, 8);
  value.writeUInt32BE(value.length - 20, 20);
  value.writeUInt16BE(clips.length, 26);
  let offset = 30;
  for (const clip of clips) {
    value.writeUInt16BE(22, offset);
    value.write(clip.clipId, offset + 2, 'ascii');
    value.write('M2TS', offset + 7, 'ascii');
    value.writeUInt32BE(Number(clip.inTime || 0), offset + 14);
    value.writeUInt32BE(Number(clip.outTime), offset + 18);
    offset += 24;
  }
  return writeBytes(root, relative, value);
}

function writeBothEndian16(buffer, offset, value) {
  buffer.writeUInt16LE(value, offset);
  buffer.writeUInt16BE(value, offset + 2);
}

function writeBothEndian32(buffer, offset, value) {
  buffer.writeUInt32LE(value, offset);
  buffer.writeUInt32BE(value, offset + 4);
}

function isoIdentifier(name, directory = false) {
  const normalized = String(name).normalize('NFKD').replace(/[^A-Za-z0-9_.-]/g, '_').toUpperCase();
  if (!normalized || normalized === '.' || normalized === '..') throw new Error('ISO fixture member has an invalid name: ' + name);
  return directory ? normalized.slice(0, 31) : (normalized.slice(0, 29) + ';1');
}

function isoDirectoryRecord(extent, size, identifier, flags) {
  const id = Buffer.isBuffer(identifier) ? identifier : Buffer.from(identifier, 'ascii');
  const length = 33 + id.length + (id.length % 2 === 0 ? 1 : 0);
  const value = Buffer.alloc(length);
  value[0] = length;
  writeBothEndian32(value, 2, extent);
  writeBothEndian32(value, 10, size);
  value.set(Buffer.from([126, 1, 1, 0, 0, 0, 0]), 18);
  value[25] = flags;
  writeBothEndian16(value, 28, 1);
  value[32] = id.length;
  id.copy(value, 33);
  return value;
}

function createIso9660(sourceRoot, target, volumeName = 'SHELFDECK') {
  const blockSize = 2048;
  const root = { name:'', sourcePath:sourceRoot, parent:null, directories:[], files:[] };
  const directories = [root];
  for (let index = 0; index < directories.length; index += 1) {
    const current = directories[index];
    const entries = fs.readdirSync(current.sourcePath, { withFileTypes:true })
      .sort((left, right) => utf8Compare(left.name, right.name));
    const identifiers = new Set();
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error('ISO fixture cannot contain symbolic links: ' + entry.name);
      const sourcePath = path.join(current.sourcePath, entry.name);
      if (entry.isDirectory()) {
        const identifier = isoIdentifier(entry.name, true);
        if (identifiers.has(identifier)) throw new Error('ISO fixture contains colliding names: ' + entry.name);
        identifiers.add(identifier);
        const child = { name:entry.name, identifier, sourcePath, parent:current, directories:[], files:[] };
        current.directories.push(child);
        directories.push(child);
      } else if (entry.isFile()) {
        const identifier = isoIdentifier(entry.name, false);
        if (identifiers.has(identifier)) throw new Error('ISO fixture contains colliding names: ' + entry.name);
        identifiers.add(identifier);
        current.files.push({ name:entry.name, identifier, sourcePath, size:fs.statSync(sourcePath).size });
      }
    }
  }
  directories.forEach((directory, index) => { directory.number = index + 1; });
  const recordLength = (identifier) => 33 + Buffer.byteLength(identifier, 'ascii') + (Buffer.byteLength(identifier, 'ascii') % 2 === 0 ? 1 : 0);
  for (const directory of directories) {
    let offset = 68;
    for (const member of [...directory.directories, ...directory.files]) {
      const length = recordLength(member.identifier);
      const inBlock = offset % blockSize;
      if (inBlock + length > blockSize) offset += blockSize - inBlock;
      offset += length;
    }
    directory.size = Math.max(blockSize, Math.ceil(offset / blockSize) * blockSize);
  }
  const pathTableSize = directories.reduce((sum, directory) => {
    const idLength = directory === root ? 1 : Buffer.byteLength(directory.identifier, 'ascii');
    return sum + 8 + idLength + (idLength % 2);
  }, 0);
  const pathTableBlocks = Math.ceil(pathTableSize / blockSize);
  const littlePathTableLba = 18;
  const bigPathTableLba = littlePathTableLba + pathTableBlocks;
  let nextLba = bigPathTableLba + pathTableBlocks;
  for (const directory of directories) {
    directory.extent = nextLba;
    nextLba += directory.size / blockSize;
  }
  const files = directories.flatMap((directory) => directory.files);
  for (const file of files) {
    file.extent = nextLba;
    nextLba += Math.max(1, Math.ceil(file.size / blockSize));
  }
  const image = Buffer.alloc(nextLba * blockSize);
  const pvd = image.subarray(16 * blockSize, 17 * blockSize);
  pvd[0] = 1;
  pvd.write('CD001', 1, 'ascii');
  pvd[6] = 1;
  pvd.fill(0x20, 8, 80);
  pvd.write('SHELFDECK', 8, 'ascii');
  pvd.write(String(volumeName).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 32), 40, 'ascii');
  writeBothEndian32(pvd, 80, nextLba);
  writeBothEndian16(pvd, 120, 1);
  writeBothEndian16(pvd, 124, 1);
  writeBothEndian16(pvd, 128, blockSize);
  writeBothEndian32(pvd, 132, pathTableSize);
  pvd.writeUInt32LE(littlePathTableLba, 140);
  pvd.writeUInt32BE(bigPathTableLba, 148);
  isoDirectoryRecord(root.extent, root.size, Buffer.from([0]), 2).copy(pvd, 156);
  pvd.fill(0x20, 190, 813);
  for (const dateOffset of [813, 830, 847]) pvd.write('2026081100000000', dateOffset, 'ascii');
  pvd.write('0000000000000000', 864, 'ascii');
  pvd[881] = 1;
  const terminator = image.subarray(17 * blockSize, 18 * blockSize);
  terminator[0] = 255;
  terminator.write('CD001', 1, 'ascii');
  terminator[6] = 1;

  const writePathTable = (buffer, bigEndian) => {
    let offset = 0;
    for (const directory of directories) {
      const id = directory === root ? Buffer.from([0]) : Buffer.from(directory.identifier, 'ascii');
      buffer[offset] = id.length;
      if (bigEndian) {
        buffer.writeUInt32BE(directory.extent, offset + 2);
        buffer.writeUInt16BE(directory.parent ? directory.parent.number : 1, offset + 6);
      } else {
        buffer.writeUInt32LE(directory.extent, offset + 2);
        buffer.writeUInt16LE(directory.parent ? directory.parent.number : 1, offset + 6);
      }
      id.copy(buffer, offset + 8);
      offset += 8 + id.length + (id.length % 2);
    }
  };
  writePathTable(image.subarray(littlePathTableLba * blockSize, (littlePathTableLba + pathTableBlocks) * blockSize), false);
  writePathTable(image.subarray(bigPathTableLba * blockSize, (bigPathTableLba + pathTableBlocks) * blockSize), true);

  for (const directory of directories) {
    const data = image.subarray(directory.extent * blockSize, directory.extent * blockSize + directory.size);
    let offset = 0;
    const records = [
      isoDirectoryRecord(directory.extent, directory.size, Buffer.from([0]), 2),
      isoDirectoryRecord((directory.parent || directory).extent, (directory.parent || directory).size, Buffer.from([1]), 2),
      ...directory.directories.map((member) => isoDirectoryRecord(member.extent, member.size, member.identifier, 2)),
      ...directory.files.map((member) => isoDirectoryRecord(member.extent, member.size, member.identifier, 0)),
    ];
    for (const record of records) {
      const inBlock = offset % blockSize;
      if (inBlock + record.length > blockSize) offset += blockSize - inBlock;
      record.copy(data, offset);
      offset += record.length;
    }
  }
  for (const file of files) fs.readFileSync(file.sourcePath).copy(image, file.extent * blockSize);
  ensureParent(target);
  fs.writeFileSync(target, image);
  return target;
}

function createVideo(ffmpeg, target, options) {
  ensureParent(target);
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${options.width}x${options.height}:rate=24`,
    '-f', 'lavfi', '-i', `sine=frequency=${options.frequency || 440}:sample_rate=48000`,
    '-t', String(options.duration || 3), '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', options.videoCodec, '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
  if (options.videoCodec === 'libx265') args.push('-x265-params', 'pools=1:frame-threads=1:log-level=error');
  args.push('-c:a', options.audioCodec || 'aac', '-b:a', options.audioBitrate || '128k', '-shortest');
  if (options.container === 'mp4') args.push('-tag:v', 'hvc1', '-movflags', '+faststart');
  if (options.container === 'm2ts') args.push('-f', 'mpegts', '-mpegts_m2ts_mode', '1');
  args.push(target);
  runTool(ffmpeg, args, 'ffmpeg ' + path.basename(target));
}

function createImage(ffmpeg, target, width, height, color) {
  ensureParent(target);
  runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    `color=c=${color}:s=${width}x${height}:d=0.1`, '-frames:v', '1', '-q:v', '3', target], 'image ' + path.basename(target));
}

function createAudio(ffmpeg, target) {
  ensureParent(target);
  runTool(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    'sine=frequency=660:sample_rate=48000', '-t', '1', '-c:a', 'flac', target], 'audio ' + path.basename(target));
}

function createMasters(buildRoot, ffmpeg) {
  const masters = path.join(buildRoot, '.masters');
  fs.mkdirSync(masters, { recursive: true });
  const outputs = {
    h264:path.join(masters, 'h264-720p.mkv'),
    hevc:path.join(masters, 'hevc-720p.mkv'),
    hevcMp4:path.join(masters, 'hevc-720p.mp4'),
    fourK:path.join(masters, 'hevc-4k-eac3.mkv'),
    low:path.join(masters, 'h264-360p.mkv'),
    m2tsA:path.join(masters, 'bdmv-a.m2ts'),
    m2tsB:path.join(masters, 'bdmv-b.m2ts'),
  };
  createVideo(ffmpeg, outputs.h264, { width:1280, height:720, duration:3, videoCodec:'libx264' });
  createVideo(ffmpeg, outputs.hevc, { width:1280, height:720, duration:3, videoCodec:'libx265' });
  createVideo(ffmpeg, outputs.hevcMp4, { width:1280, height:720, duration:3, videoCodec:'libx265', container:'mp4', frequency:550 });
  createVideo(ffmpeg, outputs.fourK, { width:3840, height:1600, duration:1.5, videoCodec:'libx265', audioCodec:'eac3', audioBitrate:'640k', frequency:770 });
  createVideo(ffmpeg, outputs.low, { width:640, height:360, duration:3, videoCodec:'libx264', frequency:330 });
  createVideo(ffmpeg, outputs.m2tsA, { width:1280, height:720, duration:2, videoCodec:'libx264', container:'m2ts', frequency:400 });
  createVideo(ffmpeg, outputs.m2tsB, { width:1280, height:720, duration:4, videoCodec:'libx264', container:'m2ts', frequency:800 });
  return outputs;
}

function addArtwork(buildRoot, ffmpeg, prefix, generic = false) {
  const stem = generic ? '' : path.basename(prefix);
  const parent = generic ? prefix : path.dirname(prefix);
  const poster = generic ? path.join(parent, 'poster.jpg') : path.join(parent, stem + '-poster.jpg');
  const fanart = generic ? path.join(parent, 'fanart.jpg') : path.join(parent, stem + '-fanart.jpg');
  createImage(ffmpeg, poster, 600, 900, '0x30475e');
  createImage(ffmpeg, fanart, 1280, 720, '0x355c4a');
  return { poster, fanart };
}

function addRealSourceLibrary(buildRoot, ffmpeg, sourceRoot) {
  const movieRoot = path.join(sourceRoot, '0.5毫米 (2014)');
  const sourceMovie = path.join(movieRoot, '0.5毫米 (2014) - 1080p x264 AAC.mkv');
  const bdmvMovieRoot = path.join(sourceRoot, '爆弹 (2025)');
  const bdmvRoot = path.join(bdmvMovieRoot, 'BDMV');
  for (const required of [sourceMovie, path.join(movieRoot, '0.5毫米 (2014) - 1080p x264 AAC.nfo'),
    path.join(bdmvRoot, 'STREAM', '00001.m2ts'), path.join(bdmvRoot, 'PLAYLIST', '00001.mpls'),
    path.join(bdmvRoot, 'CLIPINF', '00001.clpi'), path.join(bdmvRoot, 'index.bdmv'), path.join(bdmvRoot, 'MovieObject.bdmv')]) {
    if (!fs.existsSync(required)) throw new Error('Authorized real-source fixture is unavailable: ' + required);
  }
  const m11Directory = 'SDT-M11-Real-Chinese-MKV (2014)';
  const m11Stem = path.join(m11Directory, m11Directory);
  extractSegment(ffmpeg, sourceMovie, path.join(buildRoot, m11Stem + '.mkv'), 'mkv');
  copyFile(buildRoot, path.join(movieRoot, '0.5毫米 (2014) - 1080p x264 AAC.nfo'), path.join(m11Directory, 'movie.nfo'));
  copyFile(buildRoot, path.join(movieRoot, 'poster.jpg'), path.join(m11Directory, 'poster.jpg'));
  copyFile(buildRoot, path.join(movieRoot, 'fanart.jpg'), path.join(m11Directory, 'fanart.jpg'));
  copyFile(buildRoot, path.join(movieRoot, 'landscape.jpg'), m11Stem + '-landscape.jpg');

  const m12Directory = 'SDT-M12-Real-BDMV (2025)';
  extractSegment(ffmpeg, path.join(bdmvRoot, 'STREAM', '00001.m2ts'),
    path.join(buildRoot, m12Directory, 'BDMV', 'STREAM', '00001.m2ts'), 'm2ts');
  for (const relative of ['PLAYLIST/00001.mpls', 'CLIPINF/00001.clpi', 'index.bdmv', 'MovieObject.bdmv']) {
    copyFile(buildRoot, path.join(bdmvRoot, ...relative.split('/')), path.join(m12Directory, 'BDMV', relative));
  }
  const certificate = path.join(bdmvMovieRoot, 'CERTIFICATE', 'id.bdmv');
  if (fs.existsSync(certificate)) copyFile(buildRoot, certificate, path.join(m12Directory, 'CERTIFICATE', 'id.bdmv'));
  copyFile(buildRoot, path.join(bdmvMovieRoot, '爆弹 (2025).nfo'), path.join(m12Directory, 'movie.nfo'));
  copyFile(buildRoot, path.join(bdmvMovieRoot, 'poster.jpg'), path.join(m12Directory, 'poster.jpg'));
  copyFile(buildRoot, path.join(bdmvMovieRoot, 'backdrop.jpg'), path.join(m12Directory, 'fanart.jpg'));
  copyFile(buildRoot, path.join(bdmvMovieRoot, 'logo.png'), path.join(m12Directory, m12Directory + '-logo.png'));

  const dvdMovieRoot = path.join(sourceRoot, '顽主 (1989)');
  const dvdRoot = path.join(dvdMovieRoot, 'VIDEO_TS');
  for (const required of ['VIDEO_TS.IFO', 'VIDEO_TS.BUP', 'VTS_01_0.IFO', 'VTS_01_0.BUP', 'VTS_01_1.VOB']) {
    const source = path.join(dvdRoot, required);
    if (!fs.existsSync(source)) throw new Error('Authorized real DVD fixture is unavailable: ' + source);
  }
  const g09Directory = 'SDT-G09-DVD (1989)';
  for (const relative of ['VIDEO_TS.IFO', 'VIDEO_TS.BUP', 'VTS_01_0.IFO', 'VTS_01_0.BUP']) {
    copyFile(buildRoot, path.join(dvdRoot, relative), path.join(g09Directory, 'VIDEO_TS', relative));
  }
  extractSegment(ffmpeg, path.join(dvdRoot, 'VTS_01_1.VOB'),
    path.join(buildRoot, g09Directory, 'VIDEO_TS', 'VTS_01_1.VOB'), 'vob');
  copyFile(buildRoot, path.join(dvdMovieRoot, '顽主 (1989).nfo'), path.join(g09Directory, 'movie.nfo'));
  copyFile(buildRoot, path.join(dvdMovieRoot, 'poster.jpg'), path.join(g09Directory, 'poster.jpg'));
}

function buildLibrary(buildRoot, ffmpeg, sourceRoot = null) {
  const masters = createMasters(buildRoot, ffmpeg);

  const rootStem = 'SDT-M01-Standalone-H264 (2008)';
  copyFile(buildRoot, masters.h264, rootStem + '.mkv');
  writeText(buildRoot, rootStem + '.nfo', nfo('Big Buck Bunny', 2008, '10378'));
  writeText(buildRoot, rootStem + '.zh-CN.srt', subtitle(rootStem));
  createImage(ffmpeg, path.join(buildRoot, rootStem + '-poster.jpg'), 600, 900, '0x425d75');
  createImage(ffmpeg, path.join(buildRoot, rootStem + '-fanart.jpg'), 1280, 720, '0x496b55');

  const m02Directory = 'SDT-M02-Single-Directory (2008)';
  const m02Stem = path.join(m02Directory, m02Directory);
  copyFile(buildRoot, masters.hevc, m02Stem + '.mkv');
  writeText(buildRoot, path.join(m02Directory, 'movie.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  writeText(buildRoot, m02Stem + '.zh-CN.srt', subtitle(m02Directory));
  writeText(buildRoot, m02Stem + '.chapters', 'CHAPTER01=00:00:00.000\nCHAPTER01NAME=Start\n');
  createAudio(ffmpeg, path.join(buildRoot, m02Stem + '.flac'));
  addArtwork(buildRoot, ffmpeg, path.join(buildRoot, m02Directory), true);

  const m03Directory = 'SDT-M03-Multi-Movie-Directory';
  const m03A = 'SDT-M03A-H264-Needs-Transcode (2008)';
  const m03B = 'SDT-M03B-HEVC-MP4-Direct (2008)';
  copyFile(buildRoot, masters.h264, path.join(m03Directory, m03A + '.mkv'));
  copyFile(buildRoot, masters.hevcMp4, path.join(m03Directory, m03B + '.mp4'));
  writeText(buildRoot, path.join(m03Directory, m03A + '.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  writeText(buildRoot, path.join(m03Directory, m03B + '.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  writeText(buildRoot, path.join(m03Directory, m03A + '.zh-CN.srt'), subtitle(m03A));
  createImage(ffmpeg, path.join(buildRoot, m03Directory, m03A + '-poster.jpg'), 600, 900, '0x754242');
  createImage(ffmpeg, path.join(buildRoot, m03Directory, m03B + '-fanart.jpg'), 1280, 720, '0x5d4275');
  createImage(ffmpeg, path.join(buildRoot, m03Directory, 'poster.jpg'), 600, 900, '0x756c42');

  const m04Directory = 'SDT-M04-4K-Premium (2008)';
  copyFile(buildRoot, masters.fourK, path.join(m04Directory, m04Directory + '.mkv'));
  writeText(buildRoot, path.join(m04Directory, 'movie.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  addArtwork(buildRoot, ffmpeg, path.join(buildRoot, m04Directory), true);

  const m05Directory = 'SDT-M05-External-Upgrade (2008)';
  copyFile(buildRoot, masters.low, path.join(m05Directory, m05Directory + '.mkv'));
  writeText(buildRoot, path.join(m05Directory, 'movie.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  addArtwork(buildRoot, ffmpeg, path.join(buildRoot, m05Directory), true);

  const m06Directory = 'SDT-M06-BDMV-Single (2008)';
  copyFile(buildRoot, masters.m2tsA, path.join(m06Directory, 'BDMV', 'STREAM', '00000.m2ts'));
  writeMpls(buildRoot, path.join(m06Directory, 'BDMV', 'PLAYLIST', '00000.mpls'), [{ clipId:'00000', outTime:90000 }]);
  for (const relative of ['BDMV/CLIPINF/00000.clpi', 'BDMV/index.bdmv', 'BDMV/MovieObject.bdmv', 'CERTIFICATE/id.bdmv',
    'BDMV/BACKUP/CLIPINF/00000.clpi', 'BDMV/BACKUP/PLAYLIST/00000.mpls']) writeBytes(buildRoot, path.join(m06Directory, relative), Buffer.from('SDT-BDMV-METADATA'));
  writeText(buildRoot, path.join(m06Directory, 'movie.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  addArtwork(buildRoot, ffmpeg, path.join(buildRoot, m06Directory), true);

  const m07Directory = 'SDT-M07-BDMV-Multi-Title (2008)';
  copyFile(buildRoot, masters.m2tsA, path.join(m07Directory, 'BDMV', 'STREAM', '00000.m2ts'));
  copyFile(buildRoot, masters.m2tsB, path.join(m07Directory, 'BDMV', 'STREAM', '00001.m2ts'));
  writeMpls(buildRoot, path.join(m07Directory, 'BDMV', 'PLAYLIST', '00000.mpls'), [{ clipId:'00000', outTime:90000 }]);
  writeMpls(buildRoot, path.join(m07Directory, 'BDMV', 'PLAYLIST', '00001.mpls'), [{ clipId:'00001', outTime:180000 }]);
  for (const relative of ['BDMV/CLIPINF/00000.clpi', 'BDMV/CLIPINF/00001.clpi', 'BDMV/index.bdmv', 'BDMV/MovieObject.bdmv', 'CERTIFICATE/id.bdmv']) writeBytes(buildRoot, path.join(m07Directory, relative), Buffer.from('SDT-BDMV-METADATA'));
  writeText(buildRoot, path.join(m07Directory, 'movie.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  addArtwork(buildRoot, ffmpeg, path.join(buildRoot, m07Directory), true);

  const m08Directory = 'SDT-M08-Missing-NFO (2008)';
  copyFile(buildRoot, masters.h264, path.join(m08Directory, m08Directory + '.mkv'));
  createImage(ffmpeg, path.join(buildRoot, m08Directory, 'poster.jpg'), 600, 900, '0x705050');

  writeBytes(buildRoot, path.join('SDT-M09-Corrupt-Media', 'SDT-M09-Corrupt-Media.mkv'), Buffer.from('not a Matroska file\n', 'utf8'));
  writeText(buildRoot, path.join('SDT-M09-Corrupt-Media', 'movie.nfo'), nfo('Big Buck Bunny', 2008, '10378'));

  writeText(buildRoot, path.join('SDT-M10-Sidecar-Only', 'movie.nfo'), nfo('Big Buck Bunny', 2008, '10378'));
  createImage(ffmpeg, path.join(buildRoot, 'SDT-M10-Sidecar-Only', 'poster.jpg'), 600, 900, '0x505070');

  const g01Directory = 'SDT-G01-Related-Replacement (2008)';
  copyFile(buildRoot, masters.hevc, path.join(g01Directory, g01Directory + '.mkv'));
  writeText(buildRoot, path.join(g01Directory, 'movie.nfo'), nfo('Obsolete Related Metadata', 1900, '0'));
  createImage(ffmpeg, path.join(buildRoot, g01Directory, 'poster.jpg'), 120, 180, '0x201010');

  const g02Directory = 'SDT-G02-Settlement-Authorization (2008)';
  copyFile(buildRoot, masters.h264, path.join(g02Directory, g02Directory + '.mkv'));
  writeText(buildRoot, path.join(g02Directory, 'movie.nfo'), nfo('Obsolete Settlement Metadata', 1900, '0'));
  writeText(buildRoot, path.join(g02Directory, g02Directory + '.zh-CN.srt'), subtitle(g02Directory));
  createImage(ffmpeg, path.join(buildRoot, g02Directory, 'poster.jpg'), 120, 180, '0x301010');

  const g03Directory = 'SDT-G03-Settlement-Recovery (2008)';
  copyFile(buildRoot, masters.h264, path.join(g03Directory, g03Directory + '.mkv'));
  writeText(buildRoot, path.join(g03Directory, 'movie.nfo'), nfo('Obsolete Recovery Metadata', 1900, '0'));
  writeText(buildRoot, path.join(g03Directory, g03Directory + '.zh-CN.srt'), subtitle(g03Directory + ' Chinese'));
  writeText(buildRoot, path.join(g03Directory, g03Directory + '.en.srt'), subtitle(g03Directory + ' English'));
  createImage(ffmpeg, path.join(buildRoot, g03Directory, 'poster.jpg'), 120, 180, '0x401010');
  createImage(ffmpeg, path.join(buildRoot, g03Directory, 'fanart.jpg'), 320, 180, '0x104010');

  const g04Directory = 'SDT-G04-Collision-Source (2008)';
  copyFile(buildRoot, masters.hevc, path.join(g04Directory, g04Directory + '.mkv'));
  writeText(buildRoot, path.join(g04Directory, 'movie.nfo'), nfo('SDT-G04-Collision', 2008, '40004'));
  createImage(ffmpeg, path.join(buildRoot, g04Directory, 'poster.jpg'), 600, 900, '0x403010');
  copyFile(buildRoot, masters.h264, path.join(CONTROL_DIRECTORY, 'seeds', 'G04-collision-target.mkv.seed'));

  const g05Directory = 'SDT-G05-Cross-Volume (2008)';
  copyFile(buildRoot, masters.hevc, path.join(g05Directory, g05Directory + '.mkv'));
  writeText(buildRoot, path.join(g05Directory, 'movie.nfo'), nfo('SDT-G05-Cross-Volume', 2008, '40005'));
  writeText(buildRoot, path.join(g05Directory, g05Directory + '.zh-CN.srt'), subtitle(g05Directory));
  createImage(ffmpeg, path.join(buildRoot, g05Directory, 'poster.jpg'), 600, 900, '0x404010');

  const g06Directory = 'SDT-G06-Stale-Related (2008)';
  copyFile(buildRoot, masters.hevc, path.join(g06Directory, g06Directory + '.mkv'));
  writeText(buildRoot, path.join(g06Directory, 'movie.nfo'), nfo('SDT-G06-Stale-Related', 2008, '40006'));
  createImage(ffmpeg, path.join(buildRoot, g06Directory, 'poster.jpg'), 600, 900, '0x405010');
  const g06MutationImage = path.join(buildRoot, '.masters', 'G06-poster-mutated.jpg');
  createImage(ffmpeg, g06MutationImage, 600, 900, '0x701020');
  copyFile(buildRoot, g06MutationImage, path.join(CONTROL_DIRECTORY, 'seeds', 'G06-poster-mutated.jpg.seed'));

  const g08Directory = 'SDT-G08-ISO (2008)';
  const g08IsoRoot = path.join(buildRoot, '.masters', 'g08-iso-root');
  copyFile(buildRoot, masters.m2tsA, path.join('.masters', 'g08-iso-root', 'BDMV', 'STREAM', '00000.m2ts'));
  writeMpls(buildRoot, path.join('.masters', 'g08-iso-root', 'BDMV', 'PLAYLIST', '00000.mpls'), [{ clipId:'00000', outTime:90000 }]);
  for (const relative of ['BDMV/CLIPINF/00000.clpi', 'BDMV/index.bdmv', 'BDMV/MovieObject.bdmv', 'CERTIFICATE/id.bdmv']) {
    writeBytes(buildRoot, path.join('.masters', 'g08-iso-root', relative), Buffer.from('SDT-ISO-BDMV-METADATA'));
  }
  createIso9660(g08IsoRoot, path.join(buildRoot, g08Directory, g08Directory + '.iso'), 'SDT_G08_ISO');
  writeText(buildRoot, path.join(g08Directory, 'movie.nfo'), nfo('SDT-G08-ISO', 2008, '40008'));
  createImage(ffmpeg, path.join(buildRoot, g08Directory, 'poster.jpg'), 600, 900, '0x406010');

  const g09Directory = 'SDT-G09-DVD (1989)';
  copyFile(buildRoot, masters.m2tsA, path.join(g09Directory, 'VIDEO_TS', 'VTS_01_1.VOB'));
  for (const relative of ['VIDEO_TS.IFO', 'VIDEO_TS.BUP', 'VTS_01_0.IFO', 'VTS_01_0.BUP']) {
    writeBytes(buildRoot, path.join(g09Directory, 'VIDEO_TS', relative), Buffer.from('SDT-DVD-STRUCTURE'));
  }
  writeText(buildRoot, path.join(g09Directory, 'movie.nfo'), nfo('SDT-G09-DVD', 1989, '40009'));
  createImage(ffmpeg, path.join(buildRoot, g09Directory, 'poster.jpg'), 600, 900, '0x407010');

  const g10Directory = 'SDT-G10-Disposition-Overflow (2008)';
  const g10Stem = path.join(g10Directory, g10Directory);
  copyFile(buildRoot, masters.hevc, g10Stem + '.mkv');
  writeText(buildRoot, path.join(g10Directory, 'movie.nfo'), nfo('SDT-G10-Disposition-Overflow', 2008, '40010'));
  for (let index = 0; index < 1024; index += 1) {
    const ordinal = String(index + 1).padStart(4, '0');
    writeText(buildRoot, g10Stem + '.' + ordinal + '.srt', subtitle(g10Directory + ' ' + ordinal));
  }

  if (sourceRoot) addRealSourceLibrary(buildRoot, ffmpeg, sourceRoot);

  fs.rmSync(path.join(buildRoot, '.masters'), { recursive: true, force: true });
}

function listRegularFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes:true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Test library cannot contain symbolic links: ' + absolute);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort((left, right) => utf8Compare(path.relative(root, left), path.relative(root, right)));
}

function probeFile(ffprobe, filePath) {
  const result = spawnSync(ffprobe, ['-v', 'error', '-of', 'json=compact=1', '-show_entries',
    'format=format_name,duration,size:stream=index,codec_type,codec_name,profile,width,height,channels,channel_layout', filePath],
  { encoding:'utf8', windowsHide:true, timeout:60000, maxBuffer:1024 * 1024 });
  if (result.status !== 0) return Object.freeze({ resultKind:'not_media', exitCode:result.status, stderr:String(result.stderr || '').slice(0, 512) });
  const parsed = JSON.parse(result.stdout);
  return Object.freeze({ resultKind:'probed', format:parsed.format || {}, streams:parsed.streams || [] });
}

function verificationFor(root, ffprobe, owned = ownedTopLevel(false)) {
  const mediaExtensions = new Set(['.mkv', '.mp4', '.m2ts']);
  const ownedNames = new Set(owned.filter((item) => item !== CONTROL_DIRECTORY));
  const files = listRegularFiles(root).filter((filePath) => {
    const relative = path.relative(root, filePath);
    const top = relative.split(path.sep)[0];
    return ownedNames.has(top);
  });
  const entries = files.map((filePath) => {
    const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
    const stat = fs.statSync(filePath);
    const base = { relativePath, sizeBytes:Number(stat.size), sha256:sha256File(filePath) };
    return mediaExtensions.has(path.extname(filePath).toLowerCase()) ? { ...base, probe:probeFile(ffprobe, filePath) } : base;
  });
  const realityItems = entries.map(({ relativePath, sizeBytes, sha256 }) => ({ relativePath, sizeBytes, sha256 }));
  return Object.freeze({ regularFileCount:entries.length, totalBytes:entries.reduce((sum, item) => sum + item.sizeBytes, 0),
    realityDigest:sha256Bytes(Buffer.from(JSON.stringify(realityItems))), entries:Object.freeze(entries) });
}

function ownedTopLevel(includeReal = false) {
  const values = [
    CONTROL_DIRECTORY,
    'SDT-M01-Standalone-H264 (2008).mkv',
    'SDT-M01-Standalone-H264 (2008).nfo',
    'SDT-M01-Standalone-H264 (2008).zh-CN.srt',
    'SDT-M01-Standalone-H264 (2008)-poster.jpg',
    'SDT-M01-Standalone-H264 (2008)-fanart.jpg',
    'SDT-M02-Single-Directory (2008)',
    'SDT-M03-Multi-Movie-Directory',
    'SDT-M04-4K-Premium (2008)',
    'SDT-M05-External-Upgrade (2008)',
    'SDT-M06-BDMV-Single (2008)',
    'SDT-M07-BDMV-Multi-Title (2008)',
    'SDT-M08-Missing-NFO (2008)',
    'SDT-M09-Corrupt-Media',
    'SDT-M10-Sidecar-Only',
    'SDT-G01-Related-Replacement (2008)',
    'SDT-G02-Settlement-Authorization (2008)',
    'SDT-G03-Settlement-Recovery (2008)',
    'SDT-G04-Collision-Source (2008)',
    'SDT-G05-Cross-Volume (2008)',
    'SDT-G06-Stale-Related (2008)',
    'SDT-G08-ISO (2008)',
    'SDT-G09-DVD (1989)',
    'SDT-G10-Disposition-Overflow (2008)',
  ];
  if (includeReal) values.push('SDT-M11-Real-Chinese-MKV (2014)', 'SDT-M12-Real-BDMV (2025)');
  return Object.freeze(values);
}

function readOwnership(root) {
  const filePath = path.join(root, CONTROL_DIRECTORY, 'ownership.json');
  if (!fs.existsSync(filePath)) return null;
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (value.schema !== OWNERSHIP_SCHEMA || value.libraryId !== LIBRARY_ID || !Array.isArray(value.ownedTopLevel)) {
    throw new Error('Existing test library ownership marker is not recognized.');
  }
  return value;
}

function removePreviousOwned(root, expectedOwned) {
  const marker = readOwnership(root);
  if (!marker) {
    const collisions = expectedOwned.filter((relative) => fs.existsSync(path.join(root, relative)));
    if (collisions.length) throw new Error('Refusing to replace unowned paths: ' + collisions.join(', '));
    return;
  }
  for (const relative of marker.ownedTopLevel) {
    const target = assertInside(root, path.join(root, relative));
    if (fs.existsSync(target)) fs.rmSync(target, { recursive:true, force:true });
  }
}

function writeControlFiles(buildRoot, finalRoot, verification, includeReal) {
  const control = path.join(buildRoot, CONTROL_DIRECTORY);
  fs.mkdirSync(control, { recursive:true });
  const controlAssets = CONTROL_ASSETS.map((relativePath) => {
    const absolute = path.join(control, ...relativePath.split('/'));
    if (!fs.existsSync(absolute)) throw new Error('Required control seed is missing: ' + relativePath);
    const stat = fs.statSync(absolute);
    return { relativePath, sizeBytes:Number(stat.size), sha256:sha256File(absolute) };
  });
  const ownership = { schema:OWNERSHIP_SCHEMA, libraryId:LIBRARY_ID, root:finalRoot, ownedTopLevel:ownedTopLevel(includeReal) };
  fs.writeFileSync(path.join(control, 'ownership.json'), JSON.stringify(ownership, null, 2) + '\n');
  const manifest = {
    schema:MANIFEST_SCHEMA,
    libraryId:LIBRARY_ID,
    purpose:'Deterministic Movie vertical test library for Procurement, Libra and Arca disposition E2E',
    root:finalRoot,
    safety:{ sourceSystem:includeReal ? 'local_synthetic_and_bounded_authorized_source_excerpts' : 'locally_generated_only',
      nasPathsForbidden:true, intendedMaterialFieldRoot:finalRoot,
      intendedMovieShelfTargetRoot:finalRoot, sourceMutationAllowedOnlyByThisBuilder:true },
    currentProductBoundary:{ procurement:'expected to close all listed Procurement outcomes',
      libraDirectInput:'implemented', libraRemuxTranscodeExternalAcquisition:'contracts exist; Movie orchestration not yet closed',
      arcaDisposition:'fixtures and phase recipes materialized; product execution not yet closed',
      isoDvd:'fixtures materialized; typed topology and production paths are not yet implemented' },
    scenarios:includeReal
      ? Object.freeze([...SCENARIOS, ...REAL_SOURCE_SCENARIOS, ...E2E_SCENARIOS])
      : Object.freeze([...SCENARIOS, ...E2E_SCENARIOS]),
    controlAssets,
    verification,
  };
  fs.writeFileSync(path.join(control, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(control, 'README.txt'), [
    'ShelfDeck Helix Movie vertical test library',
    '',
    'This directory is generated. See manifest.json for exact Procurement and Libra expectations.',
    'G01-G10 add Arca disposition, authorization, recovery, collision, mutation, replay, ISO/DVD and contract-limit coverage.',
    'Target/mutation seed files live below this control directory and must be materialized only at the phase named in manifest.json.',
    'Rebuild the library before every destructive or fault-injection case; do not run destructive cases concurrently.',
    'Rebuild only with media-service/scripts/build-helix-movie-test-library.js.',
    'The builder owns only paths listed in ownership.json and preserves every other path.',
    'Never substitute Z:\\Film or another production/NAS path.',
    '',
  ].join('\n'));
}

function verifyExisting(root, ffprobe) {
  const ownership = readOwnership(root);
  if (!ownership) throw new Error('No recognized test library exists at the requested root.');
  const manifestPath = path.join(root, CONTROL_DIRECTORY, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const current = verificationFor(root, ffprobe, ownership.ownedTopLevel);
  const expected = manifest.verification;
  if (current.regularFileCount !== expected.regularFileCount || current.totalBytes !== expected.totalBytes || current.realityDigest !== expected.realityDigest) {
    throw new Error('Test library reality differs from its manifest.');
  }
  for (const expectedAsset of manifest.controlAssets || []) {
    const absolute = path.join(root, CONTROL_DIRECTORY, ...expectedAsset.relativePath.split('/'));
    if (!fs.existsSync(absolute)) throw new Error('Test control asset is missing: ' + expectedAsset.relativePath);
    const stat = fs.statSync(absolute);
    if (Number(stat.size) !== Number(expectedAsset.sizeBytes) || sha256File(absolute) !== expectedAsset.sha256) {
      throw new Error('Test control asset differs from its manifest: ' + expectedAsset.relativePath);
    }
  }
  return { root, verification:current, scenarios:manifest.scenarios.length };
}

function applyBuild(root, ffmpeg, ffprobe, sourceRoot = null) {
  fs.mkdirSync(root, { recursive:true });
  const stat = fs.statSync(root);
  if (!stat.isDirectory()) throw new Error('Test root must be an existing directory.');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-movie-library-build-'));
  try {
    const resolvedSourceRoot = sourceRoot ? path.resolve(sourceRoot) : null;
    if (resolvedSourceRoot && !fs.statSync(resolvedSourceRoot).isDirectory()) throw new Error('Source root must be a directory.');
    buildLibrary(temporaryRoot, ffmpeg, resolvedSourceRoot);
    const expectedOwned = ownedTopLevel(Boolean(resolvedSourceRoot));
    const verification = verificationFor(temporaryRoot, ffprobe, expectedOwned);
    const corrupt = verification.entries.find((item) => item.relativePath.endsWith('SDT-M09-Corrupt-Media.mkv'));
    const unexpectedFailures = verification.entries.filter((item) => item.probe && item.probe.resultKind !== 'probed' && item !== corrupt);
    if (!corrupt || corrupt.probe?.resultKind !== 'not_media' || unexpectedFailures.length) {
      throw new Error('Generated media verification did not match the scenario contract.');
    }
    writeControlFiles(temporaryRoot, root, verification, Boolean(resolvedSourceRoot));
    removePreviousOwned(root, expectedOwned);
    for (const relative of expectedOwned) {
      const source = assertInside(temporaryRoot, path.join(temporaryRoot, relative));
      const target = assertInside(root, path.join(root, relative));
      fs.renameSync(source, target);
    }
    return verifyExisting(root, ffprobe);
  } finally {
    if (fs.existsSync(temporaryRoot)) fs.rmSync(temporaryRoot, { recursive:true, force:true });
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const root = normalizedRoot(options.root);
  const ffmpeg = require('ffmpeg-static');
  const ffprobe = require('@ffprobe-installer/ffprobe').path;
  if (options.verify) {
    console.log(JSON.stringify({ action:'verified', ...verifyExisting(root, ffprobe) }, null, 2));
    return;
  }
  if (!options.apply) {
    const includeReal = Boolean(options.sourceRoot);
    console.log(JSON.stringify({ action:'dry_run', root, sourceRoot:options.sourceRoot ? path.resolve(options.sourceRoot) : null,
      libraryId:LIBRARY_ID, scenarios:includeReal
        ? [...SCENARIOS, ...REAL_SOURCE_SCENARIOS, ...E2E_SCENARIOS]
        : [...SCENARIOS, ...E2E_SCENARIOS],
      ownedTopLevel:ownedTopLevel(includeReal), note:'Pass --apply to generate locally controlled media.' }, null, 2));
    return;
  }
  console.log(JSON.stringify({ action:'built', ...applyBuild(root, ffmpeg, ffprobe, options.sourceRoot) }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = Object.freeze({ LIBRARY_ID, MANIFEST_SCHEMA, SCENARIOS, REAL_SOURCE_SCENARIOS, E2E_SCENARIOS,
  normalizedRoot, assertInside, writeMpls, createIso9660, ownedTopLevel, main });
