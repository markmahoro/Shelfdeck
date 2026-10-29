'use strict';
const { deliveryScopeStatements,readDeliveryScopes } = require('./series-delivery-scope-reader');

const { createIntakeRetirementStore } = require('./intake-retirement-store');

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const DEFAULT_PREDECK_PIPELINE_SEATS = 3;
const MIN_PREDECK_PIPELINE_SEATS = 0;
const MAX_PREDECK_PIPELINE_SEATS = 8;
const DEFAULT_SECONDARY_SEATS = 5;
const MAX_SECONDARY_SEATS = 32;

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
      ...deliveryScopeStatements,
      secondary_policy: {kind:'select-one',tableId:'libra_workshop_policies',columns:['secondary_seats','policy_revision','updated_at_ms'],keyColumns:['policy_id']},
      insert_secondary_policy: {kind:'insert',tableId:'libra_workshop_policies',columns:['policy_id','secondary_seats','policy_revision','updated_at_ms']},
      update_secondary_policy: {kind:'update',tableId:'libra_workshop_policies',setColumns:['secondary_seats','policy_revision','updated_at_ms'],keyColumns:['policy_id']},
      list_secondary: {kind:'select-all',tableId:'libra_workshop_placements',columns:['subject_id','transferred_at_ms','readiness_digest'],keyColumns:[]},
      find_secondary: {kind:'select-one',tableId:'libra_workshop_placements',columns:['subject_id','transferred_at_ms','readiness_digest'],keyColumns:['subject_id']},
      insert_secondary: {kind:'insert',tableId:'libra_workshop_placements',columns:['subject_id','transferred_at_ms','readiness_digest']},
      delete_secondary: {kind:'delete',tableId:'libra_workshop_placements',keyColumns:['subject_id']},
      scope_subject:{kind:'select-one',tableId:'libra_subjects',columns:['structure_kind','status'],keyColumns:['subject_id']},
      pending_bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:['material_key','authority_kind','current'],keyColumns:['subject_id']},
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

  const retirement = createIntakeRetirementStore(options);

  function execute(participantId, body, guards = []) {
    return options.unitOfWork.execute([...guards, {
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
    const secondary = new Set(context.repository(repository.repositoryId).invoke('list_secondary', {}).map(row => row.subject_id));
    return rows.filter(row => !secondary.has(row.subject_id)).length;
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

  function secondaryProjection(repo) {
    const row = repo.invoke('secondary_policy', {policy_id:'secondary'});
    const held = repo.invoke('list_secondary', {}).length;
    const seats = row ? Number(row.secondary_seats) : DEFAULT_SECONDARY_SEATS;
    return Object.freeze({secondarySeats:seats, policyRevision:row ? Number(row.policy_revision) : 1,
      updatedAtMs:row ? Number(row.updated_at_ms) : 0, held, free:Math.max(0,seats-held)});
  }

  return Object.freeze({
    DEFAULT_PREDECK_PIPELINE_SEATS,
    MIN_PREDECK_PIPELINE_SEATS,
    MAX_PREDECK_PIPELINE_SEATS,
    readSecondaryPolicy() {
      return execute('libra_secondary_policy_read', context => secondaryProjection(context.repository(repository.repositoryId)));
    },
    reviseSecondaryPolicy(seats) {
      if (!Number.isSafeInteger(seats) || seats < 0 || seats > MAX_SECONDARY_SEATS) {
        fail('LIBRA_SECONDARY_SEATS_INVALID', 'Secondary workshop seats must be an integer from 0 to 32.');
      }
      return execute('libra_secondary_policy_write', context => {
        const repo=context.repository(repository.repositoryId), current=repo.invoke('secondary_policy',{policy_id:'secondary'});
        if (!current || Number(current.secondary_seats)!==seats) repo.invoke(current?'update_secondary_policy':'insert_secondary_policy',{
          policy_id:'secondary',secondary_seats:seats,policy_revision:current?Number(current.policy_revision)+1:1,updated_at_ms:options.now()});
        return secondaryProjection(repo);
      });
    },
    listSecondaryPlacements() {
      return execute('libra_secondary_placements_read', context => Object.freeze(context.repository(repository.repositoryId)
        .invoke('list_secondary',{}).map(row=>Object.freeze({subjectId:row.subject_id,
          transferredAtMs:Number(row.transferred_at_ms),readinessDigest:row.readiness_digest}))));
    },
    // The Owner supplies a synchronous proof participant; it runs in the SAME
    // transaction as capacity admission. A stale or absent proof cannot transfer.
    transferToSecondary(subjectId, proofParticipant, readParticipants=[]) {
      if (!subjectId || !proofParticipant || proofParticipant.owner!=='libra' ||
          typeof proofParticipant.execute!=='function' || proofParticipant.participantId==='libra_secondary_transfer') {
        fail('LIBRA_SECONDARY_PROOF_REQUIRED','Secondary transfer requires an Owner readiness proof.');
      }
      if(!Array.isArray(readParticipants)||readParticipants.some(participant=>participant.owner!=='execution-foundation'||!participant.repositories?.every(repo=>repo.readOnly)))
        fail('LIBRA_SECONDARY_READ_PROOF_INVALID','Execution proof participants must belong to Foundation.');
      let proof;
      return options.unitOfWork.execute([...readParticipants,{...proofParticipant,execute(context){
        proof=proofParticipant.execute(context);return proof;
      }},{participantId:'libra_secondary_transfer',owner:'libra',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId);
        if (!repo.invoke('find_token',{subject_id:subjectId})) return Object.freeze({transferred:false,reasonCode:'responsibility_absent'});
        if (repo.invoke('find_secondary',{subject_id:subjectId})) return Object.freeze({transferred:true,replayed:true});
        if (proof?.subjectId!==subjectId || proof?.eligible!==true || !/^[a-f0-9]{64}$/.test(proof.readinessDigest||'')) {
          return Object.freeze({transferred:false,reasonCode:'readiness_not_proven'});
        }
        const policy=secondaryProjection(repo);
        if (!policy.free) return Object.freeze({transferred:false,reasonCode:'secondary_full'});
        repo.invoke('insert_secondary',{subject_id:subjectId,transferred_at_ms:options.now(),readiness_digest:proof.readinessDigest});
        return Object.freeze({transferred:true,replayed:false});
      }}]).libra_secondary_transfer;
    },
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
        const subject = repo.invoke('scope_subject', { subject_id: subjectId });
        if (subject && subject.status !== 'active') {
          fail('LIBRA_SUBJECT_TERMINAL', 'A terminal Subject cannot reacquire a pipeline token.', { subjectId });
        }
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
      }, [retirement.activeAdmissionGuard(sourceProcessId)]);
    },
    release(subjectId, expectedSourceProcessId = null) {
      return execute('libra_predeck_pipeline_token_release', (context) => {
        const repo = context.repository(repository.repositoryId);
        const existing = repo.invoke('find_token', { subject_id: subjectId });
        if (!existing) return Object.freeze({ released: false, subjectId });
        if (expectedSourceProcessId !== null && existing.source_process_id !== expectedSourceProcessId)
          return Object.freeze({ released: false, subjectId, reasonCode: 'intake_process_changed' });
        if(repo.invoke('scope_subject',{subject_id:subjectId})?.structure_kind==='season'){
          const scopes=readDeliveryScopes(repo,subjectId),assigned=new Set(scopes.flatMap(scope=>scope.materialKeys));
          const active=scopes.some(scope=>!scope.accepted&&['active','suspended','frozen'].includes(scope.state));
          const pending=repo.invoke('pending_bindings',{subject_id:subjectId}).some(row=>
            Number(row.current)===1&&row.authority_kind==='primary_control'&&!assigned.has(row.material_key));
          if(active||pending)return Object.freeze({released:false,subjectId,reasonCode:'series_delivery_responsibility_remaining'});
        }
        repo.invoke('delete_secondary', { subject_id: subjectId });
        repo.invoke('delete_token', { subject_id: subjectId });
        return Object.freeze({ released: true, subjectId, fieldId: existing.source_field_id });
      });
    },
  });
}

module.exports = Object.freeze({
  DEFAULT_SECONDARY_SEATS,
  MAX_SECONDARY_SEATS,
  DEFAULT_PREDECK_PIPELINE_SEATS,
  MIN_PREDECK_PIPELINE_SEATS,
  MAX_PREDECK_PIPELINE_SEATS,
  PredeckPipelineAdmissionStoreError,
  createPredeckPipelineAdmissionStore,
});
