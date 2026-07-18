'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const { canonicalDigest }=require('../../src/helix/contracts/canonical-json');
const { createSubjectContinuityResolver }=require('../../src/helix/domains/libra/application/subject-continuity-resolver');

const D=(value)=>canonicalDigest({ value });
const claim=(key='season-1')=>{ const value={ claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:key,
  claimDigest:'',evidenceDigest:D('evidence-'+key) }; value.claimDigest=canonicalDigest({ schema:'season-continuity-claim@1',
  claimKind:value.claimKind,claimNamespace:value.claimNamespace,claimKey:value.claimKey }); return value; };
function snapshot(episodeKeys=['E01'],claims=[claim()]) {
  return { snapshotContract:'procurement.candidate-delivery@1',offer:{ offerId:'offer-1' },deliverySnapshotDigest:D('snapshot'),
    candidatePackage:{ candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),seasonContinuityClaims:claims,
      seasonContinuityClaimSetDigest:canonicalDigest({ schema:'season-continuity-claim-set@1',items:claims }) },
    primaryInputManifest:{ structureKind:'season' },primaryMaterialDeliveries:[{ role:'primary_payload',episodeClaims:episodeKeys.map((episodeKey)=>({ episodeKey })) }] };
}
function subject(id='subject-1',episodes=['E00'],claims=[claim()]) {
  return { subjectId:id,status:'active',intakeRevision:2,continuitySetDigest:D('continuity-'+id),episodeScopeDigest:D('episodes-'+id),
    episodeKeys:episodes,continuityClaims:claims.map((value)=>({ ...value,provenanceKind:'candidate',provenanceRef:'candidate-old' })) };
}
function resolver(){ let next=0; return createSubjectContinuityResolver({ allocateDecisionId:()=>`decision-${++next}`,
  allocateSubjectId:()=>`new-subject-${next}` }); }
const head={ revision:4,digest:D('head') };

test('FA-04 extends only one exact active Subject with zero Episode overlap',()=>{
  const decision=resolver().resolve({ snapshot:snapshot(['E01']),expectedContinuityHead:head,matchedSubjects:[subject()] });
  assert.equal(decision.result,'season_extension'); assert.equal(decision.targetSubjectId,'subject-1');
  assert.equal(decision.allocatedSubjectId,undefined); assert.equal(decision.matchCardinality,'one');
  assert.deepEqual(decision.overlappingEpisodeKeys,[]);
});

test('zero, multiple, or overlapping exact matches always allocate a new Subject',()=>{
  const resolve=resolver();
  const none=resolve.resolve({ snapshot:snapshot(),expectedContinuityHead:head,matchedSubjects:[] });
  const multiple=resolve.resolve({ snapshot:snapshot(),expectedContinuityHead:head,matchedSubjects:[subject('b'),subject('a')] });
  const overlap=resolve.resolve({ snapshot:snapshot(['E01']),expectedContinuityHead:head,matchedSubjects:[subject('only',['E01'])] });
  for (const value of [none,multiple,overlap]) { assert.equal(value.result,'new_subject'); assert.ok(value.allocatedSubjectId); }
  assert.deepEqual(multiple.matchWitnesses.map((item)=>item.subjectId),['a','b']);
  assert.deepEqual(overlap.overlappingEpisodeKeys,['E01']);
});

test('title, year, path, and fuzzy score cannot enter continuity authority',()=>{
  const source=require('node:fs').readFileSync(require('node:path').resolve(__dirname,
    '../../src/helix/domains/libra/application/subject-continuity-resolver.js'),'utf8');
  assert.doesNotMatch(source,/title|year|path|folder|fuzzy|similarity|score/i);
  assert.throws(()=>resolver().resolve({ snapshot:snapshot(),expectedContinuityHead:head,
    matchedSubjects:[subject('fake',[],[claim('different')])] }),(error)=>error.code==='P8_CONTINUITY_FALSE_MATCH');
});
