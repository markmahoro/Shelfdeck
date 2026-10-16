'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createPerceptionResolutionQuery } = require('../../src/helix/domains/perception/application/perception-resolution-query');
const { createPerceptionResolutionInputAssembler } = require('../../src/helix/domains/perception/application/perception-resolution-input-assembler');
const { buildRuleSnapshot } = require('../../src/helix/domains/perception/application/perception-resolution-application');
const { createPerceptionProcessServices, queryFor, queryHandle } = require('../../src/helix/domains/perception/application/perception-process-services');
const { createPerceptionResolutionCommitRegistration } = require('../../src/helix/domains/perception/capabilities/perception-resolution-lifecycle');
const { resolvePerception } = require('../../src/helix/domains/perception/capabilities/perception-resolution-resolver');
const { createPerceptionStore } = require('../../src/helix/domains/perception/persistence/perception-store');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('persisted corrected JAV queries isolate foreign direct targets and old shared identity for both facts',()=>{
  fixture(({store})=>{
    const {ORIGIN_SCHEMA,CONTINUITY_SCHEMA}=require('../../src/helix/contracts/jav-perception-continuity');
    const originBody={schemaRef:ORIGIN_SCHEMA,schemaVersion:1,onDeckPackageId:'package',packageRevision:1,packageDigest:hash('package'),subjectId:'accepted',libraRunId:'run',shelfId:'shelf'},
      origin={...originBody,originDigest:canonicalDigest(originBody)},proofBody={schemaRef:CONTINUITY_SCHEMA,schemaVersion:1,shelfEntryId:'entry',shelfId:'shelf',canonicalIdentityRevision:2,canonicalIdentityDigest:hash('canonical'),correctionId:'correction',committedContextDigest:hash('context'),identityCommitReceiptDigest:hash('receipt'),originalOnDeckCommitDigest:hash('commit'),acceptedSubjectOrigin:origin},
      target={targetType:'shelf_entry',targetId:'entry',targetRevision:2,title:'Same title',year:null,providerIdentity:'jav:IPX-178',canonicalIdentityDigest:proofBody.canonicalIdentityDigest,javPerceptionContinuity:{...proofBody,continuityDigest:canonicalDigest(proofBody)}};
    const anchor=(kind,value)=>({anchorKind:kind,anchorValue:value,confidenceClass:kind==='title'?'medium':kind==='provider_identity'?'strong':'exact',evidenceDigest:hash(kind+value)});
    register(store);start(store);
    page(store,{records:[record('old-shared',{rating:5,watchedState:false,anchors:[anchor('provider_identity','jav:IPX-177'),anchor('title','same title')]}),
      record('current-shared',{rating:2,watchedState:false,anchors:[anchor('provider_identity','jav:IPX-178')]})]});
    store.registerSource({perceptionSourceId:'direct',sourceKind:'shelfdeck_direct',integrationId:'direct-input',status:'active',configRevision:1});
    start(store,{perceptionAcquisitionId:'direct-acquisition',perceptionSourceId:'direct'});
    page(store,{perceptionAcquisitionId:'direct-acquisition',perceptionSourceId:'direct',acquisitionCommitReceiptId:'direct-receipt',commitMarker:'direct-marker',records:[
      record('accepted-record',{sourceKind:'shelfdeck_direct',rating:4,watchedState:true,anchors:[anchor('subject_id','accepted'),anchor('provider_identity','jav:IPX-177'),anchor('title','same title')]}),
      record('foreign-record',{sourceKind:'shelfdeck_direct',rating:1,watchedState:false,anchors:[anchor('shelf_entry_id','foreign'),anchor('provider_identity','jav:IPX-178'),anchor('title','same title')]})]});
    const before=store.getRecord('accepted-record'),assembler=createPerceptionResolutionInputAssembler({store}),ruleSnapshot=buildRuleSnapshot();
    for(const kind of ['rating','watched']){const query=queryFor(target,kind),input=assembler.assemble({queryHandle:queryHandle(query,1,'arca'),ruleSnapshot}),result=resolvePerception(input,{draftId:'draft-'+kind,producedAtMs:1_700_010_000_100});
      assert.equal(result.winningPerceptionId,'accepted-record');assert.equal(result.resolvedValue.value,kind==='rating'?4:true);assert.deepEqual(result.duplicateRelationDrafts,[]);
    }
    assert.deepEqual(store.getRecord('accepted-record'),before);
  });
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-perception-store-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_010_000_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createPerceptionStore({ schemaManifest, unitOfWork });
  try { return run({ databasePath, store, unitOfWork }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function register(store, id = 'source-1') {
  return store.registerSource({
    perceptionSourceId: id, sourceKind: 'douban', integrationId: 'integration-douban', status: 'active', configRevision: 1
  });
}

function start(store, overrides = {}) {
  const scope = overrides.scope || { collection: 'watched', locale: 'zh-CN' };
  return store.startAcquisition({
    perceptionAcquisitionId: 'acquisition-1', perceptionSourceId: 'source-1', sourceConfigRevision: 1,
    scopeSchemaRef: 'helix://contracts/types/PerceptionAcquisitionScope/v1', scope, scopeDigest: canonicalDigest(scope),
    ...overrides, scope
  });
}

function record(id, overrides = {}) {
  return {
    perceptionId: id, recordKind: 'observation', sourceKind: 'douban', sourceRecordKey: id,
    sourceRecordRevision: 1, sourceRecordDigest: hash(id + ':source'), normalizationRuleRef: 'douban-normalize@1',
    rating: 5, watchedState: true, observedTitle: 'Example ' + id, provenanceRef: 'page:' + id,
    provenanceDigest: hash(id + ':provenance'), observedAtMs: 1_700_000_000_000,
    anchors: [{ anchorKind: 'provider_id', anchorValue: 'douban:' + id, confidenceClass: 'strong', evidenceDigest: hash(id + ':anchor') }],
    ...overrides
  };
}

function page(store, overrides = {}) {
  const records = overrides.records || [record('perception-1')];
  return store.commitPage({
    acquisitionCommitReceiptId: 'commit-1', perceptionAcquisitionId: 'acquisition-1', perceptionSourceId: 'source-1',
    pageOrdinal: 0, expectedCursorRevision: 0, cursorIn: null, cursorOut: 'cursor-1',
    observationPageDigest: hash('page-1'), hasMore: false, commitMarker: 'marker-1',
    records, relations: [], ...overrides, records
  });
}

function count(databasePath, table) {
  const database = new Database(databasePath, { readonly: true });
  try { return database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count; }
  finally { database.close(); }
}

function boundedRatingReads(unitOfWork, calls) {
  return {execute(parts){return unitOfWork.execute(parts.map(part=>({...part,execute(context){
    return part.execute({...context,repository(id){const repo=context.repository(id);return {...repo,invoke(name,parameters){
      assert.ok(!['list_heads','list_resolutions','find_anchors_by_kind','list_relations'].includes(name),'Rating reads must not scan unrelated history.');
      if(parameters.values){assert.ok(parameters.values.length<=500);calls.push({name,values:parameters.values});}
      return repo.invoke(name,parameters);
    }}}});
  }})));}};
}

test('batch rating reads retain retractions and missing targets across bounded pages',()=>{
  fixture(({store,unitOfWork})=>{
    register(store);start(store);
    const anchors=[{anchorKind:'subject_id',anchorValue:'subject-rated',confidenceClass:'exact',evidenceDigest:hash('subject-rated')}];
    page(store,{records:[record('rated',{anchors}),record('unrelated')]});
    start(store,{perceptionAcquisitionId:'acquisition-2',scope:{collection:'new-page'}});
    page(store,{acquisitionCommitReceiptId:'commit-2',perceptionAcquisitionId:'acquisition-2',expectedCursorRevision:1,
      cursorIn:null,cursorOut:'cursor-2',commitMarker:'marker-2',records:[record('retracted',{recordKind:'retraction',
        sourceRecordKey:'rated',sourceRecordRevision:2,rating:null,anchors})],
      relations:[{relationId:'retract-rated',relationKind:'retracts',sourcePerceptionId:'retracted',targetPerceptionId:'rated',
        ruleRevision:1,evidenceDigest:hash('retract-rated')}]});
    const expected=store.findCurrentTargetRating('subject','subject-rated'),calls=[];
    const limited=createPerceptionStore({schemaManifest,unitOfWork:boundedRatingReads(unitOfWork,calls)});
    const ids=['subject-rated',...Array.from({length:600},(_,index)=>'missing-'+index)];
    const result=limited.findCurrentTargetRatings('subject',ids);
    assert.deepEqual(result.get('subject-rated'),expected);
    assert.equal(result.get('subject-rated').rating,null);
    assert.equal(result.get('missing-599'),null);
    assert.equal(result.size,ids.length);
    assert.equal(calls.filter(call=>call.name==='find_anchor_targets').length,2);
  });
});

test('batch target ratings read complete Records and Anchors in bounded groups and retain digest validation',()=>{
  fixture(({store,unitOfWork,databasePath})=>{
    register(store);start(store);
    const ids=Array.from({length:501},(_,index)=>'target-'+index);
    const records=ids.map((id,index)=>record('rating-'+index,{anchors:[
      {anchorKind:'title',anchorValue:'中文 '+index,confidenceClass:'weak',evidenceDigest:hash('title:'+index)},
      {anchorKind:'shelf_entry_id',anchorValue:id,confidenceClass:'exact',evidenceDigest:hash(id)},
      {anchorKind:'title',anchorValue:'English '+index,confidenceClass:'weak',evidenceDigest:hash('alias:'+index)},
    ]}));
    page(store,{records:[...records,record('unrelated')]});
    const expected=new Map(ids.map((id,index)=>[id,store.getRecord('rating-'+index)]));
    const calls=[],limited=createPerceptionStore({schemaManifest,unitOfWork:{execute(parts){return unitOfWork.execute(parts.map(part=>({
      ...part,execute(context){return part.execute({...context,repository(id){const repo=context.repository(id);return {...repo,
        invoke(name,parameters){assert.ok(!['find_record','find_anchors','list_records','list_anchors'].includes(name));
          if(parameters.values)assert.ok(parameters.values.length<=500);calls.push(name);return repo.invoke(name,parameters);}};}});},
    })));}}});
    const result=limited.findCurrentTargetRatings('shelf_entry',[...ids,ids[0],'missing']);
    for(const id of ids)assert.deepEqual(result.get(id),expected.get(id));
    assert.equal(result.get('missing'),null);
    assert.equal(result.size,502);
    assert.equal(calls.filter(name=>name==='find_records_many').length,2);
    assert.equal(calls.filter(name=>name==='find_anchors_many').length,2);
    assert.equal(calls.length,8);
    const database=new Database(databasePath);
    try{
      database.prepare('UPDATE perception_records SET rating=1 WHERE perception_id=?').run('unrelated');
      assert.deepEqual(limited.findCurrentTargetRatings('shelf_entry',[ids[0]]).get(ids[0]),expected.get(ids[0]));
      database.prepare('UPDATE perception_records SET rating=1 WHERE perception_id=?').run('rating-0');
      assert.throws(()=>limited.findCurrentTargetRatings('shelf_entry',[ids[0]]),{code:'P6_PERCEPTION_RECORD_DIGEST_MISMATCH'});
    }finally{database.close();}
  });
});

test('binds exactly two Owner repositories to all nine Perception tables', () => {
  fixture(({ store }) => {
    assert.deepEqual(store.repositoryManifest.components, [
      {
        component: 'PerceptionRecordRepository', repositoryId: 'perception_record_repository',
        tableIds: ['perception_acquisition_commits', 'perception_acquisitions', 'perception_identity_anchors',
          'perception_record_relations', 'perception_records', 'perception_source_cursors', 'perception_sources']
      },
      {
        component: 'PerceptionResolutionRepository', repositoryId: 'perception_resolution_repository',
        tableIds: ['perception_resolution_heads', 'perception_resolution_revisions']
      }
    ]);
  });
});

test('starts Source without a phantom cursor and freezes exact config, scope and cursor basis', () => {
  fixture(({ store }) => {
    const source = register(store);
    assert.equal(source.currentCursorRevision, null);
    const acquisition = start(store);
    assert.equal(acquisition.initialCursorRevision, 0);
    assert.equal(acquisition.initialCursorValue, null);
    assert.equal(acquisition.scopeJson, '{"collection":"watched","locale":"zh-CN"}');
    assert.throws(() => start(store, { perceptionAcquisitionId: 'acquisition-stale', sourceConfigRevision: 2 }),
      (error) => error.code === 'P6_PERCEPTION_ACQUISITION_BASIS_STALE');
    assert.throws(() => start(store, { perceptionAcquisitionId: 'acquisition-bad-scope', scopeDigest: hash('wrong') }),
      (error) => error.code === 'P6_PERCEPTION_SCOPE_DIGEST_MISMATCH');
  });
});

test('permits only one active Acquisition per Source and permits a new one after terminal commit', () => {
  fixture(({ store }) => {
    register(store); start(store);
    assert.throws(() => start(store, { perceptionAcquisitionId: 'acquisition-overlap' }),
      (error) => error.code === 'SQLITE_CONSTRAINT_UNIQUE');
    page(store);
    assert.equal(store.getAcquisition('acquisition-1').state, 'completed');
    const nextScope = { collection: 'ratings' };
    const next = start(store, {
      perceptionAcquisitionId: 'acquisition-2', scope: nextScope, scopeDigest: canonicalDigest(nextScope)
    });
    assert.equal(next.initialCursorRevision, 1);
    assert.equal(next.initialCursorValue, null);
  });
});

test('inherits a compatible persisted Source cursor after restart and resets only an incompatible scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-perception-resume-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let now = 1_700_020_000_000;
  const open = () => {
    const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    return { kernel, unitOfWork, store:createPerceptionStore({ schemaManifest, unitOfWork }) };
  };
  const scope = { mode:'provider', collection:'watched_movies', sourceId:'source-1', acquisitionWindow:{ kind:'full_snapshot', openedAtMs:1 } };
  let opened = open();
  try {
    register(opened.store);
    start(opened.store, { scope, scopeDigest:canonicalDigest(scope) });
    page(opened.store, { cursorOut:'435', hasMore:true });
    opened.store.failAcquisition('acquisition-1');
  } finally { opened.kernel.close(); }
  opened = open();
  try {
    const services = createPerceptionProcessServices({ schemaManifest, unitOfWork:opened.unitOfWork,
      perceptionStore:opened.store, now:() => now++,
      readDoubanSourceConfiguration:() => ({ sourceId:'source-1', integrationId:'integration-douban', configRevision:1 }),
      workResultReader:{ status:() => null },
      targetProjectionReader:() => ({ title:'Example', year:1994, providerIdentity:null,
        targetRevision:1, targetDigest:hash('target') }) });
    assert.deepEqual(services.syncState(),{
      latest:opened.store.getAcquisition('acquisition-1'),activeCount:0,completionState:'incomplete',lastCursorOut:'435',
      cursorRevision:1,committedPageCount:1,recordCount:1,
    });
    const resumedRequest = services.requestAcquisition({ idempotencyKey:'restart-after-403' });
    const resumed = opened.store.getAcquisition(resumedRequest.operationRef);
    assert.equal(resumed.initialCursorRevision, 1);
    assert.equal(resumed.initialCursorValue, '435');
    assert.equal(resumed.scopeDigest, canonicalDigest(scope));
    assert.equal(services.acquisitionContext(resumedRequest.operationRef).cursorIn, '435');
    assert.equal(services.syncState().completionState,'in_progress');
    opened.store.failAcquisition(resumedRequest.operationRef);
    const changedScope = { ...scope, acquisitionWindow:{ kind:'full_snapshot', openedAtMs:2 } };
    const reset = start(opened.store, { perceptionAcquisitionId:'acquisition-3', scope:changedScope, scopeDigest:canonicalDigest(changedScope) });
    assert.equal(reset.initialCursorRevision, 1);
    assert.equal(reset.initialCursorValue, null);
    opened.store.failAcquisition('acquisition-3');
    opened.store.reviseSource({ perceptionSourceId:'source-1', sourceKind:'douban',
      integrationId:'integration-douban', status:'active', configRevision:2 }, 1);
    const revised = start(opened.store, { perceptionAcquisitionId:'acquisition-4',
      sourceConfigRevision:2, scope, scopeDigest:canonicalDigest(scope) });
    assert.equal(revised.initialCursorRevision, 1);
    assert.equal(revised.initialCursorValue, null);
  } finally { opened.kernel.close(); fs.rmSync(root, { recursive:true, force:true }); }
});

test('provider retry reuses the failed stable scope without idempotency-key pollution', () => {
  fixture(({ store, unitOfWork }) => {
    const statuses = new Map(); let now = 1_700_030_000_000;
    const services = createPerceptionProcessServices({ schemaManifest, unitOfWork, perceptionStore:store,
      now:() => now++, readDoubanSourceConfiguration:() => ({ sourceId:'source-1', integrationId:'integration-douban', configRevision:1 }),
      workResultReader:{ status:(workId) => statuses.get(workId) || null },
      targetProjectionReader:() => ({ title:'Example', year:1994, providerIdentity:null, targetRevision:1, targetDigest:hash('target') }) });
    const first = services.requestAcquisition({ idempotencyKey:'first-http-command' });
    const firstAcquisition = store.getAcquisition(first.operationRef), scope = JSON.parse(firstAcquisition.scopeJson);
    assert.equal(Object.hasOwn(scope, 'idempotencyKey'), false);
    page(store, { perceptionAcquisitionId:first.operationRef, cursorOut:'435', hasMore:true });
    const failingPage = services.reconcileAcquisition(first.operationRef);
    statuses.set(failingPage.workId, { state:'failed', latestAttempt:{ failure_code:'P5_PROVIDER_TRANSPORT_FAILED' } });
    services.reconcileAcquisition(first.operationRef);
    const resumed = services.requestAcquisition({ idempotencyKey:'resume-after-403' });
    const resumedAcquisition = store.getAcquisition(resumed.operationRef);
    assert.equal(resumedAcquisition.scopeDigest, firstAcquisition.scopeDigest);
    assert.equal(resumedAcquisition.initialCursorRevision, 1);
    assert.equal(resumedAcquisition.initialCursorValue, '435');
    assert.equal(services.acquisitionContext(resumed.operationRef).cursorIn, '435');
    assert.equal(services.acquisitionContext(resumed.operationRef).pageOrdinal, 0);
  });
});

test('atomically commits receipt, normalized records, anchors, cursor head and durable typed Result', () => {
  fixture(({ databasePath, store }) => {
    register(store); start(store);
    const committed = page(store);
    assert.equal(committed.cursor.revision, 1);
    assert.deepEqual(committed.perceptionIds, ['perception-1']);
    assert.equal(committed.commit.result.schemaRef, 'helix://contracts/types/PerceptionRecordCommitResult/v1');
    assert.equal(committed.commit.result.insertedCount, 1);
    assert.equal(committed.commit.result.duplicateCount, 0);
    assert.equal(committed.commit.result.committedCursorRevision, 1);
    assert.equal(committed.commit.resultDigest, canonicalDigest(committed.commit.result));
    assert.equal(store.getSource('source-1').currentCursorRevision, 1);
    assert.equal(store.getRecord('perception-1').normalizationRuleRef, 'douban-normalize@1');
    assert.equal(count(databasePath, 'perception_acquisition_commits'), 1);
    assert.equal(count(databasePath, 'perception_records'), 1);
    assert.equal(count(databasePath, 'perception_identity_anchors'), 1);
    assert.equal(count(databasePath, 'perception_source_cursors'), 1);
  });
});

test('replays the original typed Result by commit marker and counts source-identity duplicates in a later Acquisition', () => {
  fixture(({ databasePath, store }) => {
    register(store); start(store);
    const first = page(store);
    const replay = page(store);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.commit, first.commit);
    assert.throws(() => page(store, { observationPageDigest: hash('drift') }),
      (error) => error.code === 'P6_PERCEPTION_COMMIT_REPLAY_DRIFT');

    const scope = { collection: 'watched', locale: 'zh-CN' };
    start(store, { perceptionAcquisitionId: 'acquisition-2', scope, scopeDigest: canonicalDigest(scope),
    });
    const duplicate = record('different-draft-id', {
      sourceRecordKey: 'perception-1', sourceRecordDigest: hash('perception-1:source')
    });
    const second = page(store, { acquisitionCommitReceiptId: 'commit-2', perceptionAcquisitionId: 'acquisition-2', pageOrdinal: 0,
      expectedCursorRevision: 1, cursorIn: 'cursor-1', cursorOut: 'cursor-2', commitMarker: 'marker-2', records: [duplicate] });
    assert.equal(second.commit.result.insertedCount, 0);
    assert.equal(second.commit.result.duplicateCount, 1);
    assert.deepEqual(second.commit.result.perceptionIds, []);
    assert.equal(count(databasePath, 'perception_records'), 1);
  });
});

test('rolls the whole page back for invalid rating, duplicate anchors or stale cursor CAS', () => {
  fixture(({ databasePath, store }) => {
    register(store); start(store);
    assert.throws(() => page(store, { records: [record('bad-rating', { rating: 0 })] }),
      (error) => error.code === 'P6_PERCEPTION_RATING_INVALID');
    const anchor = { anchorKind: 'provider_id', anchorValue: 'same', confidenceClass: 'strong', evidenceDigest: hash('same') };
    assert.throws(() => page(store, { records: [record('bad-anchor', { anchors: [anchor, anchor] })] }),
      (error) => error.code === 'P6_PERCEPTION_ANCHOR_DUPLICATE');
    assert.throws(() => page(store, { expectedCursorRevision: 1, cursorIn: 'cursor-1' }),
      (error) => error.code === 'P6_PERCEPTION_CURSOR_REVISION_CONFLICT');
    for (const table of ['perception_acquisition_commits', 'perception_records', 'perception_identity_anchors', 'perception_source_cursors']) {
      assert.equal(count(databasePath, table), 0);
    }
    assert.equal(store.getSource('source-1').currentCursorRevision, null);
  });
});

test('requires correction/retraction source lineage in the same page and preserves direction', () => {
  fixture(({ databasePath, store }) => {
    register(store); start(store); page(store);
    const scope = { collection: 'watched-v2' };
    start(store, { perceptionAcquisitionId: 'acquisition-2', scope, scopeDigest: canonicalDigest(scope) });
    const correction = record('perception-2', { recordKind: 'correction', sourceRecordKey: 'perception-1', sourceRecordRevision: 2 });
    assert.throws(() => page(store, {
      acquisitionCommitReceiptId: 'commit-2', perceptionAcquisitionId: 'acquisition-2', pageOrdinal: 0,
      expectedCursorRevision: 1, cursorIn: null, cursorOut: 'cursor-2', commitMarker: 'marker-2', records: [correction]
    }), (error) => error.code === 'P6_PERCEPTION_LINEAGE_REQUIRED');
    assert.equal(count(databasePath, 'perception_records'), 1);
    const relation = { relationId: 'relation-supersedes', relationKind: 'supersedes', sourcePerceptionId: 'perception-2',
      targetPerceptionId: 'perception-1', ruleRevision: 1, evidenceDigest: hash('relation-supersedes') };
    const committed = page(store, {
      acquisitionCommitReceiptId: 'commit-2', perceptionAcquisitionId: 'acquisition-2', pageOrdinal: 0,
      expectedCursorRevision: 1, cursorIn: null, cursorOut: 'cursor-2', commitMarker: 'marker-2', records: [correction], relations: [relation]
    });
    assert.deepEqual(committed.relationIds, ['relation-supersedes']);
    const database = new Database(databasePath, { readonly: true });
    const saved = database.prepare('SELECT relation_kind,source_perception_id,target_perception_id FROM perception_record_relations').get();
    database.close();
    assert.deepEqual(saved, { relation_kind: 'supersedes', source_perception_id: 'perception-2', target_perception_id: 'perception-1' });
  });
});

test('permits duplicate relations only through Resolution Commit and rejects them in Acquisition', () => {
  fixture(({ databasePath, store }) => {
    register(store); start(store);
    page(store, { records: [record('perception-a'), record('perception-b')], hasMore: true });
    assert.equal(store.appendDuplicateRelation, undefined);
    assert.throws(() => page(store, {
      acquisitionCommitReceiptId: 'commit-2', pageOrdinal: 1, expectedCursorRevision: 1, cursorIn: 'cursor-1', cursorOut: 'cursor-2',
      commitMarker: 'marker-2', records: [], relations: [{ relationId: 'duplicate-2', relationKind: 'duplicate_of',
        sourcePerceptionId: 'perception-a', targetPerceptionId: 'perception-b', ruleRevision: 2, evidenceDigest: hash('duplicate-2') }]
    }), (error) => error.code === 'P6_PERCEPTION_PAGE_DUPLICATE_RELATION');
    assert.equal(count(databasePath, 'perception_acquisition_commits'), 1);
  });
});

test('fails closed when a durable typed Result is tampered after commit', () => {
  fixture(({ databasePath, store }) => {
    register(store); start(store); page(store);
    const database = new Database(databasePath);
    database.prepare('UPDATE perception_acquisition_commits SET result_json=? WHERE acquisition_commit_receipt_id=?')
      .run('{"schemaRef":"helix://contracts/types/PerceptionRecordCommitResult/v1"}', 'commit-1');
    database.close();
    assert.throws(() => store.getCommit('commit-1'), (error) => error.code === 'P6_PERCEPTION_STORED_RESULT_INVALID');
  });
});

test('exposes no direct Resolution write bypass, raw SQL, cross-Owner table or legacy Perception names', () => {
  fixture(({ store }) => assert.equal(store.publishResolution, undefined));
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/domains/perception/persistence/perception-store.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:proc_|libra_|arca_|people_|platform_|fx_)\w*/);
  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+/i);
  assert.doesNotMatch(source, /\bMAX\s*\(/);
  assert.doesNotMatch(source, /perception_dedup_relations|['"]cursor_value['"]|\bappendRecord\b|\badvanceSourceCursor\b/);
});

test('assembles, resolves and commits a complete typed Resolution without Facade side reads', () => {
  fixture(({ databasePath, store, unitOfWork }) => {
    register(store); start(store);
    const commonAnchor={anchorKind:'provider_id',anchorValue:'douban:shared',confidenceClass:'strong',evidenceDigest:hash('shared-anchor')};
    page(store, { records:[record('perception-a',{rating:5,anchors:[commonAnchor]}),record('perception-b',{rating:5,anchors:[commonAnchor]})] });
    const { queryHandle, ruleSnapshot }=resolutionBasis(commonAnchor);
    const inputs=createPerceptionResolutionInputAssembler({store}).assemble({queryHandle,ruleSnapshot});
    const draft=resolvePerception(inputs,{draftId:'resolution-draft-1',producedAtMs:1_700_010_000_100});
    assert.equal(draft.winningPerceptionId,'perception-a');
    assert.equal(draft.duplicateRelationDrafts.length,1);
    const aggregateId = 'perception-resolution:' + canonicalDigest({ queryContract:draft.queryContract, queryInputDigest:draft.queryInputDigest });
    const handle = { ownerDomain:'perception', aggregateType:'perception-resolution', aggregateId,
      factType:'PerceptionResolutionDraft', factSchemaRef:draft.schemaRef,
      resultSchemaRef:'helix://contracts/types/PerceptionResolutionRevision/v1', expectedRevision:0,
      handleId:'resolution-1', commitIdempotencyKey:'resolution-marker-1', payloadDigest:canonicalDigest(draft) };
    const registration = createPerceptionResolutionCommitRegistration(store);
    assert.equal(registration.factType, 'PerceptionResolutionDraft');
    const result = unitOfWork.execute([registration.createParticipant({ handle, payload:draft })]).perception_resolution_commit;
    assert.equal(result.schemaRef, 'helix://contracts/types/PerceptionResolutionRevision/v1');
    assert.equal(result.revision, 1);
    assert.equal(result.winningPerceptionId, 'perception-a');
    assert.equal(result.committedRelationIds.length, 1);
    assert.equal(store.getResolution(draft.queryContract, draft.queryInputDigest).revision, 1);
    assert.equal(count(databasePath, 'perception_record_relations'), 1);

    const query = createPerceptionResolutionQuery({ store, now:() => result.committedAtMs + 10, freshnessTtlMs:1000 });
    const projection = query.resolveDecisionFact({ queryContract:draft.queryContract, queryInputDigest:draft.queryInputDigest });
    assert.equal(projection.kind, 'found');
    assert.deepEqual(projection.value, { factKind:'rating', value:5 });
    assert.equal(projection.evidence[0].winningPerceptionId, 'perception-a');
    assert.equal(Object.hasOwn(projection, 'records'), false);
    const calls=[],limited=createPerceptionStore({schemaManifest,unitOfWork:boundedRatingReads(unitOfWork,calls)});
    const current=limited.readCurrentResolvedRatings([draft.queryInputDigest,...Array.from({length:600},(_,index)=>hash('unused-rating-'+index))]);
    assert.equal(current.length,1);
    assert.deepEqual(current[0].resolution,result);
    assert.equal(current[0].winner.perceptionId,'perception-a');
    assert.equal(calls.filter(call=>call.name==='find_rating_heads').length,2);
  });
});

test('projects historical title-year aliases into title-only Resolution evidence', () => {
  fixture(({ store }) => {
    register(store); start(store);
    const commonAnchor={anchorKind:'provider_id',anchorValue:'douban:alias',confidenceClass:'strong',evidenceDigest:hash('alias-anchor')};
    const titleYearSuffix=String.fromCharCode(0)+'1994';
    const titleAnchor={anchorKind:'title_year',anchorValue:'肖申克的救赎 / The Shawshank Redemption'+titleYearSuffix,confidenceClass:'strong',evidenceDigest:hash('alias-title')};
    page(store, { records:[record('perception-alias',{observedTitle:'肖申克的救赎',anchors:[commonAnchor,titleAnchor]})] });
    const { queryHandle, ruleSnapshot }=resolutionBasis(commonAnchor);
    const inputs=createPerceptionResolutionInputAssembler({store}).assemble({queryHandle,ruleSnapshot});
    const anchors=inputs.recordSet.records[0].identityAnchors;
    assert.ok(anchors.some((item)=>item.anchorKind==='title'&&item.anchorValue==='肖申克的救赎'));
    assert.ok(anchors.some((item)=>item.anchorKind==='title'&&item.anchorValue==='The Shawshank Redemption'));
    assert.ok(anchors.every((item)=>Object.keys(item).sort().join(',')==='anchorKind,anchorValue,confidenceClass,evidenceDigest'));
  });
});

test('resolves a historical title-year Record for a same-title target with a different year', () => {
  fixture(({ store }) => {
    register(store); start(store);
    const oldAnchor={anchorKind:'title_year',anchorValue:'同名电影\0'+'1990',confidenceClass:'medium',evidenceDigest:hash('old-title-year')};
    page(store,{records:[record('perception-old-year',{rating:4,observedTitle:'同名电影',anchors:[oldAnchor]})]});
    const query=queryFor({targetType:'subject',targetId:'subject-new-year',targetRevision:1,title:'同名电影',year:2024,providerIdentity:null});
    const inputs=createPerceptionResolutionInputAssembler({store}).assemble({queryHandle:queryHandle(query,1,'libra'),ruleSnapshot:buildRuleSnapshot()});
    const draft=resolvePerception(inputs,{draftId:'title-only-resolution',producedAtMs:1});
    assert.equal(draft.resultKind,'found');
    assert.equal(draft.winningPerceptionId,'perception-old-year');
  });
});

test('terminals a Douban Acquisition after its page Work is failed rather than leaving it active', () => {
  fixture(({ store, unitOfWork }) => {
    register(store); start(store, { scope:{ collection:'watched_movies' } });
    const statuses=new Map();
    const services=createPerceptionProcessServices({schemaManifest,unitOfWork,perceptionStore:store,
      workResultReader:{status:(workId)=>statuses.get(workId)||null},
      targetProjectionReader:()=>({title:'Example',year:1994,providerIdentity:null,targetRevision:1,targetDigest:hash('target')})});
    const first=services.reconcileAcquisition('acquisition-1');
    assert.equal(first.kind,'pending');
    assert.equal(store.getAcquisition('acquisition-1').state,'active');
    statuses.set(first.workId,{state:'failed',latestAttempt:{failure_code:'P5_PROVIDER_TRANSPORT_FAILED'}});
    const closed=services.reconcileAcquisition('acquisition-1');
    assert.equal(closed.kind,'terminal');
    assert.equal(closed.state,'failed');
    assert.equal(store.getAcquisition('acquisition-1').state,'failed');
    assert.ok(store.getAcquisition('acquisition-1').terminalAtMs);
    assert.equal(services.reconcileAcquisition('acquisition-1').kind,'terminal');
  });
});

test('replans a failed Resolution input-contract attempt once under a new basis', () => {
  fixture(({ databasePath, store, unitOfWork }) => {
    const statuses=new Map();
    const services=createPerceptionProcessServices({schemaManifest,unitOfWork,perceptionStore:store,
      workResultReader:{status:(workId)=>statuses.get(workId)||null},
      targetProjectionReader:()=>({title:'Example',year:1994,providerIdentity:null,targetRevision:1,targetDigest:hash('target')})});
    const first=services.ensureResolution('subject','subject-1');
    const database=new Database(databasePath);
    database.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_id=?").run(first.workId);
    database.close();
    statuses.set(first.workId,{state:'failed',latestAttempt:{failure_code:'P4_CAPABILITY_SCHEMA_REJECTED'}});
    const retry=services.ensureResolution('subject','subject-1');
    assert.notEqual(retry.workId,first.workId);
    assert.equal(count(databasePath,'fx_supporting_works'),2);
  });
});

test('fails closed on stale Resolution CAS, non-normalized duplicate pairs and uncommitted query state', () => {
  fixture(({ databasePath, store, unitOfWork }) => {
    register(store); start(store); page(store, { records:[record('perception-a'), record('perception-b')] });
    const anchor=record('x').anchors[0]; const {queryHandle,ruleSnapshot}=resolutionBasis(anchor);
    const inputs=createPerceptionResolutionInputAssembler({store}).assemble({queryHandle,ruleSnapshot});
    const valid=resolvePerception(inputs,{draftId:'bad-draft',producedAtMs:1});
    const draft={...valid,duplicateRelationDrafts:[{sourcePerceptionId:'perception-b',targetPerceptionId:'perception-a',ruleRevision:1,evidenceDigest:hash('duplicate')} ]};
    draft.draftDigest=canonicalDigest(Object.fromEntries(Object.entries(draft).filter(([key])=>!['schemaRef','schemaVersion','draftId','draftKind','basisDigest','draftDigest','producedAtMs'].includes(key))));
    const queryContract=draft.queryContract,queryInputDigest=draft.queryInputDigest;
    const handle = { ownerDomain:'perception', aggregateType:'perception-resolution',
      aggregateId:'perception-resolution:' + canonicalDigest({ queryContract, queryInputDigest }),
      factType:'PerceptionResolutionDraft', factSchemaRef:draft.schemaRef,
      resultSchemaRef:'helix://contracts/types/PerceptionResolutionRevision/v1', expectedRevision:0,
      handleId:'bad-resolution', commitIdempotencyKey:'bad-marker', payloadDigest:canonicalDigest(draft) };
    const participant = createPerceptionResolutionCommitRegistration(store).createParticipant;
    assert.throws(() => participant({ handle, payload:draft }),
      (error) => error.code === 'P6_PERCEPTION_DUPLICATE_RELATION_INVALID');
    assert.equal(count(databasePath, 'perception_resolution_revisions'), 0);
    assert.equal(count(databasePath, 'perception_record_relations'), 0);
    const query = createPerceptionResolutionQuery({ store, now:() => 1, freshnessTtlMs:0 });
    assert.throws(() => query.resolveDecisionFact({ queryContract, queryInputDigest }),
      (error) => error.code === 'P6_PERCEPTION_RESOLUTION_NOT_COMMITTED');
  });
});

test('candidate lookup preserves multilingual title aliases, technical suffixes and exact title years',()=>{
  fixture(({store})=>{
    register(store);start(store);
    const anchor=value=>({anchorKind:'title_year',anchorValue:value,confidenceClass:'medium',evidenceDigest:hash(value)});
    page(store,{records:[record('fullwidth',{anchors:[anchor('ＡＢＣ / Other title\0'+'2001')]}),
      record('technical',{anchors:[anchor('The Film - 1080p WEB-DL HEVC\0'+'2002')]}),
      record('different',{anchors:[anchor('Unrelated\0'+'2001')]})]});
    const lookup=(anchorKind,anchorValue,maxCandidates=256)=>store.readResolutionCandidates({identityEvidence:[{anchorKind,anchorValue}]},
      {candidateRetrievalClauses:[{anchorKind,lookupMode:'normalized_exact',normalizationProfileRef:'unicode_nfkc_casefold',maxCandidates}],maxCandidateRecords:256});
    assert.deepEqual(lookup('title','abc').records.map(r=>r.perceptionId),['fullwidth']);
    assert.deepEqual(lookup('title','the film').records.map(r=>r.perceptionId),['technical']);
    assert.deepEqual(lookup('title_year','ABC\0'+'2001').records.map(r=>r.perceptionId),['fullwidth']);
    assert.deepEqual(lookup('title_year','ABC\0'+'2002').records,[]);
    const query=queryFor({targetType:'shelf_entry',targetId:'alias-target',targetRevision:1,title:'ABC',year:2001,providerIdentity:null});
    const assembled=createPerceptionResolutionInputAssembler({store}).assemble({queryHandle:queryHandle(query,1,'arca'),ruleSnapshot:buildRuleSnapshot()});
    const derived=assembled.recordSet.records[0].identityAnchors.find(a=>a.anchorKind==='title'&&a.anchorValue==='ABC');
    assert.equal(derived.evidenceDigest,canonicalDigest({schema:'perception-derived-title-alias@3',
      sourceAnchorValue:'ＡＢＣ / Other title\0'+'2001',alias:'ABC',aliasRuleRevision:3}));
  });
});

test('exact candidate lookup avoids loading unrelated anchors and retains candidate overflow checks',()=>{
  fixture(({store,unitOfWork})=>{
    register(store);start(store);
    page(store,{records:Array.from({length:201},(_,i)=>record('exact-'+i))});
    let returnedRows=0;
    const measured=createPerceptionStore({schemaManifest,unitOfWork:{execute(parts,...args){return unitOfWork.execute(parts.map(part=>({...part,
      execute(context){return part.execute({...context,repository(id){const repo=context.repository(id);return {...repo,
        invoke(name,params){const value=repo.invoke(name,params);if(Array.isArray(value))returnedRows+=value.length;return value;}};}});}})),...args);}}});
    const query={identityEvidence:[{anchorKind:'provider_id',anchorValue:'douban:exact-7'}]},
      rule={candidateRetrievalClauses:[{anchorKind:'provider_id',lookupMode:'exact',maxCandidates:256}],maxCandidateRecords:256};
    assert.deepEqual(measured.readResolutionCandidates(query,rule).records.map(r=>r.perceptionId),['exact-7']);
    assert.ok(returnedRows<=4,'An exact lookup must not materialize the unrelated anchor corpus.');
    const two={identityEvidence:[...query.identityEvidence,{anchorKind:'provider_id',anchorValue:'douban:exact-8'}]};
    assert.throws(()=>store.readResolutionCandidates(two,{...rule,candidateRetrievalClauses:[{...rule.candidateRetrievalClauses[0],maxCandidates:1}]}),
      {code:'P6_PERCEPTION_CANDIDATE_CLAUSE_OVERFLOW'});
    assert.throws(()=>store.readResolutionCandidates(two,{...rule,maxCandidateRecords:1}),{code:'P6_PERCEPTION_CANDIDATE_SET_OVERFLOW'});
  });
});

test('paired rating and watched reads retain scalar results and exact scopes without retaining live candidates',()=>{
  fixture(({store,unitOfWork})=>{
    register(store);start(store);page(store,{records:[record('paired-record')]});
    const target={targetType:'subject',targetId:'paired-subject',targetRevision:1,title:'Paired Film',year:2024,providerIdentity:'douban:paired-record'},
      ruleSnapshot=buildRuleSnapshot(),handles=['rating','watched'].map(kind=>queryHandle(queryFor(target,kind),1,'libra'));
    let reads=0,targetReads=0;
    const measured={...store,readResolutionCandidates(query,rule){reads++;return store.readResolutionCandidates(query,rule);}},
      assembler=createPerceptionResolutionInputAssembler({store:measured});
    const scalar=handles.map(handle=>assembler.assemble({queryHandle:handle,ruleSnapshot}));assert.equal(reads,2);
    reads=0;const paired=assembler.assemblePair({queryHandles:handles,ruleSnapshot});assert.equal(reads,1);assert.deepEqual(paired,scalar);
    assert.notEqual(paired[0].recordSet.recordSetDigest,paired[1].recordSet.recordSetDigest);
    assert.deepEqual(paired[0].recordSet.records,paired[1].recordSet.records);
    const other=queryHandle(queryFor({...target,targetId:'other'},'watched'),1,'libra');
    assert.throws(()=>assembler.assemblePair({queryHandles:[handles[0],other],ruleSnapshot}),{code:'P6_PERCEPTION_QUERY_PAIR_INVALID'});
    assert.throws(()=>assembler.assemblePair({queryHandles:[handles[0],handles[0]],ruleSnapshot}),{code:'P6_PERCEPTION_QUERY_PAIR_INVALID'});
    assert.throws(()=>assembler.assemblePair({queryHandles:[handles[0],{...handles[1],inputDigest:hash('wrong')}],ruleSnapshot}),{code:'P6_PERCEPTION_QUERY_HANDLE_INVALID'});
    const services=createPerceptionProcessServices({schemaManifest,unitOfWork,perceptionStore:measured,now:()=>100,
      workResultReader:{status:()=>null},targetProjectionReader:()=>{targetReads++;return target;}});
    reads=0;const operations=services.ensureTargetResolutions('subject',target.targetId);
    assert.equal(targetReads,1);assert.equal(reads,1);assert.notEqual(operations.rating.workId,operations.watched.workId);
    register(store,'paired-new-source');start(store,{perceptionAcquisitionId:'paired-new-acquisition',perceptionSourceId:'paired-new-source'});
    page(store,{perceptionAcquisitionId:'paired-new-acquisition',perceptionSourceId:'paired-new-source',acquisitionCommitReceiptId:'paired-new-commit',commitMarker:'paired-new-marker',
      records:[record('paired-new-record',{anchors:[{anchorKind:'subject_id',anchorValue:target.targetId,confidenceClass:'exact',evidenceDigest:hash('new-target')} ]})]});
    const changed=assembler.assemblePair({queryHandles:handles,ruleSnapshot});
    assert.notDeepEqual(changed,paired);
    assert.deepEqual(changed,handles.map(queryHandle=>assembler.assemble({queryHandle,ruleSnapshot})));
  });
});

test('normalized candidate membership preserves exact and fuzzy modes, profiles and overflow',()=>{
  fixture(({store})=>{
    register(store);start(store);
    page(store,{records:[record('alpha',{anchors:[{anchorKind:'title',anchorValue:'ＡＢＣ  Film',confidenceClass:'medium',evidenceDigest:hash('alpha')}]}),
      record('beta',{anchors:[{anchorKind:'title',anchorValue:'ABC-Film',confidenceClass:'medium',evidenceDigest:hash('beta')}]}),
      record('other',{anchors:[{anchorKind:'title',anchorValue:'Different',confidenceClass:'medium',evidenceDigest:hash('other')} ]})]});
    const lookup=(values,lookupMode,normalizationProfileRef,maxCandidates=256)=>store.readResolutionCandidates({identityEvidence:values.map(anchorValue=>({anchorKind:'title',anchorValue}))},
      {candidateRetrievalClauses:[{anchorKind:'title',lookupMode,normalizationProfileRef,threshold:1,maxCandidates}],maxCandidateRecords:256}).records.map(row=>row.perceptionId);
    assert.deepEqual(lookup(['missing','abc film','abc film'],'normalized_exact','unicode_nfkc_casefold'),['alpha']);
    assert.deepEqual(lookup(['abc film'],'normalized_exact','alphanumeric_casefold'),['alpha','beta']);
    assert.deepEqual(lookup(['abc film'],'exact','unicode_nfkc_casefold'),[]);
    assert.deepEqual(lookup(['ＡＢＣ  Film'],'exact','unicode_nfkc_casefold'),['alpha']);
    assert.deepEqual(lookup(['abc film'],'bounded_fuzzy','unicode_nfkc_casefold'),['alpha']);
    assert.throws(()=>lookup(['abc film'],'normalized_exact','alphanumeric_casefold',1),{code:'P6_PERCEPTION_CANDIDATE_CLAUSE_OVERFLOW'});
  });
});

test('warm title transforms do not retain candidate membership across new Record commits',()=>{
  fixture(({store})=>{
    register(store);start(store);
    const anchors=[{anchorKind:'title_year',anchorValue:'The Film - 1080p WEB-DL HEVC\0'+'2002',
      confidenceClass:'medium',evidenceDigest:hash('warm-alias')}];
    page(store,{records:[record('first-alias',{anchors})]});
    const query={identityEvidence:[{anchorKind:'title',anchorValue:'the film'}]},
      clause={anchorKind:'title',lookupMode:'normalized_exact',normalizationProfileRef:'unicode_nfkc_casefold',maxCandidates:256},
      rule={candidateRetrievalClauses:[clause],maxCandidateRecords:256};
    const before=store.readResolutionCandidates(query,rule);
    assert.deepEqual(before.records.map(r=>r.perceptionId),['first-alias']);
    register(store,'source-2');start(store,{perceptionAcquisitionId:'acquisition-2',perceptionSourceId:'source-2'});
    page(store,{perceptionAcquisitionId:'acquisition-2',perceptionSourceId:'source-2',
      acquisitionCommitReceiptId:'commit-2',commitMarker:'marker-2',records:[record('second-alias',{anchors,rating:1})]});
    const after=store.readResolutionCandidates(query,rule);
    assert.deepEqual(after.records.map(r=>r.perceptionId),['first-alias','second-alias']);
    assert.deepEqual(after.records[0],before.records[0]);
    assert.equal(after.records[1].rating,1);
    assert.throws(()=>store.readResolutionCandidates(query,{...rule,candidateRetrievalClauses:[{...clause,maxCandidates:1}]}),
      {code:'P6_PERCEPTION_CANDIDATE_CLAUSE_OVERFLOW'});
  });
});

function resolutionBasis(anchor){
  const queryBody={queryContract:'perception.rating.resolve@1',queryVersion:1,
    querySchemaRef:'helix://contracts/domain-types/PerceptionResolutionQuery/v1',factKind:'rating',identityEvidence:[anchor]};
  const query={...queryBody,queryInputDigest:canonicalDigest(queryBody)};
  const ruleBody={ruleContract:'perception-resolution-beta',ruleVersion:1,supportedFactKinds:['rating','watched'],
    candidateRetrievalClauses:[{anchorKind:'provider_id',lookupMode:'exact',maxCandidates:256}],
    anchorMatchers:[{anchorKind:'provider_id',matchMode:'exact',strengthRank:1,minConfidenceClass:'strong'}],
    winnerOrder:'strongest_anchor_then_value_consensus_then_perception_id',equalStrengthConflict:'not_found',
    duplicateProofMatchers:[{anchorKind:'provider_id',matchMode:'exact',minConfidenceClass:'strong',requireSameAnchorValue:true,requireSameFactKind:true,requireSameCanonicalValue:true}],maxCandidateRecords:256};
  const ruleSnapshot={...ruleBody,ruleDigest:canonicalDigest(ruleBody)};
  return {queryHandle:{providerDomain:'perception',consumerDomain:'libra',queryContract:query.queryContract,queryVersion:1,
    typedInputSchemaRef:query.querySchemaRef,typedInput:query,inputDigest:query.queryInputDigest},ruleSnapshot};
}
