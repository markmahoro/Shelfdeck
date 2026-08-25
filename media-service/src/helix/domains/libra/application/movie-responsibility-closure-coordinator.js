'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { digest } = require('../../../foundation/persistence/ddl-compiler');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createInboxCoordinator } = require('../../../foundation/persistence/outbox-inbox');
const {
  buildRunLifecycleDecision,
} = require('../model/run-lifecycle-contracts');
const {
  CYCLE_MS,
  DAY_MS,
  buildCommitDecision,
  buildEffectIntent,
  buildObservation,
  buildOffloadAdmission,
} = require('../model/workspace-cleanup-contracts');
const {
  createRunLifecycleStore,
} = require('../persistence/run-lifecycle-store');
const {
  createWorkspaceCleanupStore,
} = require('../persistence/workspace-cleanup-store');

class MovieResponsibilityClosureError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MovieResponsibilityClosureError';
    this.code = code;
    this.details = details;
  }
}
function fail(code, message, details) {
  throw new MovieResponsibilityClosureError(code, message, details);
}

function messageDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'movie_responsibility_messages',
    owner: 'execution-foundation',
    readOnly: true,
    schemaManifest,
    statements: {
      list_kind: {
        kind: 'select-all', tableId: 'fx_outbox',
        columns: [
          'message_id', 'producer_domain', 'message_kind', 'aggregate_type',
          'aggregate_id', 'aggregate_revision', 'dedup_key',
          'payload_schema_ref', 'payload_json', 'payload_digest', 'state',
        ],
        keyColumns: ['message_kind'], safeIntegers: true,
      },
      find_delivery: {
        kind: 'select-one', tableId: 'fx_outbox_deliveries',
        columns: [
          'message_id', 'consumer_domain', 'state', 'attempt_count',
          'next_attempt_at_ms', 'acked_at_ms',
        ],
        keyColumns: ['message_id', 'consumer_domain'], safeIntegers: true,
      },
      find_inbox: {
        kind: 'select-one', tableId: 'fx_inbox',
        columns: [
          'consumer_domain', 'message_id', 'dedup_key',
          'received_at_ms', 'consumed_at_ms', 'result_digest',
        ],
        keyColumns: ['consumer_domain', 'message_id'], safeIntegers: true,
      },
      find_result: {
        kind: 'select-one', tableId: 'fx_event_result_bindings',
        columns: [
          'result_id', 'result_schema_ref', 'result_json', 'result_digest',
        ],
        keyColumns: ['result_id'], safeIntegers: true,
      },
    },
  });
}

function stateDefinition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'movie_responsibility_libra_state',
    owner: 'libra',
    readOnly: true,
    schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one', tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'subject_id', 'state', 'state_revision',
          'state_digest', 'execution_basis_digest',
        ],
        keyColumns: ['libra_run_id'], safeIntegers: true,
      },
      find_head: {
        kind: 'select-one', tableId: 'libra_run_admission_heads',
        columns: ['subject_id', 'head_revision', 'active_scope_set_digest'],
        keyColumns: ['subject_id'], safeIntegers: true,
      },
      find_scope: {
        kind: 'select-one', tableId: 'libra_workspace_cleanup_scopes',
        columns: [
          'cleanup_scope_id', 'admission_decision_digest', 'state',
          'state_revision', 'state_digest',
        ],
        keyColumns: ['cleanup_scope_id'], safeIntegers: true,
      },
      list_subject_runs: {
        kind: 'select-all', tableId: 'libra_runs',
        columns: [
          'libra_run_id', 'subject_id', 'state', 'state_revision',
          'state_digest', 'package_revision_head',
        ],
        keyColumns: ['subject_id'], safeIntegers: true,
      },
      list_run_packages: {
        kind: 'select-all', tableId: 'libra_product_packages',
        columns: [
          'on_deck_package_id', 'offer_id', 'package_revision',
          'libra_run_id', 'package_digest', 'state',
        ],
        keyColumns: ['libra_run_id'], safeIntegers: true,
      },
      page_active_workspaces: {
        kind: 'select-page-after', tableId: 'libra_workspaces', keyColumn:'workspace_id',
        fixedKeyColumns:['state'], maxItems:100, safeIntegers:true,
        columns:['workspace_id','libra_run_id','state'],
      },
      page_active_cleanup_scopes: {
        kind: 'select-page-after', tableId: 'libra_workspace_cleanup_scopes', keyColumn:'cleanup_scope_id',
        fixedKeyColumns:['state'], maxItems:100, safeIntegers:true,
        columns:['cleanup_scope_id','libra_run_id','workspace_id','state'],
      },
    },
  });
}

