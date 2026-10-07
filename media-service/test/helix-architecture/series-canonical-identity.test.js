'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {canonicalContentIdentity}=require('../../src/helix/domains/arca/model/canonical-content-identity');
function identity(){return {contentProfile:'series',structureKind:'season',identityKind:'tmdb_series_season',
 identityDigest:canonicalDigest('first-evidence'),providerIdentities:[{provider:'tmdb',namespace:'tmdb_series',providerKey:'42',seasonNumber:1}]};}
test('Canonical Season identity survives another Subject, evidence and translated display title',()=>{
 const a=identity(),b={...a,identityDigest:canonicalDigest('second-evidence'),subjectId:'another',displayIdentity:{title:'Translated'}};
 assert.deepEqual(canonicalContentIdentity('shelf',a),canonicalContentIdentity('shelf',b));
});
test('Shelf, Series and Season separate canonical collection identities',()=>{
 const a=identity(),first=canonicalContentIdentity('shelf',a);
 assert.notDeepEqual(first,canonicalContentIdentity('other-shelf',a));
 for(const change of [{seasonNumber:2},{providerKey:'43'}])assert.notDeepEqual(first,
  canonicalContentIdentity('shelf',{...a,providerIdentities:[{...a.providerIdentities[0],...change}]}));
 for(const change of [{seasonNumber:0},{seasonNumber:null},{providerKey:'unknown'}])assert.throws(()=>
  canonicalContentIdentity('shelf',{...a,providerIdentities:[{...a.providerIdentities[0],...change}]}));
 assert.throws(()=>canonicalContentIdentity('shelf',{...a,providerIdentities:[...a.providerIdentities,...a.providerIdentities]}));
});
test('Movie canonical identity preserves its existing key contract',()=>{
 const value={identityDigest:canonicalDigest('movie'),structureKind:'single',identityKind:'tmdb_movie',providerIdentities:[{provider:'tmdb',providerKey:'42'}]};
 const key=canonicalDigest({schema:'arca.canonical-content-identity-key@1',shelfId:'shelf',structureKind:'single',identityKind:'tmdb_movie',provider:'tmdb',providerKey:'42',identityDigest:value.identityDigest});
 assert.equal(canonicalContentIdentity('shelf',value).canonicalIdentityKey,key);
});
