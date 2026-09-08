'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { projectMovieNfoPersonObservations, MAX_NFO_BYTES } = require('../../src/helix/domains/arca/model/aftercare-nfo');
const observe = xml => projectMovieNfoPersonObservations(Buffer.from(xml));

test('UAT-214 observes NFO actor identity as provider evidence, never as local Person identity', () => {
  const result = observe('<movie><actor><name>张三 &amp; 李四</name><role>主角</role><tmdbid>123</tmdbid></actor></movie>');
  assert.equal(result.usable, true);
  assert.deepEqual(result.actors, [{ ordinal:0, displayName:'张三 & 李四', displayNameNormalized:'张三 & 李四',
    role:'actor', character:'主角', identityConflict:false,
    providerIdentities:[{provider:'tmdb',namespace:'person',providerKey:'123'}] }]);
  assert.equal(Object.hasOwn(result.actors[0], 'personId'), false);
});

test('UAT-214 weak, conflicting, and malformed NFO identities do not become stable claims', () => {
  for (const fields of ['', '<tmdbid>123</tmdbid><uniqueid type="tmdb">456</uniqueid>', '<tmdbid>not-an-id</tmdbid>']) {
    const result = observe('<movie><actor><name>Same Name</name>' + fields + '</actor></movie>');
    assert.equal(result.usable, true);
    assert.deepEqual(result.actors[0].providerIdentities, []);
  }
});

test('UAT-214 rejects unsafe XML and full observation overflow without partial actor publication', () => {
  for (const bytes of [Buffer.alloc(MAX_NFO_BYTES + 1), Buffer.from('<!DOCTYPE movie [<!ENTITY x SYSTEM "file:///secret">]><movie/>'),
    Buffer.from('<movie>' + '<actor><name>A</name></actor>'.repeat(257) + '</movie>'), Buffer.from('<movie><actor>')]) {
    const result = projectMovieNfoPersonObservations(bytes);
    assert.equal(result.usable, false);
    assert.deepEqual(result.actors, []);
  }
});


test('UAT-214 Arca observation fences Inventory changes and never reads primary payload or scans directories', () => {
  const {createOnDeckNfoPersonEvidence} = require('../../src/helix/domains/arca/application/on-deck-nfo-person-evidence');
  let revision=1, reads=0;
  const projection=createOnDeckNfoPersonEvidence({contextReader:{store:{currentContext:()=>({
    entry:{status:'active',current_inventory_revision:revision},shelf:{status:'active'},
    materials:[{ordinal:0,role:'primary_payload',location:'/movie.mkv'}, {ordinal:1,role:'metadata_sidecar',location:'/movie.nfo'}]})}},
    readBoundedFileSnapshotSync:location=>{assert.equal(location,'/movie.nfo');reads++;revision++;
      return {bytes:Buffer.from('<movie><actor><name>A</name></actor></movie>'),contentFingerprint:'a'.repeat(64)};}});
  assert.deepEqual(projection.observeEntry({shelfEntryId:'entry'}),{kind:'unavailable',reasonCode:'inventory_revision_changed',items:[]});
  assert.equal(reads,1);
});
