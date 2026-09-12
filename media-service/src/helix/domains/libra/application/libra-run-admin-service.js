'use strict';
const { requirementGapValueDigest } = require('../../../contracts/requirement-gap-values');

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
const { createDefectAuthorizationStore } = require('../persistence/defect-authorization-store');
const { createRunOutcomeStore } = require('../persistence/run-outcome-store');
const { createWorkResultReader } = require('../../../foundation/execution/work-result-reader');
const {metadataResultItems,observedFieldKeys,observedMediaCastRoles}=require('../planning/product-metadata-work');
const {WAIVABLE_MEDIA_CODES}=require('../model/defect-admission-contracts');
const {createStrategyAvailabilityStore}=require('../persistence/strategy-availability-store');

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
  const defectAuthorizations = createDefectAuthorizationStore(options);
  const outcomes = createRunOutcomeStore(options);
  const strategyAvailability=createStrategyAvailabilityStore(options);
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
          'acceptance_spec_id', 'execution_basis_digest',
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
        const specRow=repo.invoke('find_spec',{acceptance_spec_id:run.acceptance_spec_id});
        return Object.freeze({ run:Object.freeze(run), head:Object.freeze(head),spec:specRow?JSON.parse(specRow.spec_json):null,
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
    if(terminalEvidence.assessmentId)fail('P9_DEFECT_ADMISSION_INELIGIBLE','Finite freshness recovery did not establish current product eligibility.');
    const works = ['workspace_media_production','product_metadata_observation','artifact_production'].flatMap(workKind =>
      workResultReader.listWorks({ ownerDomain:'libra', processType:'libra_run', processId:libraRunId, workKind }));
    let directMediaVerification = null,verificationWorkId=null;
    for (const work of works.filter(work => work.work_kind === 'workspace_media_production')) {
      const found = workResultReader.read(work.work_id).find((item) =>
        item.outcomeKind === 'succeeded' &&
        item.capabilityRef === 'libra.product_media.verify@1' &&
        item.result?.candidateKind === 'direct_input');
      if (found) {directMediaVerification = found.result;verificationWorkId=work.work_id;}
    }
    const metadata=metadataResultItems({workResultReader},libraRunId);
    const fields=observedFieldKeys(metadata),roles=observedMediaCastRoles(metadata);
    const missingMetadataFields=(snapshot.spec?.requirements?.metadata?.requiredFieldCodes || [])
      .filter(code=>code==='actor'?!roles.has('actor'):!fields.has(code));
    // The Work's owner-defined production objective locates the affected product
    // dimension. Capability names and failure classifications are provenance,
    // never authorization to waive a requirement.
    const productGapPaths = Object.fromEntries(works.map(work => [work.work_id,
      work.work_kind === 'product_metadata_observation' && metadata.length > 0 && missingMetadataFields.length > 0
        ? 'metadata' : work.work_kind === 'workspace_media_production'
          ? 'media' : null]));
    const missingArtifactKindsByWork={};
    for(const blocker of terminalEvidence.blockedWorks||[]) {
      if(!works.some(work=>work.work_id===blocker.workId&&work.work_kind==='artifact_production'))continue;
      const bindings=workResultReader.readBindings(blocker.workId);
      const failed=bindings.find(item=>item.eventId===blocker.terminalEventId);
      const verification=bindings.find(item=>item.inputBindings.bindings.some(binding=>binding.portName==='artifactHandleList'&&binding.eventId===failed?.eventId));
      const kind=(failed?.inputBindings.bindings.find(binding=>binding.portName==='artifactRequirement')||
        verification?.inputBindings.bindings.find(binding=>binding.portName==='artifactRequirement'))?.parameters?.artifactKind;
      if(['nfo','poster','fanart'].includes(kind))missingArtifactKindsByWork[blocker.workId]=[kind];
    }
    const input = {
      run:Object.freeze({ libraRunId, state:'frozen',
        stateRevision:Number(snapshot.run.state_revision), stateDigest:snapshot.run.state_digest }),
      terminalEvidence,
      directMediaVerification,
      missingMetadataFields,
      productGapPaths,
      missingArtifactKindsByWork,
      requirements:snapshot.spec?.requirements,
      sizeCapVerification:terminalEvidence.blockedWorks?.[0]?.failureCode === 'size_cap_requires_admission'
        ? workResultReader.read(terminalEvidence.blockedWorks[0].workId).find((item) =>
          item.outcomeKind === 'succeeded' &&
          item.capabilityRef === 'libra.product_media.verify@1')?.result || null
        : null,
      priorAuthorizedManifest:latestDefect,
    };
    const verification=input.sizeCapVerification||directMediaVerification;
    if(!verification || !snapshot.spec) {
      const unfinished = works.some(work => !['succeeded','failed','cancelled','superseded'].includes(work.state));
      fail(unfinished ? 'P9_DEFECT_ADMISSION_EVIDENCE_PENDING' : 'P9_DEFECT_ADMISSION_INELIGIBLE',
        'Actual product safety and current requirement evidence are not complete.');
    }
    if(terminalEvidence.availabilityId) {
      if(terminalEvidence.status!=='unavailable'||!verificationWorkId)
        fail('P9_DEFECT_ADMISSION_INELIGIBLE','A bounded unavailable strategy and actual product proof are required.');
      const sourceWorkId=terminalEvidence.strategyKind==='tmdb'?(metadata.at(-1)?.sourceWorkId||verificationWorkId):verificationWorkId;
      productGapPaths[sourceWorkId]=terminalEvidence.strategyKind==='tmdb'?'metadata':'media';
      input.candidateGapSources=[{workId:sourceWorkId,failureCode:terminalEvidence.reasonCode,
        failureClass:'strategy_unavailable',capabilityRef:terminalEvidence.strategyKind==='tmdb'?'libra.product_metadata.fetch@1':'libra.product_media.verify@1',
        terminalEvidenceDigest:terminalEvidence.evidenceDigest}];
    }
    if(verification.libraRunId!==libraRunId || (verification.reasonCodes || []).some(code=>!WAIVABLE_MEDIA_CODES.has(code)))
      fail('P9_DEFECT_ADMISSION_NONWAIVABLE','Product evidence contains a non-waivable safety or identity failure.', {
        productEvidence: {libraRunId,runStateRevision:Number(snapshot.run.state_revision),
          runStateDigest:snapshot.run.state_digest,verificationId:verification.verificationId,
          verificationDigest:canonicalDigest(verification),reasonCodes:verification.libraRunId===libraRunId
            ? verification.reasonCodes.filter(code=>!WAIVABLE_MEDIA_CODES.has(code)) : ['product_identity_mismatch']},
      });
    const candidate=buildDefectAdmissionCandidate(input);
    const gaps=candidate.defects.flatMap(defect=>defect.artifactKindCodes
      ?defect.artifactKindCodes.map(kind=>({requirementCode:'metadata_artifact_unmet',targetKind:'artifact',targetId:kind,evidenceDigest:defect.sourceEvidenceDigest}))
      :defect.metadataFieldCodes
      ?defect.metadataFieldCodes.map(field=>({requirementCode:'metadata_field_unmet',targetKind:'metadata_field',targetId:field,evidenceDigest:defect.sourceEvidenceDigest}))
      :defect.waivedRequirementCodes.map(code=>({requirementCode:code,targetKind:'media',targetId:verification.productMaterialHandleId,evidenceDigest:canonicalDigest(verification)})))
      .map(gap=>({...gap,requiredValueDigest:requirementGapValueDigest(snapshot.spec.requirements,gap.requirementCode,gap.targetId)}));
    const unique=[...new Map(gaps.map(gap=>[canonicalDigest(gap),gap])).values()].sort((a,b)=>canonicalDigest(a).localeCompare(canonicalDigest(b)));
    return buildDefectAdmissionCandidate({...input,gapScope:Object.freeze({ownerDomain:'libra',processId:libraRunId,
      productRevision:Number(snapshot.run.state_revision),acceptanceSpecId:snapshot.run.acceptance_spec_id,
      acceptanceSpecRecordDigest:snapshot.spec.recordDigest,requirementsDigest:canonicalDigest(snapshot.spec.requirements),
      productEvidenceDigest:canonicalDigest(verification),gaps:unique})});
  }

  function sizeForecastForRun(libraRunId, acceptanceSpecId, candidate) {
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
      if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes < 1) return null;
      const defect=candidate?.defects?.find((item)=>item.defectCode==='size_cap_exceeded');
      const verifyRecord = defect ? workResultReader.read(defect.sourceWorkId).find((item) =>
        item.outcomeKind === 'succeeded' &&
        item.capabilityRef === 'libra.product_media.verify@1' &&
        item.result?.verificationId === defect.workspaceMediaVerificationId &&
        canonicalDigest(item.result) === defect.workspaceMediaVerificationDigest) : null;
      const verification = verifyRecord?.result;
      if (!verification?.spaceSummary) return null;
      const actualBytes = verification.spaceSummary.actualSizeBytes;
      const predictedBytes = actualBytes;
      return Object.freeze({
        maxSizeBytes,
        predictedBytes,
        overshootBytes: Math.max(0, (actualBytes || 0) - maxSizeBytes),
        measured: true,
        actualSizeBytes: actualBytes,
        withinLimit: verification.spaceSummary.withinLimit === true,
      });
    } catch {
      return null;
    }
  }

  const service = {
    readOutcome: outcomes.get,
    reprocessSourceFieldIds:outcomes.sourceFieldIds,
    reconcileCommitted:outcomes.reconcileCommitted,
    listPendingCommitted:outcomes.listPendingCommitted,
    requestReprocess(libraRunId,body) {
      const result=outcomes.requestReprocess(libraRunId,{...body,actorId:'admin'});
      options.wake?.();
      return result;
    },
    readAutomaticAuthorization: () => defectAuthorizations.current(),
    waitUnavailableStrategy(libraRunId,strategyKind,reasonCode) {
      const snapshot=current(libraRunId);
      if(snapshot.run.state!=='active')return {kind:'not_active',libraRunId};
      const conditions=options.readFailureRecoveryConditions?.([strategyKind])||[];
      const evidence=strategyAvailability.observe({libraRunId,strategyKind,reasonCode,
        conditionDigest:canonicalDigest(conditions),now:options.now?.()??Date.now()},snapshot.run);
      if(!evidence||evidence.status==='waiting')return {kind:'waiting_external_integration',libraRunId,reasonCode};
      const decision=buildRunLifecycleDecision({libraRunId,expectedStateRevision:Number(snapshot.run.state_revision),
        expectedStateDigest:snapshot.run.state_digest,transitionKind:'freeze',
        transitionEvidence:evidence,expectedAdmissionHeadRevision:Number(snapshot.head.head_revision),
        expectedActiveScopeSetDigest:snapshot.head.active_scope_set_digest});
      lifecycle.transition({decision,commitMarker:canonicalDigest({schema:'libra.strategy-availability-marker@1',decisionDigest:decision.decisionDigest}),
        resultId:canonicalDigest({schema:'libra.strategy-availability-result@1',decisionDigest:decision.decisionDigest})});
      options.libraRunExecutionProjection.invalidate(libraRunId);options.wake?.();
      return {kind:evidence.status==='unavailable'?'frozen':'waiting_external_integration',libraRunId,reasonCode};
    },
    setAutomaticAuthorization(body) {
      const result = defectAuthorizations.publish({ ...body, actorId: 'admin' });
      options.wake?.();
      return result;
    },
    reconcileRejected(libraRunId) {
      const snapshot=current(libraRunId);
      try {
        const result=service.discard(libraRunId,{expectedRunStateRevision:Number(snapshot.run.state_revision),
          expectedRunStateDigest:snapshot.run.state_digest,idempotencyKey:'terminal-rejected:'+libraRunId+':'+snapshot.run.state_revision},'processing_failed');
        return Object.freeze({...result,kind:result.resultKind==='discarded'?'unable_to_on_deck':'closure_pending',libraRunId});
      } catch(error) {
        if(['P9_DISCARD_EXECUTION_PENDING','P9_DISCARD_EFFECT_PENDING'].includes(error.code))
          return Object.freeze({kind:'closure_pending',libraRunId,reasonCode:error.code});
        throw error;
      }
    },
    reconcileFrozen(libraRunId) {
      const authorization = defectAuthorizations.current();
      let candidate;
      try { candidate = defectCandidate(libraRunId); }
      catch (error) {
        if(error.code==='P9_DEFECT_ADMISSION_EVIDENCE_PENDING')return Object.freeze({kind:'evidence_pending',libraRunId});
        if (['P9_DEFECT_ADMISSION_INELIGIBLE','P9_DEFECT_ADMISSION_NONWAIVABLE'].includes(error.code)) {
          const snapshot=current(libraRunId);
          try {
            const result=service.discard(libraRunId,{expectedRunStateRevision:Number(snapshot.run.state_revision),
              expectedRunStateDigest:snapshot.run.state_digest,idempotencyKey:'terminal:'+libraRunId+':'+snapshot.run.state_revision},'processing_failed',error.details?.productEvidence);
            return Object.freeze({...result,kind:result.resultKind==='discarded'?'unable_to_on_deck':'closure_pending',libraRunId});
          } catch (closureError) {
            if(['P9_DISCARD_EXECUTION_PENDING','P9_DISCARD_EFFECT_PENDING'].includes(closureError.code))
              return Object.freeze({kind:'closure_pending',libraRunId,reasonCode:closureError.code});
            throw closureError;
          }
        }
        throw error;
      }
      if (authorization?.state !== 'enabled') return Object.freeze({kind:'awaiting_defect_decision',libraRunId});
      const result = service.admitWithDefects(libraRunId, {
        expectedRunStateRevision: candidate.frozenRunStateRevision,
        expectedRunStateDigest: candidate.frozenRunStateDigest,
        expectedDefectCandidateDigest: candidate.candidateDigest,
        idempotencyKey: canonicalDigest({authorization: authorization.authorizationDigest, candidate: candidate.candidateDigest}),
        acknowledged: true,
      }, authorization);
      return Object.freeze({ ...result, kind:'defect_admitted' });
    },
    expedite(libraRunId, body) {
      return setPriority(libraRunId, body, 'expedited');
    },
    cancelExpedite(libraRunId, body) {
      return setPriority(libraRunId, body, 'normal');
    },
    discard(libraRunId, body, terminalReason = 'user_cancelled', productEvidence = null) {
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
        actorId: terminalReason === 'user_cancelled' ? 'admin' : 'system',
        idempotencyKey: body.idempotencyKey,
      });
      const subjectId = current(libraRunId).run.subject_id;
      const inspected = discardStore.inspect(command);
      if(inspected.kind==='ready') {
        const cancelled=options.cancelProcessWorks?.({ownerDomain:'libra',processType:'libra_run',processId:libraRunId,reasonCode:'LIBRA_RUN_TERMINAL_CLOSURE'});
        if(Number(cancelled?.drainingWorks || 0)>0)return Object.freeze({resultKind:'closure_pending',libraRunId});
      }
      const result = inspected.kind === 'ready'
        ? discardStore.commit(inspected,terminalReason,productEvidence) : inspected;
      if (result.resultKind === 'discarded') {
        const released = options.pipelineAdmission?.releaseForSubject(subjectId) || null;
        if (released?.released) options.onPipelineSeatReleased?.(released);
        options.libraRunExecutionProjection.invalidate(libraRunId);
        options.wake?.();
      }
      return result;
    },
    previewDefects(libraRunId) {
      const snapshot = current(libraRunId);
      const terminalRow=snapshot.revisions.find(row=>Number(row.state_revision)===Number(snapshot.run.state_revision));
      const terminal=JSON.parse(terminalRow.transition_evidence_json);
      const pathResults=(terminal.blockedWorks||[]).map(item=>({workId:item.workId,capabilityRef:item.capabilityRef,
        failureClass:item.failureClass,failureCode:item.failureCode,evidenceDigest:item.terminalEvidenceDigest}));
      let candidate;
      try {candidate=defectCandidate(libraRunId,snapshot);}catch(error) {
        if(error.code==='P9_DEFECT_ADMISSION_EVIDENCE_PENDING')return Object.freeze({eligibility:'evidence_pending',libraRunId,
          missingEvidence:['product_safety_and_exact_requirements'],ineligibleReasons:[],pathResults,message:'尚缺少完整的成品安全或差距证据。'});
        if(['P9_DEFECT_ADMISSION_INELIGIBLE','P9_DEFECT_ADMISSION_NONWAIVABLE'].includes(error.code))return Object.freeze({
          eligibility:'ineligible',libraRunId,missingEvidence:[],ineligibleReasons:[error.code],pathResults,
          message:error.code==='P9_DEFECT_ADMISSION_NONWAIVABLE'?'当前成品有不可豁免的安全或身份问题。':'本次处理没有已证实可接受的成品差距。'});
        throw error;
      }
      const preview=Object.freeze({...candidate,eligibility:'eligible',missingEvidence:[],ineligibleReasons:[],pathResults});
      if (!candidate.defects.some((item) => item.defectCode === 'size_cap_exceeded')) {
        return preview;
      }
      const sizeForecast = sizeForecastForRun(
        libraRunId,
        snapshot.run.acceptance_spec_id,
        candidate,
      );
      return sizeForecast ? Object.freeze({ ...preview, sizeForecast }) : preview;
    },
    admitWithDefects(libraRunId, body, standingAuthorization = null) {
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
        standingAuthorization,
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
  };
  const buildPreview=service.previewDefects;
  service.previewDefects=(libraRunId)=>{
    const preview=buildPreview(libraRunId);
    if(Buffer.byteLength(JSON.stringify(preview))>65536)fail('P9_DEFECT_ADMISSION_TOO_LARGE','Defect preview exceeds its bounded response budget.');
    options.contractValidator?.validate('helix://contracts/application-types/LibraDefectPreview/v1',preview);
    return preview;
  };
  return Object.freeze(service);
}

module.exports = Object.freeze({ LibraRunAdminError, createLibraRunAdminService });
