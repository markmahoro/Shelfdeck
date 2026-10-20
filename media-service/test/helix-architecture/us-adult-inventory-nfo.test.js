'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { renderUsAdultInventoryNfo, projectMovieNfoSemantics } = require('../../src/helix/domains/arca/model/aftercare-nfo');
function input() {
  return { metadata:{ descriptiveFacts:{ entries:[{ key:'title',value:'New Actor Original & Scene' },{ key:'plot',value:'Frozen description' }] } },
    actor:{ personId:'actor-new',role:'actor',displayName:'New Actor',providerIdentities:[] },existingBytes:null };
}
test('US actor refresh replaces all previous direct actors while retaining other NFO fields and nested extension content', () => {
  const value = input();value.existingBytes = Buffer.from('<movie><title>Old Actor Original</title>' +
    '<actor><name>Old Actor</name><thumb>old.jpg</thumb></actor><actor><name>Wrong Actor</name></actor>' +
    '<userrating>9</userrating><custom><actor>Extension value</actor></custom><uniqueid type="private">persistent-content-id</uniqueid></movie>');
  const result = renderUsAdultInventoryNfo(value), xml = result.bytes.toString('utf8'), semantics = projectMovieNfoSemantics(result.bytes);
  assert.equal(result.disposition,'update');assert.equal(semantics.usable,true);
  assert.deepEqual(semantics.actors.map(actor=>actor.name),['New Actor']);
  assert.deepEqual(semantics.fields.title,['New Actor Original & Scene']);
  assert.ok(xml.includes('<userrating>9</userrating>'));assert.ok(xml.includes('<custom><actor>Extension value</actor></custom>'));
  assert.ok(xml.includes('<uniqueid type="private">persistent-content-id</uniqueid>'));assert.ok(!xml.includes('old.jpg'));
  assert.deepEqual(renderUsAdultInventoryNfo({...value,existingBytes:result.bytes}).bytes,result.bytes);
});
test('US NFO creation and damaged-source rebuild require no invented provider identifier', () => {
  const value=input(), created=renderUsAdultInventoryNfo(value), rebuilt=renderUsAdultInventoryNfo({...value,existingBytes:Buffer.from('<movie><broken>')});
  assert.equal(created.disposition,'create');assert.equal(rebuilt.disposition,'rebuild');assert.deepEqual(rebuilt.bytes,created.bytes);
  assert.equal(projectMovieNfoSemantics(created.bytes).actors.length,1);assert.ok(!created.bytes.toString('utf8').includes('uniqueid'));
});
test('US NFO rejects unresolved actors, provider identities and a missing frozen title', () => {
  const value=input();assert.throws(()=>renderUsAdultInventoryNfo({...value,actor:{...value.actor,personId:null}}),{code:'ARCA_US_ADULT_NFO_ACTOR_INVALID'});
  assert.throws(()=>renderUsAdultInventoryNfo({...value,actor:{...value.actor,providerIdentities:[{provider:'tmdb',providerKey:'123'}]}}),{code:'ARCA_US_ADULT_NFO_ACTOR_INVALID'});
  assert.throws(()=>renderUsAdultInventoryNfo({...value,metadata:{entries:[]}}),{code:'ARCA_US_ADULT_NFO_TITLE_REQUIRED'});
});
