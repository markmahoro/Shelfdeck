'use strict';

const { digest } = require('./ddl-compiler');
const { createRepositoryDefinition } = require('./owner-repository');
const { createOutboxParticipant } = require('./outbox-inbox');

const SHA256 = /^[0-9a-f]{64}$/;

class CommandCommitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CommandCommitError';
    this.code = code;
    this.details = details;
  }
}

class ReplaySignal extends Error {
  constructor(receipt) {
    super('Command receipt replay');
    this.receipt = receipt;
  }
}

function fail(code, message, details) {
  throw new CommandCommitError(code, message, details);
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

function requiredText(value, field) {
  if (typeof value !== 'string' || value.length === 0) fail('P3_COMMAND_INVALID_FIELD', 'Command commit field is required.', { field });
  return value;
}

function requiredDigest(value, field) {
  if (!SHA256.test(value || '')) fail('P3_COMMAND_INVALID_DIGEST', 'Command commit digest must be lowercase SHA-256.', { field });
  return value;
}

function createDefinitions(schemaManifest) {
  return Object.freeze({
    receipts: createRepositoryDefinition({
      repositoryId: 'command_receipts', owner: 'execution-foundation', schemaManifest,
      statements: {
        find_receipt: {
          kind: 'select-one', tableId: 'fx_command_receipts',
          columns: ['command_receipt_id', 'request_digest', 'target_type', 'target_id', 'result_schema_ref', 'result_ref_json', 'result_digest', 'committed_at_ms'],
          keyColumns: ['owner_domain', 'command_contract', 'caller_scope', 'idempotency_key']
        },
        insert_receipt: {
          kind: 'insert', tableId: 'fx_command_receipts',
          columns: ['command_receipt_id', 'owner_domain', 'command_contract', 'caller_scope', 'idempotency_key', 'request_digest',
            'target_type', 'target_id', 'result_schema_ref', 'result_ref_json', 'result_digest', 'committed_at_ms']
        }
      }
    }),
    markers: createRepositoryDefinition({
      repositoryId: 'commit_markers', owner: 'execution-foundation', schemaManifest,
      statements: {
        insert_marker: {
          kind: 'insert', tableId: 'fx_commit_markers',
          columns: ['commit_marker', 'effect_id', 'owner_domain', 'scope_type', 'scope_id', 'commit_digest', 'committed_at_ms']
        }
      }
    }),
    audit: createRepositoryDefinition({
      repositoryId: 'audit_records', owner: 'execution-foundation', schemaManifest,
      statements: {
        insert_audit: {
          kind: 'insert', tableId: 'fx_audit_records',
          columns: ['audit_id', 'owner_domain', 'actor_type', 'actor_id', 'action', 'scope_type', 'scope_id',
            'work_id', 'event_id', 'evidence_digest', 'occurred_at_ms']
        }
      }
    })
  });
}

function decodedReceipt(row) {
  let resultRef;
  try {
    resultRef = JSON.parse(row.result_ref_json);
  } catch (error) {
    fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored command Result JSON is invalid.');
  }
  if (!resultRef || typeof resultRef !== 'object' || Array.isArray(resultRef)) {
    fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored command Result reference is not a typed object.');
  }
  const encoded = canonicalJson(resultRef);
  if (digest(encoded) !== row.result_digest) fail('P3_COMMAND_RECEIPT_CORRUPT', 'Stored command Result digest is invalid.');
  return Object.freeze({
    commandReceiptId: row.command_receipt_id,
    requestDigest: row.request_digest,
    targetType: row.target_type,
    targetId: row.target_id,
    resultSchemaRef: row.result_schema_ref,
    resultRef,
    resultDigest: row.result_digest,
    committedAtMs: row.committed_at_ms
  });
}

function createCommandCommitCoordinator(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P3_COMMAND_INVALID_COORDINATOR', 'Schema manifest and SqliteUnitOfWork are required.');
  }
  const repositories = createDefinitions(options.schemaManifest);
  return Object.freeze({
    execute(request) {
      if (!request || !request.command || !request.domainParticipant || !request.commitMarker ||
          !Array.isArray(request.auditRecords) || request.auditRecords.length === 0 || typeof request.resultEnvelope !== 'function' ||
          request.outboxMessages !== undefined && !Array.isArray(request.outboxMessages)) {
        fail('P3_COMMAND_INVALID_REQUEST', 'Command, Domain participant, marker, audit records, and Result encoder are required.');
      }
      const command = request.command;
      for (const field of ['commandReceiptId', 'ownerDomain', 'commandContract', 'callerScope', 'idempotencyKey', 'targetType', 'targetId']) {
        requiredText(command[field], field);
      }
      requiredDigest(command.requestDigest, 'requestDigest');
      if (request.domainParticipant.owner !== command.ownerDomain) fail(
        'P3_COMMAND_OWNER_MISMATCH', 'Command Owner and Domain participant Owner must match.'
      );
      if(request.controlParticipant&&(request.controlParticipant.owner!=='material-control-authority'||
          request.controlParticipant.boundBusinessOwner!==command.ownerDomain))fail(
        'P3_COMMAND_CONTROL_OWNER_MISMATCH','Command Control participant must be bound to the command Owner.');
      const validations=request.validationParticipants===undefined?[]:request.validationParticipants;
      if(!Array.isArray(validations)||validations.length>8||validations.some(participant=>
          !participant||!([command.ownerDomain,'execution-foundation','material-control-authority'].includes(participant.owner)||
            participant.owner==='platform-settings'&&Array.isArray(participant.repositories)&&participant.repositories.length>0&&
              participant.repositories.every(repository=>repository&&Array.isArray(repository.tableIds)&&repository.tableIds.length===1&&repository.tableIds[0]==='platform_workspace_roots'))||
          participant.owner!==command.ownerDomain&&participant.boundBusinessOwner!==command.ownerDomain||
          !Array.isArray(participant.repositories)||!participant.repositories.length||participant.repositories.some(repository=>!repository||repository.readOnly!==true)||
          typeof participant.execute!=='function'))fail('P3_COMMAND_VALIDATION_PARTICIPANT_INVALID',
        'Command validation participants must be bounded, read-only and bound to the exact command Owner.');
      let domainResult;
      let receipt;
      try {
        const outboxParticipant = request.outboxMessages && request.outboxMessages.length > 0
          ? createOutboxParticipant({ schemaManifest: options.schemaManifest, producerDomain: command.ownerDomain,
            participantId: 'command_outbox', messages: request.outboxMessages }) : null;
        const results = options.unitOfWork.execute([
          {
            participantId: 'command_preflight', owner: 'execution-foundation', boundBusinessOwner: command.ownerDomain, repositories: [repositories.receipts],
            execute(context) {
              const existing = context.repository('command_receipts').invoke('find_receipt', {
                owner_domain: command.ownerDomain,
                command_contract: command.commandContract,
                caller_scope: command.callerScope,
                idempotency_key: command.idempotencyKey
              });
              if (!existing) {
                // Fence public projections without admitting another Owner repository.
                // Receipt replay remains independent of later projection changes.
                if (request.readFence !== undefined && request.readFence !== null) {
                  if (typeof options.unitOfWork.assertReadFence !== 'function') fail(
                    'P3_UOW_READ_FENCE_UNAVAILABLE', 'Command read fences require a validating Unit of Work.'
                  );
                  options.unitOfWork.assertReadFence(request.readFence);
                }
                return;
              }
              if (existing.request_digest !== command.requestDigest) fail(
                'P3_COMMAND_IDEMPOTENCY_CONFLICT', 'Idempotency key already exists with a different request digest.'
              );
              throw new ReplaySignal(decodedReceipt(existing));
            }
          },
          ...validations,
          {
            ...request.domainParticipant,
            execute(context) {
              domainResult = request.domainParticipant.execute(context);
              return domainResult;
            }
          },
          ...(request.controlParticipant?[request.controlParticipant]:[]),
          ...(outboxParticipant ? [outboxParticipant] : []),
          {
            participantId: 'commit_foundation', owner: 'execution-foundation', boundBusinessOwner: command.ownerDomain,
            repositories: [repositories.receipts, repositories.markers, repositories.audit],
            execute(context) {
              const envelope = request.resultEnvelope(domainResult);
              if (!envelope || typeof envelope.resultRef !== 'object' || envelope.resultRef === null || Array.isArray(envelope.resultRef)) fail(
                'P3_COMMAND_INVALID_RESULT', 'Command Result envelope requires a typed object reference.'
              );
              const resultSchemaRef = requiredText(envelope.resultSchemaRef, 'resultSchemaRef');
              const resultRefJson = canonicalJson(envelope.resultRef);
              if (typeof resultRefJson !== 'string') fail('P3_COMMAND_INVALID_RESULT', 'Command Result reference must be JSON serializable.');
              if (new TextEncoder().encode(resultRefJson).byteLength > 16384) fail(
                'P3_COMMAND_RESULT_TOO_LARGE', 'Command Result reference exceeds the 16 KiB contract.'
              );
              const resultDigest = digest(resultRefJson);
              const marker = request.commitMarker;
              context.repository('commit_markers').invoke('insert_marker', {
                commit_marker: requiredText(marker.commitMarker, 'commitMarker'),
                effect_id: marker.effectId || null,
                owner_domain: command.ownerDomain,
                scope_type: requiredText(marker.scopeType, 'scopeType'),
                scope_id: requiredText(marker.scopeId, 'scopeId'),
                commit_digest: requiredDigest(marker.commitDigest, 'commitDigest'),
                committed_at_ms: context.commitTimeMs
              });
              context.repository('command_receipts').invoke('insert_receipt', {
                command_receipt_id: command.commandReceiptId,
                owner_domain: command.ownerDomain,
                command_contract: command.commandContract,
                caller_scope: command.callerScope,
                idempotency_key: command.idempotencyKey,
                request_digest: command.requestDigest,
                target_type: command.targetType,
                target_id: command.targetId,
                result_schema_ref: resultSchemaRef,
                result_ref_json: resultRefJson,
                result_digest: resultDigest,
                committed_at_ms: context.commitTimeMs
              });
              for (const record of request.auditRecords) {
                context.repository('audit_records').invoke('insert_audit', {
                  audit_id: requiredText(record.auditId, 'auditId'),
                  owner_domain: command.ownerDomain,
                  actor_type: requiredText(record.actorType, 'actorType'),
                  actor_id: record.actorId || null,
                  action: requiredText(record.action, 'action'),
                  scope_type: requiredText(record.scopeType, 'auditScopeType'),
                  scope_id: requiredText(record.scopeId, 'auditScopeId'),
                  work_id: record.workId || null,
                  event_id: record.eventId || null,
                  evidence_digest: record.evidenceDigest ? requiredDigest(record.evidenceDigest, 'evidenceDigest') : null,
                  occurred_at_ms: context.commitTimeMs
                });
              }
              receipt = Object.freeze({
                commandReceiptId: command.commandReceiptId,
                requestDigest: command.requestDigest,
                targetType: command.targetType,
                targetId: command.targetId,
                resultSchemaRef,
                resultRef: envelope.resultRef,
                resultDigest,
                committedAtMs: context.commitTimeMs
              });
              return receipt;
            }
          }
        ]);
        return Object.freeze({ replayed: false, receipt: results.commit_foundation,
          domainResult: results[request.domainParticipant.participantId], outboxResult: results.command_outbox });
      } catch (error) {
        if (error instanceof ReplaySignal) return Object.freeze({ replayed: true, receipt: error.receipt, domainResult: undefined });
        throw error;
      }
    }
  });
}

