'use strict';

const assert = require('node:assert/strict');

const STALE = 'P8_ACCEPTANCE_CONTINUITY_BASIS_STALE';
const ACCEPT = 'libra.intake.accept.commit@1';
const BINDING = 'libra.intake.binding.resolve@1';

function failedAttempts(db) {
  return db.prepare(`SELECT a.event_attempt_id,a.event_id,a.state AS attempt_state,a.outcome_kind,
      a.failure_class,a.failure_code,a.evidence_digest,e.state AS event_state,e.result_id,e.capability_ref,
      w.work_id,w.owner_domain,w.process_type,w.process_id,w.work_kind,w.state AS work_state,
      wa.ordinal AS work_ordinal,wa.state AS work_attempt_state,wa.failure_code AS work_failure_code
    FROM fx_event_attempts a
    LEFT JOIN fx_workflow_events e ON e.event_id=a.event_id
    LEFT JOIN fx_supporting_works w ON w.work_id=e.work_id
    LEFT JOIN fx_work_attempts wa ON wa.attempt_id=e.attempt_id
    WHERE a.failure_code IS NOT NULL OR a.outcome_kind='failed' ORDER BY a.event_attempt_id`).all();
}

function assertFailedInputHasNoEffect(db, failure) {
  assert.equal(failure.failure_code, STALE, 'Unexpected failed Event Attempt: ' + JSON.stringify(failure));
  assert.equal(failure.failure_class, 'input_projection');
  assert.equal(failure.attempt_state, 'completed');
  assert.equal(failure.outcome_kind, 'failed');
  assert.match(failure.evidence_digest || '', /^[0-9a-f]{64}$/);
  assert.equal(failure.owner_domain, 'libra');
  assert.equal(failure.process_type, 'libra_intake');
  assert.equal(failure.work_kind, 'acceptance');
  assert.ok([BINDING, ACCEPT].includes(failure.capability_ref));
  assert.equal(failure.event_state, 'failed');
  assert.equal(failure.result_id, null);
  assert.ok(Number.isSafeInteger(failure.work_ordinal) && failure.work_ordinal >= 1);
  assert.equal(db.prepare(`SELECT count(*) AS n FROM fx_effect_journal j
    JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id WHERE a.event_id=?`).get(failure.event_id).n, 0,
  'Failed input must have no Effect');
  assert.equal(db.prepare('SELECT count(*) AS n FROM fx_event_result_bindings WHERE event_id=?').get(failure.event_id).n, 0,
    'Failed input must have no Result');
}

