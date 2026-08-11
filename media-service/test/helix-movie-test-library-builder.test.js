'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  SCENARIOS,
  REAL_SOURCE_SCENARIOS,
  E2E_SCENARIOS,
  normalizedRoot,
  assertInside,
  writeMpls,
  createIso9660,
  ownedTopLevel,
} = require('../scripts/build-helix-movie-test-library');
const { preparePhase } = require('../scripts/prepare-helix-movie-test-phase');

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
const { createBdmvTopologyReader } = require('../src/helix/integrations/bdmv-topology');

test('movie test-library builder rejects remote and broad output roots', () => {
  assert.throws(() => normalizedRoot('Z:\\Film'), /Remote\/NAS paths are forbidden/);
  assert.throws(() => normalizedRoot(path.parse(process.cwd()).root), /filesystem root/);
  const root = path.join(os.tmpdir(), 'shelfdeck-builder-boundary');
  assert.equal(assertInside(root, path.join(root, 'owned')), path.join(root, 'owned'));
  assert.throws(() => assertInside(root, root), /escapes or aliases/);
  assert.throws(() => assertInside(root, path.join(root, '..', 'outside')), /escapes or aliases/);
});

test('scenario matrix covers Procurement structure and Libra production decisions', () => {
  const all = [...SCENARIOS, ...REAL_SOURCE_SCENARIOS, ...E2E_SCENARIOS];
  assert.deepEqual(all.map((item) => item.id), ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12',
    'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08', 'G09', 'G10']);
  assert.ok(all.some((item) => item.scopeKind === 'standalone_file'));
  assert.ok(all.some((item) => item.scopeKind === 'ordinary_directory' && item.expectedProcurement.candidateCount === 2));
  assert.equal(all.filter((item) => item.scopeKind === 'bdmv_container').length, 3);
  const paths = new Set(all.flatMap((item) => item.libraCases.map((entry) => entry.expectedPath)));
  for (const expected of ['direct_input', 'transcode_to_hevc', 'external_acquisition', 'remux_to_stream_file', 'provider_metadata_then_sidecar_render']) {
    assert.equal(paths.has(expected), true, expected);
  }
  assert.equal(ownedTopLevel(true).includes('SDT-M12-Real-BDMV (2025)'), true);
  assert.equal(ownedTopLevel(false).includes('SDT-M12-Real-BDMV (2025)'), false);
  assert.equal(E2E_SCENARIOS.length, 10);
  assert.equal(E2E_SCENARIOS.find((item) => item.id === 'G10').expectedProcurement.relatedCandidateCount, 1025);
  assert.equal(ownedTopLevel(false).includes('SDT-G10-Disposition-Overflow (2008)'), true);
});

test('generated MPLS proves deterministic single-title topology', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-builder-mpls-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const bdmv = path.join(root, 'Movie', 'BDMV');
  fs.mkdirSync(path.join(bdmv, 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(bdmv, 'CLIPINF'), { recursive:true });
  fs.writeFileSync(path.join(bdmv, 'STREAM', '00000.m2ts'), Buffer.from('payload'));
  fs.writeFileSync(path.join(bdmv, 'CLIPINF', '00000.clpi'), Buffer.from('clip'));
  fs.writeFileSync(path.join(bdmv, 'index.bdmv'), Buffer.from('index'));
  fs.writeFileSync(path.join(bdmv, 'MovieObject.bdmv'), Buffer.from('object'));
  writeMpls(root, 'Movie/BDMV/PLAYLIST/00000.mpls', [{ clipId:'00000', outTime:90000 }]);
  const topology = await createBdmvTopologyReader().inspect(bdmv);
  assert.equal(topology.titleCount, 1);
  assert.equal(topology.selectedPlaylist.relativeLocation, 'PLAYLIST/00000.mpls');
  assert.deepEqual(topology.selectedPlaylist.clipIds, ['00000']);
});

