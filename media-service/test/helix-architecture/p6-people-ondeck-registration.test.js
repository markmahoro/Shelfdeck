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
const {seedCandidate,seedPerson}=require('./fixtures/people-state-fixture');
const {projectionItem}=require('../../src/helix/domains/arca/model/person-evidence-projection-item');
const {createSystemRegistrationCoordinator}=require('../../src/helix/domains/people/application/system-registration-coordinator');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const contractValidator=createCapabilityContractValidator({schemas:[require('../../src/helix/contracts/domain-types/OnDeckPersonEvidenceProjectionItem/v1/schema.json')]});
const { relationEvidenceDigest } = require('../../src/helix/domains/arca/application/on-deck-person-evidence-projection');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

test('UAT-214 current cast paging ignores 150 historical copies and preserves exact accepted weak evidence',()=>fixture(({store,unitOfWork,schemaManifest,kernel})=>{
  const {createOnDeckPersonEvidenceProjection}=require('../../src/helix/domains/arca/application/on-deck-person-evidence-projection');
  const {personRecordQuery}=require('../../src/helix/domains/arca/model/person-record-observation');
  kernel.runPrimitive(({prepare})=>{
    prepare("INSERT INTO arca_canonical_identity_revisions(shelf_entry_id,revision,identity_kind) VALUES('entry-history',1,'tmdb_movie')").run();
    prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,status,structure_kind,canonical_identity_revision) VALUES('entry-history','active','single',1)").run();
    for(let revision=1;revision<=150;revision++){
      prepare('INSERT INTO arca_inventory_representations(shelf_entry_id,revision) VALUES(?,?)').run('entry-history',revision);
      for(const id of ['cast-a','cast-b'])prepare('INSERT INTO arca_inventory_person_relations(relation_id,shelf_entry_id,inventory_revision,display_name,display_name_normalized,role,provider_identity_json,relation_digest) VALUES(?,?,?,?,?,?,?,?)')
        .run(id,'entry-history',revision,'Same Name','same name','actor','[]',canonicalDigest({id}));
    }
    prepare("UPDATE arca_shelf_entries SET current_inventory_revision=1 WHERE shelf_entry_id='entry-history'").run();
  });
  const projection=createOnDeckPersonEvidenceProjection({schemaManifest,unitOfWork}),people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:store});
  const original=projection.listPage({cursor:null,limit:1})[0].scope;
  const person=seedPerson(store,original,{historical:true});
  kernel.runPrimitive(({prepare})=>prepare("UPDATE arca_shelf_entries SET current_inventory_revision=150 WHERE shelf_entry_id='entry-history'").run());
  const first=projection.listPage({cursor:null,limit:1}),second=projection.listPage({cursor:first[0].cursor,limit:1});
  assert.equal(first[0].scope.inventoryRevision,150);assert.equal(first[0].scope.skipped,false);
  assert.equal(first[0].scope.evidenceDigest,original.evidenceDigest);
  assert.equal(second[0].scope.relationId,'cast-b');assert.equal(second[0].scope.inventoryRevision,150);
  assert.equal(projection.listPage({cursor:second[0].cursor,limit:1}).length,0);
  assert.equal(people.mediaCastReferenceQuery.resolve({libraryKind:'normal',personId:null,providerIdentities:[],evidenceDigest:first[0].scope.evidenceDigest}).personId,person.personId);
  assert.deepEqual(projection.read(first[0].scope.projectionItem),first[0].scope.projectionItem);assert.equal(projection.read(original.projectionItem),null);assert.equal(store.listRegistrationCandidates().length,1);
  const row=kernel.runPrimitive(({prepare})=>prepare("SELECT * FROM arca_inventory_person_relations WHERE relation_id='cast-a' AND inventory_revision=150").get());
  const linked=people.mediaCastReferenceQuery.resolve(personRecordQuery({...row,evidence_inventory_revision:1},'normal'));
  assert.equal(linked.personId,person.personId);assert.equal(linked.reasonCode,'accepted_origin_evidence');
  assert.equal(people.mediaCastReferenceQuery.resolve({libraryKind:'normal',personId:null,providerIdentities:[],evidenceDigest:second[0].scope.evidenceDigest}).kind,'unresolved');
  kernel.runPrimitive(({prepare})=>prepare("UPDATE arca_inventory_person_relations SET person_id=?,relation_digest=? WHERE relation_id='cast-a' AND inventory_revision=150").run(person.personId,canonicalDigest({linked:person.personId})));
  const bound=projection.listPage({cursor:null,limit:1})[0].scope;
  assert.equal(bound.personId,person.personId);assert.equal(people.mediaCastReferenceQuery.resolve({libraryKind:'normal',personId:bound.personId,providerIdentities:[]}).kind,'unchanged');
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
  const options={peopleStore:store,unitOfWork,schemaManifest,kernel,contractValidator,
    workResultReader:createWorkResultReader({unitOfWork,schemaManifest})};
  options.systemRegistration=createSystemRegistrationCoordinator(options);
  try { return run({...options,store}); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function scopeFor(key,ids=[],contentProfile='movie') {
  const scope={contentProfile,shelfEntryId:'entry-'+key,inventoryRevision:1,relationId:'relation-'+key,
    relationDigest:canonicalDigest({key}),originEvidenceDigest:null,displayName:'Same Name',displayNameNormalized:'same name',role:'actor',
    providerIdentities:ids,evidenceDigest:canonicalDigest({key,ids})};
  return {...scope,projectionItem:projectionItem(scope,'media_cast')};
}
function peopleFor(value,extra={}) {return createPeopleProcessServices({...value,peopleStore:value.store,...extra});}

test('strong and weak Evidence admit separate immutable Works without synchronous Person writes',()=>fixture(value=>{
  const people=peopleFor(value),strong=scopeFor('strong',[{provider:'tmdb',namespace:'person',providerKey:'12345'}]),weak=scopeFor('weak');
  const a=people.reconcile(strong),b=people.reconcile(weak);
  assert.equal(a.kind,'evidence_pending');assert.equal(b.kind,'evidence_pending');assert.notEqual(a.workId,b.workId);
  assert.equal(value.store.listPeople().length,0);assert.equal(value.store.listRegistrationCandidates().length,0);
  for(const [result,scope] of [[a,strong],[b,weak]]) {
    const work=value.workResultReader.readDefinition(result.workId).definition;
    assert.equal(work.ownerDomain,'people');assert.equal(work.workKind,'system_person_registration');
    assert.equal(work.executionBasisDigest,scope.projectionItem.projectionItemDigest);
    assert.equal(value.workResultReader.read(result.workId).length,0);
    assert.equal(people.reconcile(scope).workId,result.workId);
  }
  assert.throws(()=>people.acceptRegistration({},'admin'),{code:'PEOPLE_LIBRARY_READ_ONLY'});
}));

test('normal and JAV libraries reject user registration without publishing a Person', () => fixture(({store,unitOfWork,schemaManifest}) => {
  const people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:store});
  for(const libraryKind of ['normal','jav']) assert.throws(() => people.registerPerson({libraryKind,canonicalName:'Name'},'admin'), {code:'PEOPLE_LIBRARY_READ_ONLY'});
  assert.equal(store.listPeople().length,0);
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

test('shared provenance and identical names retain every strong and weak source as a separate Work',()=>fixture(value=>{
  const people=peopleFor(value),relations=Array.from({length:19},(_,i)=>scopeFor(String(i),i<16?
    [{provider:'tmdb',namespace:'person',providerKey:String(20000+i)}]:[]));
  const admitted=relations.map(scope=>people.reconcile(scope));
  assert.equal(new Set(admitted.map(item=>item.workId)).size,19);
  assert.equal(value.kernel.runPrimitive(({prepare})=>prepare('SELECT count(*) n FROM fx_supporting_works').get().n),19);
  assert.equal(value.store.listPeople().length,0);assert.equal(value.store.listRegistrationCandidates().length,0);
  relations.forEach((scope,i)=>assert.equal(people.reconcile(scope).workId,admitted[i].workId));
}));

test('exact Provider identity resolves across sources and coordinator restart within its library',()=>fixture(value=>{
  const first=scopeFor('first',[{provider:'tmdb',namespace:'person',providerKey:'424242'}]),
    second=scopeFor('second',first.providerIdentities),person=seedPerson(value.store,first);
  assert.equal(peopleFor(value).reconcile(second).personId,person.personId);
  const restarted=createSystemRegistrationCoordinator(value);
  assert.equal(restarted.reconcile(second).kind,'known');
  assert.equal(restarted.reconcile(scopeFor('jav',first.providerIdentities,'jav')).kind,'evidence_pending');
  assert.equal(value.store.listPeople().length,1);
}));

test('new On-deck evidence is visible and admitted immediately after an empty sweep', () => fixture(({ store, unitOfWork, schemaManifest,systemRegistration }) => {
  let page = [];
  const people = createPeopleProcessServices({
    schemaManifest, unitOfWork, peopleStore: store,systemRegistration,
    onDeckPersonEvidenceProjection: { listPage: () => page },
  });
  assert.deepEqual(people.listPage({ cursor: null, limit: 100 }), []);
  const base = { contentProfile: 'movie',
    relationId: 'relation-after-empty-sweep', shelfEntryId: 'entry-1', inventoryRevision: 1,
    relationDigest: canonicalDigest({ relationId: 'relation-after-empty-sweep' }),
    originEvidenceDigest: canonicalDigest({ source: 'movie-after-empty-sweep' }),
    displayName: '后到的人物证据', displayNameNormalized: '后到的人物证据', role: 'actor',
    providerIdentities: [{ provider: 'tmdb', namespace: 'tmdb_person', providerKey: '909090' }],
    identityStrength: 'strong',
  };
  const body={...base,evidenceDigest:relationEvidenceDigest(base)},scope=Object.freeze({...body,projectionItem:projectionItem(body,'media_cast')});
  page = [Object.freeze({ cursor: scope.relationId, scope })];
  assert.equal(people.listPage({ cursor: null, limit: 100 }).length, 1);
  assert.equal(people.reconcile(scope).kind, 'evidence_pending');
  assert.equal(store.listPeople().length, 0);
}));

test('periodic admission uses exact lookups and rejects forged Projection bytes',()=>fixture(value=>{
  const guardedStore={...value.store,listPeople(){throw Error('No registry scan');},listRegistrationCandidates(){throw Error('No candidate scan');}},
    coordinator=createSystemRegistrationCoordinator({...value,peopleStore:guardedStore}),strong=scopeFor('bounded',[{provider:'tmdb',namespace:'person',providerKey:'bounded'}]),weak=scopeFor('weak');
  for(const scope of [strong,weak]){const first=coordinator.reconcile(scope);assert.equal(first.kind,'evidence_pending');assert.equal(coordinator.reconcile(scope).workId,first.workId);}
  assert.throws(()=>coordinator.reconcile({...weak,projectionItem:{...weak.projectionItem,displayName:'Forged'}}),{code:'PEOPLE_SYSTEM_EVIDENCE_INVALID'});
  assert.equal(coordinator.reconcile(scopeFor('us',[],'western_adult')).kind,'user_owned_library');
  assert.throws(()=>projectionItem({...weak,contentProfile:'unknown'},'media_cast'),{code:'ARCA_PERSON_EVIDENCE_PROFILE_INVALID'});
}));

test('UAT-214 consumes bounded Arca NFO evidence and does not re-register unchanged content after an Inventory revision', () => fixture(({ store, unitOfWork, schemaManifest,systemRegistration,kernel }) => {
  const {createOnDeckNfoPersonEvidence} = require('../../src/helix/domains/arca/application/on-deck-nfo-person-evidence');
  let revision=1, reads=0, clock=1000;
  const raw=()=>({contentProfile:'movie',entry:{status:'active',current_inventory_revision:revision},shelf:{status:'active'},
    materials:[{ordinal:0,role:'primary_payload',location:'/movie.mkv'},
      {ordinal:1,role:'metadata_sidecar',location:'/movie.nfo',material_key:'physical'}]});
  const projection=createOnDeckNfoPersonEvidence({now:()=>clock,contextReader:{store:{
    currentNfoContext:()=>raw(),listEntryPage:()=>[{cursor:'entry',scope:{shelfEntryId:'entry'}}]}},
    readBoundedFileSnapshotSync:(location,bound)=>{
      assert.equal(location,'/movie.nfo');assert.equal(bound,262144);reads++;
      return {bytes:Buffer.from('<movie><actor><name>Strong Actor</name><tmdbid>987</tmdbid></actor><actor><name>Weak Actor</name></actor></movie>'),
        contentFingerprint:canonicalDigest({bytes:'nfo'}),stat:{size:100,ino:1,mtimeNs:1,ctimeNs:1}};
    }});
  const people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:store,systemRegistration,onDeckNfoPersonEvidence:projection});
  const scope=people.listNfoPage({cursor:null,limit:100})[0].scope;
  assert.deepEqual(people.reconcileNfoEntry(scope),{kind:'nfo_evidence_consumed',observedCount:2,registeredCount:0,pendingCount:0});
  const first=projection.observeEntry(scope).items;
  assert.equal(reads,1);
  people.reconcileNfoEntry(scope);assert.equal(reads,1);
  revision=2;people.reconcileNfoEntry(scope);assert.equal(reads,2);
  assert.equal(projection.observeEntry(scope).items[0].inventoryRevision,2);
  assert.equal(projection.observeEntry(scope).items[0].evidenceDigest,first[0].evidenceDigest);
  assert.equal(store.listPeople().length,0);assert.equal(store.listRegistrationCandidates().length,0);
  assert.equal(kernel.runPrimitive(({prepare})=>prepare('SELECT count(*) n FROM fx_supporting_works').get().n),2,'One live Work per source holds the concurrency scope.');
  assert.equal(systemRegistration.reconcile(projection.observeEntry(scope).items[0]).kind,'evidence_deferred');
  clock+=600001;people.reconcileNfoEntry(scope);assert.equal(reads,3);
}));