// Verify the accepted handoff using historical ownership evidence: current control
// may legitimately advance after the Handoff A commit.
function assertAcceptedIntake(db, workId, afterOrdinal = 0) {
  const work = db.prepare('SELECT * FROM fx_supporting_works WHERE work_id=?').get(workId);
  assert.ok(work && work.owner_domain === 'libra' && work.process_type === 'libra_intake' &&
    work.work_kind === 'acceptance' && work.state === 'succeeded', 'Acceptance Work must succeed');
  const events = db.prepare(`SELECT e.event_id,e.result_id,wa.ordinal FROM fx_workflow_events e
    JOIN fx_work_attempts wa ON wa.attempt_id=e.attempt_id
    WHERE e.work_id=? AND e.capability_ref=? AND e.state='succeeded' AND wa.state='succeeded'`).all(workId, ACCEPT);
  assert.equal(events.length, 1, 'Acceptance must commit exactly one successful Event');
  assert.ok(events[0].ordinal > afterOrdinal, 'Acceptance must succeed on a later Work Attempt');
  const result = db.prepare('SELECT * FROM fx_event_result_bindings WHERE result_id=? AND event_id=?').get(events[0].result_id,events[0].event_id);
  assert.ok(result && result.outcome_kind === 'succeeded', 'Successful Acceptance requires its Event Result');
  const effects = db.prepare(`SELECT j.* FROM fx_effect_journal j JOIN fx_event_attempts a
    ON a.event_attempt_id=j.event_attempt_id WHERE a.event_id=?`).all(events[0].event_id);
  assert.equal(effects.length, 1, 'Successful Acceptance requires one committed Effect');
  assert.equal(effects[0].state,'committed');
  const markers = db.prepare(`SELECT * FROM fx_commit_markers WHERE result_id=? AND effect_id=?
    AND owner_domain='libra' AND scope_type='intake_decision' AND scope_id=?`).all(result.result_id,effects[0].effect_id,work.process_id);
  assert.equal(markers.length, 1, 'Successful Acceptance requires its exact commit marker');
  const decision = db.prepare(`SELECT d.*,r.receipt_id,r.receipt_digest,r.subject_id,r.outcome FROM libra_intake_decisions d
    JOIN libra_handoff_a_receipts r ON r.intake_decision_id=d.intake_decision_id WHERE d.intake_decision_id=?`).get(work.process_id);
  assert.ok(decision && decision.decision_kind === 'accepted_resolution' && decision.outcome === 'accepted');
  const receipt = JSON.parse(result.result_json);
  assert.deepEqual([receipt.intakeDecisionId,receipt.offerId,receipt.candidatePackageId,receipt.packageDigest,
    receipt.subjectId,receipt.receiptId,receipt.receiptDigest],
  [work.process_id,decision.offer_id,decision.candidate_package_id,decision.package_digest,
    decision.subject_id,decision.receipt_id,decision.receipt_digest]);
  const subject = db.prepare('SELECT subject_id,structure_kind,content_profile FROM libra_subjects WHERE subject_id=?').get(decision.subject_id);
  assert.ok(subject && subject.structure_kind === 'season' && subject.content_profile === 'series');

  const keys = db.prepare('SELECT material_key FROM proc_candidate_primary_materials WHERE candidate_package_id=? ORDER BY material_key')
    .all(decision.candidate_package_id).map(row=>row.material_key);
  assert.ok(keys.length > 0, 'Accepted Season must have source materials');
  const bindings = db.prepare(`SELECT material_key,subject_id,authority_kind FROM libra_material_bindings
    WHERE origin_intake_decision_id=? ORDER BY material_key`).all(work.process_id);
  assert.deepEqual(bindings.map(row=>row.material_key), keys, 'Every Candidate source must bind to the accepted Subject');
  for(const row of bindings) assert.deepEqual([row.subject_id,row.authority_kind],[decision.subject_id,'primary_control'],
    'Every source binding must belong to the accepted Subject');
  const transfers = db.prepare(`SELECT material_key,from_owner_domain,from_scope_type,from_scope_id,to_owner_domain,to_scope_type,to_scope_id
    FROM fx_material_control_revisions WHERE commit_marker=? ORDER BY material_key`).all(markers[0].commit_marker);
  assert.deepEqual(transfers.map(row=>row.material_key), keys, 'The commit must transfer precisely the Candidate sources');
  for (const row of transfers) assert.deepEqual([row.from_owner_domain,row.from_scope_type,row.from_scope_id,
    row.to_owner_domain,row.to_scope_type,row.to_scope_id],['procurement','material_field',decision.source_field_id,'libra','subject',decision.subject_id]);
  const candidateEpisodes = db.prepare(`SELECT DISTINCT episode_key FROM proc_candidate_primary_material_episode_claims
    WHERE candidate_package_id=? ORDER BY episode_key`).all(decision.candidate_package_id).map(row=>row.episode_key);
  const scope = db.prepare(`SELECT episode_key,subject_id FROM libra_subject_episode_scopes
    WHERE first_intake_decision_id=? ORDER BY episode_key`).all(work.process_id);
  const subjectEpisodes = scope.map(row=>row.episode_key);
  assert.ok(candidateEpisodes.length > 0);
  assert.deepEqual(subjectEpisodes, candidateEpisodes, 'Accepted Episode scope must equal the Candidate scope');
  assert.ok(scope.every(row=>row.subject_id===decision.subject_id));
  const delivery = db.prepare('SELECT * FROM proc_candidate_deliveries WHERE offer_id=?').get(decision.offer_id);
  assert.ok(delivery && delivery.state === 'accepted', 'Procurement must consume the Handoff A receipt');
  assert.deepEqual([delivery.candidate_package_id,delivery.package_digest,delivery.handoff_decision_id,
    delivery.handoff_receipt_id,delivery.handoff_receipt_digest,delivery.terminal_evidence_digest],
  [decision.candidate_package_id,decision.package_digest,work.process_id,decision.receipt_id,decision.receipt_digest,decision.receipt_digest]);
  const selections = db.prepare(`SELECT material_key,selection_state,terminal_disposition,terminal_evidence_digest FROM proc_run_materials
    WHERE candidate_package_id=? ORDER BY material_key`).all(decision.candidate_package_id);
  assert.deepEqual(selections.map(row=>row.material_key),keys, 'Handoff must close the complete Candidate selection');
  for(const row of selections) assert.deepEqual([row.selection_state,row.terminal_disposition,row.terminal_evidence_digest],
    ['transferred','handoff_accepted',decision.receipt_digest]);
  const messages = db.prepare(`SELECT * FROM fx_outbox WHERE producer_domain='libra' AND message_kind='libra_candidate_accepted'
    AND aggregate_type='intake_decision' AND aggregate_id=?`).all(work.process_id);
  assert.equal(messages.length,1, 'Accepted Decision must have exactly one Handoff A message');
  const message=JSON.parse(messages[0].payload_json);
  assert.deepEqual([message.intakeDecisionId,message.offerId,message.candidatePackageId,message.packageDigest,
    message.subjectId,message.receiptId,message.receiptDigest],
  [work.process_id,decision.offer_id,decision.candidate_package_id,decision.package_digest,
    decision.subject_id,decision.receipt_id,decision.receipt_digest]);
  return {work,decision,event:events[0],marker:markers[0]};
}

async function assertRecoveredIntakeFailures(db, {until, checkRuntime = () => {}}) {
  let pending = [];
  while (Date.now() < until) {
    checkRuntime();
    const failures = failedAttempts(db);
    pending = [];
    for (const failure of failures) {
      assertFailedInputHasNoEffect(db, failure);
      if (['failed','cancelled'].includes(failure.work_state)) assert.fail('Stale Acceptance Work did not recover: ' + JSON.stringify(failure));
      if (failure.work_state !== 'succeeded') { pending.push(failure); continue; }
      assert.equal(failure.work_attempt_state,'failed');
      assert.equal(failure.work_failure_code,STALE);
      const delivery = db.prepare(`SELECT p.state FROM libra_intake_decisions d JOIN proc_candidate_deliveries p ON p.offer_id=d.offer_id
        WHERE d.intake_decision_id=?`).get(failure.process_id);
      if (!delivery || delivery.state === 'open') { pending.push(failure); continue; }
      assert.equal(delivery.state,'accepted', 'Replanned Acceptance must close its original delivery');
      assertAcceptedIntake(db, failure.work_id, failure.work_ordinal);
    }
    if (!pending.length) return failures;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.fail('Stale Acceptance did not complete its Work and Handoff before the deadline: ' + JSON.stringify(pending));
}

module.exports = { assertAcceptedIntake, assertRecoveredIntakeFailures, failedAttempts };
