'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const DEFAULT_PREDECK_PIPELINE_SEATS = 3;
const MIN_PREDECK_PIPELINE_SEATS = 0;
const MAX_PREDECK_PIPELINE_SEATS = 8;

class PredeckPipelineAdmissionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PredeckPipelineAdmissionStoreError';
    this.code = code;
    this.details = details;
  }
}
function fail(code, message, details) { throw new PredeckPipelineAdmissionStoreError(code, message, details); }

function createPredeckPipelineAdmissionStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.now !== 'function') {
    fail('P14_PREDECK_PIPELINE_ADMISSION_DEPENDENCIES', 'Pre-deck pipeline admission store requires persistence and clock.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_predeck_pipeline_admission',
    owner: 'libra',
    schemaManifest: options.schemaManifest,
    statements: {
      find_policy: {
        kind: 'select-one',
        tableId: 'libra_field_intake_admission_policies',
        columns: ['field_id', 'predeck_pipeline_seats', 'policy_revision', 'updated_at_ms'],
        keyColumns: ['field_id'],
      },
      insert_policy: {
        kind: 'insert',
        tableId: 'libra_field_intake_admission_policies',
        columns: ['field_id', 'predeck_pipeline_seats', 'policy_revision', 'updated_at_ms'],
      },
      update_policy: {
        kind: 'update',
        tableId: 'libra_field_intake_admission_policies',
        setColumns: ['predeck_pipeline_seats', 'policy_revision', 'updated_at_ms'],
        keyColumns: ['field_id'],
      },
      list_tokens_for_field: {
        kind: 'select-all',
        tableId: 'libra_predeck_pipeline_tokens',
        columns: ['subject_id', 'source_field_id', 'source_process_id', 'acquired_at_ms'],
        keyColumns: ['source_field_id'],
      },
      list_tokens: {
        kind: 'select-all',
        tableId: 'libra_predeck_pipeline_tokens',
        columns: ['subject_id', 'source_field_id', 'source_process_id', 'acquired_at_ms'],
        keyColumns: [],
      },
      find_token: {
        kind: 'select-one',
        tableId: 'libra_predeck_pipeline_tokens',
        columns: ['subject_id', 'source_field_id', 'source_process_id', 'acquired_at_ms'],
        keyColumns: ['subject_id'],
      },
      insert_token: {
        kind: 'insert',
        tableId: 'libra_predeck_pipeline_tokens',
        columns: ['subject_id', 'source_field_id', 'source_process_id', 'acquired_at_ms'],
      },
      delete_token: {
        kind: 'delete',
        tableId: 'libra_predeck_pipeline_tokens',
        keyColumns: ['subject_id'],
      },
    },
  });

  function execute(participantId, body) {
    return options.unitOfWork.execute([{
      participantId,
      owner: 'libra',
      repositories: [repository],
      execute: body,
    }])[participantId];
  }

  function normalizeSeats(value) {
    if (!Number.isSafeInteger(value) || value < MIN_PREDECK_PIPELINE_SEATS || value > MAX_PREDECK_PIPELINE_SEATS) {
      fail('P14_PREDECK_PIPELINE_SEATS_INVALID', 'Pre-deck pipeline seats must be an integer from 0 to 8.', { value });
    }
    return value;
  }

  function readPolicyRow(fieldId, context) {
    return context.repository(repository.repositoryId).invoke('find_policy', { field_id: fieldId }) || null;
  }

  function ensurePolicy(fieldId, context) {
    const existing = readPolicyRow(fieldId, context);
    if (existing) return existing;
    const nowMs = options.now();
    const row = {
      field_id: fieldId,
      predeck_pipeline_seats: DEFAULT_PREDECK_PIPELINE_SEATS,
      policy_revision: 1,
      updated_at_ms: nowMs,
    };
    context.repository(repository.repositoryId).invoke('insert_policy', row);
    return row;
  }

  function heldCount(fieldId, context) {
    const rows = context.repository(repository.repositoryId).invoke('list_tokens_for_field', { source_field_id: fieldId });
    return Array.isArray(rows) ? rows.length : 0;
  }

  function projection(fieldId, row, held) {
    const seats = Number(row.predeck_pipeline_seats);
    return Object.freeze({
      fieldId,
      predeckPipelineSeats: seats,
      policyRevision: Number(row.policy_revision),
      updatedAtMs: Number(row.updated_at_ms),
      held,
      free: Math.max(0, seats - held),
    });
  }

  return Object.freeze({
    DEFAULT_PREDECK_PIPELINE_SEATS,
    MIN_PREDECK_PIPELINE_SEATS,
    MAX_PREDECK_PIPELINE_SEATS,
    readPolicy(fieldId) {
      return execute('libra_predeck_pipeline_policy_read', (context) => {
        const row = readPolicyRow(fieldId, context) || {
          field_id: fieldId,
          predeck_pipeline_seats: DEFAULT_PREDECK_PIPELINE_SEATS,
          policy_revision: 1,
          updated_at_ms: 0,
        };
        return projection(fieldId, row, heldCount(fieldId, context));
      });
    },
    revisePolicy(fieldId, predeckPipelineSeats) {
      const seats = normalizeSeats(predeckPipelineSeats);
      return execute('libra_predeck_pipeline_policy_write', (context) => {
        const repo = context.repository(repository.repositoryId);
        const current = readPolicyRow(fieldId, context);
        const nowMs = options.now();
        if (current && Number(current.predeck_pipeline_seats) === seats) {
          return projection(fieldId, current, heldCount(fieldId, context));
        }
        if (!current) {
          const row = {
            field_id: fieldId,
            predeck_pipeline_seats: seats,
            policy_revision: 1,
            updated_at_ms: nowMs,
          };
          repo.invoke('insert_policy', row);
          return projection(fieldId, row, heldCount(fieldId, context));
        }
        const nextRevision = Number(current.policy_revision) + 1;
        const row = {
          field_id: fieldId,
          predeck_pipeline_seats: seats,
          policy_revision: nextRevision,
          updated_at_ms: nowMs,
        };
        repo.invoke('update_policy', row);
        return projection(fieldId, row, heldCount(fieldId, context));
      });
    },
    hasToken(subjectId) {
      return execute('libra_predeck_pipeline_token_read', (context) =>
        Boolean(context.repository(repository.repositoryId).invoke('find_token', { subject_id: subjectId })));
    },
    listTokens() {
      return execute('libra_predeck_pipeline_token_list', (context) => {
        const rows = context.repository(repository.repositoryId).invoke('list_tokens', {});
        return Object.freeze((rows || []).slice().sort((left, right) =>
          String(left.subject_id).localeCompare(String(right.subject_id))).map((row) => Object.freeze({
          subjectId: row.subject_id,
          fieldId: row.source_field_id,
          processId: row.source_process_id,
          acquiredAtMs: Number(row.acquired_at_ms),
        })));
      });
    },
    acquire({ fieldId, subjectId, sourceProcessId }) {
      if (!fieldId || !subjectId || !sourceProcessId) {
        fail('P14_PREDECK_PIPELINE_ACQUIRE_INVALID', 'Pipeline token acquire requires fieldId, subjectId, and sourceProcessId.');
      }
      return execute('libra_predeck_pipeline_token_acquire', (context) => {
        const repo = context.repository(repository.repositoryId);
        if (repo.invoke('find_token', { subject_id: subjectId })) {
          return Object.freeze({ acquired: true, replayed: true, subjectId, fieldId });
        }
        const policy = readPolicyRow(fieldId, context) || ensurePolicy(fieldId, context);
        const seats = Number(policy.predeck_pipeline_seats);
        const held = heldCount(fieldId, context);
        if (held >= seats) {
          fail('PREDECK_PIPELINE_FULL', 'Pre-deck pipeline seats are full for this Material Field.', {
            fieldId, seats, held,
          });
        }
        repo.invoke('insert_token', {
          subject_id: subjectId,
          source_field_id: fieldId,
          source_process_id: sourceProcessId,
          acquired_at_ms: options.now(),
        });
        return Object.freeze({ acquired: true, replayed: false, subjectId, fieldId });
      });
    },
    release(subjectId) {
      return execute('libra_predeck_pipeline_token_release', (context) => {
        const repo = context.repository(repository.repositoryId);
        const existing = repo.invoke('find_token', { subject_id: subjectId });
        if (!existing) return Object.freeze({ released: false, subjectId });
        repo.invoke('delete_token', { subject_id: subjectId });
        return Object.freeze({ released: true, subjectId, fieldId: existing.source_field_id });
      });
    },
  });
}

module.exports = Object.freeze({
  DEFAULT_PREDECK_PIPELINE_SEATS,
  MIN_PREDECK_PIPELINE_SEATS,
  MAX_PREDECK_PIPELINE_SEATS,
  PredeckPipelineAdmissionStoreError,
  createPredeckPipelineAdmissionStore,
});