// Compose an explicit command receipt with an existing owner transaction whose
// commit marker and domain effects are already supplied by that transaction.
function createCommandReceiptParticipant(options, request) {
  const repositories=createDefinitions(options.schemaManifest),command=request.command;
  for(const field of ['commandReceiptId','ownerDomain','commandContract','callerScope','idempotencyKey','targetType','targetId'])
    requiredText(command[field],field);
  requiredDigest(command.requestDigest,'requestDigest');
  if(!Array.isArray(request.auditRecords)||!request.auditRecords.length)
    fail('P3_COMMAND_INVALID_REQUEST','Atomic command receipt requires audit records.');
  const resultSchemaRef=requiredText(request.resultSchemaRef,'resultSchemaRef');
  if(!request.resultRef||typeof request.resultRef!=='object'||Array.isArray(request.resultRef))
    fail('P3_COMMAND_INVALID_RESULT','Atomic command receipt requires a typed result.');
  const resultJson=canonicalJson(request.resultRef),resultDigest=digest(resultJson);
  if(Buffer.byteLength(resultJson)>16384)fail('P3_COMMAND_RESULT_TOO_LARGE','Command Result reference exceeds 16 KiB.');
  return {participantId:request.participantId,owner:'execution-foundation',boundBusinessOwner:command.ownerDomain,
    repositories:[repositories.receipts,repositories.audit],execute(context){
      const repo=context.repository('command_receipts');
      const existing=repo.invoke('find_receipt',{owner_domain:command.ownerDomain,command_contract:command.commandContract,
        caller_scope:command.callerScope,idempotency_key:command.idempotencyKey});
      if(existing) {
        if(existing.request_digest!==command.requestDigest||existing.result_digest!==resultDigest||existing.result_schema_ref!==resultSchemaRef)
          fail('P3_COMMAND_IDEMPOTENCY_CONFLICT','Atomic command receipt belongs to another request or result.');
        return decodedReceipt(existing);
      }
      repo.invoke('insert_receipt',{command_receipt_id:command.commandReceiptId,owner_domain:command.ownerDomain,
        command_contract:command.commandContract,caller_scope:command.callerScope,idempotency_key:command.idempotencyKey,
        request_digest:command.requestDigest,target_type:command.targetType,target_id:command.targetId,
        result_schema_ref:resultSchemaRef,result_ref_json:resultJson,result_digest:resultDigest,committed_at_ms:context.commitTimeMs});
      for(const record of request.auditRecords)context.repository('audit_records').invoke('insert_audit',{
        audit_id:requiredText(record.auditId,'auditId'),owner_domain:command.ownerDomain,
        actor_type:requiredText(record.actorType,'actorType'),actor_id:record.actorId||null,
        action:requiredText(record.action,'action'),scope_type:requiredText(record.scopeType,'auditScopeType'),
        scope_id:requiredText(record.scopeId,'auditScopeId'),work_id:record.workId||null,event_id:record.eventId||null,
        evidence_digest:record.evidenceDigest?requiredDigest(record.evidenceDigest,'evidenceDigest'):null,occurred_at_ms:context.commitTimeMs});
      return Object.freeze({commandReceiptId:command.commandReceiptId,resultSchemaRef,resultRef:request.resultRef,resultDigest});
    }};
}

module.exports = Object.freeze({ CommandCommitError, createCommandCommitCoordinator, createCommandReceiptParticipant });
