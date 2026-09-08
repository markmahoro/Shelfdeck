'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMediaCastReferenceQuery}=require('../../src/helix/domains/people/application/media-cast-reference-query');
const person=(id,status='active',target=null)=>({personId:id,status,currentRevision:2,revision:{mergedIntoPersonId:target,factDigest:'a'.repeat(64)}});

test('UAT-214 preserves established relations except formal Merge correlation and rejects cycles',()=>{
  const people={a:person('a','merged','b'),b:person('b'),c:person('c','merged','c')};
  const query=createMediaCastReferenceQuery({getPerson:id=>people[id]});
  assert.equal(query.resolve({personId:'a',providerIdentities:[]}).personId,'b');
  assert.equal(query.resolve({personId:'b',providerIdentities:[]}).kind,'unchanged');
  assert.equal(query.resolve({personId:'c',providerIdentities:[]}).kind,'unresolved');
  assert.equal(query.resolve({personId:'missing',providerIdentities:[]}).kind,'unresolved');
});

test('UAT-214 conflicting stable identities do not pick an arbitrary Person',()=>{
  const query=createMediaCastReferenceQuery({findActivePersonByProviderIdentity:i=>person(i.providerKey)});
  assert.deepEqual(query.resolve({personId:null,providerIdentities:[
    {provider:'tmdb',namespace:'person',providerKey:'1'},{provider:'tmdb',namespace:'person',providerKey:'2'}]}),
    {kind:'unresolved',reasonCode:'conflicting_provider_identities'});
});
