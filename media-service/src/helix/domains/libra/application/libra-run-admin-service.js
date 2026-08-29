'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { buildRunLifecycleDecision } = require('../model/run-lifecycle-contracts');
const { buildRunDiscardCommand } = require('../model/run-discard-contracts');
const {
  SCHEMA_REF: DEFECT_MANIFEST_SCHEMA,
  buildAuthorizedDefectManifest,
  buildDefectAdmissionCandidate,
} = require('../model/defect-admission-contracts');
const { createRunDiscardStore } = require('../persistence/run-discard-store');
const { createRunLifecycleStore } = require('../persistence/run-lifecycle-store');
const { createWorkResultReader } = require('../../../foundation/execution/work-result-reader');
const { sizeCapAdmissionForecast } = require('../model/media-production-contracts');

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
  const workResultReader = options.workResultReader || createWorkResultReader(options);
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
          'acceptance_spec_id',
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
      list_revisions: {
        kind: 'select-all',
        tableId: 'libra_run_revisions',
        columns: ['libra_run_id', 'state_revision', 'transition_kind',
          'transition_evidence_json'],
        keyColumns: ['libra_run_id'],
        safeIntegers: true,
      },
      find_spec: {
        kind: 'select-one',
        tableId: 'libra_acceptance_specs',
        columns: ['acceptance_spec_id', 'spec_json'],
        keyColumns: ['acceptance_spec_id'],
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
        const revisions = repo.invoke('list_revisions', { libra_run_id:libraRunId })
          .sort((left, right) => Number(left.state_revision) - Number(right.state_revision));
        return Object.freeze({ run:Object.freeze(run), head:Object.freeze(head),
          revisions:Object.freeze(revisions) });
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

  function defectCandidate(libraRunId, snapshot = current(libraRunId)) {
    if (snapshot.run.state !== 'frozen') {
      fail('LIBRA_DEFECT_ADMISSION_STATE', 'Only a frozen Libra Run can accept defects.');
    }
    const latestDefect = [...snapshot.revisions].reverse().map((row) => {
      if (row.transition_kind !== 'defect_admitted') return null;
      try { return JSON.parse(row.transition_evidence_json); } catch { return null; }
    }).find((item) => item?.schemaRef === DEFECT_MANIFEST_SCHEMA) || null;
    const terminalRow = snapshot.revisions.find((row) =>
      Number(row.state_revision) === Number(snapshot.run.state_revision));
    let terminalEvidence;
    try { terminalEvidence = JSON.parse(terminalRow?.transition_evidence_json); } catch {
      fail('LIBRA_DEFECT_ADMISSION_TERMINAL', 'Frozen terminal Evidence is corrupt.');
    }
    let directMediaVerification = null;
    for (const work of workResultReader.listWorks({ ownerDomain:'libra',
      processType:'libra_run', processId:libraRunId,
      workKind:'workspace_media_production' })) {
      const found = workResultReader.read(work.work_id).find((item) =>
        item.outcomeKind === 'succeeded' &&
        item.capabilityRef === 'libra.product_media.verify@1' &&
        item.result?.candidateKind === 'direct_input');
      if (found) directMediaVerification = found.result;
    }
    const candidate = buildDefectAdmissionCandidate({
      run:Object.freeze({ libraRunId, state:'frozen',
        stateRevision:Number(snapshot.run.state_revision), stateDigest:snapshot.run.state_digest }),
      terminalEvidence,
      directMediaVerification,
      priorAuthorizedManifest:latestDefect,
    });
    if (!candidate.defects.some((item) => item.defectCode === 'size_cap_exceeded')) {
      return candidate;
    }
    const sizeForecast = sizeForecastForRun(libraRunId, snapshot.run.acceptance_spec_id);
    return sizeForecast ? Object.freeze({ ...candidate, sizeForecast }) : candidate;
  }

  function sizeForecastForRun(libraRunId, acceptanceSpecId) {
    try {
      const specRow = options.unitOfWork.execute([{
        participantId: 'libra_run_admin_spec_read',
        owner: 'libra',
        repositories: [repository],
        execute(context) {
          return context.repository(repository.repositoryId).invoke('find_spec', {
            acceptance_spec_id: acceptanceSpecId,
          });
        },
      }]).libra_run_admin_spec_read;
      const spec = specRow?.spec_json ? JSON.parse(specRow.spec_json) : null;
      const maxSizeBytes = spec?.requirements?.space?.maxSizeBytes;
      const works = workResultReader.listWorks({
        ownerDomain: 'libra', processType: 'libra_run', processId: libraRunId,
        workKind: 'workspace_media_production',
      }) || [];
      const assessment = [...works].reverse().find((work) =>
        String(work.work_id).includes('_assessment-work-'));
      if (!assessment) return null;
      const record = workResultReader.read(assessment.work_id).find((item) =>
        item.capabilityRef === 'libra.transcode.input.verify@1');
      const intent = record?.inputBindings?.bindings?.find((item) =>
        item.portName === 'encodeIntent')?.value;
      const probe = record?.inputBindings?.bindings?.find((item) =>
        item.portName === 'mediaProbeEvidence')?.value;
      return sizeCapAdmissionForecast({ maxSizeBytes, probe, intent });
    } catch {
      return null;
    }
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
    previewDefects(libraRunId) {
      return defectCandidate(libraRunId);
    },
    admitWithDefects(libraRunId, body) {
      if (!body || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey ||
          !Number.isSafeInteger(body.expectedRunStateRevision) ||
          typeof body.expectedRunStateDigest !== 'string' ||
          typeof body.expectedDefectCandidateDigest !== 'string' ||
          body.acknowledged !== true) {
        fail('LIBRA_DEFECT_ADMISSION_INPUT',
          'Defect admission requires exact Run/candidate fences, acknowledgement, and idempotency.');
      }
      const snapshot = current(libraRunId);
      const latestDefect = [...snapshot.revisions].reverse().map((row) => {
        if (row.transition_kind !== 'defect_admitted') return null;
        try { return JSON.parse(row.transition_evidence_json); } catch { return null; }
      }).find((item) => item?.schemaRef === DEFECT_MANIFEST_SCHEMA) || null;
      if (snapshot.run.state === 'active' && latestDefect &&
          latestDefect.actorId === 'admin' &&
          latestDefect.idempotencyKey === body.idempotencyKey) {
        return Object.freeze({ resultKind:'defect_admitted', libraRunId,
          stateRevision:Number(snapshot.run.state_revision), stateDigest:snapshot.run.state_digest,
          authorizedDefectManifest:latestDefect, replayed:true });
      }
      if (snapshot.run.state !== 'frozen') {
        fail('LIBRA_DEFECT_ADMISSION_STATE', 'Only a frozen Libra Run can accept defects.');
      }
      if (Number(snapshot.run.state_revision) !== body.expectedRunStateRevision ||
          snapshot.run.state_digest !== body.expectedRunStateDigest) {
        fail('LIBRA_DEFECT_ADMISSION_STALE', 'Libra Run changed before defect admission.');
      }
      const candidate = defectCandidate(libraRunId, snapshot);
      if (candidate.candidateDigest !== body.expectedDefectCandidateDigest) {
        fail('LIBRA_DEFECT_ADMISSION_CANDIDATE_STALE',
          'Defect candidate changed before user acknowledgement.',
          { currentCandidateDigest:candidate.candidateDigest });
      }
      const manifest = buildAuthorizedDefectManifest({ candidate, actorId:'admin',
        idempotencyKey:body.idempotencyKey, acknowledged:true,
        decidedAtMs:(options.now || Date.now)() });
      const decision = buildRunLifecycleDecision({ libraRunId,
        expectedStateRevision:Number(snapshot.run.state_revision),
        expectedStateDigest:snapshot.run.state_digest,
        transitionKind:'defect_admit', transitionEvidence:manifest,
        expectedAdmissionHeadRevision:Number(snapshot.head.head_revision),
        expectedActiveScopeSetDigest:snapshot.head.active_scope_set_digest });
      const committed = lifecycle.transition({ decision,
        commitMarker:canonicalDigest({ schema:'libra.defect-admission-marker@1',
          defectDecisionId:manifest.defectDecisionId, decisionDigest:decision.decisionDigest }),
        resultId:canonicalDigest({ schema:'libra.defect-admission-result-id@1',
          defectDecisionId:manifest.defectDecisionId }) });
      options.libraRunExecutionProjection.invalidate(libraRunId);
      options.wake?.();
      return Object.freeze({ resultKind:'defect_admitted', libraRunId,
        stateRevision:committed.result.committedStateRevision,
        stateDigest:committed.result.committedStateDigest,
        authorizedDefectManifest:manifest, replayed:committed.replayed });
    },
  });
}

module.exports = Object.freeze({ LibraRunAdminError, createLibraRunAdminService });
