'use strict';

// Administrative scope discovery is deliberately independent of the legacy
// deletion closure. Historical membership never authorizes a current release.
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const OPEN_RUNS = new Set(['active', 'suspended', 'frozen']);
const CLOSED_WORKS = new Set(['succeeded', 'failed', 'cancelled']);
const ordered = values => [...new Set(values)].sort();
const key = (owner, type, id) => JSON.stringify([owner, type, id]);

function rowsFor(db, table, column, ids) {
  const rows = [];
  const selected = ordered(ids);
  for (let offset = 0; offset < selected.length; offset += 100) {
    const batch = selected.slice(offset, offset + 100);
    rows.push(...db.prepare(`SELECT * FROM ${table} WHERE ${column} IN (${batch.map(() => '?').join(',')})`).all(...batch));
  }
  return rows.sort((a, b) => canonicalDigest(a).localeCompare(canonicalDigest(b)));
}

function inspectRetirementPlan(db) {
  // Pin all reads to one snapshot, including preview callers outside a UOW.
  const ownedTransaction = !db.inTransaction;
  if (ownedTransaction) db.exec('BEGIN');
  try {
    const subjects = db.prepare(`SELECT s.* FROM libra_subjects s
      LEFT JOIN libra_formation_projections p ON p.subject_id=s.subject_id
      WHERE s.status='active' AND (
        p.classification IN ('in_progress','attention_required') OR
        EXISTS(SELECT 1 FROM libra_runs r WHERE r.subject_id=s.subject_id AND r.state IN ('active','suspended','frozen')) OR
        EXISTS(SELECT 1 FROM libra_predeck_pipeline_tokens t WHERE t.subject_id=s.subject_id) OR
        (p.subject_id IS NULL AND (
          EXISTS(SELECT 1 FROM libra_runs r WHERE r.subject_id=s.subject_id AND r.state IN ('active','suspended','frozen')) OR
          NOT EXISTS(SELECT 1 FROM libra_runs r WHERE r.subject_id=s.subject_id)))) ORDER BY s.subject_id`).all();
    const subjectIds = subjects.map(row => row.subject_id);
    const subjectSet = new Set(subjectIds);
    const tokens = db.prepare(`SELECT t.* FROM libra_predeck_pipeline_tokens t
      LEFT JOIN libra_subjects s ON s.subject_id=t.subject_id
      WHERE s.subject_id IS NULL OR s.status='active' ORDER BY t.subject_id`).all()
      .filter(row => subjectSet.has(row.subject_id) || !db.prepare('SELECT 1 FROM libra_subjects WHERE subject_id=?').get(row.subject_id));
    const runs = rowsFor(db, 'libra_runs', 'subject_id', subjectIds);
    const packages = rowsFor(db, 'libra_product_packages', 'subject_id', subjectIds);
    const custodies = rowsFor(db, 'arca_ondeck_custodies', 'on_deck_package_id', packages.map(row => row.on_deck_package_id));
    const onDeckRuns = rowsFor(db, 'arca_ondeck_runs', 'custody_id', custodies.map(row => row.custody_id));
    const commits = rowsFor(db, 'arca_ondeck_commit_receipts', 'on_deck_run_id', onDeckRuns.map(row => row.on_deck_run_id));
    const committedOnDeckIds = new Set(commits.map(row => row.on_deck_run_id));
    const committedCustodyIds = new Set(onDeckRuns.filter(row => committedOnDeckIds.has(row.on_deck_run_id)).map(row => row.custody_id));
    const committedPackageIds = new Set(custodies.filter(row => committedCustodyIds.has(row.custody_id)).map(row => row.on_deck_package_id));
    const committedRunIds = new Set(packages.filter(row => committedPackageIds.has(row.on_deck_package_id)).map(row => row.libra_run_id));
    const currentRuns = runs.filter(row => OPEN_RUNS.has(row.state) && !committedRunIds.has(row.libra_run_id));
    const currentRunIds = new Set(currentRuns.map(row => row.libra_run_id));
    const allAttempts = rowsFor(db, 'arca_acceptance_attempts', 'on_deck_package_id', packages.map(row => row.on_deck_package_id));
    const openAttemptPackageIds = new Set(allAttempts.filter(row => ['active', 'waiting'].includes(row.state)).map(row => row.on_deck_package_id));
    const occupiedPackageIds = new Set(custodies.filter(row => row.state === 'active').map(row => row.on_deck_package_id));
    const currentPackages = packages.filter(row => !committedPackageIds.has(row.on_deck_package_id) &&
      (currentRunIds.has(row.libra_run_id) || openAttemptPackageIds.has(row.on_deck_package_id) || occupiedPackageIds.has(row.on_deck_package_id)));
    const packageIds = new Set(currentPackages.map(row => row.on_deck_package_id));
    const currentCustodies = custodies.filter(row => packageIds.has(row.on_deck_package_id) && row.state === 'active');
    const custodyIds = new Set(currentCustodies.map(row => row.custody_id));
    const currentOnDeckRuns = onDeckRuns.filter(row => custodyIds.has(row.custody_id) && !committedOnDeckIds.has(row.on_deck_run_id));
    const currentAttempts = allAttempts.filter(row => packageIds.has(row.on_deck_package_id) && ['active', 'waiting'].includes(row.state));
    const workspaces = rowsFor(db, 'libra_workspaces', 'libra_run_id', currentRuns.map(row => row.libra_run_id));
    const intakes = rowsFor(db, 'libra_intake_decisions', 'target_subject_id', subjectIds);
    const intakeWorks=db.prepare(`SELECT work_id,process_id FROM fx_supporting_works WHERE owner_domain='libra' AND process_type='libra_intake'
      AND state NOT IN ('succeeded','failed','cancelled') ORDER BY process_id,work_id`).all();
    const intakeIds = ordered([...intakes.map(row => row.intake_decision_id), ...tokens.map(row => row.source_process_id),...intakeWorks.map(row=>row.process_id)]);
    const pendingProcessIds=intakeIds.filter(id=>!db.prepare('SELECT 1 FROM libra_handoff_a_receipts WHERE intake_decision_id=?').get(id));
    const pendingSet=new Set(pendingProcessIds),pendingIntakes=[],intakeBlockers=[];
    if(pendingProcessIds.length){
      const matched=new Set();
      for(const message of db.prepare(`SELECT payload_json,payload_digest FROM fx_outbox WHERE producer_domain='procurement'
        AND message_kind='procurement_candidate_offer_available' ORDER BY message_id`).all()){
        const offer=JSON.parse(message.payload_json),processId=canonicalDigest({schema:'libra.intake-decision-id@1',offerId:offer.offerId});
        if(!pendingSet.has(processId))continue;
        if(canonicalDigest(offer)!==message.payload_digest||matched.has(processId)){
          intakeBlockers.push({code:'RESET_INTAKE_OFFER_INVALID',processId});continue;
        }
        matched.add(processId);
        const delivery=db.prepare('SELECT * FROM proc_candidate_deliveries WHERE offer_id=?').get(offer.offerId);
        if(!delivery||delivery.state!=='open'||delivery.candidate_package_id!==offer.candidatePackageId||delivery.package_digest!==offer.packageDigest||
            db.prepare('SELECT 1 FROM libra_intake_decisions WHERE intake_decision_id=?').get(processId)){
          intakeBlockers.push({code:'RESET_INTAKE_DECISION_UNSETTLED',processId});continue;
        }
        pendingIntakes.push({processId,offer,delivery});
      }
      for(const processId of pendingProcessIds)if(!matched.has(processId))intakeBlockers.push({code:'RESET_INTAKE_OFFER_MISSING',processId});
      pendingIntakes.sort((a,b)=>a.processId.localeCompare(b.processId));
    }
    // A stopped dispatcher may leave an already committed Handoff A awaiting
    // its ordinary Procurement acknowledgement. Preserve and consume that exact
    // original message; never retire it as an unaccepted Candidate.
    const acceptanceClosures=[];
    for(const decision of intakes){
      const receipt=db.prepare("SELECT * FROM libra_handoff_a_receipts WHERE intake_decision_id=? AND outcome='accepted'").get(decision.intake_decision_id);
      if(!receipt)continue;
      const delivery=db.prepare('SELECT * FROM proc_candidate_deliveries WHERE offer_id=?').get(receipt.offer_id);
      if(!delivery||delivery.state!=='open')continue;
      const messages=db.prepare("SELECT * FROM fx_outbox WHERE producer_domain='libra' AND message_kind='libra_candidate_accepted' AND dedup_key=?")
        .all('libra_candidate_accepted:'+receipt.offer_id);
      let envelope;
      if(messages.length===1){
        const message=messages[0],payload=JSON.parse(message.payload_json);
        const expected={schemaRef:'helix://contracts/types/LibraCandidateAcceptedMessage/v1',schemaVersion:1,messageKind:'libra_candidate_accepted',
          offerId:receipt.offer_id,candidatePackageId:receipt.candidate_package_id,packageRevision:receipt.package_revision,packageDigest:receipt.package_digest,
          intakeDecisionId:receipt.intake_decision_id,subjectId:receipt.subject_id,subjectIntakeRevision:receipt.subject_intake_revision,
          receiptId:receipt.receipt_id,receiptDigest:receipt.receipt_digest};
        if(canonicalDigest(payload)===canonicalDigest(expected)&&message.payload_digest===canonicalDigest(payload)&&
            message.payload_schema_ref===expected.schemaRef&&message.message_id===canonicalDigest({schema:'foundation.outbox-message-id@1',producerDomain:'libra',dedupKey:message.dedup_key}))
          envelope={messageId:message.message_id,dedupKey:message.dedup_key,producerDomain:'libra',consumerDomain:'procurement',
            payloadSchemaRef:message.payload_schema_ref,payloadDigest:message.payload_digest,payload};
      }
      if(!envelope){intakeBlockers.push({code:'RESET_ACCEPTANCE_ACK_UNPROVEN',processId:decision.intake_decision_id});continue;}
      acceptanceClosures.push({envelope,receipt});
    }
    const processScopes = [];
    const processKeys = new Set();
    const addProcesses = (ownerDomain, processType, ids) => {
      for (const processId of ordered(ids)) {
        const identity = key(ownerDomain, processType, processId);
        if (processKeys.has(identity)) continue;
        processKeys.add(identity); processScopes.push({ ownerDomain, processType, processId });
      }
    };
    addProcesses('libra', 'libra_intake', intakeIds);
    addProcesses('libra', 'libra_routing', subjectIds);
    addProcesses('libra', 'libra_acceptance_spec', subjectIds);
    addProcesses('libra', 'libra_run', currentRuns.map(row => row.libra_run_id));
    addProcesses('arca', 'arca_acceptance', currentPackages.map(row => row.offer_id));
    addProcesses('arca', 'arca_ondeck_run', currentOnDeckRuns.map(row => row.on_deck_run_id));
    addProcesses('arca', 'arca_on_deck_run', currentOnDeckRuns.map(row => row.on_deck_run_id));
    const readWorks = db.prepare('SELECT * FROM fx_supporting_works WHERE owner_domain=? AND process_type=? AND process_id=? ORDER BY work_id');
    const works = processScopes.flatMap(scope => readWorks.all(scope.ownerDomain, scope.processType, scope.processId))
      .filter(row => !CLOSED_WORKS.has(row.state)).sort((a, b) => a.work_id.localeCompare(b.work_id));
    const events = rowsFor(db, 'fx_workflow_events', 'work_id', works.map(row => row.work_id));
    const workAttempts = rowsFor(db, 'fx_work_attempts', 'work_id', works.map(row => row.work_id));
    const ownerScopes = [];
    const addOwners = (ownerDomain, scopeType, ids) => ordered(ids).forEach(scopeId => ownerScopes.push({ ownerDomain, scopeType, scopeId }));
    addOwners('libra', 'subject', subjectIds);
    addOwners('libra', 'libra_run', currentRuns.map(row => row.libra_run_id));
    addOwners('libra', 'workspace', workspaces.map(row => row.workspace_id));
    addOwners('libra', 'libra_workspace', workspaces.map(row => row.workspace_id));
    addOwners('libra', 'on_deck_package', currentPackages.map(row => row.on_deck_package_id));
    addOwners('arca', 'on_deck_custody', currentCustodies.map(row => row.custody_id));
    const readControls = db.prepare(`SELECT * FROM fx_material_controls WHERE state='controlled'
      AND owner_domain=? AND owner_scope_type=? AND owner_scope_id=? ORDER BY material_key`);
    const controls = ownerScopes.flatMap(scope => readControls.all(scope.ownerDomain, scope.scopeType, scope.scopeId))
      .sort((a, b) => a.material_key.localeCompare(b.material_key));
    const sharedReservations = rowsFor(db, 'arca_series_presentation_reservations', 'on_deck_run_id', currentOnDeckRuns.map(row => row.on_deck_run_id))
      .filter(row => row.state === 'pending');
    const sharedScopes = rowsFor(db, 'arca_series_presentation_scopes', 'scope_id', sharedReservations.map(row => row.scope_id));
    const blockers = [...intakeBlockers];
    const detached=db.prepare(`SELECT work_id FROM fx_supporting_works w WHERE state NOT IN ('succeeded','failed','cancelled') AND (
      (owner_domain='libra' AND process_type='libra_run' AND NOT EXISTS(SELECT 1 FROM libra_runs r WHERE r.libra_run_id=w.process_id)) OR
      (owner_domain='libra' AND process_type IN ('libra_routing','libra_acceptance_spec') AND NOT EXISTS(SELECT 1 FROM libra_subjects s WHERE s.subject_id=w.process_id)) OR
      (owner_domain='arca' AND process_type IN ('arca_ondeck_run','arca_on_deck_run') AND NOT EXISTS(SELECT 1 FROM arca_ondeck_runs r WHERE r.on_deck_run_id=w.process_id)) OR
      (owner_domain='arca' AND process_type='arca_acceptance' AND NOT EXISTS(SELECT 1 FROM libra_product_packages p WHERE p.offer_id=w.process_id)))`).all();
    if(detached.length)blockers.push({code:'RESET_UNSCOPED_RESPONSIBILITY',count:detached.length});
    const historyWorks=runs.filter(row=>!currentRunIds.has(row.libra_run_id)).flatMap(row=>readWorks.all('libra','libra_run',row.libra_run_id))
      .filter(row=>!CLOSED_WORKS.has(row.state));
    if(historyWorks.length)blockers.push({code:'RESET_TERMINAL_RUN_EXECUTION_PENDING',count:historyWorks.length});
    const recordedEffects = db.prepare(`SELECT effect_id,state,intent_digest,updated_at_ms FROM fx_effect_journal
      WHERE effect_class!='pure' AND state IN ('intended','effect_observed','reconcile_required') ORDER BY effect_id`).all();
    const history=recordedEffects.some(row=>row.state==='reconcile_required') && db.readonly
      ?require('./formation-retirement-history').readCompletedHistoricalEffects(db):{proofs:[],rejected:[]};
    const historicalIds=new Set(history.proofs.map(row=>row.effectId));
    const unresolvedEffects=recordedEffects.filter(row=>!historicalIds.has(row.effect_id));
    if (unresolvedEffects.length) blockers.push({ code: 'RESET_UNRESOLVED_EFFECT', count: unresolvedEffects.length });
    const executingEvents = db.prepare("SELECT event_id,work_id,attempt_id FROM fx_workflow_events WHERE state='executing' ORDER BY event_id").all();
    if (executingEvents.length) blockers.push({ code: 'RESET_EXECUTION_NOT_DRAINED', count: executingEvents.length });
    // Arca decides whether a shared builder survives the selected reservations.
    // The Operator must sequence its exact public closure before finishing Reset.
    if (sharedScopes.some(row => row.retirement_scope_id)) blockers.push({ code: 'RESET_SHARED_OFFDECK_PENDING' });
    if (runs.some(row => OPEN_RUNS.has(row.state) && committedRunIds.has(row.libra_run_id)))
      blockers.push({ code: 'RESET_COMMITTED_RUN_STATE_INCONSISTENT' });
    const inventoryControls = controls.filter(row => db.prepare('SELECT 1 FROM arca_inventory_materials WHERE material_key=? LIMIT 1').get(row.material_key));
    if (inventoryControls.length) blockers.push({ code: 'RESET_INVENTORY_CONTROL_PROTECTED', count: inventoryControls.length });
    const preservedRuns = runs.filter(row => !currentRunIds.has(row.libra_run_id));
    const plan = {
      schema: 'shelfdeck.formation-retirement-plan@1',
      subjects, tokens, pendingIntakes, acceptanceClosures, runs: currentRuns, packages: currentPackages, custodies: currentCustodies,
      onDeckRuns: currentOnDeckRuns, acceptanceAttempts: currentAttempts, workspaces,
      processScopes, ownerScopes, works, events, workAttempts, controls, sharedReservations, sharedScopes,
      preserved: { runs: preservedRuns, commits, committedPackages: packages.filter(row => committedPackageIds.has(row.on_deck_package_id)) },
      guards: { unresolvedEffects, executingEvents, completedHistoricalEffects:history.proofs, historicalProofRejections:history.rejected }, blockers,
    };
    return Object.freeze({ ...plan, planDigest: canonicalDigest(plan) });
  } finally {
    if (ownedTransaction) db.exec('ROLLBACK');
  }
}

module.exports = Object.freeze({ inspectRetirementPlan });
