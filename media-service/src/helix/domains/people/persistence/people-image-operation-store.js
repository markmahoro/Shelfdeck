'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const COLUMNS = ['operation_id', 'person_id', 'actor_id', 'idempotency_key', 'request_digest', 'payload_schema_ref', 'payload_json', 'payload_digest',
  'state', 'result_schema_ref', 'result_json', 'result_digest', 'failure_code', 'created_at_ms', 'updated_at_ms'];
const SHA256 = /^[a-f0-9]{64}$/;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
function requiredString(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256; }

function createPeopleImageOperationStore(options) {
  const definition = createRepositoryDefinition({ repositoryId: 'people_image_operations', owner: 'people', schemaManifest: options.schemaManifest,
    statements: {
      get: { kind: 'select-one', tableId: 'people_image_operations', keyColumns: ['operation_id'], columns: COLUMNS, safeIntegers: true },
      command: { kind: 'select-one', tableId: 'people_image_operations', keyColumns: ['actor_id', 'idempotency_key'], columns: COLUMNS, safeIntegers: true },
      page: { kind: 'select-page-after', tableId: 'people_image_operations', keyColumn: 'operation_id', fixedKeyColumns: ['state'],
        columns: COLUMNS, maxItems: 100, safeIntegers: true },
      insert: { kind: 'insert', tableId: 'people_image_operations', columns: COLUMNS },
      finish: { kind: 'update', tableId: 'people_image_operations', setColumns: ['state', 'result_schema_ref', 'result_json', 'result_digest', 'failure_code', 'updated_at_ms'],
        keyColumns: ['operation_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' }, { column: 'payload_digest', parameter: 'expected_payload_digest' }] },
    } });
  const execute = body => options.unitOfWork.execute([{ participantId: 'people_image_operations', owner: 'people', repositories: [definition],
    execute: tx => body(tx.repository(definition.repositoryId), tx.commitTimeMs) }]).people_image_operations;
  function map(row) {
    if (!row) return null;
    let payload, result;
    try { payload = JSON.parse(row.payload_json); result = row.result_json === null ? null : JSON.parse(row.result_json); }
    catch { fail('PEOPLE_IMAGE_OPERATION_CORRUPT', '人物建档操作记录损坏。'); }
    if (row.payload_schema_ref !== 'people.image-operation-request@1' || canonicalJson(payload) !== row.payload_json || canonicalDigest(payload) !== row.payload_digest || payload.personId !== row.person_id ||
        payload.actorId !== row.actor_id || payload.operationId !== row.operation_id || payload.schema !== 'people.image-operation-request@1' ||
        !['preparing', 'completed', 'failed'].includes(row.state) ||
        Object.keys(payload).sort().join(',') !== 'actorId,aliases,canonicalName,faceModelRef,operationId,personId,schema,selectedImage' ||
        row.state === 'completed' && (!result || row.result_schema_ref !== 'people.image-operation-result@1' || canonicalDigest(result) !== row.result_digest || result.personId !== row.person_id || row.failure_code !== null ||
          Object.keys(result).sort().join(',') !== 'personId,personRevision,referenceRevision') ||
        row.state !== 'completed' && (row.result_schema_ref !== null || row.result_digest !== null) ||
        row.state === 'failed' && (!requiredString(row.failure_code) || result !== null) || row.state === 'preparing' && (result !== null || row.failure_code !== null)) {
      fail('PEOPLE_IMAGE_OPERATION_CORRUPT', '人物建档操作内容或状态与校验值不一致。');
    }
    return frozen({ operationId: row.operation_id, personId: row.person_id, actorId: row.actor_id, idempotencyKey: row.idempotency_key,
      requestDigest: row.request_digest, payloadDigest: row.payload_digest, payload, state: row.state, result, failureCode: row.failure_code,
      createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms });
  }
  return Object.freeze({
    get: operationId => execute(repo => map(repo.invoke('get', { operation_id: operationId }))),
    findCommand: (actorId, idempotencyKey) => execute(repo => map(repo.invoke('command', { actor_id: actorId, idempotency_key: idempotencyKey }))),
    listPendingPage({ cursor, limit }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || cursor !== null && !requiredString(cursor)) fail('PEOPLE_IMAGE_OPERATION_INPUT_INVALID', '建档操作分页参数无效。');
      return execute(repo => repo.invoke('page', { cursor, limit, state: 'preparing' }).map(row => ({ cursor: row.operation_id, scope: { operationId: row.operation_id } })));
    },
    create({ operationId, personId, actorId, idempotencyKey, requestDigest, payload }) {
      const payloadJson = canonicalJson(payload);
      if (![operationId, personId, actorId, idempotencyKey].every(requiredString) || !SHA256.test(requestDigest) || Buffer.byteLength(payloadJson) > 16384 ||
          payload.personId !== personId || payload.actorId !== actorId || payload.operationId !== operationId || payload.schema !== 'people.image-operation-request@1') {
        fail('PEOPLE_IMAGE_OPERATION_INPUT_INVALID', '建档操作参数无效或超出大小限制。');
      }
      return execute((repo, at) => {
        const existing = repo.invoke('command', { actor_id: actorId, idempotency_key: idempotencyKey });
        if (existing) {
          if (existing.request_digest !== requestDigest) fail('PEOPLE_IMAGE_OPERATION_COMMAND_CONFLICT', '此操作标识已用于其他建档内容。');
          return map(existing);
        }
        repo.invoke('insert', { operation_id: operationId, person_id: personId, actor_id: actorId, idempotency_key: idempotencyKey, request_digest: requestDigest,
          payload_schema_ref:'people.image-operation-request@1',payload_json: payloadJson, payload_digest: canonicalDigest(payload), state: 'preparing', result_schema_ref:null, result_json: null, result_digest: null,
          failure_code: null, created_at_ms: at, updated_at_ms: at });
        return map(repo.invoke('get', { operation_id: operationId }));
      });
    },
    finish({ operationId, expectedPayloadDigest, result = null, failureCode = null }) {
      if (!SHA256.test(expectedPayloadDigest) || Boolean(result) === Boolean(failureCode) || failureCode !== null && !/^[A-Z0-9_]{1,128}$/.test(failureCode)) {
        fail('PEOPLE_IMAGE_OPERATION_INPUT_INVALID', '建档操作结果无效。');
      }
      return execute((repo, at) => {
        const current = map(repo.invoke('get', { operation_id: operationId })), state = failureCode ? 'failed' : 'completed';
        if (!current || current.payloadDigest !== expectedPayloadDigest) fail('PEOPLE_IMAGE_OPERATION_STALE', '建档操作版本已变化。');
        if (result && (result.personId !== current.personId || !Number.isSafeInteger(result.personRevision) || result.personRevision < 1 ||
            !Number.isSafeInteger(result.referenceRevision) || result.referenceRevision < 1 || Buffer.byteLength(canonicalJson(result)) > 16384)) {
          fail('PEOPLE_IMAGE_OPERATION_INPUT_INVALID', '建档操作结果缺少人物及图片版本。');
        }
        if (current.state !== 'preparing') {
          if (current.state !== state || canonicalDigest(current.result) !== canonicalDigest(result) || current.failureCode !== failureCode) fail('PEOPLE_IMAGE_OPERATION_STALE', '建档操作已有不同终态。');
          return current;
        }
        const changed = repo.invoke('finish', { operation_id: operationId, expected_state: 'preparing', expected_payload_digest: expectedPayloadDigest,
          state, result_schema_ref:result?'people.image-operation-result@1':null,result_json: result ? canonicalJson(result) : null, result_digest: result ? canonicalDigest(result) : null, failure_code: failureCode, updated_at_ms: at });
        if (changed.changes !== 1) fail('PEOPLE_IMAGE_OPERATION_STALE', '建档操作版本已变化。');
        return map(repo.invoke('get', { operation_id: operationId }));
      });
    },
  });
}

module.exports = Object.freeze({ createPeopleImageOperationStore });
