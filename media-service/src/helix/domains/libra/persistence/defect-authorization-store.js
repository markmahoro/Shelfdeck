'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');

const AUTHORIZATION_ID = 'libra-movie-defect-admission';
const COLUMNS = ['authorization_id', 'revision', 'state', 'actor_id',
  'authorization_digest', 'effective_at_ms', 'revoked_at_ms'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function createDefectAuthorizationStore(options) {
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_defect_authorization', owner: 'libra',
    schemaManifest: options.schemaManifest, statements: {
      head: { kind: 'select-one', tableId: 'libra_defect_authorization_head',
        columns: ['singleton_key', 'current_authorization_id', 'current_revision'], keyColumns: ['singleton_key'], safeIntegers: true },
      authorization: { kind: 'select-one', tableId: 'libra_defect_authorizations',
        columns: COLUMNS, keyColumns: ['authorization_id', 'revision'], safeIntegers: true },
      insert: { kind: 'insert', tableId: 'libra_defect_authorizations', columns: COLUMNS },
      insert_head: { kind: 'insert', tableId: 'libra_defect_authorization_head',
        columns: ['singleton_key', 'current_authorization_id', 'current_revision', 'updated_at_ms'] },
      advance: { kind: 'update', tableId: 'libra_defect_authorization_head',
        setColumns: ['current_revision', 'updated_at_ms'], keyColumns: ['singleton_key'],
        compareColumns: [{ column: 'current_revision', parameter: 'expected_revision' }] },
    },
  });
  function read(repo) {
    const head = repo.invoke('head', { singleton_key: AUTHORIZATION_ID });
    if (!head) return null;
    const row = repo.invoke('authorization', { authorization_id: head.current_authorization_id,
      revision: Number(head.current_revision) });
    if (!row) fail('LIBRA_DEFECT_AUTHORIZATION_CORRUPT', 'Defect authorization head does not resolve.');
    const value = { authorizationId: row.authorization_id, revision: Number(row.revision),
      state: row.state, actorId: row.actor_id, effectiveAtMs: Number(row.effective_at_ms),
      revokedAtMs: Number(row.revoked_at_ms) };
    if (canonicalDigest(value) !== row.authorization_digest)
      fail('LIBRA_DEFECT_AUTHORIZATION_CORRUPT', 'Defect authorization digest is invalid.');
    return Object.freeze({ ...value, authorizationDigest: row.authorization_digest });
  }
  function current() {
    return options.unitOfWork.execute([{ participantId: 'libra_defect_authorization_read',
      owner: 'libra', repositories: [repository], execute: context => read(context.repository(repository.repositoryId)),
    }]).libra_defect_authorization_read;
  }
  function guardParticipant(expected) {
    return { participantId: 'libra_defect_authorization_guard', owner: 'libra', repositories: [repository],
      execute(context) {
        const active = read(context.repository(repository.repositoryId));
        if (!active || active.state !== 'enabled' || active.authorizationId !== expected.authorizationId ||
            active.revision !== expected.revision || active.authorizationDigest !== expected.authorizationDigest)
          fail('LIBRA_DEFECT_AUTHORIZATION_STALE', 'Automatic defect authorization was revoked or changed.');
        return active;
      } };
  }
  function publish(request) {
    if (!request || typeof request.enabled !== 'boolean' || !Number.isSafeInteger(request.expectedRevision) ||
        request.expectedRevision < 0 || typeof request.actorId !== 'string' || !request.actorId ||
        request.actorId.length > 256 || typeof request.idempotencyKey !== 'string' || !request.idempotencyKey ||
        request.idempotencyKey.length > 256 || request.enabled && request.acknowledged !== true)
      fail('LIBRA_DEFECT_AUTHORIZATION_INPUT', 'Explicit authorization, actor, revision and idempotency key are required.');
    const commandContract = 'libra.defect-standing-authorization@1';
    const requestDigest = canonicalDigest({ enabled: request.enabled, expectedRevision: request.expectedRevision,
      actorId: request.actorId, acknowledged: request.acknowledged === true });
    const key = canonicalDigest({ commandContract, actorId: request.actorId, idempotencyKey: request.idempotencyKey });
    const committed = createCommandCommitCoordinator(options).execute({
      command: { commandReceiptId: key, ownerDomain: 'libra', commandContract,
        callerScope: request.actorId, idempotencyKey: request.idempotencyKey, requestDigest,
        targetType: 'defect_authorization', targetId: AUTHORIZATION_ID },
      domainParticipant: { participantId: 'libra_defect_authorization_write', owner: 'libra', repositories: [repository],
        execute(context) {
          const repo = context.repository(repository.repositoryId), previous = read(repo);
          if ((previous?.revision || 0) !== request.expectedRevision)
            fail('LIBRA_DEFECT_AUTHORIZATION_STALE', 'Defect authorization changed; reload its current state.');
          const state = request.enabled ? 'enabled' : 'revoked';
          if (previous?.state === state || !previous && !request.enabled) return previous;
          const value = { authorizationId: AUTHORIZATION_ID, revision: request.expectedRevision + 1,
            state, actorId: request.actorId, effectiveAtMs: context.commitTimeMs,
            revokedAtMs: request.enabled ? 0 : context.commitTimeMs };
          const authorizationDigest = canonicalDigest(value);
          repo.invoke('insert', { authorization_id: AUTHORIZATION_ID, revision: value.revision,
            state, actor_id: value.actorId, effective_at_ms: value.effectiveAtMs,
            revoked_at_ms: value.revokedAtMs, authorization_digest: authorizationDigest });
          if (!previous) repo.invoke('insert_head', { singleton_key: AUTHORIZATION_ID,
            current_authorization_id: AUTHORIZATION_ID, current_revision: value.revision, updated_at_ms: context.commitTimeMs });
          else if (repo.invoke('advance', { singleton_key: AUTHORIZATION_ID, current_revision: value.revision,
            updated_at_ms: context.commitTimeMs, expected_revision: previous.revision }).changes !== 1)
            fail('LIBRA_DEFECT_AUTHORIZATION_STALE', 'Defect authorization head changed.');
          return Object.freeze({ ...value, authorizationDigest });
        } },
      commitMarker: { commitMarker: key, scopeType: 'defect_authorization', scopeId: AUTHORIZATION_ID,
        commitDigest: requestDigest },
      auditRecords: [{ auditId: key, actorType: 'admin', actorId: request.actorId,
        action: request.enabled ? 'authorize_automatic_defect_admission' : 'revoke_automatic_defect_admission',
        scopeType: 'defect_authorization', scopeId: AUTHORIZATION_ID, evidenceDigest: requestDigest }],
      resultEnvelope: authorization => ({ resultSchemaRef: 'helix://contracts/application-types/LibraDefectAuthorizationResult/v1',
        resultRef: { authorizationId: AUTHORIZATION_ID, revision: authorization?.revision || 0 } }),
    });
    return Object.freeze({ authorization: current(), replayed: committed.replayed });
  }
  return Object.freeze({ current, publish, guardParticipant, readTableIds:repository.tableIds });
}

module.exports = Object.freeze({ AUTHORIZATION_ID, createDefectAuthorizationStore });