test('generated ISO fixture is a readable ISO9660 image containing bounded BDMV members', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-builder-iso-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'BDMV', 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(source, 'BDMV', 'PLAYLIST'), { recursive:true });
  fs.writeFileSync(path.join(source, 'BDMV', 'STREAM', '00000.m2ts'), Buffer.from('bounded-payload'));
  fs.writeFileSync(path.join(source, 'BDMV', 'PLAYLIST', '00000.mpls'), Buffer.from('playlist'));
  const target = path.join(root, 'movie.iso');
  createIso9660(source, target, 'SDT_TEST');
  const image = fs.readFileSync(target);
  assert.equal(image.subarray(16 * 2048 + 1, 16 * 2048 + 6).toString('ascii'), 'CD001');
  const rootRecordOffset = 16 * 2048 + 156;
  const listed = [];
  const visit = (extent, size, prefix = '') => {
    let offset = extent * 2048;
    const end = offset + size;
    while (offset < end) {
      const length = image[offset];
      if (length === 0) {
        offset = (Math.floor(offset / 2048) + 1) * 2048;
        continue;
      }
      const flags = image[offset + 25];
      const idLength = image[offset + 32];
      const id = image.subarray(offset + 33, offset + 33 + idLength);
      if (!(idLength === 1 && (id[0] === 0 || id[0] === 1))) {
        const name = id.toString('ascii').replace(/;1$/, '');
        const childPath = prefix ? prefix + '/' + name : name;
        listed.push(childPath);
        if ((flags & 2) === 2) visit(image.readUInt32LE(offset + 2), image.readUInt32LE(offset + 10), childPath);
      }
      offset += length;
    }
  };
  visit(image.readUInt32LE(rootRecordOffset + 2), image.readUInt32LE(rootRecordOffset + 10));
  assert.ok(listed.includes('BDMV/STREAM/00000.M2TS'));
  assert.ok(listed.includes('BDMV/PLAYLIST/00000.MPLS'));
});

test('phase helper materializes only manifest-bound collision and mutation seeds', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-builder-phase-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const control = path.join(root, '.shelfdeck-test-library');
  const seedRoot = path.join(control, 'seeds');
  fs.mkdirSync(seedRoot, { recursive:true });
  const collision = Buffer.from('collision-seed');
  const mutation = Buffer.from('mutation-seed');
  const original = Buffer.from('original-poster');
  fs.writeFileSync(path.join(seedRoot, 'G04-collision-target.mkv.seed'), collision);
  fs.writeFileSync(path.join(seedRoot, 'G06-poster-mutated.jpg.seed'), mutation);
  const mutationTarget = 'SDT-G06-Stale-Related (2008)/poster.jpg';
  fs.mkdirSync(path.join(root, path.dirname(mutationTarget)), { recursive:true });
  fs.writeFileSync(path.join(root, mutationTarget), original);
  const manifest = {
    schema:'shelfdeck.movie-test-library-manifest@2', libraryId:'shelfdeck-helix-movie-vertical-v1', root,
    scenarios:[{ id:'G04' }, { id:'G06' }],
    controlAssets:[
      { relativePath:'seeds/G04-collision-target.mkv.seed', sizeBytes:collision.length, sha256:sha256(collision) },
      { relativePath:'seeds/G06-poster-mutated.jpg.seed', sizeBytes:mutation.length, sha256:sha256(mutation) },
    ],
    verification:{ entries:[{ relativePath:mutationTarget, sha256:sha256(original) }] },
  };
  fs.writeFileSync(path.join(control, 'manifest.json'), JSON.stringify(manifest));
  const collisionTarget = path.join(root, 'SDT-G04-Collision (2008)', 'SDT-G04-Collision (2008).mkv');
  assert.equal(preparePhase(root, 'G04', false).action, 'dry_run');
  assert.equal(fs.existsSync(collisionTarget), false);
  assert.equal(preparePhase(root, 'G04', true).committedDigest, sha256(collision));
  assert.equal(preparePhase(root, 'G04', true).replayed, true);
  assert.equal(preparePhase(root, 'G06', true).committedDigest, sha256(mutation));
  assert.deepEqual(fs.readFileSync(path.join(root, mutationTarget)), mutation);
});
