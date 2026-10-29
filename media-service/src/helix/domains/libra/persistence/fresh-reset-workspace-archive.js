'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const CONTRACT = 'libra.fresh-reset-workspace-archive@1';
const TERMINAL = new Set(['completed', 'discarded', 'superseded', 'administratively_retired']);
const normalize = value => typeof value === 'bigint' ? Number(value) : Array.isArray(value) ? value.map(normalize) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)])) : value;
function fail() { throw Object.assign(new Error('Fresh Reset Workspace archive does not match its terminal Owner evidence.'),
  { code: 'LIBRA_RESET_WORKSPACE_ARCHIVE_INVALID' }); }

// Archival ends current scheduling/file-retention authority; it does not claim
// physical deletion or rewrite any historical Workspace/Reference/Registry row.
// Only the cold Operator creates it. Its generation fence stays closed until
// the separately journaled physical cleanup completes.
function createFreshResetWorkspaceArchive(options) {
  const columns = table => options.schemaManifest.tables.find(row => row.tableId === table).columns;
  const select = (tableId, keyColumns, kind = 'select-one') => ({ kind, tableId, columns: columns(tableId), keyColumns, safeIntegers: true });
  const owner = createRepositoryDefinition({ repositoryId: 'libra_fresh_workspace_archive', owner: 'libra', readOnly: true,
    schemaManifest: options.schemaManifest, statements: {
      workspace: select('libra_workspaces', ['workspace_id']), run: select('libra_runs', ['libra_run_id']),
      subject: select('libra_subjects', ['subject_id']),
    } });
  const foundation = createRepositoryDefinition({ repositoryId: 'libra_fresh_workspace_archive_evidence',
    owner: 'execution-foundation', readOnly: true, schemaManifest: options.schemaManifest, statements: {
      registry: select('fx_workspace_registry', ['workspace_id']),
      receipts: select('fx_command_receipts', ['owner_domain', 'command_contract'], 'select-all'),
      marker: select('fx_commit_markers', ['commit_marker']),
    } });
  function inspect(workspaceId) {
    const parts = options.unitOfWork.execute([
      { participantId: 'archive_owner', owner: 'libra', repositories: [owner], execute(context) {
        const repo = context.repository(owner.repositoryId), workspace = repo.invoke('workspace', { workspace_id: workspaceId });
        if (!workspace) fail();
        const run = repo.invoke('run', { libra_run_id: workspace.libra_run_id });
        const subject = run && repo.invoke('subject', { subject_id: run.subject_id });
        if (!run || !TERMINAL.has(run.state) || !subject ||
            !['administratively_retired', 'completed', 'ended', 'abandoned'].includes(subject.status)) fail();
        return normalize({ workspace, run: { libraRunId: run.libra_run_id, state: run.state, stateRevision: run.state_revision,
          stateDigest: run.state_digest }, subjectId: subject.subject_id });
      } },
      { participantId: 'archive_registry', owner: 'execution-foundation', boundBusinessOwner: 'libra', repositories: [foundation],
        execute: context => normalize(context.repository(foundation.repositoryId).invoke('registry', { workspace_id: workspaceId }) || null) },
    ]);
    const { workspace, run, subjectId } = parts.archive_owner, registry = parts.archive_registry;
    if (!registry || registry.owner_domain !== 'libra' || registry.process_type !== 'libra_run' ||
        registry.process_id !== workspace.libra_run_id || registry.root_handle_ref !== workspace.root_handle_ref ||
        !['active', 'reclaimed'].includes(registry.state)) fail();
    return { workspaceId, subjectId, run, workspaceDigest: canonicalDigest(workspace), registryDigest: canonicalDigest(registry),
      historicalStates: { workspace: workspace.state, registry: registry.state } };
  }
  function archive({ workspaceId, generationId, backupDigest, manifestDigest }) {
    if (typeof options.assertIsolated !== 'function' || ![generationId, backupDigest, manifestDigest].every(v => /^[a-f0-9]{64}$/.test(v))) fail();
    options.assertIsolated();
    const evidence = inspect(workspaceId), request = { generationId, backupDigest, manifestDigest, ...evidence };
    const requestDigest = canonicalDigest(request), commandId = canonicalDigest({ contract: CONTRACT, generationId, workspaceId });
    return createCommandCommitCoordinator(options).execute({
      command: { commandReceiptId: commandId, ownerDomain: 'libra', commandContract: CONTRACT, callerScope: 'cold-formation-reset',
        idempotencyKey: generationId + ':' + workspaceId, requestDigest, targetType: 'libra_workspace', targetId: workspaceId },
      domainParticipant: { participantId: 'libra_archive_workspace', owner: 'libra', repositories: [owner], execute() {
        options.assertIsolated(); return { ...request, disposition: 'historical_evidence_only', physicalCleanup: 'operator_receipt_required' };
      } },
      commitMarker: { commitMarker: commandId, scopeType: 'libra_workspace', scopeId: workspaceId, commitDigest: requestDigest },
      auditRecords: [{ auditId: commandId, actorType: 'admin', actorId: 'admin', action: 'archive_terminal_workspace_for_fresh_reset',
        scopeType: 'libra_workspace', scopeId: workspaceId, evidenceDigest: requestDigest }],
      resultEnvelope: resultRef => ({ resultSchemaRef: CONTRACT, resultRef }),
    });
  }
  function readArchivedIds() {
    const rows = options.unitOfWork.execute([{ participantId: 'archive_receipts', owner: 'execution-foundation', boundBusinessOwner: 'libra',
      repositories: [foundation], execute(context) {
        const repo = context.repository(foundation.repositoryId);
        return normalize(repo.invoke('receipts', { owner_domain: 'libra', command_contract: CONTRACT })).map(row =>
          ({ row, marker: normalize(repo.invoke('marker', { commit_marker: row.command_receipt_id })) }));
      } }]).archive_receipts;
    const ids = new Set();
    for (const { row, marker } of rows) {
      let value; try { value = JSON.parse(row.result_ref_json); } catch { fail(); }
      if (canonicalDigest(value) !== row.result_digest || row.result_schema_ref !== CONTRACT || row.target_type !== 'libra_workspace' ||
          row.target_id !== value.workspaceId || value.disposition !== 'historical_evidence_only' ||
          value.physicalCleanup !== 'operator_receipt_required' || !marker || marker.commit_digest !== row.request_digest ||
          marker.scope_id !== row.target_id || marker.scope_type !== 'libra_workspace' || marker.owner_domain !== 'libra') fail();
      const { disposition, physicalCleanup, ...request } = value;
      if (canonicalDigest(request) !== row.request_digest) fail();
      const evidence = inspect(row.target_id);
      if (Object.keys(evidence).some(key => canonicalDigest(evidence[key]) !== canonicalDigest(value[key]))) fail();
      ids.add(row.target_id);
    }
    return ids;
  }
  return Object.freeze({ archive, readArchivedIds });
}

module.exports = Object.freeze({ createFreshResetWorkspaceArchive, CONTRACT });
