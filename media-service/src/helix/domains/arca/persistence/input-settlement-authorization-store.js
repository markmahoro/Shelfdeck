'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const SINGLETON_KEY = 'arca-input-settlement';
const AUTHORIZATION_ID = 'arca-input-settlement-standing';
const ENABLE_CONTRACT = 'arca.admin.input-settlement-authorization.enable@1';
const REVOKE_CONTRACT = 'arca.admin.input-settlement-authorization.revoke@1';
const RESULT_SCHEMA_REF = 'helix://contracts/application-results/ArcaInputSettlementAuthorizationResult/v1';

class ArcaInputSettlementAuthorizationStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArcaInputSettlementAuthorizationStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ArcaInputSettlementAuthorizationStoreError(code, message, details);
}

function text(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail('P14_INPUT_SETTLEMENT_AUTH_FIELD', 'Input Settlement Authorization field is required.', { field });
  return value;
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('P14_INPUT_SETTLEMENT_AUTH_REVISION', 'expectedRevision must be a non-negative integer.');
  return value;
}

function mapAuthorization(row) {
  if (!row) return null;
  const coversExclusiveRelatedInput = row.authorization_scope_kind === 'old_primary_and_exclusive_related'
    || row.authorization_scope_kind === 'exclusive_related_input';
  return Object.freeze({
    authorizationId: row.authorization_id,
    revision: Number(row.revision),
    state: row.state,
    authorizationScopeKind: row.authorization_scope_kind,
    coversExclusiveRelatedInput,
    actorId: row.actor_id,
    authorizationDigest: row.authorization_digest,
    effectiveAtMs: Number(row.effective_at_ms),
    revokedAtMs: Number(row.revoked_at_ms) || 0,
  });
}

function digestFor(row) {
  return canonicalDigest({
    schema: 'arca.input-settlement-authorization@1',
    authorizationId: row.authorization_id,
    revision: row.revision,
    state: row.state,
    authorizationScopeKind: row.authorization_scope_kind,
    actorId: row.actor_id,
    effectiveAtMs: row.effective_at_ms,
    revokedAtMs: row.revoked_at_ms,
  });
}

