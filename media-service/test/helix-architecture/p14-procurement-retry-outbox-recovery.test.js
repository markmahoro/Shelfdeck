'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const {
  createFailedPreparationRetryAdminService,
} = require('../../src/helix/domains/procurement/application/failed-preparation-retry-admin-service');
const {
  createDefaultTriageRuleRegistry,
} = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const {
  createOutboxDispatcherHost,
} = require('../../src/helix/foundation/execution/outbox-dispatcher-host');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));

function stableId(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

test('Procurement Available consumer restores the exact frozen Retry Admission and terminal replay', () => {
  const fieldId = 'field-retry-recovery';
  const failedRunId = 'failed-run-retry-recovery';
  const idempotencyKey = 'retry-recovery-key';
  const workId = stableId('failed-preparation-retry-work-', { fieldId, idempotencyKey });
  const retryIntentId = 'retry-intent-recovery';
  const intentValue = {
    retryIntentId,
    fieldId,
    failedRunId,
    retryScopeDigest: canonicalDigest({ scope: retryIntentId }),
  };
  const intent = Object.freeze({ ...intentValue, intentDigest: canonicalDigest(intentValue) });
  const payload = Object.freeze({
    messageKind: 'procurement_retry_intent_available',
    retryIntentId,
    fieldId,
    failedRunId,
    intentStateRevision: 1,
    intentDigest: intent.intentDigest,
    retryScopeDigest: intent.retryScopeDigest,
  });
  const intentEventId = stableId('retry-intent-event-', { workId });
  const admissionEventId = stableId('retry-admission-event-', { workId });
  const intentResultId = 'retry-intent-result-recovery';
  const admissionResultId = 'retry-admission-result-recovery';
  const admissionRequest = Object.freeze({
    retryIntentId,
    expectedStateRevision: 1,
    expectedIntentDigest: intent.intentDigest,
    commitMarker: Object.freeze({
      commitMarker: 'retry-admission-marker-recovery',
      commitDigest: canonicalDigest({ retryIntentId, operation: 'admit' }),
    }),
    resultBinding: Object.freeze({ resultId: admissionResultId, eventId: admissionEventId }),
  });
  const intentRequest = Object.freeze({
    intent,
    commitMarker: Object.freeze({
      commitMarker: 'retry-intent-marker-recovery',
      commitDigest: canonicalDigest({ retryIntentId, operation: 'create' }),
    }),
    resultBinding: Object.freeze({ resultId: intentResultId, eventId: intentEventId }),
  });
  const row = {
    retry_intent_id: retryIntentId,
    field_id: fieldId,
    failed_run_id: failedRunId,
    state: 'open',
    state_revision: 1,
    idempotency_key: idempotencyKey,
    intent_digest: intent.intentDigest,
    retry_scope_digest: intent.retryScopeDigest,
    create_commit_marker: intentRequest.commitMarker.commitMarker,
    create_result_digest: canonicalDigest({ created: retryIntentId }),
    consume_commit_marker: null,
    consume_result_digest: null,
  };
  const calls = [];
  const typedResult = Object.freeze({
    schemaRef: 'helix://contracts/application-types/ProcurementRetryAdmissionResult/v1',
    schemaVersion: 1,
    receiptId: admissionResultId,
    receiptKind: 'procurement_retry_admission',
    ownerDomain: 'procurement',
    scopeType: 'procurement_retry_intent',
    scopeId: retryIntentId,
    scopeDigest: intent.intentDigest,
    committedAtMs: 1,
    retryIntentId,
    intentDigest: intent.intentDigest,
    terminalIntentState: 'stale',
    resultKind: 'stale',
    staleMaterialCount: 1,
    staleMaterialSetDigest: canonicalDigest({ stale: retryIntentId }),
    staleReasonCodes: ['eligibility_changed'],
  });
  const unitOfWork = {
    execute(participants) {
      const results = {};
      for (const participant of participants) {
        results[participant.participantId] = participant.execute({
          repository() {
            return {
              invoke(statement, parameters) {
                assert.equal(statement, 'find_retry_intent');
                assert.equal(parameters.retry_intent_id, retryIntentId);
                return { ...row };
              },
            };
          },
        });
      }
      return results;
    },
  };
  let admissionCalls = 0;
  const service = createFailedPreparationRetryAdminService({
    schemaManifest,
    unitOfWork,
    triageRegistry: createDefaultTriageRuleRegistry(),
    retryIntentStore: { create() { throw new Error('create is outside recovery'); } },
    retryAdmissionStore: {
      consume(request) {
        admissionCalls += 1;
        assert.deepEqual(request, admissionRequest);
        row.state = 'stale';
        row.state_revision = 2;
        row.consume_commit_marker = admissionRequest.commitMarker.commitMarker;
        row.consume_result_digest = canonicalDigest(typedResult);
        return Object.freeze({ typedResult, replayed: admissionCalls > 1 });
      },
    },
    workRuntime: {
      snapshot(requestedWorkId) {
        assert.equal(requestedWorkId, workId);
        return Object.freeze({
          plan: Object.freeze({ planner_ref: 'procurement.failed-preparation-retry-planner@1' }),
          pages: Object.freeze([
            Object.freeze({ intentRequest }),
            Object.freeze({ admissionRequest }),
          ]),
          events: Object.freeze([
            Object.freeze({ event_id: intentEventId }),
            Object.freeze({ event_id: admissionEventId }),
          ]),
        });
      },
      beginEvent(eventId) { calls.push(['begin', eventId]); },
      completeEvent(eventId, resultId) { calls.push(['event', eventId, resultId]); },
      complete(requestedWorkId) { calls.push(['work', requestedWorkId]); },
    },
  });

  const recovered = service.consumeAvailable(payload);
  assert.equal(recovered.retryAdmissionResult.terminalIntentState, 'stale');
  assert.equal(recovered.replayed, false);
  assert.deepEqual(calls, [
    ['begin', intentEventId],
    ['event', intentEventId, intentResultId],
    ['begin', admissionEventId],
    ['event', admissionEventId, admissionResultId],
    ['work', workId],
  ]);
  const receipt = unitOfWork.execute([recovered.inboxParticipant]);
  assert.equal(receipt.procurement_retry_intent_available_receipt.terminalIntentState, 'stale');

  calls.length = 0;
  const replay = service.consumeAvailable(payload);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.retryAdmissionResult, typedResult);
  assert.equal(admissionCalls, 2);
  assert.throws(
    () => service.consumeAvailable({ ...payload, unexpected: true }),
    (error) => error.code === 'FAILED_PREPARATION_RETRY_AVAILABLE_MESSAGE_INVALID',
  );
});

