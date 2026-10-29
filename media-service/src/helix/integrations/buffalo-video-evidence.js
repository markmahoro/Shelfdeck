'use strict';
// Bounded technical grouping. The caller supplies the Owner's frozen policy.
const {createHash} = require('node:crypto');
const {assertFrameEvidence}=require('../contracts/buffalo-frame-evidence');
const DIMENSION = 512, MAX_FRAMES = 40, MAX_FACES = MAX_FRAMES * 32;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(message) { throw Object.assign(new TypeError(message), {code:'BUFFALO_VIDEO_EVIDENCE_INVALID'}); }
function byteOrder(a, b) { return Buffer.compare(Buffer.from(a), Buffer.from(b)); }
function unit(vector) {
  if (!Array.isArray(vector) || vector.length !== DIMENSION || vector.some(x => !Number.isFinite(x))) fail('A finite 512-dimensional feature is required.');
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-8) fail('A nonzero face feature is required.');
  return vector.map(x => x / norm);
}
function frameFaces(frames){
  if(!Array.isArray(frames)||frames.length>40)fail('A bounded completed frame Evidence set is required.');
  return frames.flatMap(record=>{
    assertFrameEvidence(record);
    return record.faces.map(face=>{
      const [x0,y0,x1,y1]=face.rectangle;
      return {frameOrdinal:record.frame.ordinal,faceOrdinal:face.faceOrdinal,timestampMs:record.frame.timestampMs,stratum:record.frame.stratum,
        imageDigest:record.frame.imageDigest,quality:Math.max(0,Math.min(1,face.confidence*Math.min(x1-x0,y1-y0)/160)),
        vector:face.vector,faceEvidenceDigest:face.faceEvidenceDigest};
    });
  });
}
function distance(a, b) { return Math.max(0, Math.min(2, 1 - a.reduce((sum, x, i) => sum + x * b[i], 0))); }
function validateFaces(faces) {
  if (!Array.isArray(faces) || faces.length > MAX_FACES) fail('The bounded video face count was exceeded.');
  const keys = new Set(), frames = new Map();
  const result = faces.map(face => {
    if (!Number.isSafeInteger(face.frameOrdinal) || face.frameOrdinal < 0 || face.frameOrdinal >= MAX_FRAMES ||
        !Number.isSafeInteger(face.faceOrdinal) || face.faceOrdinal < 0 || face.faceOrdinal >= 32 ||
        !Number.isSafeInteger(face.timestampMs) || face.timestampMs < 0 || !Number.isSafeInteger(face.stratum) || face.stratum < 0 || face.stratum >= 20 ||
        !/^[a-f0-9]{64}$/.test(face.imageDigest || '') || !Number.isFinite(face.quality) || face.quality < 0 || face.quality > 1) fail('Face provenance or quality is invalid.');
    const key = face.frameOrdinal + ':' + face.faceOrdinal;
    if (keys.has(key)) fail('A video face was supplied more than once.');
    const frameProof=JSON.stringify([face.timestampMs,face.stratum,face.imageDigest]);
    if(frames.has(face.frameOrdinal)&&frames.get(face.frameOrdinal)!==frameProof)fail('Faces from one frame disagree on source provenance.');
    keys.add(key); frames.set(face.frameOrdinal,frameProof);
    return {...face, key, vector:unit(face.vector)};
  });
  if (frames.size > MAX_FRAMES) fail('Too many sampled frames were supplied.');
  return result.sort((a, b) => a.timestampMs - b.timestampMs || a.frameOrdinal - b.frameOrdinal || a.faceOrdinal - b.faceOrdinal);
}
function clusterFaces(faces, {threshold, ambiguityMargin, assertActive = () => {}} = {}) {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1 || !Number.isFinite(ambiguityMargin) || ambiguityMargin < 0 || ambiguityMargin > 1) fail('Explicit bounded grouping parameters are required.');
  const ordered = validateFaces(faces), groups = [];
  for (const face of ordered) {
    assertActive();
    // Never merge co-occurring faces or allow an intermediate face to bridge two identities.
    const candidates = groups.map((group, ordinal) => ({group, ordinal, d:distance(face.vector, unit(group.sum))}))
      .filter(({group, d}) => d < threshold && group.members.every(member => member.frameOrdinal !== face.frameOrdinal && distance(member.vector, face.vector) < threshold))
      .sort((a, b) => a.d - b.d || a.ordinal - b.ordinal);
    const selected = candidates.length && !(candidates.length > 1 && candidates[1].d - candidates[0].d < ambiguityMargin) ? candidates[0].group : null;
    if (selected) {
      selected.members.push(face); selected.sum = selected.sum.map((x, i) => x + face.vector[i]);
    } else groups.push({members:[face], sum:[...face.vector]});
  }
  return Object.freeze(groups.map(group => {
    const members = group.members, uniqueImages = new Map();
    for (const member of members) if (!uniqueImages.has(member.imageDigest)) uniqueImages.set(member.imageDigest, member);
    const coverage = [...new Set([...uniqueImages.values()].map(x => x.stratum))].sort((a, b) => a - b);
    const representatives = [], available = [...uniqueImages.values()].sort((a, b) => b.quality - a.quality || a.timestampMs - b.timestampMs || byteOrder(a.key, b.key));
    while (representatives.length < 3 && available.length) {
      available.sort((a, b) => {
        if (!representatives.length) return b.quality - a.quality || byteOrder(a.key, b.key);
        const novelty = candidate => Number(!representatives.some(x => x.stratum === candidate.stratum)) * 4 +
          Math.min(...representatives.map(x => distance(candidate.vector, x.vector))) + candidate.quality * 0.01;
        return novelty(b) - novelty(a) || byteOrder(a.key, b.key);
      });
      representatives.push(available.shift());
    }
    return Object.freeze({clusterId:hash({schema:'buffalo-video-qualification-cluster@1', members:members.map(x => [x.key, x.imageDigest])}),
      memberKeys:Object.freeze(members.map(x => x.key)), uniqueFrameCount:new Set(members.map(x => x.frameOrdinal)).size,
      coverageStrata:Object.freeze(coverage), representativeKeys:Object.freeze(representatives.map(x => x.key)),
      maximumPairDistance:members.reduce((max, member, i) => Math.max(max, ...members.slice(i + 1).map(other => distance(member.vector, other.vector))), 0)});
  }));
}
function candidateEvidence(cluster, faces) {
  const byKey = new Map(validateFaces(faces).map(face => [face.key, face])), candidates = new Map();
  if (!cluster || !Array.isArray(cluster.representativeKeys) || cluster.representativeKeys.length > 3) fail('A bounded representative set is required.');
  for (const key of cluster.representativeKeys) {
    const face = byKey.get(key);
    if (!face || !cluster.memberKeys.includes(key) || !Array.isArray(face.matches) || face.matches.length > 5) fail('A representative lost its exact face evidence.');
    for (const match of face.matches) {
      if (typeof match.uid !== 'string' || !match.uid || typeof match.name !== 'string' || !match.name ||
          !Number.isFinite(match.combinedDistance) || match.combinedDistance < 0 || match.combinedDistance > 1) fail('A catalogue candidate is invalid.');
      const identity = match.identityKey || match.uid;
      if (!candidates.has(identity)) candidates.set(identity, {identity, observations:[]});
      candidates.get(identity).observations.push({faceKey:key, stratum:face.stratum, imageDigest:face.imageDigest,
        uid:match.uid, name:match.name, gender:match.gender ?? null, distance:match.combinedDistance});
    }
  }
  // These counts are observations, not calibrated probabilities or an actor choice.
  return Object.freeze([...candidates.values()].map(candidate => Object.freeze({...candidate,
    supportingRepresentatives:new Set(candidate.observations.map(x => x.faceKey)).size,
    supportingStrata:new Set(candidate.observations.map(x => x.stratum)).size,
    minimumDistance:Math.min(...candidate.observations.map(x => x.distance)),
    genders:Object.freeze([...new Set(candidate.observations.map(x => x.gender))]),
    observations:Object.freeze(candidate.observations.map(Object.freeze))}))
    .sort((a, b) => b.supportingStrata - a.supportingStrata || a.minimumDistance - b.minimumDistance || byteOrder(a.identity, b.identity)));
}
module.exports = Object.freeze({clusterFaces, candidateEvidence, distance, unit, frameFaces});
