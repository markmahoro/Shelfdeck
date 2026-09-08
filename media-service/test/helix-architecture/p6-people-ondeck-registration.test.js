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

test('UAT-214 current cast paging ignores 150 historical copies and preserves exact accepted weak evidence',()=>fixture(({store,unitOfWork,schemaManifest,kernel})=>{
  const {createOnDeckPersonEvidenceProjection}=require('../../src/helix/domains/arca/application/on-deck-person-evidence-projection');
  const {personRecordQuery}=require('../../src/helix/domains/arca/model/person-record-observation');
  kernel.runPrimitive(({prepare})=>{
    prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status) VALUES('entry-history','active')").run();
    for(let revision=1;revision<=150;revision++){
      prepare('INSERT INTO arca_inventory_representations(shelf_entry_id,revision) VALUES(?,?)').run('entry-history',revision);
      for(const id of ['cast-a','cast-b'])prepare('INSERT INTO arca_inventory_person_relations(relation_id,shelf_entry_id,inventory_revision,display_name,display_name_normalized,role,provider_identity_json,relation_digest) VALUES(?,?,?,?,?,?,?,?)')
        .run(id,'entry-history',revision,'Same Name','same name','actor','[]',canonicalDigest({id}));
    }
    prepare("UPDATE arca_shelf_entries SET current_inventory_revision=1 WHERE shelf_entry_id='entry-history'").run();
  });
  const projection=createOnDeckPersonEvidenceProjection({schemaManifest,unitOfWork}),people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:store});
  const original=projection.listPage({cursor:null,limit:1})[0].scope;
  const draft=people.reconcile(original),person=people.acceptRegistration({candidateId:draft.candidateId},'admin');
  kernel.runPrimitive(({prepare})=>prepare("UPDATE arca_shelf_entries SET current_inventory_revision=150 WHERE shelf_entry_id='entry-history'").run());
  const first=projection.listPage({cursor:null,limit:1}),second=projection.listPage({cursor:first[0].cursor,limit:1});
  assert.equal(first[0].scope.inventoryRevision,150);assert.equal(first[0].scope.skipped,false);
  assert.equal(first[0].scope.evidenceDigest,original.evidenceDigest);
  assert.equal(second[0].scope.relationId,'cast-b');assert.equal(second[0].scope.inventoryRevision,150);
  assert.equal(projection.listPage({cursor:second[0].cursor,limit:1}).length,0);
  assert.equal(people.reconcile(first[0].scope).kind,'known');assert.equal(store.listRegistrationCandidates().length,1);
  const row=kernel.runPrimitive(({prepare})=>prepare("SELECT * FROM arca_inventory_person_relations WHERE relation_id='cast-a' AND inventory_revision=150").get());
  const linked=people.mediaCastReferenceQuery.resolve(personRecordQuery({...row,evidence_inventory_revision:1}));
  assert.equal(linked.personId,person.personId);assert.equal(linked.reasonCode,'accepted_origin_evidence');
  assert.equal(people.mediaCastReferenceQuery.resolve({personId:null,providerIdentities:[],evidenceDigest:second[0].scope.evidenceDigest}).kind,'unresolved');
  kernel.runPrimitive(({prepare})=>prepare("UPDATE arca_inventory_person_relations SET person_id=?,relation_digest=? WHERE relation_id='cast-a' AND inventory_revision=150").run(person.personId,canonicalDigest({linked:person.personId})));
  const bound=projection.listPage({cursor:null,limit:1})[0].scope;
  assert.equal(bound.personId,person.personId);assert.equal(people.reconcile(bound).kind,'known');
  assert.equal(store.listRegistrationCandidates().length,1,'Linking the accepted Person must not create another weak candidate.');
  kernel.runPrimitive(({prepare})=>prepare("UPDATE arca_shelf_entries SET status='offdecked' WHERE shelf_entry_id='entry-history'").run());
  assert.equal(projection.listPage({cursor:null,limit:100}).length,0);
}));

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-people-ondeck-'));
  let clock = 1_700_040_000_000;
  const kernel = openSqliteKernel({
    Database, databasePath: path.join(root, 'shelfdeck.db'), schemaDdl, schemaManifest, now: () => clock++,
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createPeopleStore({ schemaManifest, unitOfWork });
  try { return run({ store, unitOfWork, schemaManifest, kernel }); }
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

test('new On-deck evidence is visible immediately after an empty sweep', () => fixture(({ store, unitOfWork, schemaManifest }) => {
  let page = [];
  const people = createPeopleProcessServices({
    schemaManifest, unitOfWork, peopleStore: store,
    onDeckPersonEvidenceProjection: { listPage: () => page },
  });
  assert.deepEqual(people.listPage({ cursor: null, limit: 100 }), []);
  const base = {
    relationId: 'relation-after-empty-sweep', shelfEntryId: 'entry-1', inventoryRevision: 1,
    relationDigest: canonicalDigest({ relationId: 'relation-after-empty-sweep' }),
    originEvidenceDigest: canonicalDigest({ source: 'movie-after-empty-sweep' }),
    displayName: '后到的人物证据', displayNameNormalized: '后到的人物证据', role: 'actor',
    providerIdentities: [{ provider: 'tmdb', namespace: 'tmdb_person', providerKey: '909090' }],
    identityStrength: 'strong',
  };
  const scope = Object.freeze({ ...base, evidenceDigest: relationEvidenceDigest(base) });
  page = [Object.freeze({ cursor: scope.relationId, scope })];
  assert.equal(people.listPage({ cursor: null, limit: 100 }).length, 1);
  assert.equal(people.reconcile(scope).kind, 'auto_accepted');
  assert.equal(store.listPeople().length, 1);
}));

test('periodic Person evidence reconciliation uses exact identity and evidence lookups', () => fixture(({ store, unitOfWork, schemaManifest }) => {
  const guardedStore=Object.freeze({...store,
    listPeople(){throw new Error('periodic reconciliation must not scan the Person Registry');},
    listRegistrationCandidates(){throw new Error('periodic reconciliation must not scan all Candidates');},
  });
  const people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:guardedStore,
    onDeckPersonEvidenceProjection:{listPage:()=>[]}});
  const strong=Object.freeze({displayName:'有界强身份',shelfEntryId:'entry-bounded',inventoryRevision:1,
    providerIdentities:[{provider:'tmdb',namespace:'person',providerKey:'bounded-1'}],
    evidenceDigest:canonicalDigest({kind:'bounded-strong'}),identityStrength:'strong'});
  const weak=Object.freeze({displayName:'有界弱身份',shelfEntryId:'entry-bounded',inventoryRevision:1,
    providerIdentities:[],evidenceDigest:canonicalDigest({kind:'bounded-weak'}),identityStrength:'weak'});
  assert.equal(people.reconcile(strong).kind,'auto_accepted');
  assert.equal(people.reconcile(strong).kind,'known');
  assert.equal(people.reconcile(weak).kind,'candidate_open');
  assert.equal(people.reconcile(weak).kind,'known');
}));