test('Dispatcher durably consumes and acknowledges Procurement Retry Intent Available exactly once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-retry-outbox-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const database = new Database(databasePath);
  const payload = Object.freeze({
    messageKind: 'procurement_retry_intent_available',
    retryIntentId: 'retry-intent-dispatch',
    fieldId: 'field-dispatch',
    failedRunId: 'failed-run-dispatch',
    intentStateRevision: 1,
    intentDigest: '1'.repeat(64),
    retryScopeDigest: '2'.repeat(64),
  });
  database.prepare(`
    INSERT INTO fx_outbox(
      message_id,producer_domain,message_kind,aggregate_type,aggregate_id,
      aggregate_revision,dedup_key,consumer_set_digest,intended_consumer_count,
      payload_schema_ref,payload_json,payload_digest,state,available_at_ms,
      created_at_ms,all_acked_at_ms
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'retry-message-dispatch', 'procurement', 'procurement_retry_intent_available',
    'procurement_retry_intent', payload.retryIntentId, 1,
    `procurement_retry_intent_available:${payload.retryIntentId}:1`,
    canonicalDigest(['procurement']), 1,
    'helix://contracts/application-types/ProcurementRetryIntentAvailableMessage/v1',
    canonicalJson(payload), canonicalDigest(payload), 'pending', 1, 1, null,
  );
  database.prepare(`
    INSERT INTO fx_outbox_deliveries(
      message_id,consumer_domain,state,attempt_count,next_attempt_at_ms,acked_at_ms
    ) VALUES(?,?,?,?,?,?)
  `).run('retry-message-dispatch', 'procurement', 'pending', 0, 1, null);
  database.close();
  const receiptRepository = createRepositoryDefinition({
    repositoryId: 'retry_dispatch_receipt',
    owner: 'procurement',
    readOnly: true,
    schemaManifest,
    statements: {
      find: {
        kind: 'select-one',
        tableId: 'proc_procurement_retry_intents',
        columns: ['retry_intent_id'],
        keyColumns: ['retry_intent_id'],
      },
    },
  });
  let consumed = 0;
  let wakes = 0;
  const admissionResultDigest = '3'.repeat(64);
  const dispatcher = createOutboxDispatcherHost({
    schemaManifest,
    unitOfWork,
    now: () => 10,
    failedPreparationRetryService: {
      consumeAvailable(received) {
        consumed += 1;
        assert.deepEqual(received, payload);
        return Object.freeze({
          retryAdmissionResult: Object.freeze({ terminalIntentState: 'consumed' }),
          resultDigest: admissionResultDigest,
          inboxParticipant: Object.freeze({
            participantId: 'procurement_retry_dispatch_receipt',
            owner: 'procurement',
            repositories: [receiptRepository],
            execute: () => Object.freeze({ retryIntentId: payload.retryIntentId }),
          }),
        });
      },
    },
    executionRuntimeHost: { wake() { wakes += 1; } },
    onError(error) { throw error; },
  });
  assert.deepEqual(await dispatcher.drainOnce(), { kind: 'advanced', delivered: 1 });
  assert.deepEqual(await dispatcher.drainOnce(), { kind: 'idle', delivered: 0 });
  assert.equal(consumed, 1);
  assert.equal(wakes, 1);
  const check = new Database(databasePath, { readonly: true });
  const outbox = check.prepare(`SELECT state,all_acked_at_ms FROM fx_outbox WHERE message_id=?`)
    .get('retry-message-dispatch');
  assert.equal(outbox.state, 'fully_acked');
  assert.ok(Number.isSafeInteger(outbox.all_acked_at_ms));
  const delivery = check.prepare(`SELECT state,acked_at_ms FROM fx_outbox_deliveries WHERE message_id=? AND consumer_domain=?`)
    .get('retry-message-dispatch', 'procurement');
  assert.equal(delivery.state, 'acked');
  assert.ok(Number.isSafeInteger(delivery.acked_at_ms));
  assert.equal(
    check.prepare(`SELECT count(*) count FROM fx_inbox WHERE message_id=? AND consumer_domain=?`)
      .get('retry-message-dispatch', 'procurement').count,
    1,
  );
  check.close();
  kernel.close();
});
