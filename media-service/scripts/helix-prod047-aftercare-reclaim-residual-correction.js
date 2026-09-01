'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const CONFIRMATION = 'PROD047_AFTERCARE_RECLAIM_RESIDUAL_CORRECTION_V1';
const FAILURE_CODE = 'P4_LEGACY_AFTERCARE_RECLAIM_EXECUTION_RETIRED_PROD047';
const ACTIVE_WORK_STATES = ['admitted', 'ready', 'running', 'blocked'];
const ACTIVE_ATTEMPT_STATES = ['ready', 'running', 'blocked'];
const NONTERMINAL_EVENT_STATES = [
  'pending', 'ready', 'waiting_for_resource', 'waiting_for_external',
  'waiting_for_approval', 'executing',
];
const NONTERMINAL_EFFECT_STATES = ['intended', 'effect_observed', 'reconcile_required'];
const TERMINAL_CASE_STATES = ['resolved', 'invalidated', 'unresolved'];

function valueAfter(args, flag) {
  const assigned = args.find((arg) => arg.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesAfter(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
    else if (args[index].startsWith(`${flag}=`)) values.push(args[index].slice(flag.length + 1));
  }
  return values;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function parseJson(value, unsafeReasons, label) {
  try { return JSON.parse(value); }
  catch { unsafeReasons.push(`${label}_json_invalid`); return null; }
}

function sameSorted(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function reclaimIdentity(aftercareCaseId, materials) {
  const members = materials.map((row) => ({
    handleId:row.material_handle_id,
    handleDigest:row.handle_digest,
    fenceDigest:row.fence_digest,
  })).sort((a, b) => a.handleId.localeCompare(b.handleId));
  const intentDigest = canonicalDigest({
    schema:'arca.aftercare-workspace-reclaim-intent@1', aftercareCaseId, members,
  });
  return Object.freeze({
    intentDigest,
    effectId:'arca-aftercare-workspace-reclaim-' +
      canonicalDigest({ aftercareCaseId, intentDigest }).slice(0, 40),
  });
}

function receiptFor(aftercareCaseId, identity, materials, committedAtMs, includeScopeDigest) {
  const receipt = {
    schemaRef:'helix://contracts/types/ReclamationReceipt/v1',
    schemaVersion:1,
    receiptId:'arca-care-reclaim-' +
      canonicalDigest({ aftercareCaseId, intentDigest:identity.intentDigest }).slice(0, 40),
    receiptKind:'aftercare_workspace_reclaimed',
    ownerDomain:'arca',
    scopeType:'aftercare_case',
    scopeId:aftercareCaseId,
    workspaceId:aftercareCaseId,
    reclaimedHandleIds:materials.map((row) => row.material_handle_id).sort(),
    retainedHandleIds:[],
    reclaimedBytes:materials.reduce((sum, row) => sum + Number(row.size_bytes), 0),
    committedAtMs:Number(committedAtMs),
  };
  if (includeScopeDigest) receipt.scopeDigest = identity.intentDigest;
  return Object.freeze(receipt);
}

function inspectCandidate(database, work) {
  const unsafeReasons = [];
  const definition = parseJson(work.definition_json, unsafeReasons, 'definition');
  if (definition && canonicalDigest(definition) !== work.definition_digest) {
    unsafeReasons.push('definition_digest_drift');
  }
  if (definition && (definition.schemaRef !== 'helix://foundation/types/SupportingWorkDefinition/v1' ||
      definition.ownerDomain !== 'arca' || definition.processType !== 'arca_shelf_entry' ||
      definition.processId !== work.process_id || definition.workId !== work.work_id ||
      definition.workKind !== 'care_workspace_reclaim' ||
      definition.outputContractRef !== 'helix://contracts/types/ReclamationReceipt/v1')) {
    unsafeReasons.push('definition_scope_mismatch');
  }
  const aftercareRefs = Array.isArray(definition?.dependencyRefs) ?
    definition.dependencyRefs.filter((ref) => ref?.ownerDomain === 'arca' &&
      ref?.objectType === 'aftercare_case' && typeof ref.objectId === 'string') : [];
  if (aftercareRefs.length !== 1) unsafeReasons.push('aftercare_case_reference_cardinality');
  const aftercareCaseId = aftercareRefs[0]?.objectId || null;

  const attempts = database.prepare(`
    SELECT attempt_id, state, finished_at_ms, failure_code
      FROM fx_work_attempts WHERE work_id = ? ORDER BY ordinal, attempt_id
  `).all(work.work_id);
  const activeAttempts = attempts.filter((row) => ACTIVE_ATTEMPT_STATES.includes(row.state));
  if (activeAttempts.length !== 1 || attempts.length !== 1) unsafeReasons.push('work_attempt_cardinality');
  const attempt = activeAttempts[0] || attempts[0] || null;
  const plans = attempt ? database.prepare(`
    SELECT plan_id, state FROM fx_workflow_plans WHERE attempt_id = ? ORDER BY plan_id
  `).all(attempt.attempt_id) : [];
  if (plans.length !== 1 || plans[0]?.state !== 'planned') unsafeReasons.push('workflow_plan_cardinality');
  const events = attempt ? database.prepare(`
    SELECT event_id, state, capability_ref, result_id
      FROM fx_workflow_events WHERE attempt_id = ? ORDER BY event_id
  `).all(attempt.attempt_id) : [];
  if (events.length !== 1 || events[0]?.capability_ref !== 'arca.aftercare.workspace.reclaim@1' ||
      !NONTERMINAL_EVENT_STATES.includes(events[0]?.state)) unsafeReasons.push('workflow_event_shape');
  const event = events[0] || null;
  const eventAttempts = event ? database.prepare(`
    SELECT event_attempt_id, state, outcome_kind, failure_code
      FROM fx_event_attempts WHERE event_id = ? ORDER BY ordinal, event_attempt_id
  `).all(event.event_id) : [];
  const executingEventAttempts = eventAttempts.filter((row) => row.state === 'executing');
  if (eventAttempts.length !== 1 || executingEventAttempts.length !== 1) {
    unsafeReasons.push('event_attempt_cardinality');
  }
  const eventAttempt = executingEventAttempts[0] || eventAttempts[0] || null;
  const results = event ? database.prepare(`
    SELECT result_id FROM fx_event_result_bindings WHERE event_id = ? ORDER BY result_id
  `).all(event.event_id) : [];
  if (event?.result_id !== null || results.length !== 0) unsafeReasons.push('immutable_result_present');
  const effects = eventAttempt ? database.prepare(`
    SELECT x.effect_id, x.effect_class, x.state,
           COUNT(m.commit_marker) AS marker_count
      FROM fx_effect_journal x
      LEFT JOIN fx_commit_markers m ON m.effect_id = x.effect_id
     WHERE x.event_attempt_id = ?
     GROUP BY x.effect_id, x.effect_class, x.state
     ORDER BY x.effect_id
  `).all(eventAttempt.event_attempt_id) : [];
  if (effects.length !== 1 || effects[0]?.effect_class !== 'workspace_write' ||
      !NONTERMINAL_EFFECT_STATES.includes(effects[0]?.state) || Number(effects[0]?.marker_count) !== 0) {
    unsafeReasons.push('effect_shape');
  }

  const care = aftercareCaseId ? database.prepare(`
    SELECT aftercare_case_id, shelf_entry_id, state, terminal_at_ms
      FROM arca_aftercare_cases WHERE aftercare_case_id = ?
  `).get(aftercareCaseId) : null;
  if (!care || !TERMINAL_CASE_STATES.includes(care.state) || care.terminal_at_ms === null ||
      care.shelf_entry_id !== work.process_id) unsafeReasons.push('aftercare_case_not_terminal');
  const registry = aftercareCaseId ? database.prepare(`
    SELECT workspace_id, owner_domain, process_type, process_id, state, reclaimed_at_ms
      FROM fx_workspace_registry WHERE workspace_id = ?
  `).get(aftercareCaseId) : null;
  if (!registry || registry.owner_domain !== 'arca' || registry.process_type !== 'aftercare_case' ||
      registry.process_id !== aftercareCaseId || registry.state !== 'reclaimed' ||
      registry.reclaimed_at_ms === null) unsafeReasons.push('workspace_not_reclaimed');
  const materials = aftercareCaseId ? database.prepare(`
    SELECT workspace_id, material_handle_id, size_bytes, handle_digest, fence_digest, state,
           reclaimed_effect_id, reclaimed_effect_receipt_digest, reclaimed_at_ms
      FROM fx_workspace_materials WHERE workspace_id = ? ORDER BY material_handle_id
  `).all(aftercareCaseId) : [];
  if (materials.length === 0 || materials.some((row) => row.state !== 'reclaimed' ||
      row.reclaimed_at_ms === null || Number(row.reclaimed_at_ms) !== Number(registry?.reclaimed_at_ms))) {
    unsafeReasons.push('workspace_material_not_reclaimed');
  }
  const materialScope = Array.isArray(definition?.workspaceMaterialScope) ? definition.workspaceMaterialScope : [];
  const expectedScope = materials.map((row) => `${row.material_handle_id}:${row.fence_digest}`);
  const actualScope = materialScope.map((row) => `${row?.handleId}:${row?.fenceDigest}`);
  if (materialScope.length !== materials.length || !sameSorted(expectedScope, actualScope)) {
    unsafeReasons.push('workspace_material_scope_mismatch');
  }
  const artifacts = aftercareCaseId ? database.prepare(`
    SELECT artifact_handle_id, state FROM fx_artifact_registry
     WHERE owner_domain = 'arca' AND owner_scope_type = 'aftercare_case' AND owner_scope_id = ?
     ORDER BY artifact_handle_id
  `).all(aftercareCaseId) : [];
  const artifactIds = artifacts.map((row) => row.artifact_handle_id);
  const activeReferences = artifactIds.length === 0 ? [] : database.prepare(`
    SELECT artifact_handle_id, consumer_domain, consumer_scope_type, consumer_scope_id, reference_kind
      FROM fx_artifact_references
     WHERE artifact_handle_id IN (${placeholders(artifactIds)}) AND state = 'active'
     ORDER BY artifact_handle_id, consumer_domain, consumer_scope_type, consumer_scope_id, reference_kind
  `).all(...artifactIds);
  if (artifacts.some((row) => row.state === 'active') || activeReferences.length !== 0) {
    unsafeReasons.push('active_artifact_reference');
  }

  let legacyReceiptDigest = null;
  let currentReceiptDigest = null;
  let identity = null;
  if (aftercareCaseId && registry?.reclaimed_at_ms !== null && materials.length > 0) {
    identity = reclaimIdentity(aftercareCaseId, materials);
    legacyReceiptDigest = canonicalDigest(receiptFor(aftercareCaseId, identity, materials,
      registry.reclaimed_at_ms, false));
    currentReceiptDigest = canonicalDigest(receiptFor(aftercareCaseId, identity, materials,
      registry.reclaimed_at_ms, true));
    if (legacyReceiptDigest === currentReceiptDigest || materials.some((row) =>
      row.reclaimed_effect_id !== identity.effectId ||
      row.reclaimed_effect_receipt_digest !== legacyReceiptDigest)) {
      unsafeReasons.push('legacy_receipt_proof_mismatch');
    }
  }

  return Object.freeze({
    workId:work.work_id,
    workState:work.state,
    attemptId:attempt?.attempt_id || null,
    attemptState:attempt?.state || null,
    eventId:event?.event_id || null,
    eventState:event?.state || null,
    eventAttemptId:eventAttempt?.event_attempt_id || null,
    effectId:effects[0]?.effect_id || null,
    effectState:effects[0]?.state || null,
    aftercareCaseId,
    workspaceState:registry?.state || null,
    materialCount:materials.length,
    legacyReceiptDigest,
    currentReceiptDigest,
    unsafeReasons:Object.freeze([...new Set(unsafeReasons)]),
  });
}

function inspectPlan(database) {
  const works = database.prepare(`
    SELECT work_id, process_id, state, definition_json, definition_digest
      FROM fx_supporting_works
     WHERE owner_domain = 'arca'
       AND process_type = 'arca_shelf_entry'
       AND work_kind = 'care_workspace_reclaim'
       AND state IN (${placeholders(ACTIVE_WORK_STATES)})
     ORDER BY work_id
  `).all(...ACTIVE_WORK_STATES);
  const candidates = works.map((work) => inspectCandidate(database, work));
  return Object.freeze({
    candidates:Object.freeze(candidates),
    repairableCount:candidates.filter((item) => item.unsafeReasons.length === 0).length,
    unsafeCount:candidates.filter((item) => item.unsafeReasons.length > 0).length,
  });
}

function assertExpectedScope(plan, expectedWorkIds) {
  if (!Array.isArray(expectedWorkIds) || expectedWorkIds.length === 0) {
    throw new Error('PROD047_EXPECTED_WORK_IDS_REQUIRED');
  }
  if (!sameSorted(plan.candidates.map((item) => item.workId), expectedWorkIds)) {
    const error = new Error('PROD047_EXPECTED_WORK_IDS_MISMATCH');
    error.details = { actual:plan.candidates.map((item) => item.workId), expected:[...expectedWorkIds].sort() };
    throw error;
  }
  if (plan.unsafeCount > 0) {
    const error = new Error('PROD047_AFTERCARE_RECLAIM_RESIDUAL_UNSAFE');
    error.details = plan.candidates.filter((item) => item.unsafeReasons.length > 0)
      .map((item) => ({ workId:item.workId, unsafeReasons:item.unsafeReasons }));
    throw error;
  }
}

function applyCorrection(database, nowMs, expectedWorkIds) {
  const plan = inspectPlan(database);
  assertExpectedScope(plan, expectedWorkIds);
  const transaction = database.transaction(() => {
    let cancelledWorks = 0;
    let cancelledAttempts = 0;
    let cancelledEvents = 0;
    let completedEventAttempts = 0;
    let failedEffects = 0;
    let cancelledResourceDefers = 0;
    for (const item of plan.candidates) {
      const evidenceDigest = canonicalDigest({
        schema:'prod047.legacy-aftercare-reclaim-execution-retirement@1',
        workId:item.workId,
        attemptId:item.attemptId,
        eventId:item.eventId,
        eventAttemptId:item.eventAttemptId,
        effectId:item.effectId,
        aftercareCaseId:item.aftercareCaseId,
        legacyReceiptDigest:item.legacyReceiptDigest,
        currentReceiptDigest:item.currentReceiptDigest,
        failureCode:FAILURE_CODE,
        atMs:nowMs,
      });
      if (database.prepare(`
        UPDATE fx_effect_journal
           SET state = 'failed', verified_at_ms = COALESCE(verified_at_ms, ?), updated_at_ms = ?
         WHERE effect_id = ? AND state = ?
      `).run(nowMs, nowMs, item.effectId, item.effectState).changes !== 1) throw new Error('PROD047_EFFECT_CAS');
      failedEffects += 1;
      if (database.prepare(`
        UPDATE fx_event_attempts
           SET state = 'completed', outcome_kind = 'cancelled', retry_after_ms = NULL,
               failure_class = 'fence', failure_code = ?, evidence_digest = ?, finished_at_ms = ?
         WHERE event_attempt_id = ? AND state = 'executing'
      `).run(FAILURE_CODE, evidenceDigest, nowMs, item.eventAttemptId).changes !== 1) {
        throw new Error('PROD047_EVENT_ATTEMPT_CAS');
      }
      completedEventAttempts += 1;
      cancelledResourceDefers += database.prepare(`
        UPDATE fx_resource_defer SET state = 'cancelled'
         WHERE event_id = ? AND state = 'waiting'
      `).run(item.eventId).changes;
      if (database.prepare(`
        UPDATE fx_workflow_events SET state = 'cancelled', retry_at_ms = NULL
         WHERE event_id = ? AND state = ?
      `).run(item.eventId, item.eventState).changes !== 1) throw new Error('PROD047_EVENT_CAS');
      cancelledEvents += 1;
      if (database.prepare(`
        UPDATE fx_work_attempts
           SET state = 'cancelled', finished_at_ms = COALESCE(finished_at_ms, ?), failure_code = ?
         WHERE attempt_id = ? AND state = ?
      `).run(nowMs, FAILURE_CODE, item.attemptId, item.attemptState).changes !== 1) {
        throw new Error('PROD047_WORK_ATTEMPT_CAS');
      }
      cancelledAttempts += 1;
      if (database.prepare(`
        UPDATE fx_supporting_works SET state = 'cancelled', updated_at_ms = ?
         WHERE work_id = ? AND state = ?
      `).run(nowMs, item.workId, item.workState).changes !== 1) throw new Error('PROD047_WORK_CAS');
      cancelledWorks += 1;
    }
    return Object.freeze({ cancelledWorks, cancelledAttempts, cancelledEvents,
      completedEventAttempts, failedEffects, cancelledResourceDefers });
  });
  const result = transaction();
  const remaining = inspectPlan(database);
  if (remaining.candidates.length !== 0) throw new Error('PROD047_AFTERCARE_RECLAIM_RESIDUAL_POSTCONDITION');
  return Object.freeze(result);
}

function main(argv = process.argv.slice(2)) {
  const dataDir = path.resolve(valueAfter(argv, '--data-dir') || process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data'));
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  const database = new Database(databasePath);
  try {
    database.pragma('foreign_keys = ON');
    const plan = inspectPlan(database);
    if (!argv.includes('--apply')) return Object.freeze({
      operation:'prod047_aftercare_reclaim_residual_correction',
      confirmationRequired:CONFIRMATION,
      dataDir,
      plan,
    });
    if (valueAfter(argv, '--confirm') !== CONFIRMATION) {
      throw new Error('PROD047_AFTERCARE_RECLAIM_RESIDUAL_CONFIRMATION_REQUIRED');
    }
    const expectedWorkIds = valuesAfter(argv, '--expected-work-id');
    const result = applyCorrection(database, Date.now(), expectedWorkIds);
    const integrity = database.pragma('integrity_check', { simple:true });
    if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
    return Object.freeze({ applied:true, dataDir, expectedWorkIds:Object.freeze(expectedWorkIds), result, integrity });
  } finally { database.close(); }
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error:{ code:error.message, message:error.message,
      details:error.details || null } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ CONFIRMATION, FAILURE_CODE, inspectPlan, applyCorrection,
  reclaimIdentity, receiptFor });
