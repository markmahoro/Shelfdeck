'use strict';

const { digest } = require('../persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../persistence/owner-repository');
const { validateSupportingWorkDefinition } = require('./runtime-contracts');

const COMMAND_CONTRACT = 'helix.foundation.work.submit@1';
const RESULT_SCHEMA = 'helix://foundation/results/WorkAdmissionResult/v1';
const OPEN_WORK_STATES = new Set(['admitted', 'ready', 'running', 'blocked']);
const OPEN_EVENT_STATES = new Set(['pending', 'ready', 'waiting_for_resource', 'waiting_for_external', 'waiting_for_approval', 'executing']);

class WorkAdmissionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkAdmissionError';
    this.code = code;
    this.details = details;
  }
}

class WorkAdmissionReplay extends Error {
  constructor(result) {
    super('Work Admission replay');
    this.result = result;
  }
}

class WorkAdmissionDeferred extends Error {
  constructor(reasonCode) {
    super('Work Admission deferred');
    this.reasonCode = reasonCode;
  }
}

function fail(code, message, details) {
  throw new WorkAdmissionError(code, message, details);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonical(value[key]); return result;
  }, {});
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function repositories(schemaManifest) {
  return Object.freeze({
    works: createRepositoryDefinition({
      repositoryId: 'work_admission_works', owner: 'execution-foundation', schemaManifest,
      statements: {
        find: { kind: 'select-one', tableId: 'fx_supporting_works', columns: ['work_id', 'state'], keyColumns: ['work_id'] },
        list_all: { kind: 'select-all', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'state'], keyColumns: [] },
        list_owner: { kind: 'select-all', tableId: 'fx_supporting_works', columns: ['work_id', 'state'], keyColumns: ['owner_domain'] },
        insert: { kind: 'insert', tableId: 'fx_supporting_works', columns: [
          'work_id', 'owner_domain', 'process_type', 'process_id', 'work_kind', 'basis_digest', 'priority_class', 'state',
          'idempotency_key', 'created_at_ms', 'updated_at_ms'
        ] }
      }
    }),
    receipts: createRepositoryDefinition({
      repositoryId: 'work_admission_receipts', owner: 'execution-foundation', schemaManifest,
      statements: {
        list_key: { kind: 'select-all', tableId: 'fx_command_receipts', columns: [
          'request_digest', 'caller_scope', 'target_id', 'result_ref_json', 'result_digest'
        ], keyColumns: ['owner_domain', 'command_contract', 'idempotency_key'] },
        list_scope: { kind: 'select-all', tableId: 'fx_command_receipts', columns: ['target_id'],
          keyColumns: ['owner_domain', 'command_contract', 'caller_scope'] },
        insert: { kind: 'insert', tableId: 'fx_command_receipts', columns: [
          'command_receipt_id', 'owner_domain', 'command_contract', 'caller_scope', 'idempotency_key', 'request_digest',
          'target_type', 'target_id', 'result_schema_ref', 'result_ref_json', 'result_digest', 'committed_at_ms'
        ] }
      }
    }),
    circuits: createRepositoryDefinition({
      repositoryId: 'work_admission_circuits', owner: 'execution-foundation', schemaManifest,
      statements: { find: { kind: 'select-one', tableId: 'fx_circuit_states', columns: ['state'], keyColumns: ['circuit_key'] } }
    }),
    events: createRepositoryDefinition({
      repositoryId: 'work_admission_events', owner: 'execution-foundation', schemaManifest,
      statements: { list: { kind: 'select-all', tableId: 'fx_workflow_events', columns: ['state'], keyColumns: [] } }
    })
  });
}

function decodeReplay(row) {
  let result;
  try { result = JSON.parse(row.result_ref_json); } catch (error) { fail('P4_WORK_ADMISSION_RECEIPT_CORRUPT', 'Stored Work Admission Result is invalid JSON.'); }
  if (!result || digest(canonicalJson(result)) !== row.result_digest) fail('P4_WORK_ADMISSION_RECEIPT_CORRUPT', 'Stored Work Admission Result digest is invalid.');
  return Object.freeze({ ...result, replayed: true });
}

