'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createProcurementRunSlices } = require('../../src/helix/domains/procurement/model/procurement-run-creator');

const BASIS = canonicalDigest({ fixture: 'run-creator' });

function group(folder, count) {
  return Array.from({ length: count }, (_, index) => ({
    materialKey: `${folder}-${String(index).padStart(4, '0')}`,
    relativeLocation: `${folder}/Episode.${String(index).padStart(4, '0')}.mkv`,
  }));
}

test('244 and 255 member directory groups form two whole Runs', () => {
  const value = createProcurementRunSlices({ fieldId: 'field', creationBasisDigest: BASIS,
    materials: [...group('Season 1', 244), ...group('Season 2', 255)] });
  assert.deepEqual(value.runs.map((run) => run.members.length), [244, 255]);
  assert.deepEqual(value.runs.map((run) => [...new Set(run.members.map((item) => item.directParent))]),
    [['Season 1'], ['Season 2']]);
});

test('small directory groups use canonical sequential packing without reordering', () => {
  const materials = [...group('B', 100), ...group('A', 100), ...group('C', 100)];
  const value = createProcurementRunSlices({ fieldId: 'field', creationBasisDigest: BASIS, materials });
  assert.deepEqual(value.runs.map((run) => run.members.length), [200, 100]);
  assert.deepEqual([...new Set(value.runs[0].members.map((item) => item.directParent))], ['A', 'B']);
});

test('257 member directory is closed and never split', () => {
  const value = createProcurementRunSlices({ fieldId: 'field', creationBasisDigest: BASIS, materials: group('Huge', 257) });
  assert.equal(value.runs.length, 0);
  assert.deepEqual(value.closedGroups, [{ directParent: 'Huge', groupKind:'directory', memberCount: 257,
    reasonCode: 'procurement_selection_scope_too_large' }]);
});

test('BDMV members and sibling CERTIFICATE use one logical container group', () => {
  const materials = [
    { materialKey:'a'.repeat(64), relativeLocation:'Movie/BDMV/STREAM/00000.m2ts' },
    { materialKey:'b'.repeat(64), relativeLocation:'Movie/BDMV/PLAYLIST/00000.mpls' },
    { materialKey:'c'.repeat(64), relativeLocation:'Movie/BDMV/CLIPINF/00000.clpi' },
    { materialKey:'e'.repeat(64), relativeLocation:'Movie/CERTIFICATE/id.bdmv' },
    { materialKey:'d'.repeat(64), relativeLocation:'Movie/sidecar.nfo' },
  ];
  const value = createProcurementRunSlices({ fieldId:'field', creationBasisDigest:BASIS, materials });
  assert.equal(value.runs.length, 1);
  assert.equal(value.runs[0].members.filter((item) => /(?:BDMV|CERTIFICATE)/i.test(item.relativeLocation)).length, 4);
  assert.equal(value.runs[0].logicalSelectionCount, 2);
});

test('BDMV group uses one logical slot up to the atomic Control physical cap', () => {
  const materials = group('Movie/BDMV/STREAM', 257);
  const value = createProcurementRunSlices({ fieldId:'field', creationBasisDigest:BASIS, materials });
  assert.equal(value.runs.length, 1);
  assert.equal(value.runs[0].members.length, 257);
  assert.equal(value.runs[0].logicalSelectionCount, 1);
});

test('BDMV group above the bounded physical cap is closed as one group', () => {
  const materials = group('Movie/BDMV/STREAM', 1025);
  const value = createProcurementRunSlices({ fieldId:'field', creationBasisDigest:BASIS, materials });
  assert.equal(value.runs.length, 0);
  assert.equal(value.closedGroups[0].groupKind, 'bdmv');
  assert.equal(value.closedGroups[0].reasonCode, 'procurement_selection_scope_too_large');
});

test('multiple legal BDMV groups cannot overflow one Run physical input', () => {
  const materials = [
    ...group('A/BDMV/STREAM', 500),
    ...group('B/BDMV/STREAM', 500),
    ...group('C/BDMV/STREAM', 500),
  ];
  const value = createProcurementRunSlices({ fieldId:'field', creationBasisDigest:BASIS, materials });
  assert.deepEqual(value.runs.map((run) => run.members.length), [1000, 500]);
  assert.deepEqual(value.runs.map((run) => run.logicalSelectionCount), [2, 1]);
});

test('1000 members create multiple non-overlapping stable Runs', () => {
  const materials = Array.from({ length: 100 }, (_, index) => group(`Folder-${String(index).padStart(3, '0')}`, 10)).flat();
  const first = createProcurementRunSlices({ fieldId: 'field', creationBasisDigest: BASIS, materials });
  const replay = createProcurementRunSlices({ fieldId: 'field', creationBasisDigest: BASIS, materials: [...materials].reverse() });
  assert.deepEqual(first, replay);
  assert.deepEqual(first.runs.map((run) => run.members.length), [250, 250, 250, 250]);
  const keys = first.runs.flatMap((run) => run.members.map((member) => member.materialKey));
  assert.equal(new Set(keys).size, 1000);
});
