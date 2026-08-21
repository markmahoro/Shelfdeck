'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createIso9660, createUdfBluRay, writeMpls } = require('../../scripts/build-helix-movie-test-library');
const { createDiscTopologyReader } = require('../../src/helix/integrations/disc-topology');
const { isProvenIsoTopology, materialInputFormFromProbe } = require('../../src/helix/domains/procurement/model/triage-contracts');

test('disc topology is proven from bounded content rather than filename extension', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-disc-topology-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'BDMV', 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(source, 'BDMV', 'CLIPINF'), { recursive:true });
  fs.writeFileSync(path.join(source, 'BDMV', 'STREAM', '00000.m2ts'), Buffer.alloc(4096, 7));
  fs.writeFileSync(path.join(source, 'BDMV', 'CLIPINF', '00000.clpi'), Buffer.from('clip'));
  fs.writeFileSync(path.join(source, 'BDMV', 'index.bdmv'), Buffer.from('index'));
  fs.writeFileSync(path.join(source, 'BDMV', 'MovieObject.bdmv'), Buffer.from('object'));
  writeMpls(root, 'source/BDMV/PLAYLIST/00000.mpls', [{ clipId:'00000', outTime:90000 }]);
  const image = path.join(root, 'disc-without-iso-extension.bin');
  createIso9660(source, image, 'DISC_PROOF');
  const fake = path.join(root, 'ordinary-name.iso');
  fs.writeFileSync(fake, Buffer.from('not-an-image'));
  const reader = createDiscTopologyReader();
  const topology = await reader.inspect(image);
  assert.equal(topology.discKind, 'iso');
  assert.equal(topology.titleCount, 1);
  assert.deepEqual(topology.selectedPlaylist.clipIds, ['00000']);
  assert.equal(materialInputFormFromProbe({ discTopology:topology }), 'iso');
  assert.equal(await reader.inspect(fake), null);
});

test('UDF Blu-ray ISO topology is proven from AVDP and metadata partition content', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-udf-reject-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const fakeUdf = path.join(root, 'udf-without-volume.iso');
  const image = Buffer.alloc(2048 * 20);
  image.write('BEA01', 16 * 2048 + 1, 5, 'ascii');
  image.write('NSR03', 17 * 2048 + 1, 5, 'ascii');
  image.write('TEA01', 18 * 2048 + 1, 5, 'ascii');
  fs.writeFileSync(fakeUdf, image);
  const reader = createDiscTopologyReader();
  assert.equal(await reader.inspect(fakeUdf), null);

  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'BDMV', 'STREAM'), { recursive:true });
  fs.mkdirSync(path.join(source, 'BDMV', 'CLIPINF'), { recursive:true });
  fs.writeFileSync(path.join(source, 'BDMV', 'STREAM', '00000.m2ts'), Buffer.alloc(4096, 7));
  fs.writeFileSync(path.join(source, 'BDMV', 'CLIPINF', '00000.clpi'), Buffer.from('clip'));
  fs.writeFileSync(path.join(source, 'BDMV', 'index.bdmv'), Buffer.from('index'));
  fs.writeFileSync(path.join(source, 'BDMV', 'MovieObject.bdmv'), Buffer.from('object'));
  writeMpls(root, 'source/BDMV/PLAYLIST/00000.mpls', [{ clipId:'00000', outTime:90000 }]);
  const udfImage = path.join(root, 'udf-bluray.iso');
  createUdfBluRay(source, udfImage);
  const topology = await reader.inspect(udfImage);
  assert.equal(topology.discKind, 'iso');
  assert.equal(topology.titleCount, 1);
  assert.equal(topology.selectedPlaylist.relativeLocation, 'BDMV/PLAYLIST/00000.mpls');
  assert.deepEqual(topology.selectedPlaylist.clipIds, ['00000']);
  assert.equal(materialInputFormFromProbe({ discTopology: topology }), 'iso');
  assert.equal(isProvenIsoTopology({ discTopology: topology }), true);
  assert.equal(isProvenIsoTopology({ discTopology: { discKind:'iso' } }), false);

  const canaryIso = process.env.HELIX_UDF_ISO_FIXTURE;
  if (!canaryIso) return;
  const live = await reader.inspect(canaryIso);
  assert.equal(live.discKind, 'iso');
  assert.ok(live.titleCount >= 1);
  assert.match(live.selectedPlaylist.relativeLocation, /BDMV\/PLAYLIST\/\d+\.mpls/i);
  assert.equal(materialInputFormFromProbe({ discTopology: live }), 'iso');
});

test('DVD topology requires IFO content signatures and selects one bounded title set', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-dvd-topology-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const videoTs = path.join(root, 'Movie', 'VIDEO_TS');
  fs.mkdirSync(videoTs, { recursive:true });
  fs.writeFileSync(path.join(videoTs, 'VIDEO_TS.IFO'), Buffer.from('DVDVIDEO-VMG-manager'));
  fs.writeFileSync(path.join(videoTs, 'VTS_01_0.IFO'), Buffer.from('DVDVIDEO-VTS-title'));
  fs.writeFileSync(path.join(videoTs, 'VTS_01_1.VOB'), Buffer.alloc(8192, 1));
  fs.writeFileSync(path.join(videoTs, 'VTS_02_0.IFO'), Buffer.from('DVDVIDEO-VTS-title'));
  fs.writeFileSync(path.join(videoTs, 'VTS_02_1.VOB'), Buffer.alloc(4096, 2));
  const reader = createDiscTopologyReader();
  const topology = await reader.inspect(path.join(videoTs, 'VTS_01_1.VOB'));
  assert.equal(topology.discKind, 'dvd');
  assert.equal(topology.titleCount, 2);
  assert.equal(topology.selectedPlaylist.relativeLocation, 'VIDEO_TS/VTS_01');
  assert.equal(materialInputFormFromProbe({ discTopology:topology }), 'dvd');
  assert.equal(topology.members.filter((item) => item.role === 'primary_payload').length, 1);

  fs.writeFileSync(path.join(videoTs, 'VIDEO_TS.IFO'), Buffer.from('not-a-dvd-manager'));
  const uncached = createDiscTopologyReader();
  assert.equal(await uncached.inspect(path.join(videoTs, 'VTS_01_1.VOB')), null);
});
