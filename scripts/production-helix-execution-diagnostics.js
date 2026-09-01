'use strict';

/**
 * Read-only diagnostics for Clean Helix execution residual incidents on NAS.
 *
 * This command never changes SQLite or media files. It reports aggregate
 * execution coherence and performs one bounded 256 KiB read from each source
 * Material that belongs to an offloading Arca On-deck Run.
 */

const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(conn, command) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    conn.exec(command, { pty:true }, (error, stream) => {
      if (error) return reject(error);
      stream.on('close', (code) => resolve({ code, output, errorOutput }));
      stream.on('data', (chunk) => { output += chunk.toString(); });
      stream.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    });
  });
}

function remoteCommand() {
  const source = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const database = new Database('/app/data/shelfdeck.db', { readonly:true, fileMustExist:true });
const all = (sql, parameters = []) => database.prepare(sql).all(...parameters);
const get = (sql, parameters = []) => database.prepare(sql).get(...parameters);

function materialLocation(row) {
  if (row.location_kind === 'workspace_handle' && row.workspace_handle_json) {
    const handle = JSON.parse(row.workspace_handle_json);
    return path.resolve('/transcode', handle.workspaceId, ...String(handle.relativePath || '').split('/'));
  }
  return row.location || null;
}

function boundedRead(location) {
  if (!location) return { location:null, status:'missing_location' };
  const started = Date.now();
  let descriptor;
  try {
    const stat = fs.lstatSync(location, { bigint:true });
    if (!stat.isFile() || stat.isSymbolicLink()) return { location, status:'not_regular_file' };
    const sampleLength = Math.min(Number(stat.size), 256 * 1024);
    const sampleOffset = Math.floor((Number(stat.size) - sampleLength) / 2);
    const sample = Buffer.allocUnsafe(sampleLength);
    descriptor = fs.openSync(location, 'r');
    const bytesRead = fs.readSync(descriptor, sample, 0, sampleLength, sampleOffset);
    return { location, status:'ok', sizeBytes:Number(stat.size), bytesRead, elapsedMs:Date.now() - started };
  } catch (error) {
    return { location, status:'error', code:error.code || error.name, elapsedMs:Date.now() - started };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function boundedFingerprint(location) {
  const evidence = boundedRead(location);
  if (evidence.status !== 'ok') return evidence;
  let descriptor;
  try {
    const sampleLength = Math.min(evidence.sizeBytes, 256 * 1024);
    const sampleOffset = Math.floor((evidence.sizeBytes - sampleLength) / 2);
    const sample = Buffer.allocUnsafe(sampleLength);
    descriptor = fs.openSync(location, 'r');
    const bytesRead = fs.readSync(descriptor, sample, 0, sampleLength, sampleOffset);
    return { ...evidence, contentFingerprint:crypto.createHash('sha256').update(sample.subarray(0, bytesRead)).digest('hex') };
  } catch (error) {
    return { location, status:'error', code:error.code || error.name };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

try {
  const residuals = all(
    "SELECT w.owner_domain AS ownerDomain,w.state AS workState,a.state AS attemptState,COUNT(*) AS count " +
    "FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
    "WHERE w.state IN ('succeeded','failed','cancelled') AND a.state IN ('ready','running','blocked') " +
    "GROUP BY w.owner_domain,w.state,a.state ORDER BY w.owner_domain,w.state,a.state"
  );
  const unsafeResiduals = get(
    "SELECT COUNT(*) AS count FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
    "WHERE w.state='cancelled' AND a.state IN ('ready','running','blocked') AND (" +
      "EXISTS(SELECT 1 FROM fx_workflow_events e WHERE e.attempt_id=a.attempt_id AND e.state NOT IN ('succeeded','skipped','failed','cancelled')) OR " +
      "EXISTS(SELECT 1 FROM fx_workflow_events e JOIN fx_event_attempts ea ON ea.event_id=e.event_id WHERE e.attempt_id=a.attempt_id AND ea.state='executing') OR " +
      "EXISTS(SELECT 1 FROM fx_workflow_events e JOIN fx_event_attempts ea ON ea.event_id=e.event_id JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id " +
        "WHERE e.attempt_id=a.attempt_id AND x.state IN ('intended','effect_observed','reconcile_required')) OR " +
      "EXISTS(SELECT 1 FROM fx_workflow_events e JOIN fx_resource_defer d ON d.event_id=e.event_id WHERE e.attempt_id=a.attempt_id AND d.state='waiting'))"
  );
  const residualChildren = all(
    "SELECT e.capability_ref AS capabilityRef,e.state AS eventState,ea.state AS eventAttemptState," +
      "COALESCE(ea.outcome_kind,'none') AS outcomeKind,COALESCE(x.effect_class,'none') AS effectClass," +
      "COALESCE(x.state,'none') AS effectState,COUNT(*) AS count " +
    "FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
      "LEFT JOIN fx_workflow_events e ON e.attempt_id=a.attempt_id " +
      "LEFT JOIN fx_event_attempts ea ON ea.event_id=e.event_id " +
      "LEFT JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id " +
    "WHERE w.state='cancelled' AND a.state IN ('ready','running','blocked') " +
    "GROUP BY e.capability_ref,e.state,ea.state,ea.outcome_kind,x.effect_class,x.state " +
    "ORDER BY count DESC,e.capability_ref"
  );
  const activeAttempts = all(
    "SELECT w.owner_domain AS ownerDomain,w.state AS workState,a.state AS attemptState,COUNT(*) AS count " +
    "FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
    "WHERE a.state IN ('ready','running','blocked') GROUP BY w.owner_domain,w.state,a.state " +
    "ORDER BY w.owner_domain,w.state,a.state"
  );
  const activeLibraWorks = all(
    "SELECT w.process_type AS processType,w.process_id AS processId,w.work_kind AS workKind," +
      "w.work_id AS workId,w.state AS workState,a.attempt_id AS attemptId,a.state AS attemptState," +
      "r.subject_id AS subjectId,r.state AS libraRunState " +
    "FROM fx_supporting_works w LEFT JOIN fx_work_attempts a ON a.work_id=w.work_id " +
      "LEFT JOIN libra_runs r ON r.libra_run_id=w.process_id " +
    "WHERE w.owner_domain='libra' AND w.state IN ('admitted','ready','running','blocked') " +
    "ORDER BY w.process_type,w.process_id,w.work_kind,w.work_id"
  );
  const activeLibraEvents = all(
    "SELECT w.process_type AS processType,w.process_id AS processId,w.work_kind AS workKind,w.work_id AS workId," +
      "e.event_id AS eventId,e.capability_ref AS capabilityRef,e.state AS eventState," +
      "ea.event_attempt_id AS eventAttemptId,ea.state AS eventAttemptState,ea.started_at_ms AS startedAtMs," +
      "x.effect_id AS effectId,x.state AS effectState,x.updated_at_ms AS effectUpdatedAtMs " +
    "FROM fx_supporting_works w JOIN fx_workflow_events e ON e.work_id=w.work_id " +
      "LEFT JOIN fx_event_attempts ea ON ea.event_id=e.event_id AND ea.state='executing' " +
      "LEFT JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id " +
    "WHERE w.owner_domain='libra' AND w.state IN ('admitted','ready','running','blocked') " +
      "AND e.state NOT IN ('succeeded','skipped','failed','cancelled') ORDER BY w.work_id,e.event_id"
  );
  const activeLibraInputBindings = all(
    "SELECT w.process_id AS processId,e.event_id AS eventId,e.capability_ref AS capabilityRef," +
      "node.input_bindings_json AS inputBindingsJson " +
    "FROM fx_supporting_works w JOIN fx_workflow_events e ON e.work_id=w.work_id " +
      "JOIN fx_plan_nodes node ON node.plan_id=e.plan_id AND node.node_id=e.node_id " +
    "WHERE w.owner_domain='libra' AND w.state IN ('admitted','ready','running','blocked') " +
      "AND e.state NOT IN ('succeeded','skipped','failed','cancelled') ORDER BY w.work_id,e.event_id"
  ).map((row) => ({ ...row, inputBindings:JSON.parse(row.inputBindingsJson) }));
  const activeIntakePayloads = all(
    "SELECT w.process_id AS processId,e.event_id AS eventId,result.result_json AS resultJson " +
    "FROM fx_supporting_works w JOIN fx_workflow_events e ON e.work_id=w.work_id " +
      "JOIN fx_event_result_bindings result ON result.event_id=e.event_id " +
    "WHERE w.owner_domain='libra' AND w.process_type='libra_intake' " +
      "AND w.process_id IN (SELECT process_id FROM fx_supporting_works WHERE owner_domain='libra' AND state IN ('admitted','ready','running','blocked')) " +
      "AND e.capability_ref='libra.intake.binding.resolve@1' ORDER BY w.process_id,e.event_id"
  ).map((row) => ({ ...row, result:JSON.parse(row.resultJson) }));
  const admissionCapacity = {
    openWorks: get("SELECT COUNT(*) AS count FROM fx_supporting_works WHERE state IN ('admitted','ready','running','blocked')"),
    openWorksByOwner: all("SELECT owner_domain AS ownerDomain,state,COUNT(*) AS count FROM fx_supporting_works WHERE state IN ('admitted','ready','running','blocked') GROUP BY owner_domain,state ORDER BY owner_domain,state"),
    openEvents: get("SELECT COUNT(*) AS count FROM fx_workflow_events WHERE state IN ('pending','ready','waiting_for_resource','waiting_for_external','waiting_for_approval','executing')"),
    circuits: all("SELECT circuit_key AS circuitKey,state,reason_code AS reasonCode,opened_at_ms AS openedAtMs,reviewed_at_ms AS reviewedAtMs FROM fx_circuit_states WHERE circuit_key IN ('foundation/work-admission','owner/libra/work-admission') ORDER BY circuit_key"),
  };
  const pipelineTokens = all(
    "SELECT token.subject_id AS subjectId,token.source_process_id AS sourceProcessId,token.acquired_at_ms AS acquiredAtMs," +
      "subject.status AS subjectStatus,COUNT(DISTINCT work.work_id) AS sourceWorkCount," +
      "COUNT(DISTINCT receipt.command_receipt_id) AS admissionReceiptCount," +
      "GROUP_CONCAT(DISTINCT receipt.target_id) AS admissionReceiptTargets," +
      "MIN(receipt.committed_at_ms) AS admissionReceiptCommittedAtMs," +
      "COUNT(DISTINCT receipt_work.work_id) AS admissionReceiptTargetWorkCount " +
    "FROM libra_predeck_pipeline_tokens token " +
      "LEFT JOIN libra_subjects subject ON subject.subject_id=token.subject_id " +
      "LEFT JOIN fx_supporting_works work ON work.owner_domain='libra' AND work.process_id=token.source_process_id " +
      "LEFT JOIN fx_command_receipts receipt ON receipt.owner_domain='libra' " +
        "AND receipt.command_contract='helix.foundation.work.submit@1' " +
        "AND receipt.caller_scope='libra:' || token.source_process_id || '/evidence' " +
      "LEFT JOIN fx_supporting_works receipt_work ON receipt_work.work_id=receipt.target_id " +
    "GROUP BY token.subject_id,token.source_process_id,token.acquired_at_ms,subject.status ORDER BY token.acquired_at_ms"
  );
  const handoffATerminalConflicts = all(
    "SELECT token.source_process_id AS intakeDecisionId,decision.offer_id AS offerId," +
      "delivery.state AS procurementDeliveryState,delivery.handoff_decision_id AS procurementDecisionId," +
      "delivery.handoff_receipt_id AS procurementReceiptId,delivery.handoff_receipt_digest AS procurementReceiptDigest," +
      "receipt.receipt_id AS libraReceiptId,receipt.receipt_digest AS libraReceiptDigest," +
      "inbox.message_id AS procurementInboxMessageId,inbox.dedup_key AS procurementInboxDedupKey," +
      "inbox.result_digest AS procurementInboxResultDigest " +
    "FROM libra_predeck_pipeline_tokens token " +
      "LEFT JOIN libra_intake_decisions decision ON decision.intake_decision_id=token.source_process_id " +
      "LEFT JOIN libra_handoff_a_receipts receipt ON receipt.intake_decision_id=decision.intake_decision_id " +
      "LEFT JOIN proc_candidate_deliveries delivery ON delivery.offer_id=decision.offer_id " +
      "LEFT JOIN fx_inbox inbox ON inbox.consumer_domain='procurement' AND inbox.dedup_key IN (" +
        "'libra_candidate_accepted:' || decision.offer_id,'libra_candidate_rejected:' || decision.offer_id) " +
    "WHERE delivery.state IN ('accepted','rejected') AND (" +
      "delivery.handoff_decision_id IS NOT receipt.intake_decision_id OR " +
      "delivery.handoff_receipt_id IS NOT receipt.receipt_id OR " +
      "delivery.handoff_receipt_digest IS NOT receipt.receipt_digest) " +
    "ORDER BY decision.offer_id"
  );
  const intakeControlFences = all(
    "SELECT token.source_process_id AS intakeDecisionId,delivery.offer_id AS offerId," +
      "member.candidate_package_id AS candidatePackageId,member.material_key AS materialKey," +
      "member.selection_state AS procurementSelectionState,member.terminal_disposition AS procurementTerminalDisposition," +
      "member.admitted_control_revision AS admittedControlRevision," +
      "member.admitted_control_projection_digest AS admittedControlProjectionDigest," +
      "member.expected_control_revision AS expectedControlRevision," +
      "member.expected_control_projection_digest AS expectedControlProjectionDigest," +
      "control.control_revision AS currentControlRevision,control.owner_domain AS currentOwnerDomain," +
      "control.owner_scope_type AS currentOwnerScopeType,control.owner_scope_id AS currentOwnerScopeId " +
    "FROM libra_predeck_pipeline_tokens token " +
      "JOIN proc_candidate_deliveries delivery ON delivery.handoff_decision_id=token.source_process_id " +
      "JOIN proc_run_materials member ON member.candidate_package_id=delivery.candidate_package_id " +
      "LEFT JOIN fx_material_controls control ON control.material_key=member.material_key " +
    "ORDER BY delivery.offer_id,member.ordinal"
  );
  const intakeControlRevisionHistory = all(
    "SELECT revision.material_key AS materialKey,revision.revision,revision.operation_kind AS operationKind," +
      "revision.from_owner_domain AS fromOwnerDomain,revision.from_scope_type AS fromScopeType,revision.from_scope_id AS fromScopeId," +
      "revision.to_owner_domain AS toOwnerDomain,revision.to_scope_type AS toScopeType,revision.to_scope_id AS toScopeId," +
      "revision.committed_at_ms AS committedAtMs " +
    "FROM fx_material_control_revisions revision WHERE revision.material_key IN (" +
      "SELECT member.material_key FROM libra_predeck_pipeline_tokens token " +
        "JOIN proc_candidate_deliveries delivery ON delivery.handoff_decision_id=token.source_process_id " +
        "JOIN proc_run_materials member ON member.candidate_package_id=delivery.candidate_package_id) " +
    "ORDER BY revision.material_key,revision.revision"
  );
  const phantomAdmissionReceipts = all(
    "SELECT receipt.owner_domain AS ownerDomain,COUNT(*) AS count," +
      "MIN(receipt.committed_at_ms) AS oldestCommittedAtMs,MAX(receipt.committed_at_ms) AS newestCommittedAtMs " +
    "FROM fx_command_receipts receipt LEFT JOIN fx_supporting_works work ON work.work_id=receipt.target_id " +
    "WHERE receipt.command_contract='helix.foundation.work.submit@1' AND work.work_id IS NULL " +
    "GROUP BY receipt.owner_domain ORDER BY receipt.owner_domain"
  );
  const phantomAdmissionReceiptKinds = all(
    "SELECT receipt.owner_domain AS ownerDomain," +
      "CASE WHEN receipt.target_id LIKE 'libra-intake-%' THEN 'libra_intake' " +
      "WHEN receipt.target_id LIKE 'libra-routing-%' THEN 'libra_routing' " +
      "WHEN receipt.target_id LIKE 'libra-acceptance-%' THEN 'libra_acceptance' " +
      "WHEN receipt.target_id LIKE 'libra-%' THEN 'libra_other' " +
      "WHEN receipt.target_id LIKE 'arca-%' THEN 'arca' ELSE 'other' END AS targetKind," +
      "COUNT(*) AS count,MIN(receipt.committed_at_ms) AS oldestCommittedAtMs,MAX(receipt.committed_at_ms) AS newestCommittedAtMs " +
    "FROM fx_command_receipts receipt LEFT JOIN fx_supporting_works work ON work.work_id=receipt.target_id " +
    "WHERE receipt.command_contract='helix.foundation.work.submit@1' AND work.work_id IS NULL " +
    "GROUP BY receipt.owner_domain,targetKind ORDER BY receipt.owner_domain,targetKind"
  );
  const intakeReconcileCursor = get(
    "SELECT revision,opaque_cursor AS opaqueCursor,updated_at_ms AS updatedAtMs FROM fx_reconcile_cursors " +
    "WHERE owner_domain='libra' AND reconciler_key='pending-intake-offers'"
  ) || null;
  const arcaExecuting = all(
    "SELECT w.work_id AS workId,w.process_id AS processId,w.work_kind AS workKind,e.event_id AS eventId," +
      "e.capability_ref AS capabilityRef,e.state AS eventState,ea.event_attempt_id AS eventAttemptId," +
      "ea.started_at_ms AS startedAtMs,x.effect_id AS effectId,x.state AS effectState,x.updated_at_ms AS effectUpdatedAtMs " +
    "FROM fx_supporting_works w JOIN fx_workflow_events e ON e.work_id=w.work_id " +
      "LEFT JOIN fx_event_attempts ea ON ea.event_id=e.event_id AND ea.state='executing' " +
      "LEFT JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id " +
    "WHERE w.owner_domain='arca' AND w.state IN ('admitted','ready','running','blocked') " +
      "AND e.state NOT IN ('succeeded','skipped','failed','cancelled') ORDER BY w.work_id,e.event_id"
  );
  const offloading = all(
    "SELECT r.on_deck_run_id AS onDeckRunId,c.on_deck_package_id AS packageId,p.subject_id AS subjectId " +
    "FROM arca_ondeck_runs r JOIN arca_ondeck_custodies c ON c.custody_id=r.custody_id " +
      "JOIN libra_product_packages p ON p.on_deck_package_id=c.on_deck_package_id " +
    "WHERE r.state='offloading' ORDER BY r.created_at_ms"
  );
  const materialReads = [];
  const inventoryCandidates = [];
  for (const run of offloading) {
    const materials = all(
      "SELECT ordinal,role,location_kind,location,workspace_handle_json,size_bytes AS expectedSizeBytes,content_fingerprint AS expectedFingerprint " +
      "FROM libra_product_package_materials WHERE on_deck_package_id=? ORDER BY ordinal",
      [run.packageId]
    );
    materialReads.push({ onDeckRunId:run.onDeckRunId, packageId:run.packageId,
      members:materials.map((material) => ({ ordinal:material.ordinal, role:material.role,
        expectedSizeBytes:material.expectedSizeBytes, ...boundedRead(materialLocation(material)) })) });
    const directories = [...new Set(materials.filter((material) => material.location_kind !== 'workspace_handle' && material.location)
      .map((material) => path.dirname(material.location)))];
    const expected = new Map(materials.map((material) => [material.expectedFingerprint, material]));
    const candidates = [];
    for (const directory of directories) {
      let entries = [];
      try { entries = fs.readdirSync(directory, { withFileTypes:true }).filter((entry) => entry.isFile()).slice(0, 256); }
      catch (error) { candidates.push({ directory, status:'error', code:error.code || error.name }); continue; }
      for (const entry of entries) {
        const observed = boundedFingerprint(path.join(directory, entry.name));
        const match = observed.contentFingerprint ? expected.get(observed.contentFingerprint) : null;
        candidates.push({ directory, name:entry.name, status:observed.status, sizeBytes:observed.sizeBytes,
          matchedPackageOrdinal:match ? match.ordinal : null, matchedPackageRole:match ? match.role : null });
      }
    }
    inventoryCandidates.push({ onDeckRunId:run.onDeckRunId, packageId:run.packageId, candidates });
  }
  console.log(JSON.stringify({ generatedAt:new Date().toISOString(), residuals, unsafeResiduals, residualChildren,
    activeAttempts, activeLibraWorks, activeLibraEvents, activeLibraInputBindings, activeIntakePayloads, admissionCapacity, pipelineTokens, handoffATerminalConflicts, intakeControlFences, intakeControlRevisionHistory, phantomAdmissionReceipts,
    phantomAdmissionReceiptKinds, intakeReconcileCursor,
    arcaExecuting, offloading, materialReads, inventoryCandidates }, null, 2));
} finally {
  database.close();
}
`;
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `docker exec shelfdeck sh -lc ${shellQuote(`echo ${encoded} | base64 -d | node`)}`;
}

function hostStorageCommand() {
  return [
    "stat -f -c 'filesystem=%T' /vol2/1000/shelfdeck_transcode 2>/dev/null || true",
    "find /vol2 -maxdepth 4 -type d \\( -iname '*snapshot*' -o -name '@Recycle' -o -name '#recycle' \\) -print 2>/dev/null | head -100",
    "btrfs subvolume list /vol2 2>/dev/null | head -100 || true",
    "find /vol2/1000/shelfdeck_transcode -maxdepth 2 -mindepth 1 -printf '%y %p %s\\n' 2>/dev/null | head -100",
  ].join('; ');
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('This diagnostic is read-only and does not support --apply.');
  const connection = new Client();
  await new Promise((resolve, reject) => {
    connection.on('ready', resolve);
    connection.on('error', reject);
    connection.connect(loadNasSshConfig({ readyTimeout:15000 }));
  });
  try {
    const result = await run(connection, remoteCommand());
    if (result.errorOutput) process.stderr.write(result.errorOutput);
    if (result.code !== 0) throw new Error(`Remote diagnostic exited ${result.code}.`);
    const storage = await run(connection, hostStorageCommand());
    if (storage.errorOutput) process.stderr.write(storage.errorOutput);
    if (storage.code !== 0) throw new Error(`Host storage diagnostic exited ${storage.code}.`);
    const report = JSON.parse(result.output);
    report.hostStorage = storage.output.trim().split(/\r?\n/).filter(Boolean);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    connection.end();
  }
}

main().catch((error) => {
  console.error(`PRODUCTION HELIX DIAGNOSTICS FAILED: ${error.message}`);
  process.exitCode = 1;
});
