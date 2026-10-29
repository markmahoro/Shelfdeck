'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createExecutionStateReader } = require('../../../foundation/persistence/execution-state-reader');
const { createScopedControlRelease } = require('../../../foundation/persistence/scoped-control-release');
const { activeRunScopeSetDigest } = require('../model/run-admission-contracts');
const { runStateDigest } = require('../model/run-lifecycle-contracts');
const { continuityHeadDigest, CONTINUITY_HEAD_ID } = require('../model/libra-intake-contracts');

const STATE = 'administratively_retired';
const CONTRACT = 'libra.formation-retirement@1';
const RESULT = 'libra.formation-retirement-receipt@1';
const OPEN = new Set(['active', 'suspended', 'frozen']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const normalize = value => typeof value === 'bigint' ? Number(value) : Array.isArray(value) ? value.map(normalize) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;

// This command retires Libra facts only. Arca closes its own uncommitted
// responsibility first; Foundation drains execution and appends Control release
// revisions in this owning command. No cross-business-owner UOW is introduced.
function createFormationRetirementStore(options) {
  const columns = tableId => options.schemaManifest.tables.find(table => table.tableId === tableId).columns;
  const read = (tableId, keyColumns, kind = 'select-all') => ({ kind, tableId, columns: columns(tableId), keyColumns, safeIntegers: true });
  const repository = createRepositoryDefinition({ repositoryId: 'libra_formation_retirement', owner: 'libra',
    schemaManifest: options.schemaManifest, statements: {
      subject: read('libra_subjects', ['subject_id'], 'select-one'),
      runs: read('libra_runs', ['subject_id']),
      head: read('libra_run_admission_heads', ['subject_id'], 'select-one'),
      workspaces: read('libra_workspaces', ['libra_run_id']),
      intakes: read('libra_intake_decisions', ['target_subject_id']),
      packages: read('libra_product_packages', ['subject_id']),
      token: read('libra_predeck_pipeline_tokens', ['subject_id'], 'select-one'),
      workshop: read('libra_workshop_placements', ['subject_id'], 'select-one'),
      continuity: read('libra_subject_continuity_heads', ['head_id'], 'select-one'),
      retire_subject: { kind: 'update', tableId: 'libra_subjects', setColumns: ['status', 'updated_at_ms', 'terminal_at_ms'],
        keyColumns: ['subject_id'], compareColumns: [{ column: 'status', parameter: 'expected_status' }, { column: 'intake_revision', parameter: 'expected_revision' }] },
      retire_run: { kind: 'update', tableId: 'libra_runs', setColumns: ['state', 'state_revision', 'state_digest', 'recovery_next_due_at_ms', 'terminal_at_ms'],
        keyColumns: ['libra_run_id'], compareColumns: [{ column: 'state', parameter: 'expected_state' },
          { column: 'state_revision', parameter: 'expected_revision' }, { column: 'state_digest', parameter: 'expected_digest' }] },
      append_revision: { kind: 'insert', tableId: 'libra_run_revisions', columns: columns('libra_run_revisions') },
      advance_head: { kind: 'update', tableId: 'libra_run_admission_heads', setColumns: ['head_revision', 'active_scope_set_digest', 'updated_at_ms'],
        keyColumns: ['subject_id'], compareColumns: [{ column: 'head_revision', parameter: 'expected_revision' },
          { column: 'active_scope_set_digest', parameter: 'expected_digest' }] },
      advance_continuity: { kind: 'update', tableId: 'libra_subject_continuity_heads', setColumns: ['current_revision', 'head_digest', 'updated_at_ms'],
        keyColumns: ['head_id'], compareColumns: [{ column: 'current_revision', parameter: 'expected_revision' }] },
      release_token: { kind: 'delete', tableId: 'libra_predeck_pipeline_tokens', keyColumns: ['subject_id'] },
      release_workshop: { kind: 'delete', tableId: 'libra_workshop_placements', keyColumns: ['subject_id'] },
    } });
  const receipts = createRepositoryDefinition({ repositoryId: 'libra_formation_retirement_receipts', owner: 'execution-foundation', readOnly: true,
    schemaManifest: options.schemaManifest, statements: {
      receipts: read('fx_command_receipts', ['owner_domain', 'command_contract', 'target_type', 'target_id']),
      marker: read('fx_commit_markers', ['commit_marker'], 'select-one'),
    } });
  function readReceipt(subjectId) {
    return options.unitOfWork.execute([{ participantId: 'libra_formation_retirement_receipt_read', owner: 'execution-foundation', repositories: [receipts],
      execute(context) {
        const repo = context.repository(receipts.repositoryId);
        const rows = repo.invoke('receipts', { owner_domain: 'libra', command_contract: CONTRACT, target_type: 'subject', target_id: subjectId });
        if (!rows.length) return null;
        if (rows.length !== 1) fail('LIBRA_RETIREMENT_RECEIPT_CORRUPT', 'Subject has multiple retirement receipts.');
        const row = rows[0], result = JSON.parse(row.result_ref_json), marker = repo.invoke('marker', { commit_marker: row.command_receipt_id });
        if (row.result_schema_ref !== RESULT || canonicalDigest(result) !== row.result_digest || result.resultKind !== STATE || result.subjectId !== subjectId ||
            !marker || marker.owner_domain !== 'libra' || marker.scope_type !== 'subject' || marker.scope_id !== subjectId || marker.commit_digest !== row.request_digest)
          fail('LIBRA_RETIREMENT_RECEIPT_CORRUPT', 'Subject retirement receipt or commit marker is inconsistent.');
        return { ...result, receiptId: row.command_receipt_id, receiptDigest: row.result_digest };
      } }]).libra_formation_retirement_receipt_read;
  }
  const commands = createCommandCommitCoordinator(options);
  const execution = createExecutionStateReader(options);

  function snapshot(repo, subjectId) {
    const subject = repo.invoke('subject', { subject_id: subjectId });
    if (!subject) fail('LIBRA_RETIREMENT_SUBJECT_MISSING', 'Administrative retirement requires an existing Subject.');
    const runs = repo.invoke('runs', { subject_id: subjectId }).sort((a, b) => a.libra_run_id.localeCompare(b.libra_run_id));
    const value = normalize({ subject, runs, head: repo.invoke('head', { subject_id: subjectId }) || null,
      workspaces: runs.flatMap(run => repo.invoke('workspaces', { libra_run_id: run.libra_run_id })).sort((a, b) => a.workspace_id.localeCompare(b.workspace_id)),
      intakes: repo.invoke('intakes', { target_subject_id: subjectId }).sort((a, b) => a.intake_decision_id.localeCompare(b.intake_decision_id)),
      packages: repo.invoke('packages', { subject_id: subjectId }).sort((a, b) => a.on_deck_package_id.localeCompare(b.on_deck_package_id)),
      token: repo.invoke('token', { subject_id: subjectId }) || null,
      workshop: repo.invoke('workshop', { subject_id: subjectId }) || null });
    return { ...value, snapshotDigest: canonicalDigest(value) };
  }
  function inspect(subjectId) {
    return options.unitOfWork.execute([{ participantId: 'libra_retirement_snapshot', owner: 'libra', repositories: [repository],
      execute: context => snapshot(context.repository(repository.repositoryId), subjectId) }]).libra_retirement_snapshot;
  }
  function commit(request) {
    if (!request || typeof request.retirementId !== 'string' || !request.retirementId || typeof request.subjectId !== 'string' ||
        !['expectedSnapshotDigest', 'backupDigest', 'manifestDigest'].every(field => /^[0-9a-f]{64}$/.test(request[field] || '')) ||
        !Array.isArray(request.retiringRunIds) || request.retiringRunIds.length > 1000 ||
        request.retiringRunIds.some(id => typeof id !== 'string' || !id) || new Set(request.retiringRunIds).size !== request.retiringRunIds.length)
      fail('LIBRA_RETIREMENT_REQUEST_INVALID', 'Retirement requires an exact Subject snapshot, verified backup, and frozen manifest.');
    const before = inspect(request.subjectId);
    // Only immutable Arca Commit/retirement Receipts qualify. Read the public
    // proof before entering Libra's UOW; never open another Owner UOW inside it.
    let arcaProof = [];
    if (before.packages.length && before.subject.status !== STATE) {
      arcaProof = options.readArcaRetirementProof?.(before.packages.map(row => ({ offerId:row.offer_id,
        packageId:row.on_deck_package_id,packageDigest:row.package_digest }))) || [];
    }
    const arcaClosed = !before.packages.length || before.subject.status === STATE ||
      Array.isArray(arcaProof) && arcaProof.length === before.packages.length &&
      new Set(arcaProof.map(row => row.offerId)).size === before.packages.length &&
      arcaProof.every(row => before.packages.some(pkg => pkg.offer_id === row.offerId && pkg.on_deck_package_id === row.packageId && pkg.package_digest === row.packageDigest) &&
        ['committed','administratively_retired','historical_rejected'].includes(row.disposition) && /^[0-9a-f]{64}$/.test(row.evidenceDigest || '')) &&
      canonicalDigest(arcaProof) === request.expectedArcaProofDigest;
    const requestDigest = canonicalDigest(request);
    const commandId = canonicalDigest({ contract: CONTRACT, retirementId: request.retirementId, subjectId: request.subjectId });
    const scopes = [
      ...['libra_routing', 'libra_acceptance_spec'].map(processType => ({ ownerDomain: 'libra', processType, processId: request.subjectId })),
      ...before.runs.map(run => ({ ownerDomain: 'libra', processType: 'libra_run', processId: run.libra_run_id })),
      ...[...new Set([...before.intakes.map(row => row.intake_decision_id), ...(before.token ? [before.token.source_process_id] : [])])]
        .map(processId => ({ ownerDomain: 'libra', processType: 'libra_intake', processId })),
    ];
    const activeRunIds = new Set(before.runs.filter(run => OPEN.has(run.state)).map(run => run.libra_run_id));
    // Replay constructs the same scopes from the frozen request; the command
    // coordinator checks its receipt before any mutation or stale-set guard.
    const runIds = before.subject.status === STATE ? new Set(request.retiringRunIds) : activeRunIds;
    const controlScopes = [
      ['subject', request.subjectId], ...before.runs.filter(row => runIds.has(row.libra_run_id)).map(row => ['libra_run', row.libra_run_id]),
      ...before.workspaces.filter(row => runIds.has(row.libra_run_id)).flatMap(row => [['workspace', row.workspace_id], ['libra_workspace', row.workspace_id]]),
      ...before.packages.filter(row => runIds.has(row.libra_run_id)).map(row => ['on_deck_package', row.on_deck_package_id]),
    ].map(([scopeType, scopeId]) => ({ ownerDomain: 'libra', scopeType, scopeId }));
    const release = createScopedControlRelease(options, { ownerDomain: 'libra', processType: 'administrative_formation_retirement',
      processId: request.subjectId, scopes: controlScopes, expectedRows: request.expectedControls || [], evidenceDigest: requestDigest,
      commitMarker: commandId, receiptSchemaRef: RESULT });
    const executionGuard = execution.createExecutionStateReadParticipant(scopes, summaries => {
      if (summaries.some(summary => summary.hasOpenWork || summary.hasOpenEvent || summary.hasUnsettledEffect))
        fail('LIBRA_RETIREMENT_EXECUTION_PENDING', 'Retirement cannot fabricate completion of execution or an unsettled Effect.');
    });
    return commands.execute({
      command: { commandReceiptId: commandId, ownerDomain: 'libra', commandContract: CONTRACT, callerScope: 'administrative-formation-reset',
        idempotencyKey: request.retirementId + ':' + request.subjectId, requestDigest, targetType: 'subject', targetId: request.subjectId },
      validationParticipants: [{ ...executionGuard, boundBusinessOwner: 'libra' }, release.validationParticipant],
      controlParticipant: release.controlParticipant,
      domainParticipant: { participantId: 'libra_retirement_commit', owner: 'libra', repositories: [repository], execute(context) {
        const repo = context.repository(repository.repositoryId), current = snapshot(repo, request.subjectId);
        if (current.snapshotDigest !== request.expectedSnapshotDigest || current.subject.status !== 'active')
          fail('LIBRA_RETIREMENT_STALE', 'Subject retirement snapshot changed.');
        // An accepted package can have a completed Libra Run and unfinished
        // Arca custody. An explicit public Arca proof is required in that case.
        if (!arcaClosed)
          fail('LIBRA_RETIREMENT_ARCA_PENDING', 'Arca must prove its current responsibility is committed or administratively retired.');
        const active = current.runs.filter(run => OPEN.has(run.state));
        if (active.some(run => current.packages.some(pkg => pkg.libra_run_id === run.libra_run_id &&
            arcaProof.some(proof => proof.offerId === pkg.offer_id && proof.disposition === 'committed'))))
          fail('LIBRA_RETIREMENT_COMMITTED_PROTECTED', 'A Run with an Arca Commit cannot be administratively retired.');
        if (canonicalDigest([...request.retiringRunIds].sort()) !== canonicalDigest(active.map(run => run.libra_run_id).sort()))
          fail('LIBRA_RETIREMENT_STALE', 'Requested Run set does not match current unfinished Runs.');
        if (active.length && !current.head) fail('LIBRA_RETIREMENT_HEAD_MISSING', 'An active Run has no verifiable admission head.');
        if (active.length && current.head.active_scope_set_digest !== activeRunScopeSetDigest(request.subjectId, active.map(run => ({
          libraRunId: run.libra_run_id, runScopeDigest: run.run_scope_digest, stateRevision: run.state_revision, stateDigest: run.state_digest }))))
          fail('LIBRA_RETIREMENT_HEAD_INCONSISTENT', 'Admission head does not cover the exact current Run set.');
        let head = current.head;
        for (const run of active) {
          const remaining = active.filter(other => other.libra_run_id.localeCompare(run.libra_run_id) > 0).map(other => ({
            libraRunId: other.libra_run_id, runScopeDigest: other.run_scope_digest, stateRevision: other.state_revision, stateDigest: other.state_digest }));
          const nextScopeDigest = activeRunScopeSetDigest(request.subjectId, remaining);
          const evidence = { schema: CONTRACT, retirementId: request.retirementId, subjectId: request.subjectId,
            libraRunId: run.libra_run_id, previousStateRevision: run.state_revision, previousStateDigest: run.state_digest,
            backupDigest: request.backupDigest, manifestDigest: request.manifestDigest };
          const evidenceDigest = canonicalDigest(evidence), nextRevision = run.state_revision + 1;
          const stateDigest = runStateDigest({ libraRunId: run.libra_run_id, stateRevision: nextRevision, state: STATE,
            acceptanceSpecId: run.acceptance_spec_id, executionBasisDigest: run.execution_basis_digest, runScopeDigest: run.run_scope_digest,
            priorityClass: run.priority_class, priorityIntentDigest: run.priority_intent_digest, transitionKind: STATE, transitionEvidenceDigest: evidenceDigest });
          if (repo.invoke('retire_run', { libra_run_id: run.libra_run_id, state: STATE, state_revision: nextRevision, state_digest: stateDigest,
            recovery_next_due_at_ms: null, terminal_at_ms: context.commitTimeMs, expected_state: run.state,
            expected_revision: run.state_revision, expected_digest: run.state_digest }).changes !== 1)
            fail('LIBRA_RETIREMENT_RUN_CAS', 'Run retirement fence changed.');
          const revision = { libraRunId: run.libra_run_id, stateRevision: nextRevision, state: STATE, acceptanceSpecId: run.acceptance_spec_id,
            executionBasisDigest: run.execution_basis_digest, runScopeDigest: run.run_scope_digest, priorityClass: run.priority_class,
            priorityIntentDigest: run.priority_intent_digest, transitionKind: STATE, transitionDecisionId: commandId,
            transitionDecisionDigest: requestDigest, transitionEvidenceSchemaRef: CONTRACT, transitionEvidenceId: commandId,
            transitionEvidenceDigest: evidenceDigest, recoveryPolicyRef: run.recovery_policy_ref, recoveryPolicyDigest: run.recovery_policy_digest,
            suspensionStartedAtMs: run.suspension_started_at_ms, recoveryAttemptOrdinal: run.recovery_attempt_ordinal,
            recoveryNextDueAtMs: null, expectedAdmissionHeadRevision: head.head_revision, expectedActiveScopeSetDigest: head.active_scope_set_digest,
            committedAdmissionHeadRevision: head.head_revision + 1, committedActiveScopeSetDigest: nextScopeDigest, previousStateRevision: run.state_revision };
          const stored = Object.fromEntries(Object.entries(revision).map(([name, value]) => [name.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase()), value]));
          repo.invoke('append_revision', { ...stored, transition_evidence_json: canonicalJson(evidence), revision_digest: canonicalDigest(revision), committed_at_ms: context.commitTimeMs });
          if (repo.invoke('advance_head', { subject_id: request.subjectId, head_revision: head.head_revision + 1,
            active_scope_set_digest: nextScopeDigest, updated_at_ms: context.commitTimeMs,
            expected_revision: head.head_revision, expected_digest: head.active_scope_set_digest }).changes !== 1)
            fail('LIBRA_RETIREMENT_HEAD_CAS', 'Run admission head changed.');
          head = { ...head, head_revision: head.head_revision + 1, active_scope_set_digest: nextScopeDigest };
        }
        if (repo.invoke('retire_subject', { subject_id: request.subjectId, status: STATE, terminal_at_ms: context.commitTimeMs,
          updated_at_ms: context.commitTimeMs, expected_status: 'active', expected_revision: current.subject.intake_revision }).changes !== 1)
          fail('LIBRA_RETIREMENT_SUBJECT_CAS', 'Subject retirement fence changed.');
        repo.invoke('release_token', { subject_id: request.subjectId });
        repo.invoke('release_workshop', { subject_id: request.subjectId });
        const continuity = normalize(repo.invoke('continuity', { head_id: CONTINUITY_HEAD_ID }));
        if (continuity && repo.invoke('advance_continuity', { head_id: CONTINUITY_HEAD_ID, current_revision: continuity.current_revision + 1,
          head_digest: continuityHeadDigest(continuity.current_revision + 1), updated_at_ms: context.commitTimeMs,
          expected_revision: continuity.current_revision }).changes !== 1)
          fail('LIBRA_RETIREMENT_CONTINUITY_CAS', 'Subject continuity changed.');
        return { resultKind: STATE, subjectId: request.subjectId, retiredRunCount: active.length,
          releasedControlCount: release.count, releasedControlScopeDigest: release.scopeDigest,
          beforeDigest: current.snapshotDigest, afterDigest: snapshot(repo, request.subjectId).snapshotDigest,
          manifestDigest: request.manifestDigest, backupDigest: request.backupDigest };
      } },
      commitMarker: { commitMarker: commandId, scopeType: 'subject', scopeId: request.subjectId, commitDigest: requestDigest },
      auditRecords: [{ auditId: commandId, actorType: 'admin', actorId: 'admin', action: 'administratively_retire_formation',
        scopeType: 'subject', scopeId: request.subjectId, evidenceDigest: requestDigest }],
      resultEnvelope: resultRef => ({ resultSchemaRef: RESULT, resultRef }),
    });
  }
  return Object.freeze({ inspect, commit, readReceipt });
}

module.exports = Object.freeze({ createFormationRetirementStore });
