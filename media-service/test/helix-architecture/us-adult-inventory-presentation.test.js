'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { canonicalDigest: D } = require('../../src/helix/contracts/canonical-json');
const { originalNameProvenance } = require('../../src/helix/contracts/us-adult-presentation');
const { readUsAdultInventoryPresentation, buildUsAdultInventoryPresentation } = require('../../src/helix/domains/arca/model/us-adult-inventory-presentation');
const { assertUsAdultInventoryPresentation } = require('../../src/helix/contracts/us-adult-inventory-presentation');
const { metadataIdentity } = require('../../src/helix/domains/arca/model/aftercare-placement');

const {fixture} = require('./fixtures/us-adult-inventory-context');

test('Aftercare names from its current frozen actor and first original filename without consulting People or mutable titles', () => {
  const context = fixture(), before = structuredClone(context), result = readUsAdultInventoryPresentation(context);
  assert.equal(result.title, 'Current Actor Studio.Scene.1080p');
  assert.equal(result.actor.personId, 'person');
  assert.equal(result.inventoryRevision, 2);
  assert.deepEqual(metadataIdentity(context), { title: result.title, year: null });
  assert.deepEqual(context, before);
  assert.equal(result.originalName.originalFileName, 'Studio.Scene.1080p.mp4');
});

for (const [name, change] of [
  ['another Entry', c => { c.shelfEntryId = 'other'; }],
  ['ended Entry', c => { c.raw.entry.status = 'offdeck'; }],
  ['a different canonical identity', c => { c.raw.identity.identity_digest = D('other content'); }],
  ['historical relation index', c => { c.raw.people[0].inventory_revision = 1; }],
  ['different actor in the index', c => { c.raw.people[0].person_id = 'other'; }],
  ['different display name in the index', c => { c.raw.people[0].display_name = 'Live People rename'; }],
  ['stale relation proof', c => { c.raw.people[0].relation_digest = D('wrong'); }],
  ['missing actor', c => { c.raw.people = []; }],
  ['multiple actors', c => { c.raw.people.push({ ...c.raw.people[0], person_id: 'other' }); }],
  ['duplicate original naming key', c => { const entries = c.raw.facts[0].value.resolvedProductIdentity.displayIdentity.entries; entries.push(entries[1]); }],
  ['lost original proof', c => { c.raw.facts[0].value.resolvedProductIdentity.displayIdentity.entries.pop(); }],
  ['original name substitution', c => { c.raw.facts[0].value.resolvedProductIdentity.displayIdentity.entries[1].value = 'Previous Actor Renamed.mkv'; }],
  ['different cast Fact', c => { c.raw.facts[2].value.relationsDigest = D('other'); }],
  ['duplicate cast Fact', c => { c.raw.facts.push(c.raw.facts[2]); }],
]) test('Aftercare rejects ' + name + ' instead of deriving identity from a current filename', () => {
  const context = fixture(); change(context);
  assert.throws(() => readUsAdultInventoryPresentation(context), { code: 'ARCA_US_ADULT_PRESENTATION_INVALID' });
});

test('Movie placement continues to use its resolved display identity', () => {
  const context = fixture(); context.raw.identity.identity_kind = 'tmdb_movie';
  assert.deepEqual(metadataIdentity(context), { title: 'Initial title', year: null });
});

test('Inventory naming proof freezes its Owner scope and rejects a different Case, original name or changed actor', () => {
  const context = fixture(), value = buildUsAdultInventoryPresentation(context, 'case'), scope = { shelfEntryId: 'entry', aftercareCaseId: 'case' };
  assert.equal(assertUsAdultInventoryPresentation(value, scope), value);
  assert.equal(value.personId, 'person');
  assert.throws(() => assertUsAdultInventoryPresentation(value, { ...scope, aftercareCaseId: 'other' }), { code: 'ARCA_US_ADULT_PRESENTATION_SCOPE_INVALID' });
  assert.throws(() => assertUsAdultInventoryPresentation(value, { ...scope, originalName: originalNameProvenance('New name.mkv') }), { code: 'ARCA_US_ADULT_PRESENTATION_SCOPE_INVALID' });
  assert.throws(() => assertUsAdultInventoryPresentation({ ...value, actorName: 'Substituted actor' }, scope), { code: 'ARCA_US_ADULT_PRESENTATION_SCOPE_INVALID' });
});
