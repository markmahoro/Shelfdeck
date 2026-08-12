'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { buildRunLifecycleDecision } = require('../model/run-lifecycle-contracts');
const { buildRunDiscardCommand } = require('../model/run-discard-contracts');
const { createRunDiscardStore } = require('../persistence/run-discard-store');
const { createRunLifecycleStore } = require('../persistence/run-lifecycle-store');

class LibraRunAdminError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LibraRunAdminError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new LibraRunAdminError(code, message, details);
}

function createLibraRunAdminService(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      !options.libraRunExecutionProjection) {
    fail('LIBRA_RUN_ADMIN_DEPENDENCIES',
      'Libra Run Admin requires Owner persistence and its Execution Projection.');
  }
  const lifecycle = createRunLifecycleStore(options);
  const discardStore = createRunDiscardStore(options);
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_run_admin_read',
    owner: 'libra',
    schemaManifest: options.schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one',
        tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'subject_id', 'state', 'state_revision',
          'state_digest', 'priority_class', 'priority_intent_digest',
        ],
        keyColumns: ['libra_run_id'],
        safeIntegers: true,
      },
      find_head: {
        kind: 'select-one',
        tableId: 'libra_run_admission_heads',
        columns: ['subject_id', 'head_revision', 'active_scope_set_digest'],
        keyColumns: ['subject_id'],
        safeIntegers: true,
      },
    },
  });

  function current(libraRunId) {
    return options.unitOfWork.execute([{
      participantId: 'libra_run_admin_snapshot',
      owner: 'libra',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const run = repo.invoke('find_run', { libra_run_id: libraRunId });
        if (!run) fail('LIBRA_RUN_NOT_FOUND', 'Libra Run was not found.');
        const head = repo.invoke('find_head', { subject_id: run.subject_id });
        if (!head) fail('LIBRA_RUN_HEAD_NOT_FOUND',
          'Active Libra Run admission head was not found.');
        return Object.freeze({ run:Object.freeze(run), head:Object.freeze(head) });
      },
    }]).libra_run_admin_snapshot;
  }

  function setPriority(libraRunId, body, requestedPriorityClass) {
    if (!body || typeof body.idempotencyKey !== 'string' ||
        !body.idempotencyKey || !Number.isSafeInteger(body.expectedRunStateRevision) ||
        typeof body.expectedRunStateDigest !== 'string') {
      fail('LIBRA_RUN_PRIORITY_INPUT',
        'Run priority requires idempotencyKey and exact expected state revision/digest.');
    }
    const snapshot = current(libraRunId);
    const run = snapshot.run;
    if (run.state !== 'active') fail('LIBRA_RUN_PRIORITY_STATE',
      'Only an active Libra Run can change priority.');
    if (Number(run.state_revision) !== body.expectedRunStateRevision ||
        run.state_digest !== body.expectedRunStateDigest) {
      fail('LIBRA_RUN_PRIORITY_STALE', 'Libra Run state changed before priority commit.');
    }
    if (run.priority_class === requestedPriorityClass) {
      return Object.freeze({
        libraRunId,
        stateRevision: Number(run.state_revision),
        stateDigest: run.state_digest,
        priorityClass: run.priority_class,
        replayed: true,
      });
    }
    const intentKind = requestedPriorityClass === 'expedited'
      ? 'accelerate' : 'cancel_acceleration';
    const intent = {
      libraRunId,
      actorId: 'admin',
      idempotencyKey: body.idempotencyKey,
      expectedPriorityClass: run.priority_class,
      requestedPriorityClass,
      intentKind,
      issuedAtMs: (options.now || Date.now)(),
    };
    intent.intentId = canonicalDigest({
      schema: 'libra.run-priority-intent-id@1',
      libraRunId,
      actorId: intent.actorId,
      idempotencyKey: intent.idempotencyKey,
    });
    intent.intentDigest = canonicalDigest(intent);
    const decision = buildRunLifecycleDecision({
      libraRunId,
      expectedStateRevision: Number(run.state_revision),
      expectedStateDigest: run.state_digest,
      transitionKind: 'set_priority',
      transitionEvidence: intent,
      newPriority: {
        priorityClass: requestedPriorityClass,
        priorityIntentDigest: intent.intentDigest,
      },
      expectedAdmissionHeadRevision: Number(snapshot.head.head_revision),
      expectedActiveScopeSetDigest: snapshot.head.active_scope_set_digest,
    });
    const committed = lifecycle.transition({
      decision,
      commitMarker: canonicalDigest({
        schema: 'libra.run-priority-marker@1',
        intentId: intent.intentId,
        decisionDigest: decision.decisionDigest,
      }),
      resultId: canonicalDigest({
        schema: 'libra.run-priority-result-id@1',
        intentId: intent.intentId,
      }),
    });
    options.libraRunExecutionProjection.invalidate(libraRunId);
    options.wake?.();
    return Object.freeze({
      libraRunId,
      stateRevision: committed.result.committedStateRevision,
      stateDigest: committed.result.committedStateDigest,
      priorityClass: requestedPriorityClass,
      priorityIntentDigest: intent.intentDigest,
      replayed: committed.replayed,
    });
  }

  return Object.freeze({
    expedite(libraRunId, body) {
      return setPriority(libraRunId, body, 'expedited');
    },
    cancelExpedite(libraRunId, body) {
      return setPriority(libraRunId, body, 'normal');
    },
    discard(libraRunId, body) {
      if (!body || typeof body.idempotencyKey !== 'string' ||
          !body.idempotencyKey ||
          !Number.isSafeInteger(body.expectedRunStateRevision) ||
          typeof body.expectedRunStateDigest !== 'string') {
        fail('LIBRA_RUN_DISCARD_INPUT',
          'Run discard requires idempotencyKey and exact expected state revision/digest.');
      }
      const command = buildRunDiscardCommand({
        libraRunId,
        expectedRunStateRevision: body.expectedRunStateRevision,
        expectedRunStateDigest: body.expectedRunStateDigest,
        actorId: 'admin',
        idempotencyKey: body.idempotencyKey,
      });
      const inspected = discardStore.inspect(command);
      const result = inspected.kind === 'ready'
        ? discardStore.commit(inspected) : inspected;
      if (result.resultKind === 'discarded') {
        options.libraRunExecutionProjection.invalidate(libraRunId);
        options.wake?.();
      }
      return result;
    },
  });
}

module.exports = Object.freeze({ LibraRunAdminError, createLibraRunAdminService });
