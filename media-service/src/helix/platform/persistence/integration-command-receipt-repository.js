'use strict';

const {
  canonicalDigest,
  canonicalJson,
} = require('../../contracts/canonical-json');
const {
  createRepositoryDefinition,
} = require('../../foundation/persistence/owner-repository');

const RESULT_SCHEMA_REF =
  'helix://implementation-contracts/platform-integrations/' +
  'admin-command-result/v1';

class IntegrationCommandReceiptError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'IntegrationCommandReceiptError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new IntegrationCommandReceiptError(code, message, details);
}

function decode(row) {
  if (!row) return undefined;
  let result;
  try {
    result = JSON.parse(row.result_ref_json);
  } catch (_error) {
    fail(
      'PLATFORM_INTEGRATION_COMMAND_RECEIPT_CORRUPT',
      'Integration command receipt Result JSON is invalid.',
    );
  }
  if (row.result_schema_ref !== RESULT_SCHEMA_REF ||
      row.result_digest !== canonicalDigest(result)) {
    fail(
      'PLATFORM_INTEGRATION_COMMAND_RECEIPT_CORRUPT',
      'Integration command receipt Result digest is invalid.',
    );
  }
  return Object.freeze({
    commandReceiptId: row.command_receipt_id,
    requestDigest: row.request_digest,
    result: Object.freeze(result),
    committedAtMs: row.committed_at_ms,
  });
}

function createIntegrationCommandReceiptRepository(options) {
  if (!options?.schemaManifest ||
      !options?.unitOfWork ||
      typeof options.unitOfWork.execute !== 'function') {
    throw new TypeError(
      'Integration command receipt repository requires schema and UoW.',
    );
  }
  const receipts = createRepositoryDefinition({
    repositoryId: 'platform_integration_command_receipts',
    owner: 'execution-foundation',
    schemaManifest: options.schemaManifest,
    statements: {
      find: {
        kind: 'select-one',
        tableId: 'fx_command_receipts',
        columns: [
          'command_receipt_id',
          'request_digest',
          'result_schema_ref',
          'result_ref_json',
          'result_digest',
          'committed_at_ms',
        ],
        keyColumns: [
          'owner_domain',
          'command_contract',
          'caller_scope',
          'idempotency_key',
        ],
      },
      insert: {
        kind: 'insert',
        tableId: 'fx_command_receipts',
        columns: [
          'command_receipt_id',
          'owner_domain',
          'command_contract',
          'caller_scope',
          'idempotency_key',
          'request_digest',
          'target_type',
          'target_id',
          'result_schema_ref',
          'result_ref_json',
          'result_digest',
          'committed_at_ms',
        ],
      },
    },
  });
  const markers = createRepositoryDefinition({
    repositoryId: 'platform_integration_command_markers',
    owner: 'execution-foundation',
    schemaManifest: options.schemaManifest,
    statements: {
      insert: {
        kind: 'insert',
        tableId: 'fx_commit_markers',
        columns: [
          'commit_marker',
          'effect_id',
          'owner_domain',
          'scope_type',
          'scope_id',
          'commit_digest',
          'committed_at_ms',
        ],
      },
    },
  });
  const audits = createRepositoryDefinition({
    repositoryId: 'platform_integration_command_audits',
    owner: 'execution-foundation',
    schemaManifest: options.schemaManifest,
    statements: {
      insert: {
        kind: 'insert',
        tableId: 'fx_audit_records',
        columns: [
          'audit_id',
          'owner_domain',
          'actor_type',
          'actor_id',
          'action',
          'scope_type',
          'scope_id',
          'work_id',
          'event_id',
          'evidence_digest',
          'occurred_at_ms',
        ],
      },
    },
  });

  function key(value) {
    return {
      owner_domain: 'platform-settings',
      command_contract: value.commandContract,
      caller_scope: 'admin-http',
      idempotency_key: value.idempotencyKey,
    };
  }

  function read(value) {
    return options.unitOfWork.execute([{
      participantId: 'platform_integration_receipt_read',
      owner: 'execution-foundation',
      repositories: [receipts],
      execute(context) {
        return decode(context.repository(
          receipts.repositoryId,
        ).invoke('find', key(value)));
      },
    }]).platform_integration_receipt_read;
  }

  function commit(value) {
    return options.unitOfWork.execute([{
      participantId: 'platform_integration_receipt_commit',
      owner: 'execution-foundation',
      repositories: [receipts, markers, audits],
      execute(context) {
        const receiptRepository = context.repository(
          receipts.repositoryId,
        );
        const existing = decode(receiptRepository.invoke(
          'find',
          key(value),
        ));
        if (existing) {
          if (existing.requestDigest !== value.requestDigest) {
            fail(
              'PLATFORM_INTEGRATION_IDEMPOTENCY_CONFLICT',
              'Integration idempotency key was used by another request.',
            );
          }
          return existing;
        }
        const resultJson = canonicalJson(value.result);
        if (Buffer.byteLength(resultJson, 'utf8') > 16 * 1024) {
          fail(
            'PLATFORM_INTEGRATION_COMMAND_RESULT_TOO_LARGE',
            'Integration command Result exceeds its receipt bound.',
          );
        }
        const commandReceiptId = canonicalDigest({
          schema: 'platform.integration-command-receipt-id@1',
          commandKind: value.commandKind,
          idempotencyKey: value.idempotencyKey,
          requestDigest: value.requestDigest,
        });
        const commitMarker = canonicalDigest({
          schema: 'platform.integration-command-marker@1',
          commandReceiptId,
        });
        const resultDigest = canonicalDigest(value.result);
        const committedAtMs = context.commitTimeMs;
        context.repository(markers.repositoryId).invoke('insert', {
          commit_marker: commitMarker,
          effect_id: null,
          owner_domain: 'platform-settings',
          scope_type: 'platform_integration',
          scope_id: 'tmdb-main',
          commit_digest: canonicalDigest({
            schema: 'platform.integration-command-commit@1',
            commandReceiptId,
            requestDigest: value.requestDigest,
            resultDigest,
          }),
          committed_at_ms: committedAtMs,
        });
        receiptRepository.invoke('insert', {
          command_receipt_id: commandReceiptId,
          owner_domain: 'platform-settings',
          command_contract: value.commandContract,
          caller_scope: 'admin-http',
          idempotency_key: value.idempotencyKey,
          request_digest: value.requestDigest,
          target_type: 'platform_integration',
          target_id: 'tmdb-main',
          result_schema_ref: RESULT_SCHEMA_REF,
          result_ref_json: resultJson,
          result_digest: resultDigest,
          committed_at_ms: committedAtMs,
        });
        context.repository(audits.repositoryId).invoke('insert', {
          audit_id: canonicalDigest({
            schema: 'platform.integration-command-audit-id@1',
            commandReceiptId,
          }),
          owner_domain: 'platform-settings',
          actor_type: 'admin_session',
          actor_id: null,
          action: 'platform.integration.' + value.commandKind,
          scope_type: 'platform_integration',
          scope_id: 'tmdb-main',
          work_id: null,
          event_id: null,
          evidence_digest: value.requestDigest,
          occurred_at_ms: committedAtMs,
        });
        return Object.freeze({
          commandReceiptId,
          requestDigest: value.requestDigest,
          result: Object.freeze(value.result),
          committedAtMs,
        });
      },
    }]).platform_integration_receipt_commit;
  }

  return Object.freeze({ commit, read });
}

module.exports = Object.freeze({
  IntegrationCommandReceiptError,
  createIntegrationCommandReceiptRepository,
});
