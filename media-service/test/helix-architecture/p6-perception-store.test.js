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
const { createPerceptionProcessServices } = require('../../src/helix/domains/perception/application/perception-process-services');
const { createPerceptionResolutionCommitRegistration } = require('../../src/helix/domains/perception/capabilities/perception-resolution-lifecycle');
const { resolvePerception } = require('../../src/helix/domains/perception/capabilities/perception-resolution-resolver');
const { createPerceptionStore } = require('../../src/helix/domains/perception/persistence/perception-store');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

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
    initialCursorRevision: 0, initialCursorValue: null, ...overrides, scope
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
      perceptionAcquisitionId: 'acquisition-2', scope: nextScope, scopeDigest: canonicalDigest(nextScope),
      initialCursorRevision: 1, initialCursorValue: null
    });
    assert.equal(next.initialCursorRevision, 1);
    assert.equal(next.initialCursorValue, null);
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

    const scope = { collection: 'replay-window' };
    start(store, { perceptionAcquisitionId: 'acquisition-2', scope, scopeDigest: canonicalDigest(scope),
      initialCursorRevision: 1, initialCursorValue: 'cursor-1' });
    const duplicate = record('different-draft-id', {
      sourceRecordKey: 'perception-1', sourceRecordDigest: hash('perception-1:source')
    });
    const second = page(store, { acquisitionCommitReceiptId: 'commit-2', perceptionAcquisitionId: 'acquisition-2', pageOrdinal: 1,
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
    start(store, { perceptionAcquisitionId: 'acquisition-2', scope, scopeDigest: canonicalDigest(scope), initialCursorRevision: 1, initialCursorValue: 'cursor-1' });
    const correction = record('perception-2', { recordKind: 'correction', sourceRecordKey: 'perception-1', sourceRecordRevision: 2 });
    assert.throws(() => page(store, {
      acquisitionCommitReceiptId: 'commit-2', perceptionAcquisitionId: 'acquisition-2', pageOrdinal: 1,
      expectedCursorRevision: 1, cursorIn: 'cursor-1', cursorOut: 'cursor-2', commitMarker: 'marker-2', records: [correction]
    }), (error) => error.code === 'P6_PERCEPTION_LINEAGE_REQUIRED');
    assert.equal(count(databasePath, 'perception_records'), 1);
    const relation = { relationId: 'relation-supersedes', relationKind: 'supersedes', sourcePerceptionId: 'perception-2',
      targetPerceptionId: 'perception-1', ruleRevision: 1, evidenceDigest: hash('relation-supersedes') };
    const committed = page(store, {
      acquisitionCommitReceiptId: 'commit-2', perceptionAcquisitionId: 'acquisition-2', pageOrdinal: 1,
      expectedCursorRevision: 1, cursorIn: 'cursor-1', cursorOut: 'cursor-2', commitMarker: 'marker-2', records: [correction], relations: [relation]
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
  });
});

test('projects internal title aliases into the exact Resolution Record Set contract', () => {
  fixture(({ store }) => {
    register(store); start(store);
    const commonAnchor={anchorKind:'provider_id',anchorValue:'douban:alias',confidenceClass:'strong',evidenceDigest:hash('alias-anchor')};
    const titleYearSuffix=String.fromCharCode(0)+'1994';
    const titleAnchor={anchorKind:'title_year',anchorValue:'肖申克的救赎 / The Shawshank Redemption'+titleYearSuffix,confidenceClass:'strong',evidenceDigest:hash('alias-title')};
    page(store, { records:[record('perception-alias',{observedTitle:'肖申克的救赎',anchors:[commonAnchor,titleAnchor]})] });
    const { queryHandle, ruleSnapshot }=resolutionBasis(commonAnchor);
    const inputs=createPerceptionResolutionInputAssembler({store}).assemble({queryHandle,ruleSnapshot});
    const anchors=inputs.recordSet.records[0].identityAnchors;
    assert.ok(anchors.some((item)=>item.anchorValue==='肖申克的救赎'+titleYearSuffix));
    assert.ok(anchors.some((item)=>item.anchorValue==='The Shawshank Redemption'+titleYearSuffix));
    assert.ok(anchors.every((item)=>Object.keys(item).sort().join(',')==='anchorKind,anchorValue,confidenceClass,evidenceDigest'));
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