test('UAT-214 resolves only exact provider namespace or user-accepted origin, never a shared name', () => fixture(({store,unitOfWork,schemaManifest}) => {
  const people=createPeopleProcessServices({schemaManifest,unitOfWork,peopleStore:store});
  const person=seedPerson(store,{contentProfile:'movie',displayName:'Shared Name',shelfEntryId:'entry-exact',inventoryRevision:1,identityStrength:'strong',evidenceDigest:canonicalDigest({key:'10'}),providerIdentities:[{provider:'tmdb',namespace:'person',providerKey:'10'}]});
  const input={libraryKind:'normal',personId:null,providerIdentities:[{provider:'tmdb',namespace:'person',providerKey:'10'}],evidenceDigest:canonicalDigest({origin:'missing'})};
  const exact=people.mediaCastReferenceQuery.resolve(input);
  assert.equal(exact.kind,'resolved');assert.equal(exact.personId,person.personId);assert.equal(exact.reasonCode,'exact_provider_identity');
  assert.equal(exact.personRevision,1);assert.equal(exact.personFactDigest,person.revision.factDigest);
  assert.equal(people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[{provider:'tmdb',namespace:'movie',providerKey:'10'}]}).kind,'unresolved');
  const evidenceDigest=canonicalDigest({origin:'weak'});
  const candidate=seedCandidate(store,{contentProfile:'movie',displayName:'Shared Name',shelfEntryId:'entry',inventoryRevision:1,providerIdentities:[],identityStrength:'weak',evidenceDigest});
  assert.equal(people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[],evidenceDigest}).kind,'unresolved');
  const accepted=seedHistoricalAcceptance(store,candidate.candidateId);
  const linked=people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[],evidenceDigest});
  assert.equal(linked.kind,'resolved');assert.equal(linked.personId,accepted.personId);assert.equal(linked.reasonCode,'accepted_origin_evidence');
  assert.equal(people.mediaCastReferenceQuery.resolve({...input,providerIdentities:[],evidenceDigest:canonicalDigest({origin:'different'})}).kind,'unresolved');
}));

function seedHistoricalAcceptance(store,candidateId) {
  const candidate=store.getRegistrationCandidate(candidateId);
  const decision={decisionId:'historical-'+candidateId,candidateKind:'registration',candidateId,expectedCandidateRevision:candidate.currentRevision,candidatePayloadDigest:candidate.candidatePayloadDigest,decisionOrigin:'user',actorId:'historical-admin',newPersonId:'historical-person-'+candidateId};
  return store.acceptRegistrationCandidate({...decision,decisionDigest:canonicalDigest(decision)});
}

test('maintenance admission bounds outstanding People Work and reports capacity deferral without inventing a pending Work',()=>fixture(value=>{
  const people=peopleFor(value),admitted=Array.from({length:32},(_,i)=>people.reconcile(scopeFor('capacity-'+i)));
  assert.ok(admitted.every(item=>item.kind==='evidence_pending'));
  const next=people.reconcile(scopeFor('capacity-next'));
  assert.equal(next.kind,'evidence_deferred');assert.equal(Object.hasOwn(next,'workId'),false);
  assert.equal(value.kernel.runPrimitive(({prepare})=>prepare('SELECT count(*) n FROM fx_supporting_works').get().n),32);
}));
