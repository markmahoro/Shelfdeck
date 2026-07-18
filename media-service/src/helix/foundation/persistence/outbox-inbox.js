'use strict';

const { digest } = require('./ddl-compiler');
const { createRepositoryDefinition } = require('./owner-repository');

const SHA256 = /^[0-9a-f]{64}$/;
const PAYLOAD_KEY = /^[a-z][A-Za-z0-9]*(?:Id|Ids|Revision|Digest)$/;

class MessagePersistenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MessagePersistenceError';
    this.code = code;
    this.details = details;
  }
}

class InboxReplay extends Error {
  constructor(record) {
    super('Inbox replay');
    this.record = record;
  }
}

function fail(code, message, details) {
  throw new MessagePersistenceError(code, message, details);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function text(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail('P3_MESSAGE_INVALID_FIELD', 'Message field is required.', { field });
  return value;
}

function sha(value, field) {
  if (!SHA256.test(value || '')) fail('P3_MESSAGE_INVALID_DIGEST', 'Message digest must be lowercase SHA-256.', { field });
  return value;
}

function assertPayload(value, path = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('P3_OUTBOX_INVALID_PAYLOAD', 'Outbox payload must be a typed reference object.', { path });
  for (const [key, member] of Object.entries(value)) {
    if (key !== 'messageKind' && !PAYLOAD_KEY.test(key)) fail('P3_OUTBOX_PAYLOAD_AUTHORITY_ESCAPE', 'Outbox payload may contain only its message discriminator plus ID, revision, and digest references.', { path, key });
    if (Array.isArray(member)) {
      if (member.length > 256 || member.some((item) => !['string', 'number'].includes(typeof item))) fail(
        'P3_OUTBOX_INVALID_PAYLOAD', 'Outbox reference arrays must be bounded scalar lists.', { path, key }
      );
    } else if (!['string', 'number'].includes(typeof member)) {
      fail('P3_OUTBOX_INVALID_PAYLOAD', 'Outbox reference values must be scalar.', { path, key });
    }
  }
}

function definitions(schemaManifest) {
  return Object.freeze({
    outbox: createRepositoryDefinition({
      repositoryId: 'outbox', owner: 'execution-foundation', schemaManifest,
      statements: {
        insert_message: {
          kind: 'insert', tableId: 'fx_outbox',
          columns: ['message_id', 'producer_domain', 'message_kind', 'aggregate_type', 'aggregate_id', 'aggregate_revision',
            'dedup_key', 'consumer_set_digest', 'intended_consumer_count', 'payload_schema_ref', 'payload_json', 'payload_digest',
            'state', 'available_at_ms', 'created_at_ms', 'all_acked_at_ms']
        },
        find_message: {
          kind: 'select-one', tableId: 'fx_outbox',
          columns: ['message_id', 'producer_domain', 'dedup_key', 'consumer_set_digest', 'intended_consumer_count', 'state'],
          keyColumns: ['message_id']
        },
        mark_all_acked: {
          kind: 'update', tableId: 'fx_outbox', setColumns: ['state', 'all_acked_at_ms'], keyColumns: ['message_id']
        }
      }
    }),
    deliveries: createRepositoryDefinition({
      repositoryId: 'outbox_deliveries', owner: 'execution-foundation', schemaManifest,
      statements: {
        insert_delivery: {
          kind: 'insert', tableId: 'fx_outbox_deliveries',
          columns: ['message_id', 'consumer_domain', 'state', 'attempt_count', 'next_attempt_at_ms', 'acked_at_ms']
        },
        find_delivery: {
          kind: 'select-one', tableId: 'fx_outbox_deliveries',
          columns: ['message_id', 'consumer_domain', 'state', 'attempt_count', 'next_attempt_at_ms', 'acked_at_ms'],
          keyColumns: ['message_id', 'consumer_domain']
        },
        list_deliveries: {
          kind: 'select-all', tableId: 'fx_outbox_deliveries',
          columns: ['message_id', 'consumer_domain', 'state', 'attempt_count', 'next_attempt_at_ms', 'acked_at_ms'],
          keyColumns: ['message_id']
        },
        update_delivery: {
          kind: 'update', tableId: 'fx_outbox_deliveries',
          setColumns: ['state', 'attempt_count', 'next_attempt_at_ms', 'acked_at_ms'], keyColumns: ['message_id', 'consumer_domain']
        }
      }
    }),
    inbox: createRepositoryDefinition({
      repositoryId: 'inbox', owner: 'execution-foundation', schemaManifest,
      statements: {
        find_message: {
          kind: 'select-one', tableId: 'fx_inbox',
          columns: ['consumer_domain', 'message_id', 'dedup_key', 'received_at_ms', 'consumed_at_ms', 'result_digest'],
          keyColumns: ['consumer_domain', 'message_id']
        },
        find_dedup: {
          kind: 'select-one', tableId: 'fx_inbox',
          columns: ['consumer_domain', 'message_id', 'dedup_key', 'received_at_ms', 'consumed_at_ms', 'result_digest'],
          keyColumns: ['consumer_domain', 'dedup_key']
        },
        insert_inbox: {
          kind: 'insert', tableId: 'fx_inbox',
          columns: ['consumer_domain', 'message_id', 'dedup_key', 'received_at_ms', 'consumed_at_ms', 'result_digest']
        }
      }
    })
  });
}

function createOutboxParticipant(options) {
  if (!options || !options.schemaManifest || typeof options.producerDomain !== 'string' || !Array.isArray(options.messages) || options.messages.length === 0) {
    fail('P3_OUTBOX_INVALID_PARTICIPANT', 'Schema manifest and at least one Outbox message are required.');
  }
  const repository = definitions(options.schemaManifest);
  return Object.freeze({
    participantId: options.participantId || 'outbox_publish',
    owner: 'execution-foundation',
    boundBusinessOwner: options.producerDomain,
    repositories: [repository.outbox, repository.deliveries],
    execute(context) {
      const published = [];
      for (const message of options.messages) {
        if (message.producerDomain !== options.producerDomain) fail('P3_OUTBOX_PRODUCER_OWNER_MISMATCH', 'Message producer does not match the publishing Business Owner.');
        const consumers = [...new Set(message.intendedConsumers || [])].sort();
        if (consumers.length === 0 || consumers.length !== (message.intendedConsumers || []).length ||
            consumers.some((consumer) => typeof consumer !== 'string' || consumer.length === 0)) {
          fail('P3_OUTBOX_INVALID_CONSUMER_SET', 'Intended consumers must be non-empty, unique, and explicit.');
        }
        assertPayload(message.payload);
        const payloadJson = canonicalJson(message.payload);
        if (new TextEncoder().encode(payloadJson).byteLength > 16384) fail('P3_OUTBOX_PAYLOAD_TOO_LARGE', 'Outbox payload exceeds 16 KiB.');
        const consumerSetDigest = digest(canonicalJson(consumers));
        const payloadDigest = digest(payloadJson);
        const availableAtMs = message.availableAtMs === undefined ? context.commitTimeMs : message.availableAtMs;
        if (!Number.isSafeInteger(message.aggregateRevision) || message.aggregateRevision < 1 ||
            !Number.isSafeInteger(availableAtMs) || availableAtMs < context.commitTimeMs) {
          fail('P3_OUTBOX_INVALID_REVISION_OR_TIME', 'Aggregate revision and available time are invalid.');
        }
        context.repository('outbox').invoke('insert_message', {
          message_id: text(message.messageId, 'messageId'),
          producer_domain: text(message.producerDomain, 'producerDomain'),
          message_kind: text(message.messageKind, 'messageKind'),
          aggregate_type: text(message.aggregateType, 'aggregateType'),
          aggregate_id: text(message.aggregateId, 'aggregateId'),
          aggregate_revision: message.aggregateRevision,
          dedup_key: text(message.dedupKey, 'dedupKey'),
          consumer_set_digest: consumerSetDigest,
          intended_consumer_count: consumers.length,
          payload_schema_ref: text(message.payloadSchemaRef, 'payloadSchemaRef'),
          payload_json: payloadJson,
          payload_digest: payloadDigest,
          state: 'pending',
          available_at_ms: availableAtMs,
          created_at_ms: context.commitTimeMs,
          all_acked_at_ms: null
        });
        for (const consumer of consumers) context.repository('outbox_deliveries').invoke('insert_delivery', {
          message_id: message.messageId,
          consumer_domain: consumer,
          state: 'pending',
          attempt_count: 0,
          next_attempt_at_ms: availableAtMs,
          acked_at_ms: null
        });
        published.push(Object.freeze({ messageId: message.messageId, consumerSetDigest, payloadDigest, intendedConsumers: Object.freeze(consumers) }));
      }
      return Object.freeze(published);
    }
  });
}

function createInboxCoordinator(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P3_INBOX_INVALID_COORDINATOR', 'Schema manifest and SqliteUnitOfWork are required.');
  }
  const repository = definitions(options.schemaManifest);
  return Object.freeze({
    consume(request) {
      if (!request || !request.message || !request.domainParticipant || request.domainParticipant.owner !== request.message.consumerDomain) {
        fail('P3_INBOX_INVALID_CONSUME', 'Message consumer and Domain participant Owner must match.');
      }
      const message = request.message;
      sha(request.resultDigest, 'resultDigest');
      let domainResult;
      try {
        const results = options.unitOfWork.execute([
          {
            participantId: 'inbox_preflight', owner: 'execution-foundation', boundBusinessOwner: message.consumerDomain, repositories: [repository.inbox],
            execute(context) {
              const inbox = context.repository('inbox');
              const byMessage = inbox.invoke('find_message', {
                consumer_domain: text(message.consumerDomain, 'consumerDomain'), message_id: text(message.messageId, 'messageId')
              });
              const byDedup = inbox.invoke('find_dedup', {
                consumer_domain: message.consumerDomain, dedup_key: text(message.dedupKey, 'dedupKey')
              });
              const existing = byMessage || byDedup;
              if (!existing) return;
              if (existing.message_id !== message.messageId || existing.dedup_key !== message.dedupKey || existing.result_digest !== request.resultDigest) {
                fail('P3_INBOX_DEDUP_CONFLICT', 'Inbox message/dedup key conflicts with an existing consumption result.');
              }
              throw new InboxReplay(Object.freeze({ ...existing }));
            }
          },
          {
            ...request.domainParticipant,
            execute(context) {
              domainResult = request.domainParticipant.execute(context);
              return domainResult;
            }
          },
          {
            participantId: 'inbox_commit', owner: 'execution-foundation', boundBusinessOwner: message.consumerDomain, repositories: [repository.inbox],
            execute(context) {
              context.repository('inbox').invoke('insert_inbox', {
                consumer_domain: message.consumerDomain,
                message_id: message.messageId,
                dedup_key: message.dedupKey,
                received_at_ms: context.commitTimeMs,
                consumed_at_ms: context.commitTimeMs,
                result_digest: request.resultDigest
              });
              return Object.freeze({ messageId: message.messageId, consumedAtMs: context.commitTimeMs, resultDigest: request.resultDigest });
            }
          }
        ]);
        return Object.freeze({ replayed: false, inbox: results.inbox_commit, domainResult: results[request.domainParticipant.participantId] });
      } catch (error) {
        if (error instanceof InboxReplay) return Object.freeze({ replayed: true, inbox: error.record, domainResult: undefined });
        throw error;
      }
    },
    recordDeliveryAttempt(request) {
      return options.unitOfWork.execute([{
        participantId: 'delivery_attempt', owner: 'execution-foundation', repositories: [repository.deliveries],
        execute(context) {
          const deliveries = context.repository('outbox_deliveries');
          const existing = deliveries.invoke('find_delivery', {
            message_id: text(request.messageId, 'messageId'), consumer_domain: text(request.consumerDomain, 'consumerDomain')
          });
          if (!existing) fail('P3_DELIVERY_NOT_FOUND', 'Outbox Delivery does not exist.');
          if (existing.state === 'acked') return Object.freeze({ replayed: true, state: 'acked' });
          const delivered = request.delivered === true;
          const nextAttemptAtMs = delivered ? context.commitTimeMs : request.nextAttemptAtMs;
          if (!Number.isSafeInteger(nextAttemptAtMs) || nextAttemptAtMs < context.commitTimeMs) fail(
            'P3_DELIVERY_INVALID_RETRY_TIME', 'Delivery retry time must not be in the past.'
          );
          deliveries.invoke('update_delivery', {
            state: delivered ? 'delivered' : 'pending',
            attempt_count: existing.attempt_count + 1,
            next_attempt_at_ms: nextAttemptAtMs,
            acked_at_ms: null,
            message_id: request.messageId,
            consumer_domain: request.consumerDomain
          });
          return Object.freeze({ replayed: false, state: delivered ? 'delivered' : 'pending', attemptCount: existing.attempt_count + 1 });
        }
      }]).delivery_attempt;
    },
    acknowledge(request) {
      return options.unitOfWork.execute([{
        participantId: 'delivery_ack', owner: 'execution-foundation', repositories: [repository.inbox, repository.outbox, repository.deliveries],
        execute(context) {
          const inbox = context.repository('inbox').invoke('find_message', {
            consumer_domain: text(request.consumerDomain, 'consumerDomain'), message_id: text(request.messageId, 'messageId')
          });
          if (!inbox) fail('P3_ACK_BEFORE_CONSUME', 'Delivery cannot be acknowledged before durable Inbox consumption.');
          const deliveries = context.repository('outbox_deliveries');
          const existing = deliveries.invoke('find_delivery', {
            message_id: request.messageId, consumer_domain: request.consumerDomain
          });
          if (!existing) fail('P3_DELIVERY_NOT_FOUND', 'Outbox Delivery does not exist.');
          if (existing.state === 'acked') {
            const all = deliveries.invoke('list_deliveries', { message_id: request.messageId });
            return Object.freeze({
              replayed: true,
              allAcked: all.length > 0 && all.every((delivery) => delivery.state === 'acked'),
              ackedAtMs: existing.acked_at_ms
            });
          }
          deliveries.invoke('update_delivery', {
            state: 'acked', attempt_count: existing.attempt_count, next_attempt_at_ms: existing.next_attempt_at_ms,
            acked_at_ms: context.commitTimeMs, message_id: request.messageId, consumer_domain: request.consumerDomain
          });
          const all = deliveries.invoke('list_deliveries', { message_id: request.messageId });
          if (all.length === 0) fail('P3_DELIVERY_SET_EMPTY', 'Outbox message has no frozen Delivery set.');
          const allAcked = all.every((delivery) => delivery.consumer_domain === request.consumerDomain ? true : delivery.state === 'acked');
          if (allAcked) context.repository('outbox').invoke('mark_all_acked', {
            state: 'fully_acked', all_acked_at_ms: context.commitTimeMs, message_id: request.messageId
          });
          return Object.freeze({ replayed: false, allAcked, ackedAtMs: context.commitTimeMs });
        }
      }]).delivery_ack;
    }
  });
}

module.exports = Object.freeze({ MessagePersistenceError, createInboxCoordinator, createOutboxParticipant });
