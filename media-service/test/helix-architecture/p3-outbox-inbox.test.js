'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { createInboxCoordinator, createOutboxParticipant } = require('../../src/helix/foundation/persistence/outbox-inbox');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

const subjects = createRepositoryDefinition({
  repositoryId: 'subjects', owner: 'libra', schemaManifest,
  statements: { insert: { kind: 'insert', tableId: 'libra_routing_policy_revisions', columns: ['routing_policy_id','revision','field_id','mode','policy_schema_ref','policy_json','policy_digest','effective_at_ms'] } }
});
const shelves = createRepositoryDefinition({
  repositoryId: 'shelves', owner: 'arca', schemaManifest,
  statements: { insert: { kind: 'insert', tableId: 'arca_shelves', columns: ['shelf_id', 'name', 'status', 'created_at_ms'] } }
});
const perceptionSources = createRepositoryDefinition({
  repositoryId: 'perception_sources', owner: 'perception', schemaManifest,
  statements: { insert: { kind: 'insert', tableId: 'perception_sources', columns: ['perception_source_id', 'source_kind', 'status', 'created_at_ms'] } }
});

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-outbox-inbox-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let tick = 1700000000400;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => tick++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const inbox = createInboxCoordinator({ schemaManifest, unitOfWork });
  try {
    return run({ databasePath, inbox, kernel, unitOfWork });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function message(overrides = {}) {
  return {
    messageId: overrides.messageId || 'message-1',
    producerDomain: overrides.producerDomain || 'libra',
    messageKind: 'subject.changed',
    aggregateType: 'subject',
    aggregateId: overrides.aggregateId || 'subject-1',
    aggregateRevision: 1,
    dedupKey: overrides.dedupKey || 'subject-1/revision-1',
    intendedConsumers: overrides.intendedConsumers || ['perception', 'arca'],
    payloadSchemaRef: 'helix://contracts/types/SubjectChangedSignal/v1',
    payload: overrides.payload || { subjectId: overrides.aggregateId || 'subject-1', subjectRevision: 1, factDigest: digest('fact-1') }
  };
}

function publish(unitOfWork, value = message(), subjectId = 'subject-1') {
  return unitOfWork.execute([
    {
      participantId: 'libra', owner: 'libra', repositories: [subjects],
      execute(context) {
        context.repository('subjects').invoke('insert', {
          routing_policy_id:subjectId,revision:1,field_id:'fixture-field',mode:'direct',policy_schema_ref:'helix://fixtures/routing-policy/v1',policy_json:'{}',policy_digest:digest({subjectId}),effective_at_ms:context.commitTimeMs
        });
      }
    },
    createOutboxParticipant({ schemaManifest, participantId: 'outbox', producerDomain: 'libra', messages: [value] })
  ]);
}

function inspect(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  return {
    database,
    counts: {
      subjects: database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count,
      messages: database.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count,
      deliveries: database.prepare('SELECT COUNT(*) count FROM fx_outbox_deliveries').get().count,
      inbox: database.prepare('SELECT COUNT(*) count FROM fx_inbox').get().count
    }
  };
}

test('freezes the complete intended consumer set with the Owner fact in one transaction', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    const result = publish(unitOfWork);
    assert.deepEqual(result.outbox[0].intendedConsumers, ['arca', 'perception']);
    kernel.close();
    const state = inspect(databasePath);
    assert.deepEqual(state.counts, { subjects: 1, messages: 1, deliveries: 2, inbox: 0 });
    const outbox = state.database.prepare('SELECT intended_consumer_count,consumer_set_digest,payload_digest,state FROM fx_outbox').get();
    assert.equal(outbox.intended_consumer_count, 2);
    assert.equal(outbox.consumer_set_digest, digest(JSON.stringify(['arca', 'perception'])));
    assert.equal(outbox.state, 'pending');
    state.database.close();
  });
});

test('invalid or duplicate frozen consumers and payload authority escape roll back the Owner fact', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    assert.throws(() => publish(unitOfWork, message({ intendedConsumers: ['arca', 'arca'] })), (error) => error.code === 'P3_OUTBOX_INVALID_CONSUMER_SET');
    assert.throws(() => publish(unitOfWork, message({ payload: { sourcePath: 'C:/escape' } })), (error) => error.code === 'P3_OUTBOX_PAYLOAD_AUTHORITY_ESCAPE');
    assert.throws(() => publish(unitOfWork, message({ producerDomain: 'arca' })), (error) => error.code === 'P3_OUTBOX_PRODUCER_OWNER_MISMATCH');
    kernel.close();
    const state = inspect(databasePath);
    assert.deepEqual(state.counts, { subjects: 0, messages: 0, deliveries: 0, inbox: 0 });
    state.database.close();
  });
});

test('producer dedup conflict rolls back the second Owner fact and Outbox message', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    publish(unitOfWork);
    assert.throws(() => publish(unitOfWork, message({
      messageId: 'message-2', aggregateId: 'subject-2', dedupKey: 'subject-1/revision-1'
    }), 'subject-2'), /UNIQUE constraint failed: fx_outbox.producer_domain, fx_outbox.dedup_key/);
    kernel.close();
    const state = inspect(databasePath);
    assert.deepEqual(state.counts, { subjects: 1, messages: 1, deliveries: 2, inbox: 0 });
    state.database.close();
  });
});

