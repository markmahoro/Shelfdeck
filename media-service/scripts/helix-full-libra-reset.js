'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const CONFIRMATION = 'FULL_LIBRA_RESET_V1';
const FAILURE_CODE = 'P13_FULL_LIBRA_RESET_V1';
const RESETTABLE_RUN_STATES = ['active', 'suspended', 'frozen'];
const NON_TERMINAL_WORK_STATES = ['admitted', 'ready', 'running', 'blocked'];

function valueAfter(args, flag) {
  const assigned = args.find((arg) => arg.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function runStateDigest(value) {
  return canonicalDigest({
    schema: 'libra.run-state@1',
    libraRunId: value.libraRunId,
    stateRevision: value.stateRevision,
    state: value.state,
    acceptanceSpecId: value.acceptanceSpecId,
    executionBasisDigest: value.executionBasisDigest,
    runScopeDigest: value.runScopeDigest,
    priorityClass: value.priorityClass,
    priorityIntentDigest: value.priorityIntentDigest,
    transitionKind: value.transitionKind,
    transitionEvidenceDigest: value.transitionEvidenceDigest,
  });
}

function inspectPlan(database) {
  const resetRuns = database.prepare(`
    SELECT libra_run_id, subject_id, state, state_revision
      FROM libra_runs
     WHERE state IN (${RESETTABLE_RUN_STATES.map(() => '?').join(',')})
     ORDER BY created_at_ms
  `).all(...RESETTABLE_RUN_STATES);
  const workspaces = database.prepare(`
    SELECT w.workspace_id, w.libra_run_id, w.state, w.current_revision
      FROM libra_workspaces w
      JOIN libra_runs r ON r.libra_run_id = w.libra_run_id
     WHERE w.state IN ('active', 'reclaiming')
       AND r.state IN (${RESETTABLE_RUN_STATES.map(() => '?').join(',')})
     ORDER BY w.workspace_id
  `).all(...RESETTABLE_RUN_STATES);
  const tokens = database.prepare('SELECT subject_id, source_field_id FROM libra_predeck_pipeline_tokens ORDER BY subject_id').all();
  const policies = database.prepare('SELECT field_id, predeck_pipeline_seats, policy_revision FROM libra_field_intake_admission_policies ORDER BY field_id').all();
  const libraWorks = database.prepare(`
    SELECT work_id, process_id, work_kind, state
      FROM fx_supporting_works
     WHERE owner_domain = 'libra'
       AND state IN (${NON_TERMINAL_WORK_STATES.map(() => '?').join(',')})
     ORDER BY work_id
  `).all(...NON_TERMINAL_WORK_STATES);
  const executionResiduals = database.prepare(`
    SELECT a.attempt_id, a.work_id, a.state AS attempt_state
      FROM fx_work_attempts a
      JOIN fx_supporting_works w ON w.work_id = a.work_id
     WHERE w.owner_domain = 'libra'
       AND w.state = 'cancelled'
       AND a.state IN ('ready', 'running', 'blocked')
     ORDER BY a.attempt_id
  `).all();
  return Object.freeze({ resetRuns, workspaces, tokens, policies, libraWorks, executionResiduals });
}

function assertSafeTranscodeRoot(transcodeDir, dataDir) {
  if (!transcodeDir) return;
  const resolved = path.resolve(transcodeDir);
  const resolvedData = path.resolve(dataDir);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === resolvedData || resolvedData.startsWith(resolved + path.sep)) {
    throw new Error('P13_FULL_LIBRA_RESET_UNSAFE_TRANSCODE_ROOT');
  }
  if (process.platform === 'linux' && resolved !== '/transcode') {
    throw new Error('P13_FULL_LIBRA_RESET_TRANSCODE_MOUNT_REQUIRED');
  }
}

function clearTranscodeRoot(transcodeDir, dataDir) {
  if (!transcodeDir) return Object.freeze({ cleared: false, reason: 'transcode_dir_not_set' });
  assertSafeTranscodeRoot(transcodeDir, dataDir);
  if (!fs.existsSync(transcodeDir)) return Object.freeze({ cleared: true, removedEntries: 0 });
  const entries = fs.readdirSync(transcodeDir);
  for (const entry of entries) {
    fs.rmSync(path.join(transcodeDir, entry), { recursive: true, force: true });
  }
  return Object.freeze({ cleared: true, removedEntries: entries.length, transcodeDir });
}

function applyReset({ database, dataDir, transcodeDir, nowMs }) {
  const plan = inspectPlan(database);
  if (plan.executionResiduals.length > 0) {
    throw new Error('P13_FULL_LIBRA_RESET_EXECUTION_RESIDUAL_REPAIR_REQUIRED');
  }
  const evidenceDigest = canonicalDigest({
    schema: 'helix.full-libra-reset-evidence@1',
    failureCode: FAILURE_CODE,
    runIds: plan.resetRuns.map((row) => row.libra_run_id),
    atMs: nowMs,
  });
  database.pragma('foreign_keys = OFF');
  const tx = database.transaction(() => {
    for (const run of plan.resetRuns) {
      const nextRevision = Number(run.state_revision) + 1;
      const current = database.prepare('SELECT * FROM libra_runs WHERE libra_run_id = ?').get(run.libra_run_id);
      const nextState = {
        libraRunId: run.libra_run_id,
        stateRevision: nextRevision,
        state: 'discarded',
        acceptanceSpecId: current.acceptance_spec_id,
        executionBasisDigest: current.execution_basis_digest,
        runScopeDigest: current.run_scope_digest,
        priorityClass: current.priority_class,
        priorityIntentDigest: current.priority_intent_digest,
        transitionKind: 'discarded',
        transitionEvidenceDigest: evidenceDigest,
      };
      const nextDigest = runStateDigest(nextState);
      database.prepare(`
        UPDATE libra_runs
           SET state = 'discarded',
               state_revision = ?,
               state_digest = ?,
               terminal_at_ms = ?
         WHERE libra_run_id = ?
           AND state = ?
           AND state_revision = ?
      `).run(nextRevision, nextDigest, nowMs, run.libra_run_id, run.state, run.state_revision);
      database.prepare(`
        UPDATE libra_formation_projections
           SET classification = 'pending',
               attention_state = 'none',
               current_libra_run_id = NULL,
               current_libra_run_state = NULL,
               current_libra_run_state_revision = NULL,
               current_libra_run_state_digest = NULL,
               next_action_label = '等待重新入库',
               next_action_state = 'pending',
               organizing_action = NULL,
               progress_mode = NULL,
               progress_current_value = NULL,
               progress_total_value = NULL,
               progress_unit = NULL,
               progress_rate = NULL,
               progress_eta_ms = NULL,
               progress_bucket = NULL,
               updated_at_ms = ?
         WHERE current_libra_run_id = ?
      `).run(nowMs, run.libra_run_id);
    }
    database.prepare('DELETE FROM libra_predeck_pipeline_tokens').run();
    for (const workspace of plan.workspaces) {
      database.prepare(`
        UPDATE libra_workspaces
           SET state = 'reclaimed', completed_at_ms = ?
         WHERE workspace_id = ?
      `).run(nowMs, workspace.workspace_id);
      database.prepare(`
        UPDATE fx_workspace_materials
           SET state = 'reclaimed', reclaimed_at_ms = ?
         WHERE workspace_id = ? AND state = 'active'
      `).run(nowMs, workspace.workspace_id);
      database.prepare(`
        UPDATE libra_workspace_cleanup_scopes
           SET state = 'completed', completed_at_ms = ?
         WHERE workspace_id = ? AND state = 'active'
      `).run(nowMs, workspace.workspace_id);
    }
    for (const work of plan.libraWorks) {
      database.prepare(`
        UPDATE fx_resource_defer
           SET state = 'cancelled'
         WHERE event_id IN (SELECT event_id FROM fx_workflow_events WHERE work_id = ?)
           AND state = 'waiting'
      `).run(work.work_id);
      database.prepare(`
        UPDATE fx_workflow_events
           SET state = 'cancelled'
         WHERE work_id = ?
           AND state IN ('pending', 'ready', 'waiting_for_resource', 'waiting_for_external',
                         'waiting_for_approval', 'executing')
      `).run(work.work_id);
      database.prepare(`
        UPDATE fx_work_attempts
           SET state = 'cancelled', finished_at_ms = COALESCE(finished_at_ms, ?),
               failure_code = COALESCE(failure_code, 'FULL_LIBRA_RESET')
         WHERE work_id = ? AND state IN ('ready', 'running', 'blocked')
      `).run(nowMs, work.work_id);
      database.prepare(`
        UPDATE fx_supporting_works
           SET state = 'cancelled', updated_at_ms = ?
         WHERE work_id = ?
      `).run(nowMs, work.work_id);
    }
    return Object.freeze({
      discardedRuns: plan.resetRuns.length,
      clearedTokens: plan.tokens.length,
      preservedPolicies: plan.policies.length,
      reclaimedWorkspaces: plan.workspaces.length,
      retiredWorks: plan.libraWorks.length,
    });
  });
  let applied;
  try {
    applied = tx();
  } finally {
    database.pragma('foreign_keys = ON');
  }
  const transcode = clearTranscodeRoot(transcodeDir, dataDir);
  return Object.freeze({ ...applied, transcode, evidenceDigest });
}

function main(argv = process.argv.slice(2)) {
  const dataDir = path.resolve(valueAfter(argv, '--data-dir')
    || process.env.MEDIA_SERVICE_DATA_DIR
    || path.join(__dirname, '..', 'data'));
  const transcodeDir = valueAfter(argv, '--transcode-dir')
    ? path.resolve(valueAfter(argv, '--transcode-dir'))
    : null;
  const dbPath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
  const database = new Database(dbPath);
  try {
    if (argv.includes('--plan') || !argv.includes('--apply')) {
      return Object.freeze({
        operation: 'full_libra_reset',
        confirmationRequired: CONFIRMATION,
        dataDir,
        transcodeDir,
        plan: inspectPlan(database),
      });
    }
    if (valueAfter(argv, '--confirm') !== CONFIRMATION) {
      throw new Error('P13_FULL_LIBRA_RESET_CONFIRMATION_REQUIRED');
    }
    database.pragma('foreign_keys = ON');
    assertSafeTranscodeRoot(transcodeDir, dataDir);
    const result = applyReset({ database, dataDir, transcodeDir, nowMs: Date.now() });
    const integrity = database.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
    return Object.freeze({ applied: true, dataDir, transcodeDir, result });
  } finally {
    database.close();
  }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.message, message: error.message, details: error.details || null },
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ inspectPlan, applyReset, assertSafeTranscodeRoot, CONFIRMATION });
