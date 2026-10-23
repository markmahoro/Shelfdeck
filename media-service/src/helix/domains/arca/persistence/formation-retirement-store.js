'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createExecutionStateReader } = require('../../../foundation/persistence/execution-state-reader');
const { createScopedControlRelease } = require('../../../foundation/persistence/scoped-control-release');

const { createOnDeckStore } = require('./on-deck-store');

const STATE = 'administratively_retired';
const CONTRACT = 'arca.formation-retirement@1';
const RESULT = 'arca.formation-retirement-receipt@1';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const normalize = value => typeof value === 'bigint' ? Number(value) : Array.isArray(value) ? value.map(normalize) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)])) : value;
const sorted = (rows, column) => rows.sort((a, b) => a[column].localeCompare(b[column]));

function createArcaFormationRetirementStore(options) {
  const columns = tableId => options.schemaManifest.tables.find(table => table.tableId === tableId).columns;
  const read = (tableId, keyColumns, kind = 'select-all') => ({ kind, tableId, columns: columns(tableId), keyColumns, safeIntegers: true });
  const repository = createRepositoryDefinition({ repositoryId: 'arca_formation_retirement', owner: 'arca', schemaManifest: options.schemaManifest,
    statements: {
      attempts: read('arca_acceptance_attempts', ['offer_id']),
      decisions: read('arca_acceptance_decisions', ['offer_id']),
      custodies: read('arca_ondeck_custodies', ['on_deck_package_id']),
      runs: read('arca_ondeck_runs', ['custody_id']),
      run: read('arca_ondeck_runs', ['on_deck_run_id'], 'select-one'),
      commits: read('arca_ondeck_commit_receipts', ['on_deck_run_id']),
      reservations: read('arca_series_presentation_reservations', ['on_deck_run_id']),
      shared_scope: read('arca_series_presentation_scopes', ['scope_id'], 'select-one'),
      approvals: read('arca_ondeck_settlement_approvals', ['on_deck_run_id']),
      recovery: read('arca_acceptance_recovery_cases', ['offer_id'], 'select-one'),
      inventory: read('arca_inventory_materials', ['material_key']),
      retire_attempt: { kind: 'update', tableId: 'arca_acceptance_attempts', setColumns: ['state', 'finished_at_ms'], keyColumns: ['acceptance_attempt_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      release_custody: { kind: 'update', tableId: 'arca_ondeck_custodies', setColumns: ['state'], keyColumns: ['custody_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      retire_run: { kind: 'update', tableId: 'arca_ondeck_runs', setColumns: ['state', 'terminal_at_ms', 'target_reserved_at_ms'], keyColumns: ['on_deck_run_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      release_reservation: { kind: 'update', tableId: 'arca_series_presentation_reservations', setColumns: ['state', 'updated_at_ms'], keyColumns: ['scope_id', 'on_deck_run_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      stale_approval: { kind: 'update', tableId: 'arca_ondeck_settlement_approvals', setColumns: ['state'], keyColumns: ['approval_id'],
        compareColumns: [{ column: 'state', parameter: 'expected_state' }] },
      retire_recovery: { kind: 'update', tableId: 'arca_acceptance_recovery_cases', setColumns: ['recovery_state', 'updated_at_ms'], keyColumns: ['offer_id'],
        compareColumns: [{ column: 'recovery_state', parameter: 'expected_state' }, { column: 'recovery_generation', parameter: 'expected_generation' }] },
    } });
  const receipts = createRepositoryDefinition({ repositoryId: 'arca_retirement_receipts', owner: 'execution-foundation', readOnly: true,
    schemaManifest: options.schemaManifest, statements: {
      receipts: read('fx_command_receipts', ['owner_domain', 'command_contract', 'target_type', 'target_id']),
      marker: read('fx_commit_markers', ['commit_marker'], 'select-one'),
    } });
  const commands = createCommandCommitCoordinator(options), execution = createExecutionStateReader(options);
  function snapshot(repo, offerId, packageId) {
    const attempts = sorted(repo.invoke('attempts', { offer_id: offerId }), 'acceptance_attempt_id');
    const decisions = sorted(repo.invoke('decisions', { offer_id: offerId }), 'acceptance_decision_id');
    const custodies = sorted(repo.invoke('custodies', { on_deck_package_id: packageId }), 'custody_id');
    const runs = sorted(custodies.flatMap(row => repo.invoke('runs', { custody_id: row.custody_id })), 'on_deck_run_id');
    const reservations = runs.flatMap(row => repo.invoke('reservations', { on_deck_run_id: row.on_deck_run_id }));
    const value = normalize({ offerId, packageId, attempts, decisions, custodies, runs, reservations,
      commits: runs.flatMap(row => repo.invoke('commits', { on_deck_run_id: row.on_deck_run_id })),
      approvals: sorted(runs.flatMap(row => repo.invoke('approvals', { on_deck_run_id: row.on_deck_run_id })), 'approval_id'),
      sharedScopes: [...new Set(reservations.map(row => row.scope_id))].sort().map(scope_id => repo.invoke('shared_scope', { scope_id })),
      recovery: repo.invoke('recovery', { offer_id: offerId }) || null });
    return { ...value, snapshotDigest: canonicalDigest(value) };
  }
  function inspect(offerId, packageId) {
    return options.unitOfWork.execute([{ participantId: 'arca_retirement_snapshot', owner: 'arca', repositories: [repository],
      execute: context => snapshot(context.repository(repository.repositoryId), offerId, packageId) }]).arca_retirement_snapshot;
  }
  function readReceipt(offerId) {
    return options.unitOfWork.execute([{ participantId: 'arca_retirement_receipt_read', owner: 'execution-foundation', repositories: [receipts],
      execute(context) {
        const repo = context.repository(receipts.repositoryId);
        const rows = repo.invoke('receipts', { owner_domain: 'arca', command_contract: CONTRACT, target_type: 'offer', target_id: offerId });
        if (!rows.length) return null;
        if (rows.length !== 1) fail('ARCA_RETIREMENT_RECEIPT_CORRUPT', 'An Offer has multiple administrative retirement receipts.');
        const row = rows[0], result = JSON.parse(row.result_ref_json), marker = repo.invoke('marker', { commit_marker: row.command_receipt_id });
        if (row.result_schema_ref !== RESULT || canonicalDigest(result) !== row.result_digest || result.resultKind !== STATE || result.offerId !== offerId ||
            !marker || marker.owner_domain !== 'arca' || marker.scope_type !== 'offer' || marker.scope_id !== offerId || marker.commit_digest !== row.request_digest)
          fail('ARCA_RETIREMENT_RECEIPT_CORRUPT', 'Administrative retirement receipt or commit marker is inconsistent.');
        return { ...result, receiptId: row.command_receipt_id, receiptDigest: row.result_digest };
      } }]).arca_retirement_receipt_read;
  }
  function commit(request) {
    if (!request || !['retirementId', 'offerId', 'packageId'].every(field => typeof request[field] === 'string' && request[field]) ||
        !['expectedSnapshotDigest', 'packageDigest', 'backupDigest', 'manifestDigest'].every(field => /^[0-9a-f]{64}$/.test(request[field] || '')))
      fail('ARCA_RETIREMENT_REQUEST_INVALID', 'Retirement requires an exact Offer snapshot, backup and manifest.');
    const before = inspect(request.offerId, request.packageId), requestDigest = canonicalDigest(request);
    const commandId = canonicalDigest({ contract: CONTRACT, retirementId: request.retirementId, offerId: request.offerId });
    const previous = readReceipt(request.offerId);
    if (previous && previous.receiptId !== commandId) fail('ARCA_RETIREMENT_ALREADY_CLOSED', 'Offer was already retired by another administrative command.');
    const unobserved = !before.attempts.length && !before.decisions.length && !before.custodies.length && !before.recovery;
    const deliveryQuery = { queryContract:'libra.product-delivery@1',
      readPurpose:'historical',offerId:request.offerId,onDeckPackageId:request.packageId,
      expectedPackageRevision:request.packageRevision,expectedPackageDigest:request.packageDigest };
    const delivery = unobserved && !previous ? options.readPublishedProduct?.(deliveryQuery) : null;
    const delivered = delivery?.onDeckProductPackage;
    const deliveryProved = delivery?.resultKind === 'found' && delivery.deliveryFence === null &&
      delivered.onDeckPackageId === request.packageId && delivered.packageRevision === request.packageRevision &&
      delivered.packageDigest === request.packageDigest && delivery.readDigest === request.expectedDeliveryReadDigest &&
      delivery.readDigest === canonicalDigest({schema:'libra.product-delivery-read@1',query:deliveryQuery,
        packageDigest:delivered.packageDigest,deliveryFence:null});
    const release = createScopedControlRelease(options, { ownerDomain: 'arca', processType: 'administrative_formation_retirement', processId: request.offerId,
      scopes: before.custodies.map(row => ({ ownerDomain: 'arca', scopeType: 'on_deck_custody', scopeId: row.custody_id })),
      expectedRows: request.expectedControls || [], evidenceDigest: requestDigest, commitMarker: commandId, receiptSchemaRef: RESULT });
    const scopes = [{ ownerDomain: 'arca', processType: 'arca_acceptance', processId: request.offerId },
      ...before.runs.flatMap(row => ['arca_ondeck_run', 'arca_on_deck_run'].map(processType => ({ ownerDomain: 'arca', processType, processId: row.on_deck_run_id })))];
    const guard = execution.createExecutionStateReadParticipant(scopes, summaries => {
      if (summaries.some(row => row.hasOpenWork || row.hasOpenEvent || row.hasUnsettledEffect))
        fail('ARCA_RETIREMENT_EXECUTION_PENDING', 'Arca execution and Effects must be settled before administrative retirement.');
    });
    return commands.execute({
      command: { commandReceiptId: commandId, ownerDomain: 'arca', commandContract: CONTRACT, callerScope: 'administrative-formation-reset',
        idempotencyKey: request.retirementId + ':' + request.offerId, requestDigest, targetType: 'offer', targetId: request.offerId },
      validationParticipants: [{ ...guard, boundBusinessOwner: 'arca' }, release.validationParticipant], controlParticipant: release.controlParticipant,
      domainParticipant: { participantId: 'arca_retirement_commit', owner: 'arca', repositories: [repository], execute(context) {
        const repo = context.repository(repository.repositoryId), current = snapshot(repo, request.offerId, request.packageId);
        if (current.snapshotDigest !== request.expectedSnapshotDigest) fail('ARCA_RETIREMENT_STALE', 'Arca responsibility changed after preview.');
        if (current.attempts.some(row => row.on_deck_package_id !== request.packageId || row.package_digest !== request.packageDigest) ||
            current.decisions.some(row => row.on_deck_package_id !== request.packageId || row.package_digest !== request.packageDigest) ||
            current.custodies.some(row => row.package_digest !== request.packageDigest) ||
            current.recovery && (current.recovery.on_deck_package_id !== request.packageId || current.recovery.package_digest !== request.packageDigest))
          fail('ARCA_RETIREMENT_PACKAGE_MISMATCH', 'Offer does not identify this immutable Product Package.');
        if (current.commits.length || current.runs.some(row => row.state === 'committed') || current.custodies.some(row => row.state === 'committed'))
          fail('ARCA_RETIREMENT_COMMITTED_PROTECTED', 'An On-deck Commit cannot be administratively retired.');
        if (current.reservations.some(row => row.state === 'committed'))
          fail('ARCA_RETIREMENT_COMMITTED_PROTECTED', 'A committed Series reservation cannot be retired without its collection facts.');
        if (!current.attempts.length && !current.decisions.length && !current.custodies.length && !current.recovery && !deliveryProved)
          fail('ARCA_RETIREMENT_OFFER_UNOBSERVED', 'An unobserved Offer requires its exact public delivery proof before retirement.');
        if (current.sharedScopes.some(row => !row || row.retirement_scope_id))
          fail('ARCA_RETIREMENT_SHARED_BUILD_PENDING', 'Shared presentation is missing or under Off-deck retirement.');
        for (const control of request.expectedControls || [])
          if (repo.invoke('inventory', { material_key: control.material_key }).length)
            fail('ARCA_RETIREMENT_INVENTORY_PROTECTED', 'A formal Inventory material cannot be released by Formation Reset.');
        const update = (statement, values) => {
          if (repo.invoke(statement, values).changes !== 1) fail('ARCA_RETIREMENT_CAS', 'Arca administrative retirement lost its state fence.');
        };
        for (const row of current.attempts.filter(row => ['active', 'waiting'].includes(row.state)))
          update('retire_attempt', { acceptance_attempt_id: row.acceptance_attempt_id, state: STATE, finished_at_ms: context.commitTimeMs, expected_state: row.state });
        for (const row of current.custodies.filter(row => row.state === 'active'))
          update('release_custody', { custody_id: row.custody_id, state: 'released', expected_state: row.state });
        for (const row of current.runs.filter(row => row.state !== STATE))
          update('retire_run', { on_deck_run_id: row.on_deck_run_id, state: STATE, terminal_at_ms: context.commitTimeMs, target_reserved_at_ms: null, expected_state: row.state });
        for (const row of current.reservations.filter(row => row.state === 'pending'))
          update('release_reservation', { scope_id: row.scope_id, on_deck_run_id: row.on_deck_run_id, state: 'released', updated_at_ms: context.commitTimeMs, expected_state: 'pending' });
        for (const row of current.approvals.filter(row => row.state === 'active'))
          update('stale_approval', { approval_id: row.approval_id, state: 'stale', expected_state: 'active' });
        if (current.recovery)
          update('retire_recovery', { offer_id: request.offerId, recovery_state: STATE, updated_at_ms: context.commitTimeMs,
            expected_state: current.recovery.recovery_state, expected_generation: current.recovery.recovery_generation });
        return { resultKind: STATE, offerId: request.offerId, packageId: request.packageId, packageDigest: request.packageDigest,
          releasedControlCount: release.count, releasedControlScopeDigest: release.scopeDigest, beforeDigest: current.snapshotDigest,
          afterDigest: snapshot(repo, request.offerId, request.packageId).snapshotDigest, manifestDigest: request.manifestDigest, backupDigest: request.backupDigest,
          deliveryReadDigest: deliveryProved ? delivery.readDigest : null };
      } },
      commitMarker: { commitMarker: commandId, scopeType: 'offer', scopeId: request.offerId, commitDigest: requestDigest },
      auditRecords: [{ auditId: commandId, actorType: 'admin', actorId: 'admin', action: 'administratively_retire_formation', scopeType: 'offer',
        scopeId: request.offerId, evidenceDigest: requestDigest }], resultEnvelope: resultRef => ({ resultSchemaRef: RESULT, resultRef }),
    });
  }
  function retiredAdmission(offer) {
    const receipt = readReceipt(offer.offerId);
    if (!receipt) return null;
    if (receipt.packageId !== offer.onDeckPackageId || receipt.packageDigest !== offer.packageDigest)
      fail('ARCA_RETIREMENT_PACKAGE_MISMATCH', 'Retired Offer was replayed with another package.');
    return Object.freeze({ kind: STATE, processId: offer.offerId, retirementReceipt: receipt,
      admissionParticipant: { participantId: 'arca_retired_offer_consumption', owner: 'arca', repositories: [repository], execute(context) {
        const current = snapshot(context.repository(repository.repositoryId), offer.offerId, offer.onDeckPackageId);
        if (current.custodies.some(row => row.state === 'active') || current.runs.some(row => row.state !== STATE) ||
            current.attempts.some(row => ['active', 'waiting'].includes(row.state)) ||
            current.recovery && current.recovery.recovery_state !== STATE)
          fail('ARCA_RETIREMENT_RECEIPT_CORRUPT', 'Retired Offer still has active Arca responsibility.');
        return { offerId: offer.offerId, retirementReceiptId: receipt.receiptId, retirementReceiptDigest: receipt.receiptDigest };
      } } });
  }
  function isRunRetired(onDeckRunId) {
    return options.unitOfWork.execute([{ participantId: 'arca_retirement_run_read', owner: 'arca', repositories: [repository],
      execute: context => context.repository(repository.repositoryId).invoke('run', { on_deck_run_id: onDeckRunId })?.state === STATE }]).arca_retirement_run_read;
  }
  function readRetirementProof(packages) {
    if (!Array.isArray(packages) || packages.length > 1000 || new Set(packages.map(row=>row.offerId)).size !== packages.length)
      fail('ARCA_RETIREMENT_PROOF_INVALID', 'Retirement proof requires bounded unique exact Offer references.');
    const result=[];
    for (const reference of [...packages].sort((a,b)=>a.offerId.localeCompare(b.offerId))) {
      const receipt=readReceipt(reference.offerId), current=inspect(reference.offerId,reference.packageId);
      if (current.attempts.some(row=>row.on_deck_package_id!==reference.packageId||row.package_digest!==reference.packageDigest) ||
          current.decisions.some(row=>row.on_deck_package_id!==reference.packageId||row.package_digest!==reference.packageDigest) ||
          current.custodies.some(row=>row.package_digest!==reference.packageDigest))
        fail('ARCA_RETIREMENT_PACKAGE_MISMATCH', 'Retirement proof does not match the immutable Package.');
      let disposition,evidenceDigest;
      if (receipt) {
        if(receipt.packageId!==reference.packageId||receipt.packageDigest!==reference.packageDigest ||
            current.custodies.some(row=>row.state==='active')||current.runs.some(row=>row.state!==STATE)||
            current.attempts.some(row=>['active','waiting'].includes(row.state)) ||
            current.recovery && current.recovery.recovery_state !== STATE)
          fail('ARCA_RETIREMENT_RECEIPT_CORRUPT', 'Retirement proof still has current responsibility.');
        disposition=STATE;evidenceDigest=receipt.receiptDigest;
      } else if(current.commits.length && current.runs.length &&
          current.runs.every(run=>run.state==='committed'&&current.commits.some(row=>row.on_deck_run_id===run.on_deck_run_id)) &&
          current.custodies.every(custody=>current.runs.some(run=>run.custody_id===custody.custody_id)) &&
          current.attempts.every(row=>!['active','waiting'].includes(row.state)) && (!current.recovery||current.recovery.recovery_state==='resolved')) {
        // Custody is the Accepted record; ordinary On-deck finalization does not
        // change its state. Prove closure from exact committed Inventory history.
        const onDeck=createOnDeckStore(options);
        const committed=current.custodies.map(custody=>{
          const decision=current.decisions.find(row=>row.acceptance_decision_id===custody.acceptance_decision_id&&row.result==='accepted');
          if(!decision)fail('ARCA_RETIREMENT_PROOF_PENDING','Committed custody lacks its Accepted decision.');
          const proof=onDeck.readCommittedByPackage({onDeckPackageId:reference.packageId,packageDigest:reference.packageDigest,
            custodyId:custody.custody_id,shelfId:decision.shelf_id});
          if(!proof||!current.runs.some(run=>run.on_deck_run_id===proof.onDeckRunId&&run.custody_id===proof.custodyId))
            fail('ARCA_RETIREMENT_PROOF_PENDING','Offer lacks exact committed package history.');
          return proof;
        });
        disposition='committed';evidenceDigest=canonicalDigest(committed);
      } else if(current.decisions.length&&current.decisions.every(row=>row.result==='rejected')&&current.attempts.length&&
          current.attempts.every(row=>row.state==='rejected')&&!current.custodies.length&&!current.runs.length) {
        disposition='historical_rejected';evidenceDigest=canonicalDigest(current.decisions);
      } else fail('ARCA_RETIREMENT_PROOF_PENDING', 'Offer still has unclosed Arca responsibility.');
      result.push({...reference,disposition,evidenceDigest});
    }
    return Object.freeze(result);
  }
  return Object.freeze({ inspect, commit, readReceipt, retiredAdmission, isRunRetired, readRetirementProof });
}

module.exports = Object.freeze({ createArcaFormationRetirementStore });
