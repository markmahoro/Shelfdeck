'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-person-catalog-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;
const people = require('../src/personCatalogStore');
const objectivePolicy = require('../src/kairoxObjectivePolicy');
const objectiveResolver = require('../src/lifecycleObjectiveResolver');

test.after(() => {
  people.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('stable provider identities merge automatically while names only create candidates', () => {
  const first = people.observeSubjectPeople({
    subjectId: 'media-1', metadataRevision: '1',
    people: [{ name: 'Actor One', role: 'actor', providerIds: { 'emby:server-a': 'person-10' }, contentKinds: ['general'] }],
  });
  const second = people.observeSubjectPeople({
    subjectId: 'media-2', metadataRevision: '2',
    people: [{ name: 'Actor 1', role: 'actor', providerIds: { 'emby:server-a': 'person-10' }, contentKinds: ['general'] }],
  });
  assert.deepStrictEqual(second.actorPersonIds, first.actorPersonIds);

  people.observeSubjectPeople({ subjectId: 'media-3', people: [{ name: 'Actor One', role: 'actor', sourceKeys: ['another-provider'] }] });
  const catalog = people.listPeople({ limit: 20 });
  assert.strictEqual(catalog.total, 2);
  assert.strictEqual(people.getMergeCandidates().length, 1);
});

test('preference revisions and item projections use the five-level model', () => {
  const personId = people.getSubjectPreferenceProjection('media-1').actorPersonIds[0];
  const before = people.getPerson(personId);
  const updated = people.updatePerson(personId, { preference: 2 });
  assert.strictEqual(updated.preference, 2);
  assert.strictEqual(updated.preferenceRevision, before.preferenceRevision + 1);
  assert.deepStrictEqual(people.getSubjectPreferenceProjection('media-1'), {
    actorPersonIds: [personId], actorPeople: [{ personId, name: updated.name, preference: 2 }], actorPreferenceMax: 2, actorPreferenceMin: 2,
  });
  assert.throws(() => people.updatePerson(personId, { preference: 3 }), /between -2 and 2/);
  const classified = people.updatePerson(personId, { contentKinds: ['general', 'adult'] });
  assert.deepStrictEqual(classified.contentKinds, ['general', 'adult']);
});

test('confirmed merge preserves target identity and moves media relations', () => {
  const candidate = people.getMergeCandidates()[0];
  const result = people.mergePeople({ targetPersonId: candidate.left.personId, sourcePersonId: candidate.right.personId, preference: -1 });
  assert.strictEqual(result.person.personId, candidate.left.personId);
  assert.strictEqual(result.person.preference, -1);
  assert.ok(result.affectedItemIds.includes('media-3'));
  assert.strictEqual(people.getPerson(candidate.right.personId), null);
});

test('Person Catalog applies search, classification and pagination in the Store query', () => {
  people.createPerson({ name: 'Catalog Alpha', aliases: ['Needle Alias'], contentKinds: ['adult'] });
  people.createPerson({ name: 'Catalog Beta', contentKinds: ['general'] });
  const page = people.listPeople({ limit: 1, offset: 1 });
  assert.strictEqual(page.people.length, 1);
  assert.ok(page.total >= 3);
  const search = people.listPeople({ search: 'needle alias', limit: 10 });
  assert.strictEqual(search.total, 1);
  assert.strictEqual(search.people[0].name, 'Catalog Alpha');
  const adult = people.listPeople({ contentKind: 'adult', limit: 10 });
  assert.ok(adult.people.some((person) => person.name === 'Catalog Alpha'));
  assert.ok(adult.people.every((person) => person.contentKinds.includes('adult')));
});

test('actor rules are explicit policy inputs and no actor rule keeps the objective unchanged', () => {
  const actorId = people.getSubjectPreferenceProjection('media-1').actorPersonIds[0];
  const actorRule = { priority: 10, groupsConnector: 'and', groups: [{ connector: 'and', conditions: [['actorPersonIds', 'overlap', [actorId]], ['actorPreferenceMax', '>=', -1]] }], targetMediaFacts: { qualityTier: 'premium', targetCodec: 'h265' }, reason: 'actor preference' };
  const baseline = { priority: 0, groups: [], targetMediaFacts: { qualityTier: 'standard', targetCodec: 'h265' }, reason: 'baseline' };
  const config = { subLibraries: [{ uuid: 'library', ruleTemplateId: 'with-actor' }], ruleTemplates: [{ id: 'with-actor', rules: [baseline, actorRule] }] };
  const selected = objectivePolicy.applyObjectivePolicy({ subjectId: 'media-1', subLibraryId: 'library', actorPersonIds: [actorId], actorPreferenceMax: -1, actorPreferenceMin: -1 }, config);
  assert.strictEqual(selected.targetMediaFacts.qualityTier, 'premium');

  const noActorConfig = { subLibraries: [{ uuid: 'library', ruleTemplateId: 'plain' }], ruleTemplates: [{ id: 'plain', rules: [baseline] }] };
  const common = { subjectId: 'media-1', subLibraryId: 'library', metadataComplete: true, targetMediaFacts: baseline.targetMediaFacts };
  const before = objectiveResolver.projectOptimizeObjective({ ...common, actorPreferenceMax: 0, actorPreferenceMin: 0 }, { config: noActorConfig });
  const after = objectiveResolver.projectOptimizeObjective({ ...common, actorPreferenceMax: 2, actorPreferenceMin: 2 }, { config: noActorConfig });
  assert.strictEqual(after.objectiveHash, before.objectiveHash);
  assert.deepStrictEqual(after.optimizeObjective, before.optimizeObjective);
});
