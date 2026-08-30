'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const CONFIRMATION = 'PROD033_EXECUTION_RESIDUAL_REPAIR_V1';
const FAILURE_CODE = 'P4_CANCELLED_WORK_ATTEMPT_RECOVERED_PROD033';
const ACTIVE_ATTEMPT_STATES = ['ready', 'running', 'blocked'];
const NONTERMINAL_EVENT_STATES = [
  'pending', 'ready', 'waiting_for_resource', 'waiting_for_external',
  'waiting_for_approval', 'executing',
];
const NONTERMINAL_EFFECT_STATES = ['intended', 'effect_observed', 'reconcile_required'];

function valueAfter(args, flag) {
  const assigned = args.find((arg) => arg.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function inspectPlan(database) {
  const attempts = database.prepare(`
    SELECT a.attempt_id, a.work_id, a.state AS attempt_state,
           w.process_type, w.process_id, w.work_kind, w.state AS work_state
      FROM fx_work_attempts a
      JOIN fx_supporting_works w ON w.work_id = a.work_id
     WHERE w.owner_domain = 'libra'
       AND w.state = 'cancelled'
       AND a.state IN (${placeholders(ACTIVE_ATTEMPT_STATES)})
     ORDER BY a.attempt_id
  `).all(...ACTIVE_ATTEMPT_STATES);
  const details = attempts.map((attempt) => {
    const events = database.prepare(`
      SELECT event_id, state
        FROM fx_workflow_events
       WHERE attempt_id = ?
       ORDER BY event_id
    `).all(attempt.attempt_id);
    const eventIds = events.map((event) => event.event_id);
    const eventAttempts = eventIds.length === 0 ? [] : database.prepare(`
      SELECT event_attempt_id, event_id, state, outcome_kind
        FROM fx_event_attempts
       WHERE event_id IN (${placeholders(eventIds)})
       ORDER BY event_attempt_id
    `).all(...eventIds);
    const eventAttemptIds = eventAttempts.map((eventAttempt) => eventAttempt.event_attempt_id);
    const effects = eventAttemptIds.length === 0 ? [] : database.prepare(`
      SELECT x.effect_id, x.event_attempt_id, x.effect_class, x.state,
             COUNT(m.commit_marker) AS marker_count
        FROM fx_effect_journal x
        LEFT JOIN fx_commit_markers m ON m.effect_id = x.effect_id
       WHERE x.event_attempt_id IN (${placeholders(eventAttemptIds)})
       GROUP BY x.effect_id, x.event_attempt_id, x.effect_class, x.state
       ORDER BY x.effect_id
    `).all(...eventAttemptIds);
    const unsafeReasons = [];
    for (const event of events.filter((item) => item.state === 'executing')) {
      if (eventAttempts.filter((item) => item.event_id === event.event_id && item.state === 'executing').length !== 1) {
        unsafeReasons.push(`executing_attempt_cardinality:${event.event_id}`);
      }
    }
    for (const effect of effects.filter((item) => NONTERMINAL_EFFECT_STATES.includes(item.state))) {
      if (effect.effect_class !== 'workspace_write') unsafeReasons.push(`effect_class:${effect.effect_id}:${effect.effect_class}`);
      if (Number(effect.marker_count) !== 0) unsafeReasons.push(`effect_marker:${effect.effect_id}`);
    }
    for (const effect of effects.filter((item) => item.state === 'committed')) {
      const eventAttempt = eventAttempts.find((item) => item.event_attempt_id === effect.event_attempt_id);
      const event = eventAttempt && events.find((item) => item.event_id === eventAttempt.event_id);
      if (event && NONTERMINAL_EVENT_STATES.includes(event.state)) {
        unsafeReasons.push(`committed_effect_on_nonterminal_event:${effect.effect_id}`);
      }
    }
    return Object.freeze({ ...attempt, events:Object.freeze(events), eventAttempts:Object.freeze(eventAttempts),
      effects:Object.freeze(effects), unsafeReasons:Object.freeze(unsafeReasons) });
  });
  return Object.freeze({ attempts:Object.freeze(details),
    repairableCount:details.filter((item) => item.unsafeReasons.length === 0).length,
    unsafeCount:details.filter((item) => item.unsafeReasons.length > 0).length });
}

function applyRepair(database, nowMs) {
  const plan = inspectPlan(database);
  if (plan.unsafeCount > 0) {
    const error = new Error('PROD033_EXECUTION_RESIDUAL_UNSAFE');
    error.details = plan.attempts.filter((item) => item.unsafeReasons.length > 0)
      .map((item) => ({ attemptId:item.attempt_id, unsafeReasons:item.unsafeReasons }));
    throw error;
  }
  const transaction = database.transaction(() => {
    let cancelledEvents = 0;
    let completedEventAttempts = 0;
    let abandonedEffects = 0;
    let cancelledResourceDefers = 0;
    for (const item of plan.attempts) {
      const evidenceDigest = canonicalDigest({
        schema:'prod033.cancelled-work-attempt-recovery@1',
        workId:item.work_id,
        attemptId:item.attempt_id,
        failureCode:FAILURE_CODE,
        atMs:nowMs,
      });
      const eventIds = item.events.map((event) => event.event_id);
      for (const effect of item.effects.filter((row) => NONTERMINAL_EFFECT_STATES.includes(row.state))) {
        const changed = database.prepare(`
          UPDATE fx_effect_journal
             SET state = 'failed', verified_at_ms = COALESCE(verified_at_ms, ?), updated_at_ms = ?
           WHERE effect_id = ? AND state = ?
        `).run(nowMs, nowMs, effect.effect_id, effect.state).changes;
        if (changed !== 1) throw new Error('PROD033_EFFECT_CAS');
        abandonedEffects += 1;
      }
      for (const eventAttempt of item.eventAttempts.filter((row) => row.state === 'executing')) {
        const changed = database.prepare(`
          UPDATE fx_event_attempts
             SET state = 'completed', outcome_kind = 'cancelled', retry_after_ms = NULL,
                 failure_class = 'fence', failure_code = ?, evidence_digest = ?, finished_at_ms = ?
           WHERE event_attempt_id = ? AND state = 'executing'
        `).run(FAILURE_CODE, evidenceDigest, nowMs, eventAttempt.event_attempt_id).changes;
        if (changed !== 1) throw new Error('PROD033_EVENT_ATTEMPT_CAS');
        completedEventAttempts += 1;
      }
      if (eventIds.length > 0) {
        cancelledResourceDefers += database.prepare(`
          UPDATE fx_resource_defer SET state = 'cancelled'
           WHERE event_id IN (${placeholders(eventIds)}) AND state = 'waiting'
        `).run(...eventIds).changes;
      }
      for (const event of item.events.filter((row) => NONTERMINAL_EVENT_STATES.includes(row.state))) {
        const changed = database.prepare(`
          UPDATE fx_workflow_events SET state = 'cancelled', retry_at_ms = NULL
           WHERE event_id = ? AND state = ?
        `).run(event.event_id, event.state).changes;
        if (changed !== 1) throw new Error('PROD033_EVENT_CAS');
        cancelledEvents += 1;
      }
      const changed = database.prepare(`
        UPDATE fx_work_attempts
           SET state = 'cancelled', finished_at_ms = COALESCE(finished_at_ms, ?), failure_code = ?
         WHERE attempt_id = ? AND state = ?
      `).run(nowMs, FAILURE_CODE, item.attempt_id, item.attempt_state).changes;
      if (changed !== 1) throw new Error('PROD033_WORK_ATTEMPT_CAS');
    }
    return Object.freeze({ repairedAttempts:plan.attempts.length, cancelledEvents,
      completedEventAttempts, abandonedEffects, cancelledResourceDefers });
  });
  const result = transaction();
  const remaining = inspectPlan(database);
  if (remaining.attempts.length !== 0) throw new Error('PROD033_EXECUTION_RESIDUAL_POSTCONDITION');
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
    if (!argv.includes('--apply')) return Object.freeze({ operation:'prod033_execution_residual_repair',
      confirmationRequired:CONFIRMATION, dataDir, plan:inspectPlan(database) });
    if (valueAfter(argv, '--confirm') !== CONFIRMATION) {
      throw new Error('PROD033_EXECUTION_RESIDUAL_CONFIRMATION_REQUIRED');
    }
    const result = applyRepair(database, Date.now());
    const integrity = database.pragma('integrity_check', { simple:true });
    if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
    return Object.freeze({ applied:true, dataDir, result, integrity });
  } finally {
    database.close();
  }
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error:{ code:error.message, message:error.message,
      details:error.details || null } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ CONFIRMATION, FAILURE_CODE, inspectPlan, applyRepair });
