'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reliablePair,personRef,workFor}=require('../../src/helix/domains/people/model/system-merge-work');
const person=(personId,namespace,key,libraryKind='normal')=>({personId,libraryKind,status:'active',currentRevision:1,currentPreferenceRevision:null,
  revision:{canonicalName:'Shared Name',factDigest:'a'.repeat(64),providerIdentities:[{provider:'tmdb',namespace,providerKey:key}]}});
test('system Merge requires an exact reliable identity and rejects names, cross-library pairs, US identities and conflicting evidence',()=>{
  const a=person('a','person','42'),b=person('b','tmdb_person','42');assert.equal(reliablePair([a,b]),true);
  for(const other of [person('b','tmdb_person','43'),person('b','tmdb_person','42','jav'),person('b','tmdb_person','42','us_adult'),
    {...b,revision:{...b.revision,providerIdentities:[]}}, {...b,status:'merged'},
    {...b,revision:{...b.revision,providerIdentities:[...b.revision.providerIdentities,{provider:'tmdb',namespace:'person',providerKey:'43'}]}}])assert.equal(reliablePair([a,other]),false);
  assert.equal(reliablePair([person('a','person','same-name'),person('b','tmdb_person','same-name')]),false);
});
test('Merge Work is stable under pair order but freezes each Person, Preference revision and library',()=>{
  const a=personRef(person('a','person','42')),b=personRef(person('b','tmdb_person','42')),work=workFor([a,b],'normal');
  assert.deepEqual(workFor([b,a],'normal'),work);
  for(const changed of [{...b,revision:2},{...b,factDigest:'b'.repeat(64)},{...b,preferenceRevision:1}])assert.notEqual(workFor([a,changed],'normal').workId,work.workId);
  assert.notEqual(workFor([a,b],'jav').workId,work.workId);
});
