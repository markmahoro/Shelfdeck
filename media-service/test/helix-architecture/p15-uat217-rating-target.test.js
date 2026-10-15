'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {subjectRatingTarget}=require('../../src/helix/domains/libra/model/subject-rating-target');
const fs=require('node:fs'),path=require('node:path');
const {createRoutingContextReader}=require('../../src/helix/domains/libra/application/routing-context-reader');
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


test('UAT-217 replacement identity uses the same Subject head and rejects damaged evidence',()=>{
  const {establishedSubjectIdentity}=require('../../src/helix/domains/libra/planning/product-identity-work');
  const c=context(),snapshot={run:{subjectId:'subject',libraRunId:'new-run'}};
  const options={routingContextReader:{read:()=>c}};
  assert.equal(establishedSubjectIdentity(options,snapshot),null);
  const display={schemaRef:'helix://contracts/records/display-identity/v1',schemaVersion:1,recordKind:'display-identity',entries:[
    {key:'title',value:'Formal Movie'},{key:'year',value:'2008'},{key:'tmdb_movie_id',value:'990001'}]};
  c.rows.identity={identity_kind:'tmdb_movie',identity_digest:'formal',revision:2,display_identity:JSON.stringify({...display,recordDigest:canonicalDigest(display)})};
  const established=establishedSubjectIdentity(options,snapshot);
  assert.equal(established.providerKey,'990001');assert.equal(established.year,2008);
  assert.equal(established.resultDigest,'formal');
  assert.deepEqual(establishedSubjectIdentity(options,{run:{...snapshot.run,libraRunId:'another-replacement'}}),established);
  assert.throws(()=>establishedSubjectIdentity(options,{run:{subjectId:'different-subject'}}),/another Subject/);
  c.rows.identity.identity_digest='damaged';
  assert.throws(()=>establishedSubjectIdentity(options,snapshot),{code:'LIBRA_RATING_IDENTITY_INVALID'});
});

test('rating identity retains its digest without reading Routing history, Policy or Arca',()=>{
  const schemaManifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.manifest.json')));
  const subject={subject_id:'subject',status:'active',content_profile:'movie',structure_kind:'single',
    routing_anchor_intake_decision_id:'intake',intake_revision:1,current_identity_revision:null,
    current_continuity_set_digest:null,current_episode_scope_digest:null};
  const intake={intake_decision_id:'intake',accepted_result:'new_subject',target_subject_id:'subject',candidate_package_id:'package',
    source_field_id:'field',source_field_access_revision:1,source_field_context_digest:'field-context',candidate_identity_claim_digest:'claim',
    candidate_delivery_snapshot_digest:'delivery',candidate_delivery_snapshot_json:JSON.stringify({deliverySnapshotDigest:'delivery',
      candidatePackage:{identityClaim:{claimedTitle:'Movie title',claimedYear:2008}}})};
  let formal=null,restricted=false;
  const calls=[];
  const unitOfWork={execute(participants){return Object.fromEntries(participants.map(p=>[p.participantId,p.execute({repository:()=>({invoke(name){
    calls.push(name);
    if(restricted&&!['find_subject','find_intake','find_identity'].includes(name))throw Error('Unrelated Routing read: '+name);
    if(name==='find_subject')return subject;
    if(name==='find_intake')return intake;
    if(name==='find_identity')return formal;
    if(name==='list_decisions')return [];
    return null;
  }})})]));}};
  const reader=createRoutingContextReader({schemaManifest,unitOfWork,readArcaRoutingTargets(){
    assert.equal(restricted,false,'Rating identity must not read Arca routing targets.');return [];
  }});
  for(const profile of ['movie','series','jav'])for(const established of [false,true]) {
    subject.content_profile=profile;subject.current_identity_revision=established?2:null;
    const display={schemaRef:'helix://contracts/records/display-identity/v1',schemaVersion:1,recordKind:'display-identity',
      entries:[{key:'title',value:'Formal title'},{key:'year',value:'2009'},{key:'tmdb_movie_id',value:'123'}]};
    formal=established?{revision:2,identity_digest:'formal',identity_kind:'tmdb_movie',
      display_identity:JSON.stringify({...display,recordDigest:canonicalDigest(display)})}:null;
    restricted=false;const expected=subjectRatingTarget(reader.read('subject'));
    restricted=true;calls.length=0;
    assert.deepEqual(reader.ratingTarget('subject'),expected);
    assert.ok(calls.length<=3);
  }
  formal.display_identity=JSON.stringify({entries:[],recordDigest:'damaged'});
  assert.throws(()=>reader.ratingTarget('subject'),{code:'LIBRA_RATING_IDENTITY_INVALID'});
  subject.status='cancelled';assert.throws(()=>reader.ratingTarget('subject'),/active accepted Subject/);
});
