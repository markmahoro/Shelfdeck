'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {canonicalContentIdentity}=require('../../src/helix/domains/arca/model/canonical-content-identity');
const {effectiveRequirements}=require('../../src/helix/domains/arca/model/care-objective');
const {usesRatingDecision}=require('../../src/helix/domains/arca/application/aftercare-context-reader');
const {packageContentProfile,inventoryContentProfile}=require('../../src/helix/domains/arca/model/product-content-profile');
test('JAV single Inventory chooses the JAV standard and does not inherit Movie rating or optional-field obligations',()=>{
  const movie={contentProfile:'movie',decisionInputKinds:['rating'],baseRequirements:{metadata:{requiredFieldCodes:['title','release_date']}}},
    jav={contentProfile:'jav',decisionInputKinds:[],baseRequirements:{metadata:{requiredFieldCodes:['title']}}},standard={profileRuleSets:[movie,jav]},identity={identity_kind:'jav_code'};
  assert.deepEqual(effectiveRequirements({raw:{identity,entry:{structure_kind:'single'},standard:{value:standard},facts:[]}}),jav.baseRequirements);
  assert.equal(usesRatingDecision(standard,'single',identity),false);
  assert.equal(usesRatingDecision(standard,'single',{identity_kind:'tmdb_movie'}),true);
  assert.throws(()=>inventoryContentProfile(identity,'season'),{code:'ARCA_INVENTORY_CONTENT_PROFILE_INVALID'});
  assert.throws(()=>inventoryContentProfile(null,'single'),{code:'ARCA_INVENTORY_CONTENT_PROFILE_INVALID'});
});
test('Arca accepts formal JAV profile and canonical code stays stable across Subject, title and source evidence changes',()=>{
  const identity={contentProfile:'jav',structureKind:'single',identityKind:'jav_code',subjectId:'subject-a',
    providerIdentities:[{provider:'jav',namespace:'jav_code',providerKey:'IPX-177'}],identityDigest:'a'.repeat(64)};
  assert.equal(packageContentProfile({resolvedIdentitySnapshot:{factValue:identity},productStructureSnapshot:{structureKind:'single'}}),'jav');
  const first=canonicalContentIdentity('shelf-a',identity),second=canonicalContentIdentity('shelf-a',{...identity,subjectId:'subject-b',identityDigest:'b'.repeat(64)});
  assert.equal(first.canonicalIdentityKey,second.canonicalIdentityKey);
  assert.equal(first.shelfEntryId,null);
  const entryA=canonicalContentIdentity('shelf-a',identity,'arca-admission-a'),entryB=canonicalContentIdentity('shelf-a',identity,'arca-admission-b');
  assert.equal(entryA.canonicalIdentityKey,entryB.canonicalIdentityKey);assert.notEqual(entryA.shelfEntryId,entryB.shelfEntryId);
  assert.equal(entryA.shelfEntryId,canonicalContentIdentity('shelf-a',{...identity,identityDigest:'c'.repeat(64)},'arca-admission-a').shelfEntryId);
  assert.notEqual(first.canonicalIdentityKey,canonicalContentIdentity('shelf-b',identity).canonicalIdentityKey);
  assert.notEqual(first.canonicalIdentityKey,canonicalContentIdentity('shelf-a',{...identity,providerIdentities:[{...identity.providerIdentities[0],providerKey:'IPX-178'}]}).canonicalIdentityKey);
});
