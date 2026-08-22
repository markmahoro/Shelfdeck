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