function createWorkAdmission(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function' ||
      !options.eligibilityProvider || typeof options.eligibilityProvider.check !== 'function' ||
      !options.limits || !Number.isSafeInteger(options.limits.globalOpenWorks) || !Number.isSafeInteger(options.limits.ownerOpenWorks) ||
      !Number.isSafeInteger(options.limits.openEvents) || Math.min(...Object.values(options.limits)) < 1) {
    fail('P4_WORK_ADMISSION_DEPENDENCIES_REQUIRED', 'Scoped UoW, eligibility provider, and positive hard limits are required.');
  }
  const definitions = repositories(options.schemaManifest);
  function replay(rawDefinition) {
    let definition;
    try { definition = validateSupportingWorkDefinition(rawDefinition); } catch (_error) { return null; }
    const requestDigest = digest(canonicalJson(definition));
    const result = options.unitOfWork.execute([{
      participantId: 'work_admission_replay', owner: 'execution-foundation',
      repositories: [definitions.receipts],
      execute(context) {
        const rows = context.repository('work_admission_receipts').invoke('list_key', {
          owner_domain: definition.ownerDomain,
          command_contract: COMMAND_CONTRACT,
          idempotency_key: definition.idempotencyKey,
        });
        if (rows.length > 1) fail('P4_WORK_ADMISSION_RECEIPT_CORRUPT', 'Work Admission idempotency key has multiple receipts.');
        if (rows.length === 0) return null;
        if (rows[0].request_digest !== requestDigest) fail(
          'P4_WORK_ADMISSION_IDEMPOTENCY_CONFLICT',
          'Work Admission idempotency key already binds a different Definition digest.',
        );
        return decodeReplay(rows[0]);
      },
    }]).work_admission_replay;
    return result ? Object.freeze(result) : null;
  }

  return Object.freeze({
    replay,
    submit(rawDefinition) {
      let definition;
      try { definition = validateSupportingWorkDefinition(rawDefinition); } catch (error) {
        return Object.freeze({ kind: 'invalid_contract', reasonCode: error.code || 'P4_WORK_ADMISSION_INVALID_DEFINITION' });
      }
      const eligibility = options.eligibilityProvider.check(Object.freeze({
        ownerDomain: definition.ownerDomain, processType: definition.processType, processId: definition.processId,
        executionBasisId: definition.executionBasisId, executionBasisDigest: definition.executionBasisDigest
      }));
      if (!eligibility || eligibility.eligible !== true || eligibility.basisDigest !== definition.executionBasisDigest) {
        return Object.freeze({ kind: 'invalid_contract', reasonCode: eligibility && eligibility.reasonCode || 'PROCESS_OR_BASIS_NOT_ELIGIBLE' });
      }
      const requestDigest = digest(canonicalJson(definition));
      const callerScope = definition.ownerDomain + ':' + definition.concurrencyScope;
      try {
        const results = options.unitOfWork.execute([{
          participantId: 'work_admission', owner: 'execution-foundation',
          repositories: [definitions.works, definitions.receipts, definitions.circuits, definitions.events],
          execute(context) {
            const works = context.repository('work_admission_works');
            const receipts = context.repository('work_admission_receipts');
            const existingReceipts = receipts.invoke('list_key', {
              owner_domain: definition.ownerDomain, command_contract: COMMAND_CONTRACT, idempotency_key: definition.idempotencyKey
            });
            if (existingReceipts.length > 1) fail('P4_WORK_ADMISSION_RECEIPT_CORRUPT', 'Work Admission idempotency key has multiple receipts.');
            if (existingReceipts.length === 1) {
              if (existingReceipts[0].request_digest !== requestDigest) fail(
                'P4_WORK_ADMISSION_IDEMPOTENCY_CONFLICT', 'Work Admission idempotency key already binds a different Definition digest.'
              );
              throw new WorkAdmissionReplay(decodeReplay(existingReceipts[0]));
            }
            for (const circuitKey of ['foundation/work-admission', 'owner/' + definition.ownerDomain + '/work-admission']) {
              const circuit = context.repository('work_admission_circuits').invoke('find', { circuit_key: circuitKey });
              if (circuit && circuit.state !== 'closed') throw new WorkAdmissionDeferred('CIRCUIT_' + circuit.state.toUpperCase());
            }
            const ownerWorks = works.invoke('list_owner', { owner_domain: definition.ownerDomain });
            const globalOpen = works.invoke('list_all').filter((work) => OPEN_WORK_STATES.has(work.state)).length;
            const ownerOpen = ownerWorks.filter((work) => OPEN_WORK_STATES.has(work.state)).length;
            if (globalOpen >= options.limits.globalOpenWorks || ownerOpen >= options.limits.ownerOpenWorks) {
              throw new WorkAdmissionDeferred('WORK_HARD_CAP');
            }
            const openEvents = context.repository('work_admission_events').invoke('list').filter((event) => OPEN_EVENT_STATES.has(event.state)).length;
            if (openEvents >= options.limits.openEvents) throw new WorkAdmissionDeferred('EVENT_HARD_CAP');
            const scoped = receipts.invoke('list_scope', {
              owner_domain: definition.ownerDomain, command_contract: COMMAND_CONTRACT, caller_scope: callerScope
            });
            if (scoped.some((receipt) => {
              const work = works.invoke('find', { work_id: receipt.target_id });
              return work && OPEN_WORK_STATES.has(work.state);
            })) throw new WorkAdmissionDeferred('CONCURRENCY_SCOPE_OPEN');
            const result = Object.freeze({ kind: 'admitted', workId: definition.workId, state: 'admitted', replayed: false });
            const resultJson = canonicalJson(result);
            works.invoke('insert', {
              work_id: definition.workId, owner_domain: definition.ownerDomain, process_type: definition.processType,
              process_id: definition.processId, work_kind: definition.workKind, basis_digest: definition.executionBasisDigest,
              priority_class: definition.priorityClass, state: 'admitted', idempotency_key: definition.idempotencyKey,
              created_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs
            });
            receipts.invoke('insert', {
              command_receipt_id: 'work-admission/' + definition.ownerDomain + '/' + definition.workId,
              owner_domain: definition.ownerDomain, command_contract: COMMAND_CONTRACT, caller_scope: callerScope,
              idempotency_key: definition.idempotencyKey, request_digest: requestDigest, target_type: 'supporting_work',
              target_id: definition.workId, result_schema_ref: RESULT_SCHEMA, result_ref_json: resultJson,
              result_digest: digest(resultJson), committed_at_ms: context.commitTimeMs
            });
            return result;
          }
        }]);
        return results.work_admission;
      } catch (error) {
        if (error instanceof WorkAdmissionReplay) return error.result;
        if (error instanceof WorkAdmissionDeferred) return Object.freeze({ kind: 'deferred', reasonCode: error.reasonCode });
        throw error;
      }
    }
  });
}

module.exports = Object.freeze({ WorkAdmissionError, createWorkAdmission });