function createInputSettlementAuthorizationStore(options) {
  if (!options?.schemaManifest || !options?.unitOfWork) {
    throw new TypeError('Input Settlement Authorization store requires clean persistence dependencies.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'arca_input_settlement_authorization_repository',
    owner: 'arca',
    schemaManifest: options.schemaManifest,
    statements: {
      find_head: {
        kind: 'select-one',
        tableId: 'arca_input_settlement_authorization_head',
        columns: ['singleton_key', 'current_authorization_id', 'current_revision', 'updated_at_ms'],
        keyColumns: ['singleton_key'],
        safeIntegers: true,
      },
      find_authorization: {
        kind: 'select-one',
        tableId: 'arca_input_settlement_authorizations',
        columns: ['authorization_id', 'revision', 'state', 'authorization_scope_kind', 'actor_id', 'authorization_digest', 'effective_at_ms', 'revoked_at_ms'],
        keyColumns: ['authorization_id', 'revision'],
        safeIntegers: true,
      },
      insert_authorization: {
        kind: 'insert',
        tableId: 'arca_input_settlement_authorizations',
        columns: ['authorization_id', 'revision', 'state', 'authorization_scope_kind', 'actor_id', 'authorization_digest', 'effective_at_ms', 'revoked_at_ms'],
      },
      insert_head: {
        kind: 'insert',
        tableId: 'arca_input_settlement_authorization_head',
        columns: ['singleton_key', 'current_authorization_id', 'current_revision', 'updated_at_ms'],
      },
      advance_head: {
        kind: 'update',
        tableId: 'arca_input_settlement_authorization_head',
        setColumns: ['current_authorization_id', 'current_revision', 'updated_at_ms'],
        keyColumns: ['singleton_key'],
        compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }],
      },
    },
  });
  const commandCommit = createCommandCommitCoordinator({
    schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork,
  });
  const execute = (body) => options.unitOfWork.execute([{
    participantId: 'arca_input_settlement_authorization_read',
    owner: 'arca',
    repositories: [repository],
    execute: body,
  }]).arca_input_settlement_authorization_read;

  function current() {
    return execute((context) => {
      const repo = context.repository(repository.repositoryId);
      const head = repo.invoke('find_head', { singleton_key: SINGLETON_KEY });
      if (!head) return null;
      const row = repo.invoke('find_authorization', {
        authorization_id: head.current_authorization_id,
        revision: Number(head.current_revision),
      });
      if (!row) fail('P14_INPUT_SETTLEMENT_AUTH_POINTER_BROKEN', 'Input Settlement Authorization head does not resolve.');
      return mapAuthorization(row);
    });
  }

  function publish(commandContract, request, desired) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      fail('P14_INPUT_SETTLEMENT_AUTH_COMMAND', 'Input Settlement Authorization command is required.');
    }
    const idempotencyKey = text(request.idempotencyKey, 'idempotencyKey');
    const expected = expectedRevision(request.expectedRevision);
    const actorId = text(request.actorId, 'actorId');
    const requestDigest = canonicalDigest({
      commandContract,
      expectedRevision: expected,
      state: desired.state,
      authorizationScopeKind: desired.authorizationScopeKind,
    });
    const keyDigest = canonicalDigest({ commandContract, idempotencyKey });
    const committed = commandCommit.execute({
      command: {
        commandReceiptId: 'arca-settlement-auth-receipt-' + keyDigest.slice(0, 32),
        ownerDomain: 'arca',
        commandContract,
        callerScope: 'admin',
        idempotencyKey,
        requestDigest,
        targetType: 'input_settlement_authorization',
        targetId: AUTHORIZATION_ID,
      },
      domainParticipant: {
        participantId: 'arca_input_settlement_authorization_write',
        owner: 'arca',
        repositories: [repository],
        execute(context) {
          const repo = context.repository(repository.repositoryId);
          const head = repo.invoke('find_head', { singleton_key: SINGLETON_KEY });
          const currentRevision = head ? Number(head.current_revision) : 0;
          if (currentRevision !== expected) {
            fail('P14_INPUT_SETTLEMENT_AUTH_CAS', 'Input Settlement Authorization revision is stale.');
          }
          const existing = currentRevision === 0 ? null : mapAuthorization(repo.invoke('find_authorization', {
            authorization_id: AUTHORIZATION_ID,
            revision: currentRevision,
          }));
          const alreadyMatches = desired.state === 'enabled'
            ? existing?.state === 'enabled' && existing.authorizationScopeKind === desired.authorizationScopeKind
            : !existing || existing.state === 'revoked';
          if (alreadyMatches) return existing;
          const nextRevision = currentRevision + 1;
          const row = {
            authorization_id: AUTHORIZATION_ID,
            revision: nextRevision,
            state: desired.state,
            authorization_scope_kind: desired.authorizationScopeKind,
            actor_id: actorId,
            effective_at_ms: context.commitTimeMs,
            revoked_at_ms: desired.state === 'revoked' ? context.commitTimeMs : 0,
          };
          row.authorization_digest = digestFor(row);
          repo.invoke('insert_authorization', row);
          if (!head) {
            repo.invoke('insert_head', {
              singleton_key: SINGLETON_KEY,
              current_authorization_id: AUTHORIZATION_ID,
              current_revision: nextRevision,
              updated_at_ms: context.commitTimeMs,
            });
          } else if (repo.invoke('advance_head', {
            current_authorization_id: AUTHORIZATION_ID,
            current_revision: nextRevision,
            updated_at_ms: context.commitTimeMs,
            singleton_key: SINGLETON_KEY,
            expected_current_revision: currentRevision,
          }).changes !== 1) {
            fail('P14_INPUT_SETTLEMENT_AUTH_CAS', 'Input Settlement Authorization head CAS failed.');
          }
          return mapAuthorization(row);
        },
      },
      commitMarker: {
        commitMarker: 'arca-settlement-auth-' + keyDigest,
        scopeType: 'input_settlement_authorization',
        scopeId: AUTHORIZATION_ID,
        commitDigest: canonicalDigest({ commandContract, requestDigest }),
      },
      auditRecords: [{
        auditId: 'arca-settlement-auth-audit-' + keyDigest.slice(0, 32),
        actorType: 'admin',
        actorId,
        action: desired.state === 'enabled' ? 'enable_input_settlement_authorization' : 'revoke_input_settlement_authorization',
        scopeType: 'input_settlement_authorization',
        scopeId: AUTHORIZATION_ID,
        evidenceDigest: requestDigest,
      }],
      resultEnvelope: (authorization) => ({
        resultSchemaRef: RESULT_SCHEMA_REF,
        resultRef: {
          authorizationId: AUTHORIZATION_ID,
          revision: authorization ? authorization.revision : 0,
        },
      }),
    });
    return Object.freeze({
      authorization: current(),
      replayed: committed.replayed,
    });
  }

  return Object.freeze({
    current,
    enable(request) {
      const coverExclusiveRelatedInput = request?.coverExclusiveRelatedInput;
      if (coverExclusiveRelatedInput !== true && coverExclusiveRelatedInput !== false) {
        fail('P14_INPUT_SETTLEMENT_AUTH_SCOPE', 'coverExclusiveRelatedInput must be an explicit boolean.');
      }
      return publish(ENABLE_CONTRACT, request, {
        state: 'enabled',
        authorizationScopeKind: coverExclusiveRelatedInput
          ? 'old_primary_and_exclusive_related'
          : 'old_primary_input',
      });
    },
    revoke(request) {
      return publish(REVOKE_CONTRACT, request, {
        state: 'revoked',
        authorizationScopeKind: 'old_primary_and_exclusive_related',
      });
    },
  });
}

module.exports = Object.freeze({
  AUTHORIZATION_ID,
  SINGLETON_KEY,
  ArcaInputSettlementAuthorizationStoreError,
  createInputSettlementAuthorizationStore,
});
