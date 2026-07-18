'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCanonicalTransactionRegistry, createDomainCommitCoordinator, createDomainCommitRegistry } = require('../../src/helix/foundation/persistence/domain-commit-registry');
const perceptionTransaction = require('../../src/helix/contracts/transaction-contracts/helix.transaction.perception-acquisition-page-commit/v1/contract.json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createPerceptionAcquisitionPipeline, createPerceptionRecordCommitRegistration } = require('../../src/helix/domains/perception/capabilities/perception-acquisition-pipeline');
const { createPerceptionStore } = require('../../src/helix/domains/perception/persistence/perception-store');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const NOW = 1_700_020_000_000;

function sourceSnapshot() {
  const basis = { sourceId:'source-1', sourceKind:'douban', integrationId:'integration-1', sourceConfigRevision:1, sourceScopeDigest:hash('scope') };
  return Object.freeze({ schemaRef:'helix://contracts/domain-types/PerceptionSourceSnapshot/v1', schemaVersion:1,
    objectId:'source-1', revision:1, digest:canonicalDigest(basis), ...basis });
}
function cursor() { const basis = { perceptionAcquisitionId:'acquisition-1', pageOrdinal:0, expectedCursorRevision:0, cursorIn:null, pageBudget:20 };
  return Object.freeze({ schemaRef:'helix://contracts/domain-types/PerceptionAcquisitionCursor/v1', schemaVersion:1,
    objectId:'cursor-plan-1', revision:1, digest:canonicalDigest(basis), ...basis }); }
function rule() { const basis = { ruleRef:'douban-normalize', ruleVersion:'1', sourceKind:'douban', canonicalRatingScale:'integer_1_5', ruleDigest:hash('rule') };
  return Object.freeze({ schemaRef:'helix://contracts/domain-types/PerceptionNormalizationRuleRef/v1', schemaVersion:1,
    objectId:'rule-1', revision:1, digest:canonicalDigest(basis), ...basis }); }
function observation() { const inlinePayload = { title:'Example', rating:5, watched:true }; return Object.freeze({ observationId:'observation-1',
  sourceRecordKey:'douban-1', sourceRecordRevision:1, sourceRecordDigest:hash('source-record'), observedAtMs:NOW,
  payloadSchemaRef:'helix://contracts/types/DoubanInterestObservation/v1', payloadDigest:canonicalDigest(inlinePayload), inlinePayload,
  provenanceDigest:hash('provenance') }); }

function pipelineFixture(overrides = {}) {
  const providerCalls = [];
  const providerObservation = { async execute(request) { providerCalls.push(request); return Object.freeze({
    operationId:'perception.source.acquire@1', responseDigest:hash('provider-response'),
    result:Object.freeze({ resultRefs:Object.freeze([{ objectType:'provider-observation', objectId:'observation-1', revision:1, digest:hash('observation-ref') }]), nextCursor:null })
  }); } };
  const instance = createPerceptionAcquisitionPipeline({ providerObservation,
    observationReader:{ async read() { return observation(); } },
    ruleEvaluator:{ async normalize({ observation: item }) { return Object.freeze({ record:Object.freeze({ draftId:'perception-1',
      recordKind:'observation', sourceRecordKey:item.sourceRecordKey, sourceRecordRevision:item.sourceRecordRevision,
      sourceRecordDigest:item.sourceRecordDigest, rating:item.inlinePayload.rating, watchedState:true, observedTitle:item.inlinePayload.title,
      observedAtMs:item.observedAtMs, identityAnchors:Object.freeze([{ anchorKind:'provider_id', anchorValue:'douban:1',
        confidenceClass:'strong', evidenceDigest:hash('anchor') }]), provenanceRef:'observation-1', provenanceDigest:item.provenanceDigest }),
      sourceLineageRelations:Object.freeze([]) }); } }, digest:hash, ...overrides });
  return { instance, providerCalls };
}
function acquireRequest() { return { sourceSnapshot:sourceSnapshot(), cursor:cursor(),
  integrationHandle:{ integrationId:'integration-1', integrationType:'douban', configRevision:1 }, secretLeaseHandle:{ leaseId:'lease-1' },
  idempotencyKey:'acquire-page-1', timeoutMs:60000, evidenceId:'evidence-page-1', observedAtMs:NOW }; }

test('freezes Provider request basis and produces immutable Observation Page then Commit Draft', async () => {
  const { instance, providerCalls } = pipelineFixture();
  const page = await instance.acquirePage(acquireRequest());
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].input.cursor, null);
  assert.equal(page.cursor.cursorOut, 'terminal:' + hash('provider-response'));
  assert.equal(page.hasMore, false);
  assert.equal(page.observationPageDigest, page.payloadDigest);
  assert.equal(Object.isFrozen(page.observations[0].inlinePayload), true);
  const draft = await instance.normalizePage({ observationPage:page, normalizationRule:rule(), draftId:'draft-1', producedAtMs:NOW + 1 });
  assert.equal(draft.schemaRef, 'helix://contracts/types/PerceptionAcquisitionCommitDraft/v1');
  assert.equal(draft.normalizationRuleRef, 'douban-normalize@1');
  assert.equal(draft.records[0].draftId, 'perception-1');
  assert.equal(draft.cursorTransition.observationPageDigest, page.observationPageDigest);
});

