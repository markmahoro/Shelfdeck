'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {subjectRatingTarget}=require('../../src/helix/domains/libra/model/subject-rating-target');
function context(){return {subject:{subjectId:'subject',intakeRevision:1,contentProfile:'movie',snapshotDigest:'old',currentIdentityDigest:'formal'},
  deliverySnapshot:{candidatePackage:{identityClaim:{claimedTitle:'The Hobbit Extended Edition',claimedYear:2012}}},rows:{identity:null}};}
test('UAT-217 formal title supersedes the intake title only after a durable identity exists',()=>{
  const c=context(),weak=subjectRatingTarget(c),display={schemaRef:'helix://contracts/records/display-identity/v1',schemaVersion:1,recordKind:'display-identity',entries:[{key:'title',value:'The Hobbit: An Unexpected Journey'}]};
  c.rows.identity={identity_digest:'formal',revision:1,display_identity:JSON.stringify({...display,recordDigest:canonicalDigest(display)})};
  c.subject.snapshotDigest='new';const formal=subjectRatingTarget(c);
  assert.equal(formal.title,'the hobbit: an unexpected journey');assert.notEqual(formal.targetDigest,weak.targetDigest);
  assert.equal(formal.providerIdentity,null,'Display text must not fabricate a Provider anchor.');
  assert.equal(formal.year,null,'The intake year is not upgraded into a formal year.');
  assert.equal(c.deliverySnapshot.candidatePackage.identityClaim.claimedTitle,'The Hobbit Extended Edition');
  assert.deepEqual(subjectRatingTarget(c),formal);
  c.rows.identity.identity_digest='wrong';assert.throws(()=>subjectRatingTarget(c),{code:'LIBRA_RATING_IDENTITY_INVALID'});
});
test('UAT-217 durable Movie provider identity and year become the rating target',()=>{
  const c=context(),display={schemaRef:'helix://contracts/records/display-identity/v1',schemaVersion:1,
    recordKind:'display-identity',entries:[{key:'title',value:'The Hobbit: An Unexpected Journey'},
      {key:'year',value:'2012'},{key:'tmdb_movie_id',value:'49051'}]};
  c.rows.identity={identity_kind:'tmdb_movie',identity_digest:'formal',revision:2,
    display_identity:JSON.stringify({...display,recordDigest:canonicalDigest(display)})};
  const target=subjectRatingTarget(c);
  assert.equal(target.providerIdentity,'tmdb:49051');assert.equal(target.year,2012);
  assert.equal(target.targetRevision,2);
  display.entries[0].value='A different film';c.rows.identity.display_identity=JSON.stringify(display);
  assert.throws(()=>subjectRatingTarget(c),{code:'LIBRA_RATING_IDENTITY_INVALID'});
});