function canonicalOutboxPayloadDigest(value) {
  return digest(JSON.stringify(value, Object.keys(value).sort()));
}

function createMovieResponsibilityClosureCoordinator(options) {
  if (!options?.schemaManifest || !options.unitOfWork ||
      !options.offloadCompletionPort ||
      !options.workspaceProductPort ||
      typeof options.now !== 'function') {
    fail('P14_MOVIE_CLOSURE_DEPENDENCIES',
      'Movie responsibility closure requires formal ports, persistence, and a clock.');
  }
  const messageRepository = messageDefinition(options.schemaManifest);
  const stateRepository = stateDefinition(options.schemaManifest);
  const inbox = createInboxCoordinator(options);
  const lifecycle = createRunLifecycleStore(options);
  const cleanup = createWorkspaceCleanupStore(options);
  const cleanupAudits = new Map();

  function readMessage(kind, predicate, required = true) {
    return options.unitOfWork.execute([{
      participantId: 'movie_responsibility_message_read',
      owner: 'execution-foundation',
      repositories: [messageRepository],
      execute(context) {
        const repo = context.repository(messageRepository.repositoryId);
        const candidates = repo.invoke('list_kind', {
          message_kind: kind,
        }).map((row) => {
          let payload;
          try {
            payload = JSON.parse(row.payload_json);
          } catch {
            fail('P14_MOVIE_MESSAGE_CORRUPT',
              'Formal Outbox payload is not valid JSON.');
          }
          const delivery = repo.invoke('find_delivery', {
            message_id: row.message_id,
            consumer_domain: 'libra',
          });
          const inboxRow = repo.invoke('find_inbox', {
            consumer_domain: 'libra',
            message_id: row.message_id,
          });
          if (!delivery || row.producer_domain !== 'arca' ||
              row.message_id !== payload.messageId ||
              canonicalOutboxPayloadDigest(payload) !== row.payload_digest) {
            fail('P14_MOVIE_MESSAGE_CORRUPT',
              'Formal Arca→Libra message continuity is invalid.');
          }
          return { row, payload, delivery, inbox: inboxRow };
        }).filter((item) => predicate(item.payload));
        if (candidates.length > 1 || (required && candidates.length !== 1)) {
          fail('P14_MOVIE_MESSAGE_CARDINALITY',
            'Movie closure message cardinality is invalid.', {
              kind, count: candidates.length,
            });
        }
        return candidates.length ? Object.freeze(candidates[0]) : null;
      },
    }]).movie_responsibility_message_read;
  }

  function readRun(libraRunId) {
    return options.unitOfWork.execute([{
      participantId: 'movie_responsibility_run_read',
      owner: 'libra',
      repositories: [stateRepository],
      execute(context) {
        const repo = context.repository(stateRepository.repositoryId);
        const run = repo.invoke('find_run', { libra_run_id: libraRunId });
        if (!run) fail('P14_MOVIE_RUN_MISSING', 'Movie Libra Run is absent.');
        const head = repo.invoke('find_head', { subject_id: run.subject_id });
        return Object.freeze({ run, head });
      },
    }]).movie_responsibility_run_read;
  }

  function readCommittedLifecycleResult(libraRunId, messageId) {
    const resultId = canonicalDigest({
      schema: 'libra.movie-run-complete-result-id@1',
      libraRunId,
      messageId,
    });
    return options.unitOfWork.execute([{
      participantId: 'movie_responsibility_result_read',
      owner: 'execution-foundation',
      repositories: [messageRepository],
      execute(context) {
        const row = context.repository(messageRepository.repositoryId)
          .invoke('find_result', { result_id: resultId });
        if (!row ||
            row.result_schema_ref !==
              'helix://contracts/application-types/LibraRunLifecycleResult/v1') {
          fail('P14_MOVIE_RUN_REPLAY_INCOMPLETE',
            'Completed Run lacks its exact lifecycle Result.');
        }
        let result;
        try {
          result = JSON.parse(row.result_json);
        } catch {
          fail('P14_MOVIE_RUN_REPLAY_INCOMPLETE',
            'Completed Run lifecycle Result is not valid JSON.');
        }
        if (canonicalDigest(result) !== row.result_digest) {
          fail('P14_MOVIE_RUN_REPLAY_INCOMPLETE',
            'Completed Run lifecycle Result digest is invalid.');
        }
        return Object.freeze({ row, result: Object.freeze(result) });
      },
    }]).movie_responsibility_result_read;
  }

  function completeRun(libraRunId, packageValue) {
    const accepted = readMessage('arca.product.accepted@1',
      (payload) => payload.libraRunId === libraRunId &&
        payload.onDeckPackageId === packageValue.onDeckPackageId &&
        payload.packageDigest === packageValue.packageDigest);
    const current = readRun(libraRunId);
    let lifecycleResult;
    if (current.run.state === 'completed') {
      const committed = readCommittedLifecycleResult(
        libraRunId,
        accepted.payload.messageId,
      );
      if (!accepted.inbox ||
          accepted.inbox.dedup_key !== accepted.payload.dedupKey ||
          accepted.inbox.consumed_at_ms === null ||
          accepted.inbox.result_digest !== committed.result.resultDigest ||
          committed.result.libraRunId !== libraRunId ||
          committed.result.committedState !== 'completed' ||
          committed.result.committedStateRevision !==
            Number(current.run.state_revision) ||
          committed.result.committedStateDigest !== current.run.state_digest ||
          !['pending', 'delivered', 'acked'].includes(
            accepted.delivery.state,
          )) {
        fail('P14_MOVIE_RUN_REPLAY_INCOMPLETE',
          'Completed Run lacks its exact consumed Accepted delivery.');
      }
      lifecycleResult = {
        replayed: true,
        result: committed.result,
      };
    } else {
      if (!current.head || !['active', 'suspended'].includes(current.run.state)) {
        fail('P14_MOVIE_RUN_STATE',
          'Accepted Product may complete only its active/suspended Run.');
      }
      const decision = buildRunLifecycleDecision({
        libraRunId,
        expectedStateRevision: Number(current.run.state_revision),
        expectedStateDigest: current.run.state_digest,
        transitionKind: 'complete',
        transitionEvidence: accepted.payload,
        expectedAdmissionHeadRevision: Number(current.head.head_revision),
        expectedActiveScopeSetDigest: current.head.active_scope_set_digest,
      });
      lifecycleResult = lifecycle.transition({
        decision,
        commitMarker: canonicalDigest({
          schema: 'libra.movie-run-complete-marker@1',
          libraRunId,
          messageId: accepted.payload.messageId,
        }),
        resultId: canonicalDigest({
          schema: 'libra.movie-run-complete-result-id@1',
          libraRunId,
          messageId: accepted.payload.messageId,
        }),
      });
      if (typeof options.afterRunCompletion === 'function') {
        options.afterRunCompletion(lifecycleResult.result);
      }
    }
    const acknowledgement = inbox.acknowledge({
      messageId: accepted.payload.messageId,
      consumerDomain: 'libra',
    });
    return Object.freeze({
      message: accepted.payload,
      result: lifecycleResult.result,
      replayed: lifecycleResult.replayed,
      acknowledgement,
    });
  }

  function consumeOffloadWake(message, admission) {
    const consumed = inbox.consume({
      message: {
        messageId: message.messageId,
        dedupKey: message.messageId,
        consumerDomain: 'libra',
      },
      resultDigest: admission.result.resultDigest,
      domainParticipant: {
        participantId: 'movie_offload_wake_libra',
        owner: 'libra',
        repositories: [stateRepository],
        execute(context) {
          const scope = context.repository(stateRepository.repositoryId)
            .invoke('find_scope', {
              cleanup_scope_id: admission.result.cleanupScopeId,
            });
          if (!scope ||
              scope.cleanup_scope_id !== admission.result.cleanupScopeId) {
            fail('P14_MOVIE_OFFLOAD_SCOPE_MISSING',
              'Off-load wake cannot bind its committed cleanup Scope.');
          }
          return scope.cleanup_scope_id;
        },
      },
    });
    const acknowledgement = inbox.acknowledge({
      messageId: message.messageId,
      consumerDomain: 'libra',
    });
    return Object.freeze({ consumed, acknowledgement });
  }

  function findOffloadWake(packageValue) {
    if (options.offloadWakeVisible === false) return null;
    return readMessage('arca.offload.completed@1',
      (payload) => payload.onDeckPackageId === packageValue.onDeckPackageId &&
        payload.packageDigest === packageValue.packageDigest, false);
  }

  function consumeOptionalOffloadWake(wake, admission) {
    return wake ? consumeOffloadWake(wake.payload, admission) : null;
  }

  function pendingAudit(firstObservation) {
    return Object.freeze({
      stage: 'workspace_cleanup_audit_pending',
      firstObservation,
      nextObservationAtMs: firstObservation.observedAtMs + CYCLE_MS,
    });
  }

  function drainCleanupScope(cleanupScopeId, maxMembers = Number.POSITIVE_INFINITY) {
    let scope = cleanup.readScope(cleanupScopeId);
    const receipts = [];
    while (scope.state === 'active' && receipts.length < maxMembers) {
      const member = scope.members.find((item) => item.state === 'pending');
      if (!member) {
        fail('P14_MOVIE_CLEANUP_MEMBER_MISSING',
          'Active cleanup Scope has no pending member.');
      }
      const handle = cleanup.readHandle(scope.workspaceId,
        member.materialHandleId);
      const intent = buildEffectIntent(scope, member, handle);
      const effect = options.workspaceProductPort.reclaimMaterial(intent);
      const workspace = cleanup.currentWorkspace(scope.workspaceId);
      const freshScope = cleanup.readScope(scope.cleanupScopeId);
      const freshMember = freshScope.members.find((item) =>
        item.materialHandleId === member.materialHandleId);
      const pendingMembers = freshScope.members.filter((item) =>
        item.state === 'pending');
      if (pendingMembers.length === 1 &&
          pendingMembers[0].materialHandleId === member.materialHandleId) {
        options.workspaceProductPort.reclaimEmptyWorkspace?.(scope.workspaceId);
      }
      const commitDecision = buildCommitDecision({
        scope: freshScope,
        member: freshMember,
        workspace,
        deletionEvidence: effect.deletionEvidence,
      });
      const committed = cleanup.commit({
        decision: commitDecision,
        commitMarker: canonicalDigest({
          schema: 'libra.workspace-cleanup-member-marker@1',
          cleanupScopeId: scope.cleanupScopeId,
          materialHandleId: member.materialHandleId,
          decisionDigest: commitDecision.decisionDigest,
        }),
        resultId: canonicalDigest({
          schema: 'libra.workspace-cleanup-member-result-id@1',
          cleanupScopeId: scope.cleanupScopeId,
          materialHandleId: member.materialHandleId,
        }),
      });
      receipts.push(committed.result);
      if (typeof options.afterCleanupCommit === 'function' &&
          !committed.replayed) {
        options.afterCleanupCommit(committed.result);
      }
      scope = cleanup.readScope(scope.cleanupScopeId);
    }
    return Object.freeze({
      stage: scope.state === 'completed'
        ? 'workspace_cleanup_completed' : 'workspace_cleanup_in_progress',
      cleanupScopeId: scope.cleanupScopeId,
      scope,
      receipts: Object.freeze(receipts),
    });
  }

  function cleanupWorkspace(libraRunId, packageValue, maxMembers = Number.POSITIVE_INFINITY) {
    const triggerSnapshot = options.offloadCompletionPort.readCompletion({
      queryContract: 'arca.offload-completion@1',
      onDeckPackageId: packageValue.onDeckPackageId,
      expectedPackageDigest: packageValue.packageDigest,
    });
    if (triggerSnapshot.resultKind !== 'found') {
      return Object.freeze({ stage: 'offload_not_found' });
    }
    const offloadWake = findOffloadWake(packageValue);
    let scope = cleanup.readScopeByTrigger(triggerSnapshot);
    let wake;
    if (scope) {
      wake = consumeOptionalOffloadWake(offloadWake, {
        result: cleanup.readAdmissionResult(scope.cleanupScopeId),
      });
    } else {
      const nowMs = options.now();
      const graceDeadlineMs =
        triggerSnapshot.offloadCompletionFact.committedAtMs + DAY_MS;
      if (nowMs < graceDeadlineMs) {
        fail('P14_CLEANUP_GRACE_ACTIVE',
          'Workspace cleanup grace has not elapsed.', { graceDeadlineMs });
      }
      const auditKey = canonicalDigest({
        schema: 'libra.workspace-cleanup-audit-key@1',
        onDeckPackageId: packageValue.onDeckPackageId,
        packageDigest: packageValue.packageDigest,
        projectionRevision: triggerSnapshot.projectionRevision,
        projectionDigest: triggerSnapshot.projectionDigest,
      });
      const firstAudit = cleanupAudits.get(auditKey);
      if (firstAudit &&
          nowMs < firstAudit.observation.observedAtMs + CYCLE_MS) {
        return pendingAudit(firstAudit.observation);
      }
      const inspected = cleanup.inspect(libraRunId);
      if (inspected.references.length === 0) {
        return Object.freeze({ stage: 'cleanup_no_op' });
      }
      if (!firstAudit) {
        const firstObservation = buildObservation({
          workspaceId: inspected.workspace.workspaceId,
          observedAtMs: nowMs,
          otherReferences: inspected.otherReferences,
          controls: inspected.controls,
        });
        cleanupAudits.set(auditKey, Object.freeze({
          observation: firstObservation,
          workspaceId: inspected.workspace.workspaceId,
        }));
        return pendingAudit(firstObservation);
      }
      if (firstAudit.workspaceId !== inspected.workspace.workspaceId) {
        fail('P14_CLEANUP_AUDIT_WORKSPACE_CHANGED',
          'Cleanup audit Workspace identity changed between observations.');
      }
      const observation2 = buildObservation({
        workspaceId: inspected.workspace.workspaceId,
        observedAtMs: nowMs,
        otherReferences: inspected.otherReferences,
        controls: inspected.controls,
      });
      const decision = buildOffloadAdmission({
        triggerSnapshot,
        onDeckPackageId: packageValue.onDeckPackageId,
        packageDigest: packageValue.packageDigest,
        nowMs,
        libraRunRef: inspected.run,
        workspaceRef: {
          workspaceId: inspected.workspace.workspaceId,
          workspaceRevision: inspected.workspace.workspaceRevision,
          workspaceStateDigest:
            inspected.workspace.workspaceStateDigest,
          materialReferenceSetDigest:
            inspected.workspace.materialReferenceSetDigest,
        },
        references: inspected.references,
        controls: inspected.controls,
        observation1: firstAudit.observation,
        observation2,
      });
      if (typeof options.beforeCleanupAdmission === 'function') {
        options.beforeCleanupAdmission(decision);
      }
      const admission = cleanup.admit({
        decision,
        commitMarker: canonicalDigest({
          schema: 'libra.workspace-cleanup-admission-marker@1',
          cleanupScopeId: decision.cleanupScopeId,
          decisionDigest: decision.decisionDigest,
        }),
        resultId: canonicalDigest({
          schema: 'libra.workspace-cleanup-admission-result-id@1',
          cleanupScopeId: decision.cleanupScopeId,
        }),
      });
      if (typeof options.afterCleanupAdmission === 'function' &&
          !admission.replayed) {
        options.afterCleanupAdmission(admission.result);
      }
      cleanupAudits.delete(auditKey);
      wake = consumeOptionalOffloadWake(offloadWake, admission);
      scope = cleanup.readScope(decision.cleanupScopeId);
    }
    return Object.freeze({...drainCleanupScope(scope.cleanupScopeId,maxMembers),wake});
  }

  function advance(request) {
    const runClosure = completeRun(request.libraRunId,
      request.onDeckProductPackage);
    let cleanupResult;
    try {
      cleanupResult = cleanupWorkspace(request.libraRunId,
        request.onDeckProductPackage);
    } catch (error) {
      if (error.code !== 'P14_CLEANUP_GRACE_ACTIVE') throw error;
      cleanupResult = Object.freeze({
        stage: 'workspace_cleanup_grace_active',
        graceDeadlineMs: error.details.graceDeadlineMs,
      });
    }
    return Object.freeze({
      stage: cleanupResult.stage,
      runClosure,
      cleanup: cleanupResult,
    });
  }

  function findCompletedRun(subjectId) {
    return options.unitOfWork.execute([{
      participantId: 'movie_completed_run_read',
      owner: 'libra',
      repositories: [stateRepository],
      execute(context) {
        const repo = context.repository(stateRepository.repositoryId);
        const matches = repo.invoke('list_subject_runs', {
          subject_id: subjectId,
        }).filter((run) => run.state === 'completed' &&
          Number(run.package_revision_head) > 0 &&
          repo.invoke('list_run_packages', {
            libra_run_id: run.libra_run_id,
          }).some((item) => item.state === 'published'));
        if (matches.length > 1) {
          fail('P14_MOVIE_COMPLETED_RUN_AMBIGUOUS',
            'Subject has more than one completed published Movie Run.');
        }
        if (!matches.length) return null;
        const run = matches[0];
        const packages = repo.invoke('list_run_packages', {
          libra_run_id: run.libra_run_id,
        }).filter((item) => item.state === 'published');
        if (packages.length !== 1) {
          fail('P14_MOVIE_COMPLETED_PACKAGE_AMBIGUOUS',
            'Completed Movie Run requires one published Product Package.');
        }
        return Object.freeze({
          libraRunId: run.libra_run_id,
          package: Object.freeze({
            onDeckPackageId: packages[0].on_deck_package_id,
            offerId: packages[0].offer_id,
            packageRevision: Number(packages[0].package_revision),
            packageDigest: packages[0].package_digest,
          }),
        });
      },
    }]).movie_completed_run_read;
  }

  function listCompletedWorkspacePage(cursor, limit) {
    return options.unitOfWork.execute([{
      participantId:'movie_completed_workspace_page',owner:'libra',repositories:[stateRepository],execute(context){
        const repo=context.repository(stateRepository.repositoryId);
        return Object.freeze(repo.invoke('page_active_workspaces',{state:'active',cursor:cursor||null,limit}).map((workspace)=>{
          const run=repo.invoke('find_run',{libra_run_id:workspace.libra_run_id});
          if(!run||run.state!=='completed')return Object.freeze({cursor:workspace.workspace_id,scope:Object.freeze({skipped:true})});
          const packages=repo.invoke('list_run_packages',{libra_run_id:workspace.libra_run_id}).filter((item)=>item.state==='published');
          if(packages.length!==1)fail('P14_MOVIE_COMPLETED_PACKAGE_AMBIGUOUS','Completed Movie Run requires one published Product Package.');
          return Object.freeze({cursor:workspace.workspace_id,scope:Object.freeze({libraRunId:workspace.libra_run_id,
            onDeckProductPackage:Object.freeze({onDeckPackageId:packages[0].on_deck_package_id,offerId:packages[0].offer_id,
              packageRevision:Number(packages[0].package_revision),packageDigest:packages[0].package_digest})})});
        }));
      },
    }]).movie_completed_workspace_page;
  }

  function listActiveCleanupScopePage(cursor, limit) {
    return options.unitOfWork.execute([{
      participantId:'movie_active_cleanup_scope_page',owner:'libra',repositories:[stateRepository],execute(context){
        const repo=context.repository(stateRepository.repositoryId);
        return Object.freeze(repo.invoke('page_active_cleanup_scopes',{state:'active',cursor:cursor||null,limit})
          .map((scope)=>Object.freeze({cursor:scope.cleanup_scope_id,scope:Object.freeze({cleanupScopeId:scope.cleanup_scope_id})})));
      },
    }]).movie_active_cleanup_scope_page;
  }

  function reconcileCompletedWorkspace(scope) {
    if(scope?.skipped)return Object.freeze({stage:'skipped'});
    try{return cleanupWorkspace(scope.libraRunId,scope.onDeckProductPackage,1);}
    catch(error){if(error.code!=='P14_CLEANUP_GRACE_ACTIVE')throw error;return Object.freeze({stage:'workspace_cleanup_grace_active',
      graceDeadlineMs:error.details.graceDeadlineMs});}
  }

  return Object.freeze({ advance, findCompletedRun, listCompletedWorkspacePage, listActiveCleanupScopePage,
    reconcileCompletedWorkspace, reconcileCleanupScope:({cleanupScopeId})=>drainCleanupScope(cleanupScopeId,1) });
}

module.exports = Object.freeze({
  MovieResponsibilityClosureError,
  createMovieResponsibilityClosureCoordinator,
});
