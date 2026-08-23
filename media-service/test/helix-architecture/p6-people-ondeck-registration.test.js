'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createPeopleStore } = require('../../src/helix/domains/people/persistence/people-store');
const { createPeopleProcessServices } = require('../../src/helix/domains/people/application/people-process-services');
const { relationEvidenceDigest } = require('../../src/helix/domains/arca/application/on-deck-person-evidence-projection');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-people-ondeck-'));
  let clock = 1_700_040_000_000;
  const kernel = openSqliteKernel({
    Database, databasePath: path.join(root, 'shelfdeck.db'), schemaDdl, schemaManifest, now: () => clock++,
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createPeopleStore({ schemaManifest, unitOfWork });
  try { return run({ store, unitOfWork, schemaManifest }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('strong On-deck Person Evidence is auto-accepted; weak Evidence stays open for the user', () => fixture(({ store, unitOfWork, schemaManifest }) => {
  const evidence = [
    Object.freeze({
      cursor: 'rel-strong',
      scope: Object.freeze({
        skipped: false,
        displayName: '强身份演员',
        shelfEntryId: 'entry-1',
        inventoryRevision: 1,
        providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: '12345' }],
        evidenceDigest: canonicalDigest({ kind: 'strong', key: '12345' }),
        identityStrength: 'strong',
      }),
    }),
    Object.freeze({
      cursor: 'rel-weak',
      scope: Object.freeze({
        skipped: false,
        displayName: '弱身份演员',
        shelfEntryId: 'entry-1',
        inventoryRevision: 1,
        providerIdentities: [],
        evidenceDigest: canonicalDigest({ kind: 'weak', name: '弱身份演员' }),
        identityStrength: 'weak',
      }),
    }),
  ];
  const people = createPeopleProcessServices({
    schemaManifest, unitOfWork, peopleStore: store,
    onDeckPersonEvidenceProjection: { listPage: () => evidence },
  });
  assert.equal(people.reconcile(evidence[0].scope).kind, 'auto_accepted');
  assert.equal(people.reconcile(evidence[1].scope).kind, 'candidate_open');
  assert.equal(store.listPeople().filter((item) => item.status === 'active').length, 1);
  assert.equal(store.listPeople()[0].revision.canonicalName, '强身份演员');
  const open = store.listRegistrationCandidates().filter((item) => item.currentState === 'open');
  assert.equal(open.length, 1);
  assert.equal(open[0].proposedName, '弱身份演员');
  people.acceptRegistration({ candidateId: open[0].candidateId }, 'admin');
  assert.equal(store.listPeople().filter((item) => item.status === 'active').length, 2);
  assert.equal(people.reconcile(evidence[0].scope).kind, 'known');
}));

test('direct registration writes the Person Registry and does not require On-deck Evidence', () => fixture(({ store, unitOfWork, schemaManifest }) => {
  const people = createPeopleProcessServices({ schemaManifest, unitOfWork, peopleStore: store, onDeckPersonEvidenceProjection: { listPage: () => [] } });
  const person = people.registerPerson({ canonicalName: '直接登记', aliases: ['Direct'] }, 'admin');
  assert.equal(person.revision.canonicalName, '直接登记');
  assert.equal(store.listPeople().length, 1);
}));

test('shared origin provenance produces one deterministic Evidence digest per Person relation', () => {
  const originEvidenceDigest = canonicalDigest({ kind: 'movie-nfo', source: 'movie-1' });
  const evidence = Array.from({ length: 16 }, (_, index) => ({
    shelfEntryId: 'entry-1',
    inventoryRevision: 1,
    relationId: `relation-${index + 1}`,
    relationDigest: canonicalDigest({ kind: 'person-relation', index }),
    originEvidenceDigest,
    displayName: `演员 ${index + 1}`,
    displayNameNormalized: `演员 ${index + 1}`,
    role: 'actor',
    providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: String(10_000 + index) }],
  }));
  const digests = evidence.map(relationEvidenceDigest);
  assert.equal(new Set(digests).size, 16);
  assert.equal(relationEvidenceDigest(evidence[0]), digests[0]);
});

test('shared source provenance registers every strong identity and keeps every weak identity as a separate Candidate', () => fixture(({ store, unitOfWork, schemaManifest }) => {
  const originEvidenceDigest = canonicalDigest({ kind: 'movie-nfo', source: 'movie-1' });
  const relations = [
    ...Array.from({ length: 16 }, (_, index) => ({
      relationId: `strong-${index + 1}`,
      displayName: `强身份演员 ${index + 1}`,
      providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: String(20_000 + index) }],
      identityStrength: 'strong',
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      relationId: `weak-${index + 1}`,
      displayName: `弱身份演员 ${index + 1}`,
      providerIdentities: [],
      identityStrength: 'weak',
    })),
  ].map((item) => {
    const relationDigest = canonicalDigest({ relationId: item.relationId, displayName: item.displayName });
    const base = {
      ...item,
      shelfEntryId: 'entry-1',
      inventoryRevision: 1,
      relationDigest,
      originEvidenceDigest,
      displayNameNormalized: item.displayName.toLocaleLowerCase(),
      role: 'actor',
    };
    return Object.freeze({ ...base, evidenceDigest: relationEvidenceDigest(base) });
  });
  const people = createPeopleProcessServices({
    schemaManifest, unitOfWork, peopleStore: store,
    onDeckPersonEvidenceProjection: { listPage: () => relations.map((scope) => ({ cursor: scope.relationId, scope })) },
  });
  const first = relations.map((scope) => people.reconcile(scope));
  assert.equal(first.filter((item) => item.kind === 'auto_accepted').length, 16);
  assert.equal(first.filter((item) => item.kind === 'candidate_open').length, 3);
  assert.equal(store.listPeople().filter((item) => item.status === 'active').length, 16);
  assert.equal(store.listRegistrationCandidates().filter((item) => item.currentState === 'open').length, 3);
  assert.ok(relations.every((scope) => people.reconcile(scope).kind === 'known'));
  assert.equal(store.listPeople().length, 16);
}));

test('the same Provider Person Identity remains idempotent across sources and service restart', () => fixture(({ store, unitOfWork, schemaManifest }) => {
  const scopeFor = (relationId, source) => {
    const base = {
      relationId,
      shelfEntryId: `entry-${source}`,
      inventoryRevision: 1,
      relationDigest: canonicalDigest({ relationId }),
      originEvidenceDigest: canonicalDigest({ source }),
      displayName: '同一人物',
      displayNameNormalized: '同一人物',
      role: 'actor',
      providerIdentities: [{ provider: 'tmdb', namespace: 'person', providerKey: '424242' }],
      identityStrength: 'strong',
    };
    return Object.freeze({ ...base, evidenceDigest: relationEvidenceDigest(base) });
  };
  const firstScope = scopeFor('relation-a', 'a');
  const secondScope = scopeFor('relation-b', 'b');
  const firstService = createPeopleProcessServices({ schemaManifest, unitOfWork, peopleStore: store, onDeckPersonEvidenceProjection: { listPage: () => [] } });
  assert.equal(firstService.reconcile(firstScope).kind, 'auto_accepted');
  assert.equal(firstService.reconcile(secondScope).kind, 'known');
  const restartedService = createPeopleProcessServices({ schemaManifest, unitOfWork, peopleStore: store, onDeckPersonEvidenceProjection: { listPage: () => [] } });
  assert.equal(restartedService.reconcile(secondScope).kind, 'known');
  assert.equal(store.listPeople().length, 1);
}));