test('UAT-214 consumes bounded Arca NFO evidence and does not re-register unchanged content after an Inventory revision', () => fixture(({ store, unitOfWork, schemaManifest }) => {
  const {createOnDeckNfoPersonEvidence} = require('../../src/helix/domains/arca/application/on-deck-nfo-person-evidence');
  let revision=1, reads=0, clock=1000;
  const raw=()=>({entry:{status:'active',current_inventory_revision:revision},shelf:{status:'active'},
    materials:[{ordinal:0,role:'primary_payload',location:'/movie.mkv'},
      {ordinal:1,role:'metadata_sidecar',location:'/movie.nfo',material_key:'physical'}]});
  const projection=createOnDeckNfoPersonEvidence({now:()=>clock,contextReader:{store:{
    currentContext:()=>raw(),listEntryPage:()=>[{cursor:'entry',scope:{shelfEntryId:'entry'}}]}},
    readBoundedFileSnapshotSync:(location,bound)=>{
      assert.equal(location,'/movie.nfo');assert.equal(bound,262144);reads++;
      return {bytes:Buffer.from('<movie><actor><name>Strong Actor</name><tmdbid>987</tmdbid></actor><actor><name>Weak Actor</name></actor></movie>'),
        contentFingerprint:canonicalDigest({bytes:'nfo'}),stat:{size:100,ino:1,mtimeNs:1,ctimeNs:1}};
    }});
  const people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:store,onDeckNfoPersonEvidence:projection});
  const scope=people.listNfoPage({cursor:null,limit:100})[0].scope;
  assert.deepEqual(people.reconcileNfoEntry(scope),{kind:'nfo_evidence_consumed',observedCount:2,registeredCount:1,pendingCount:1});
  const first=projection.observeEntry(scope).items;
  assert.equal(reads,1);
  people.reconcileNfoEntry(scope);assert.equal(reads,1);
  revision=2;people.reconcileNfoEntry(scope);assert.equal(reads,2);
  assert.equal(projection.observeEntry(scope).items[0].inventoryRevision,2);
  assert.equal(projection.observeEntry(scope).items[0].evidenceDigest,first[0].evidenceDigest);
  assert.equal(store.listPeople().length,1);assert.equal(store.listRegistrationCandidates().length,2);
  clock+=600001;people.reconcileNfoEntry(scope);assert.equal(reads,3);
}));


test('UAT-214 resolves only exact provider namespace or user-accepted origin, never a shared name', () => fixture(({store,unitOfWork,schemaManifest}) => {
  const people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:store});
  const person=people.registerPerson({personId:'person-exact',canonicalName:'Shared Name',
    providerIdentities:[{provider:'tmdb',namespace:'person',providerKey:'10'}]},'admin');
  const input={personId:null,providerIdentities:[{provider:'tmdb',namespace:'person',providerKey:'10'}],evidenceDigest:canonicalDigest({origin:'missing'})};
  const exact=people.mediaCastReferenceQuery.resolve(input);
  assert.equal(exact.kind,'resolved');assert.equal(exact.personId,person.personId);assert.equal(exact.reasonCode,'exact_provider_identity');
  assert.equal(exact.personRevision,1);assert.equal(exact.personFactDigest,person.revision.factDigest);
  assert.equal(people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[{provider:'tmdb',namespace:'movie',providerKey:'10'}]}).kind,'unresolved');
  const evidenceDigest=canonicalDigest({origin:'weak'});
  const candidate=people.reconcile({displayName:'Shared Name',shelfEntryId:'entry',inventoryRevision:1,providerIdentities:[],identityStrength:'weak',evidenceDigest});
  assert.equal(people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[],evidenceDigest}).kind,'unresolved');
  const accepted=people.acceptRegistration({candidateId:candidate.candidateId},'admin');
  const linked=people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[],evidenceDigest});
  assert.equal(linked.kind,'resolved');assert.equal(linked.personId,accepted.personId);assert.equal(linked.reasonCode,'accepted_origin_evidence');
  assert.equal(people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[],evidenceDigest:canonicalDigest({origin:'different'})}).kind,'unresolved');
}));