test('rejects Source/Integration drift, observation tamper and wrong normalization source kind', async () => {
  let fixture = pipelineFixture();
  await assert.rejects(() => fixture.instance.acquirePage({ ...acquireRequest(), integrationHandle:{ integrationId:'other', integrationType:'douban', configRevision:1 } }),
    (error) => error.code === 'P6_PERCEPTION_INTEGRATION_FENCE_MISMATCH');
  fixture = pipelineFixture({ observationReader:{ async read() { return { ...observation(), payloadDigest:hash('tampered') }; } } });
  await assert.rejects(() => fixture.instance.acquirePage(acquireRequest()), (error) => error.code === 'P6_PERCEPTION_OBSERVATION_INVALID');
  const good = pipelineFixture(); const page = await good.instance.acquirePage(acquireRequest());
  await assert.rejects(() => good.instance.normalizePage({ observationPage:page, normalizationRule:{ ...rule(), sourceKind:'emby' }, draftId:'draft-1', producedAtMs:NOW }),
    (error) => error.code === 'P6_PERCEPTION_NORMALIZATION_BASIS_INVALID');
});

test('Record Commit registration writes Perception facts, durable typed Result, marker and Outbox atomically with replay', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-perception-pipeline-')); const databasePath = path.join(root, 'shelfdeck.db');
  let clock = NOW + 100; const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => clock++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel }); const store = createPerceptionStore({ schemaManifest, unitOfWork });
  try {
    store.registerSource({ perceptionSourceId:'source-1', sourceKind:'douban', integrationId:'integration-1', status:'active', configRevision:1 });
    const scope = { collection:'watched' }; store.startAcquisition({ perceptionAcquisitionId:'acquisition-1', perceptionSourceId:'source-1',
      sourceConfigRevision:1, scopeSchemaRef:'helix://contracts/types/PerceptionAcquisitionScope/v1', scope, scopeDigest:canonicalDigest(scope),
      initialCursorRevision:0, initialCursorValue:null });
    const pipeline = pipelineFixture().instance; const page = await pipeline.acquirePage(acquireRequest());
    const draft = await pipeline.normalizePage({ observationPage:page, normalizationRule:rule(), draftId:'draft-1', producedAtMs:NOW + 1 });
    const registry = createDomainCommitRegistry({ registrations:[createPerceptionRecordCommitRegistration(store)] });
    const transactionRegistry = createCanonicalTransactionRegistry({ contracts:[perceptionTransaction] });
    const coordinator = createDomainCommitCoordinator({ schemaManifest, registry, transactionRegistry, unitOfWork });
    const setup = new Database(databasePath);
    setup.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('work-1','perception','acquisition','acquisition-1','sync',hash('basis'),'normal','running','work-key',1,1);
    setup.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES(?,?,?,?,?,?)').run('attempt-1','work-1',1,hash('basis'),'running',1);
    setup.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run('plan-1','attempt-1','perception-planner@1',1,hash('catalog'),hash('basis'),hash('graph'),'planned',1);
    setup.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('event-1','plan-1','node-1','work-1','attempt-1','perception','perception.record.commit@1',1,'executing','normal',1); setup.close();
    const handle = { schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion:1, handleId:'commit-1', ownerDomain:'perception',
      aggregateType:'perception-acquisition', aggregateId:'acquisition-1', factType:'PerceptionAcquisitionCommitDraft', factSchemaRef:draft.schemaRef,
      resultSchemaRef:'helix://contracts/types/PerceptionRecordCommitResult/v1', expectedRevision:0, payloadDigest:canonicalDigest(draft),
      commitIdempotencyKey:'marker-1', eventFenceDigest:hash('event-fence') };
    const request = { transactionId:'helix.transaction.perception-acquisition-page-commit', handle, payload:draft,
      commitMarker:{ commitMarker:'marker-1', effectId:null, commitDigest:hash('commit') },
      resultBinding:{ resultId:'result-1', eventId:'event-1', evidenceSchemaRef:page.schemaRef, evidence:page }, outboxMessages:[{
        messageId:'message-1', producerDomain:'perception', messageKind:'perception.records.committed', aggregateType:'perception-acquisition',
        aggregateId:'acquisition-1', aggregateRevision:1, dedupKey:'acquisition-1/page-0', intendedConsumers:['people'],
        payloadSchemaRef:'helix://contracts/types/PerceptionRecordCommitSignal/v1', payload:{ perceptionAcquisitionId:'acquisition-1', acquisitionRevision:1, factDigest:page.observationPageDigest }
      }] };
    const first = coordinator.execute(request); const replay = coordinator.execute(request);
    assert.equal(first.typedResult.insertedCount, 1); assert.equal(first.typedResult.duplicateCount, 0);
    assert.equal(replay.replayed, true); assert.deepEqual(replay.typedResult, first.typedResult);
    const inspect = new Database(databasePath, { readonly:true });
    assert.equal(inspect.prepare('SELECT COUNT(*) count FROM perception_records').get().count, 1);
    assert.equal(inspect.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count, 1);
    assert.equal(inspect.prepare('SELECT COUNT(*) count FROM fx_event_result_bindings').get().count, 1);
    assert.equal(inspect.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count, 1); inspect.close();
  } finally { kernel.close(); fs.rmSync(root, { recursive:true, force:true }); }
});
