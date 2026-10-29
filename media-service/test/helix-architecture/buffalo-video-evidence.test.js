'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {samplingPoints, clusterFaces, candidateEvidence} = require('../../scripts/qualification/buffalo/video-evidence');
const {createHash} = require('node:crypto');
const digest = x => createHash('sha256').update(String(x)).digest('hex');
function face(frameOrdinal, angle, options = {}) {
  const radians = angle * Math.PI / 180, vector = Array(512).fill(0); vector[0] = Math.cos(radians); vector[1] = Math.sin(radians);
  return {frameOrdinal, faceOrdinal:0, timestampMs:frameOrdinal * 1000, stratum:frameOrdinal % 20,
    imageDigest:digest(frameOrdinal), quality:0.8, vector, matches:[], ...options};
}
test('video sampling remains bounded, deduplicates short clips and never scans the whole stream', () => {
  const plan = samplingPoints(3_600_000), points = [...plan.initial, ...plan.supplement];
  assert.equal(points.length, 40); assert.equal(new Set(points.map(x => x.timestampMs)).size, 40);
  assert.ok(points.every(x => x.timestampMs >= 180000 && x.timestampMs < 3420000));
  assert.equal(samplingPoints(1).initial.length, 1); assert.equal(samplingPoints(1).supplement.length, 0);
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => samplingPoints(value), {code:'BUFFALO_VIDEO_EVIDENCE_INVALID'});
});
test('nearby views join by feature evidence and input permutation does not change groups', () => {
  const faces = [face(0, 0), face(1, 12), face(2, 90), face(3, 100)];
  const result = clusterFaces(faces);
  assert.deepEqual(result.map(x => x.memberKeys), [['0:0', '1:0'], ['2:0', '3:0']]);
  assert.deepEqual(clusterFaces([...faces].reverse()), result);
});
test('two faces in the same frame cannot become one identity even when their features are similar', () => {
  assert.equal(clusterFaces([face(0, 0), face(0, 5, {faceOrdinal:1})]).length, 2);
});
test('an intermediate face cannot bridge incompatible identities', () => {
  assert.deepEqual(clusterFaces([face(0, 0), face(1, 35), face(2, 70)], {threshold:0.4}).map(x => x.memberKeys), [['0:0', '1:0'], ['2:0']]);
});
test('a face equally close to two existing groups stays separately unresolved', () => {
  const groups = clusterFaces([face(0, 0), face(0, 20, {faceOrdinal:1}), face(1, 10)]);
  assert.equal(groups.length, 3);
});
test('repeated images and supplemental frames do not inflate independent temporal coverage', () => {
  const group = clusterFaces([face(0, 0), face(1, 0, {imageDigest:digest(0)}), face(20, 3, {stratum:0})])[0];
  assert.equal(group.uniqueFrameCount, 3); assert.deepEqual(group.coverageStrata, [0]);
  assert.equal(group.representativeKeys.length, 2);
});
test('representatives cover separate time strata and catalogue identities stay separate despite equal names', () => {
  const candidate = uid => ({uid, name:'Same Name', gender:'FEMALE', combinedDistance:0.2});
  const faces = [face(0, 0, {matches:[candidate('catalogue:a')]}), face(1, 8, {matches:[candidate('catalogue:b')]})];
  const evidence = candidateEvidence(clusterFaces(faces)[0], faces);
  assert.equal(evidence.length, 2); assert.ok(evidence.every(x => x.supportingStrata === 1));
});
test('only explicit catalogue links combine evidence and conflicting gender remains visible', () => {
  const faces = [face(0, 0, {matches:[{uid:'source:a', identityKey:'linked:a', name:'A', gender:'FEMALE', combinedDistance:0.2}]}),
    face(1, 8, {matches:[{uid:'source:b', identityKey:'linked:a', name:'Alias', gender:'MALE', combinedDistance:0.3}]})];
  const evidence = candidateEvidence(clusterFaces(faces)[0], faces);
  assert.equal(evidence.length, 1); assert.equal(evidence[0].supportingStrata, 2); assert.deepEqual(evidence[0].genders, ['FEMALE', 'MALE']);
});
test('malformed features, duplicate faces, unbound representatives and cancellation fail explicitly', () => {
  for (const bad of [face(0, 0, {vector:Array(512).fill(0)}), face(0, 0, {vector:[NaN]}), face(0, 0, {stratum:20})])
    assert.throws(() => clusterFaces([bad]), {code:'BUFFALO_VIDEO_EVIDENCE_INVALID'});
  assert.throws(() => clusterFaces([face(0, 0), face(0, 0)]), {code:'BUFFALO_VIDEO_EVIDENCE_INVALID'});
  assert.throws(() => clusterFaces([face(0, 0), face(0, 90, {faceOrdinal:1,timestampMs:99})]), {code:'BUFFALO_VIDEO_EVIDENCE_INVALID'});
  assert.throws(() => candidateEvidence({representativeKeys:['9:0'], memberKeys:['9:0']}, [face(0, 0)]), {code:'BUFFALO_VIDEO_EVIDENCE_INVALID'});
  assert.throws(() => clusterFaces([face(0, 0)], {assertActive:() => {throw Object.assign(new Error('Stopped'), {code:'STOPPED'});}}), {code:'STOPPED'});
});
