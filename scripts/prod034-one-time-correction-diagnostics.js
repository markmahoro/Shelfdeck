'use strict';

/**
 * Read-only bounded diagnostics for the two PROD-034 correction targets.
 */

const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

const SUBJECT_PREFIXES = Object.freeze([
  'libra-subject-85679',
  'libra-subject-e8ec',
]);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(connection, command) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    connection.exec(command, { pty:true }, (error, stream) => {
      if (error) return reject(error);
      stream.on('close', (code) => resolve({ code, output, errorOutput }));
      stream.on('data', (chunk) => { output += chunk.toString(); });
      stream.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    });
  });
}

function remoteCommand() {
  const source = String.raw`
const Database = require('better-sqlite3');
const database = new Database('/app/data/shelfdeck.db', { readonly:true, fileMustExist:true });
const prefixes = ${JSON.stringify(SUBJECT_PREFIXES)};
const subjects = prefixes.flatMap((prefix) => database.prepare('SELECT subject_id FROM libra_subjects WHERE subject_id LIKE ?').all(prefix + '%').map((row) => row.subject_id));
const placeholders = subjects.map(() => '?').join(',');
const all = (sql, parameters = []) => database.prepare(sql).all(...parameters);
const one = (sql, parameters = []) => database.prepare(sql).get(...parameters);
try {
  const subjectRows = all('SELECT subject_id,status,intake_revision,created_at_ms,updated_at_ms,terminal_at_ms FROM libra_subjects WHERE subject_id IN (' + placeholders + ') ORDER BY subject_id', subjects);
  const runs = all('SELECT libra_run_id,subject_id,state,state_revision,state_digest,package_revision_head,created_at_ms,terminal_at_ms FROM libra_runs WHERE subject_id IN (' + placeholders + ') ORDER BY subject_id,created_at_ms', subjects);
  const runIds = runs.map((row) => row.libra_run_id);
  const runPlaceholders = runIds.map(() => '?').join(',') || "''";
  const runRevisions = runIds.length ? all('SELECT libra_run_id,state_revision,state,transition_kind,transition_decision_id,transition_evidence_schema_ref,committed_at_ms FROM libra_run_revisions WHERE libra_run_id IN (' + runPlaceholders + ') ORDER BY libra_run_id,state_revision', runIds) : [];
  const discardDecisions = runIds.length ? all('SELECT discard_decision_id,libra_run_id,actor_id,idempotency_key,decided_at_ms FROM libra_run_discard_decisions WHERE libra_run_id IN (' + runPlaceholders + ') ORDER BY libra_run_id', runIds) : [];
  const discardReceipts = runIds.length ? all('SELECT receipt_id,discard_decision_id,libra_run_id,committed_run_state_revision,committed_at_ms FROM libra_run_discard_receipts WHERE libra_run_id IN (' + runPlaceholders + ') ORDER BY libra_run_id', runIds) : [];
  const packages = runIds.length ? all('SELECT on_deck_package_id,offer_id,package_revision,libra_run_id,subject_id,package_digest,state,published_at_ms FROM libra_product_packages WHERE libra_run_id IN (' + runPlaceholders + ') ORDER BY libra_run_id,package_revision', runIds) : [];
  const packageIds = packages.map((row) => row.on_deck_package_id);
  const offerIds = packages.map((row) => row.offer_id);
  const packagePlaceholders = packageIds.map(() => '?').join(',') || "''";
  const offerPlaceholders = offerIds.map(() => '?').join(',') || "''";
  const acceptanceAttempts = offerIds.length ? all('SELECT * FROM arca_acceptance_attempts WHERE offer_id IN (' + offerPlaceholders + ') ORDER BY offer_id', offerIds) : [];
  const acceptanceDecisions = offerIds.length ? all('SELECT * FROM arca_acceptance_decisions WHERE offer_id IN (' + offerPlaceholders + ') ORDER BY offer_id', offerIds) : [];
  const handoffReceipts = offerIds.length ? all('SELECT * FROM arca_handoff_b_receipts WHERE offer_id IN (' + offerPlaceholders + ') ORDER BY offer_id', offerIds) : [];
  const deliveryReceipts = offerIds.length ? all('SELECT * FROM libra_delivery_receipts WHERE offer_id IN (' + offerPlaceholders + ') ORDER BY offer_id', offerIds) : [];
  const custodyIds = handoffReceipts.map((row) => row.custody_id).filter(Boolean);
  const custodyPlaceholders = custodyIds.map(() => '?').join(',') || "''";
  const custodies = custodyIds.length ? all('SELECT * FROM arca_ondeck_custodies WHERE custody_id IN (' + custodyPlaceholders + ') ORDER BY custody_id', custodyIds) : [];
  const onDeckRuns = custodyIds.length ? all('SELECT * FROM arca_ondeck_runs WHERE custody_id IN (' + custodyPlaceholders + ') ORDER BY custody_id,created_at_ms', custodyIds) : [];
  const onDeckRunIds = onDeckRuns.map((row) => row.on_deck_run_id);
  const onDeckPlaceholders = onDeckRunIds.map(() => '?').join(',') || "''";
  const finalInventoryDecisions = onDeckRunIds.length ? all('SELECT * FROM arca_final_inventory_decisions WHERE on_deck_run_id IN (' + onDeckPlaceholders + ') ORDER BY on_deck_run_id', onDeckRunIds) : [];
  const settlementApprovals = onDeckRunIds.length ? all('SELECT * FROM arca_ondeck_settlement_approvals WHERE on_deck_run_id IN (' + onDeckPlaceholders + ') ORDER BY on_deck_run_id', onDeckRunIds) : [];
  const bindings = custodyIds.length ? all("SELECT owner_object_type,owner_object_id,material_key,role,authority_kind,binding_revision,health_state,current FROM arca_material_bindings WHERE owner_object_type='on_deck_custody' AND owner_object_id IN (" + custodyPlaceholders + ') ORDER BY owner_object_id,material_key,role,binding_revision', custodyIds) : [];
  const scopeIds = [...new Set([...subjects, ...runIds, ...packageIds, ...custodyIds])];
  const scopePlaceholders = scopeIds.map(() => '?').join(',') || "''";
  const controls = scopeIds.length ? all('SELECT * FROM fx_material_controls WHERE owner_scope_id IN (' + scopePlaceholders + ') ORDER BY owner_scope_id,material_key', scopeIds) : [];
  const materialKeys = controls.map((row) => row.material_key);
  const materialPlaceholders = materialKeys.map(() => '?').join(',') || "''";
  const controlRevisions = materialKeys.length ? all('SELECT * FROM fx_material_control_revisions WHERE material_key IN (' + materialPlaceholders + ') ORDER BY material_key,revision', materialKeys) : [];
  const projections = all('SELECT subject_id,projection_revision,classification,subject_status,display_identity,next_action_label,next_action_state,current_libra_run_id,current_package_id,current_offer_id,updated_at_ms FROM libra_formation_projections WHERE subject_id IN (' + placeholders + ') ORDER BY subject_id', subjects);
  const pipelineTokens = all('SELECT * FROM libra_predeck_pipeline_tokens WHERE subject_id IN (' + placeholders + ') ORDER BY subject_id', subjects);
  const works = [...(runIds.length ? all('SELECT work_id,owner_domain,process_type,process_id,work_kind,state,created_at_ms,updated_at_ms FROM fx_supporting_works WHERE process_id IN (' + runPlaceholders + ') ORDER BY process_id,created_at_ms', runIds) : []),
    ...(onDeckRunIds.length ? all('SELECT work_id,owner_domain,process_type,process_id,work_kind,state,created_at_ms,updated_at_ms FROM fx_supporting_works WHERE process_id IN (' + onDeckPlaceholders + ') ORDER BY process_id,created_at_ms', onDeckRunIds) : [])];
  const activeAttempts = one("SELECT COUNT(*) AS count FROM fx_work_attempts WHERE state IN ('ready','running','blocked')");
  const integrity = one('PRAGMA integrity_check');
  const bindingSummary = custodyIds.map((custodyId) => ({ custodyId,
    total:bindings.filter((row) => row.owner_object_id === custodyId).length,
    current:bindings.filter((row) => row.owner_object_id === custodyId && Number(row.current) === 1).length,
    active:bindings.filter((row) => row.owner_object_id === custodyId && row.health_state === 'active').length,
    released:bindings.filter((row) => row.owner_object_id === custodyId && row.health_state === 'released').length }));
  const workSummary = works.reduce((result, row) => {
    const key = row.owner_domain + ':' + row.process_id + ':' + row.state;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  console.log(JSON.stringify({ generatedAt:new Date().toISOString(), subjects:subjectRows, runs, runRevisions,
    discardDecisions, discardReceipts, packages,
    deliveryReceipts:deliveryReceipts.map((row) => ({ offerId:row.offer_id,packageId:row.on_deck_package_id,result:row.result,custodyId:row.custody_id })),
    acceptanceAttempts:acceptanceAttempts.map((row) => ({ offerId:row.offer_id,state:row.state,attemptId:row.acceptance_attempt_id })),
    acceptanceDecisions:acceptanceDecisions.map((row) => ({ offerId:row.offer_id,result:row.result,decisionId:row.acceptance_decision_id })),
    handoffReceipts:handoffReceipts.map((row) => ({ offerId:row.offer_id,outcome:row.outcome,custodyId:row.custody_id,receiptId:row.receipt_id })),
    custodies, onDeckRuns, finalInventoryDecisions:finalInventoryDecisions.map((row) => ({ onDeckRunId:row.on_deck_run_id,decisionId:row.final_inventory_decision_id })),
    settlementApprovals, bindingSummary, controls, projections, pipelineTokens, workSummary, activeAttempts, integrity }, null, 2));
} finally { database.close(); }
`;
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `docker exec shelfdeck sh -lc ${shellQuote(`echo ${encoded} | base64 -d | node`)}`;
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('This diagnostic is read-only.');
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
    process.stdout.write(result.output);
  } finally { connection.end(); }
}

main().catch((error) => {
  console.error(`PROD-034 DIAGNOSTICS FAILED: ${error.message}`);
  process.exitCode = 1;
});
