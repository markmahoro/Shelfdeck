'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBdmvTopologyReader } = require('../../src/helix/integrations/bdmv-topology');

function writeMpls(filePath) {
  const value = Buffer.alloc(54);
  value.write('MPLS0200', 0, 'ascii');
  value.writeUInt32BE(20, 8);
  value.writeUInt32BE(34, 20);
  value.writeUInt16BE(1, 26);
  value.writeUInt16BE(22, 30);
  value.write('00000', 32, 'ascii');
  value.write('M2TS', 37, 'ascii');
  value.writeUInt32BE(0, 44);
  value.writeUInt32BE(450000, 48);
  fs.writeFileSync(filePath, value);
}

test('BDMV topology reads only the frozen admitted Scope instead of recursively counting unrelated disc assets', async (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-bdmv-scope-'));
  t.after(() => fs.rmSync(temporaryRoot, { recursive:true, force:true }));
  const bdmvRoot = path.join(temporaryRoot, 'Movie', 'BDMV');
  for (const directory of ['PLAYLIST', 'STREAM', 'CLIPINF', 'JAR']) {
    fs.mkdirSync(path.join(bdmvRoot, directory), { recursive:true });
  }
  const paths = {
    playlist:path.join(bdmvRoot, 'PLAYLIST', '00000.mpls'),
    stream:path.join(bdmvRoot, 'STREAM', '00000.m2ts'),
    clip:path.join(bdmvRoot, 'CLIPINF', '00000.clpi'),
    index:path.join(bdmvRoot, 'index.bdmv'),
    movieObject:path.join(bdmvRoot, 'MovieObject.bdmv'),
  };
  writeMpls(paths.playlist);
  for (const filePath of [paths.stream, paths.clip, paths.index, paths.movieObject]) fs.writeFileSync(filePath, Buffer.from([1]));
  for (let ordinal = 0; ordinal < 1025; ordinal += 1) {
    fs.writeFileSync(path.join(bdmvRoot, 'JAR', String(ordinal).padStart(5, '0') + '.jar'), Buffer.alloc(0));
  }
  const members = Object.values(paths).map((location, ordinal) => ({
    readHandle:{ location, identity:{ materialKey:'material-' + ordinal, sizeBytes:fs.statSync(location).size } },
    sizeBytes:fs.statSync(location).size,
  }));
  const topology = await createBdmvTopologyReader().inspect(bdmvRoot, { memberSetDigest:'frozen-scope', members });
  assert.equal(topology.titleCount, 1);
  assert.equal(topology.selectedPlaylist.relativeLocation, 'PLAYLIST/00000.mpls');
  assert.deepEqual(topology.selectedPlaylist.clipIds, ['00000']);
});