test('duplicate delivery and consume-before-ack recover forward without duplicate Consumer facts', () => {
  fixture(({ databasePath, inbox, kernel, unitOfWork }) => {
    publish(unitOfWork);
    assert.equal(inbox.recordDeliveryAttempt({ messageId: 'message-1', consumerDomain: 'arca', delivered: true }).attemptCount, 1);
    assert.equal(inbox.recordDeliveryAttempt({ messageId: 'message-1', consumerDomain: 'arca', delivered: true }).attemptCount, 2);
    assert.throws(() => inbox.acknowledge({ messageId: 'message-1', consumerDomain: 'arca' }), (error) => error.code === 'P3_ACK_BEFORE_CONSUME');
    const consumeRequest = {
      message: { consumerDomain: 'arca', messageId: 'message-1', dedupKey: 'subject-1/revision-1' },
      resultDigest: digest('arca-consume-result'),
      domainParticipant: {
        participantId: 'arca', owner: 'arca', repositories: [shelves],
        execute(context) {
          context.repository('shelves').invoke('insert', {
            shelf_id: 'shelf-1', name: 'Shelf', status: 'active', created_at_ms: context.commitTimeMs
          });
          return { shelfId: 'shelf-1' };
        }
      }
    };
    assert.equal(inbox.consume(consumeRequest).replayed, false);
    assert.equal(inbox.consume({
      ...consumeRequest,
      domainParticipant: { ...consumeRequest.domainParticipant, execute() { throw new Error('must not repeat'); } }
    }).replayed, true);
    let conflictDomainCalled = false;
    assert.throws(() => inbox.consume({
      message: { consumerDomain: 'arca', messageId: 'message-2', dedupKey: 'subject-1/revision-1' },
      resultDigest: digest('arca-consume-result'),
      domainParticipant: {
        ...consumeRequest.domainParticipant,
        execute() { conflictDomainCalled = true; }
      }
    }), (error) => error.code === 'P3_INBOX_DEDUP_CONFLICT');
    assert.equal(conflictDomainCalled, false);
    assert.equal(inbox.acknowledge({ messageId: 'message-1', consumerDomain: 'arca' }).allAcked, false);
    kernel.close();
    const state = inspect(databasePath);
    assert.equal(state.database.prepare('SELECT COUNT(*) count FROM arca_shelves').get().count, 1);
    assert.equal(state.database.prepare("SELECT state FROM fx_outbox_deliveries WHERE consumer_domain='arca'").get().state, 'acked');
    assert.equal(state.database.prepare('SELECT state FROM fx_outbox').get().state, 'pending');
    state.database.close();
  });
});

test('last durable Inbox ack closes only technical delivery state and duplicate ack is stable', () => {
  fixture(({ databasePath, inbox, kernel, unitOfWork }) => {
    publish(unitOfWork);
    const consumers = [
      ['arca', shelves, 'shelves', 'insert', { shelf_id: 'shelf-1', name: 'Shelf', status: 'active' }],
      ['perception', perceptionSources, 'perception_sources', 'insert', { perception_source_id: 'source-1', source_kind: 'domain_signal', status: 'active' }]
    ];
    for (const [owner, repository, repositoryId, statementId, values] of consumers) {
      inbox.consume({
        message: { consumerDomain: owner, messageId: 'message-1', dedupKey: 'subject-1/revision-1' },
        resultDigest: digest(owner + '-result'),
        domainParticipant: {
          participantId: owner, owner, repositories: [repository],
          execute(context) { context.repository(repositoryId).invoke(statementId, { ...values, created_at_ms: context.commitTimeMs }); }
        }
      });
      const ack = inbox.acknowledge({ messageId: 'message-1', consumerDomain: owner });
      assert.equal(ack.allAcked, owner === 'perception');
    }
    const replayedAck = inbox.acknowledge({ messageId: 'message-1', consumerDomain: 'perception' });
    assert.equal(replayedAck.replayed, true);
    kernel.close();
    const state = inspect(databasePath);
    const outbox = state.database.prepare('SELECT state,all_acked_at_ms FROM fx_outbox').get();
    assert.equal(outbox.state, 'fully_acked');
    assert.ok(outbox.all_acked_at_ms > 0);
    assert.equal(outbox.all_acked_at_ms, replayedAck.ackedAtMs);
    assert.equal(state.database.prepare("SELECT COUNT(*) count FROM fx_outbox_deliveries WHERE state='acked'").get().count, 2);
    state.database.close();
  });
});

test('startup rejects tampered frozen consumers and ack without Inbox', () => {
  fixture(({ databasePath, kernel, unitOfWork }) => {
    publish(unitOfWork);
    kernel.close();
    const changed = new Database(databasePath);
    changed.pragma('foreign_keys = OFF');
    changed.prepare("INSERT INTO fx_outbox_deliveries(message_id,consumer_domain,state,attempt_count) VALUES('message-1','people','pending',0)").run();
    changed.close();
    assert.throws(() => openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest }),
      (error) => error.code === 'P3_SQLITE_OUTBOX_CONSISTENCY_DRIFT');
  });

  fixture(({ databasePath, kernel, unitOfWork }) => {
    publish(unitOfWork);
    kernel.close();
    const changed = new Database(databasePath);
    changed.prepare("UPDATE fx_outbox_deliveries SET state='acked',acked_at_ms=1 WHERE consumer_domain='arca'").run();
    changed.close();
    assert.throws(() => openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest }),
      (error) => error.code === 'P3_SQLITE_ACK_WITHOUT_INBOX');
  });
});
