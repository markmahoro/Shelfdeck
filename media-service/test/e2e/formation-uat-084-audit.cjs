'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Arguments must use --name value pairs.');
    }
    values[key.slice(2)] = value;
  }
  return values;
}

async function jsonRequest(baseUrl, apiKey, endpoint) {
  const response = await fetch(new URL(endpoint, baseUrl), {
    headers: { 'x-api-key':apiKey },
  });
  if (response.status !== 200) {
    throw new Error(`Formation audit request failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function unique(values) {
  return [...new Set(values)].sort();
}

function createDatabaseEvidence(database) {
  const latestFailedAttempt = database.prepare(`
    SELECT w.work_id,w.work_kind,w.state AS work_state,a.failure_code,a.ordinal
    FROM fx_supporting_works w
    JOIN fx_work_attempts a ON a.work_id=w.work_id
    WHERE w.process_id=? AND w.owner_domain='libra'
      AND w.state IN ('failed','cancelled')
    ORDER BY w.updated_at_ms DESC,a.ordinal DESC
    LIMIT 1`);
  const conformanceWork = database.prepare(`
    SELECT work_id,work_kind,state
    FROM fx_supporting_works
    WHERE process_id=? AND owner_domain='libra'
      AND work_kind='product_conformance' AND state='succeeded'
    ORDER BY updated_at_ms DESC
    LIMIT 1`);
  const conformanceResult = database.prepare(`
    SELECT b.result_json,b.result_digest,e.event_id,e.capability_ref
    FROM fx_workflow_events e
    JOIN fx_event_result_bindings b ON b.event_id=e.event_id
    WHERE e.work_id=? AND e.capability_ref='libra.product.conformance.verify@1'
    LIMIT 1`);
  const openWorkCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM fx_supporting_works
    WHERE process_id=? AND state IN ('ready','running','blocked')`);
  const runForOffer = database.prepare(`
    SELECT libra_run_id
    FROM libra_product_packages
    WHERE offer_id=?
    LIMIT 1`);
  return Object.freeze({
    runIdFor(detail) {
      if (detail.currentRun?.libraRunId) return detail.currentRun.libraRunId;
      if (detail.handoffB?.offerId) return runForOffer.get(detail.handoffB.offerId)?.libra_run_id || null;
      return null;
    },
    blocker(runId) {
      if (!runId) return null;
      const failed = latestFailedAttempt.get(runId);
      if (failed) return Object.freeze({
        workId:failed.work_id,
        workKind:failed.work_kind,
        workState:failed.work_state,
        failureCode:failed.failure_code || 'work_cancelled',
      });
      const work = conformanceWork.get(runId);
      if (!work) return null;
      const binding = conformanceResult.get(work.work_id);
      if (!binding) return null;
      const result = JSON.parse(binding.result_json);
      if (result.result === 'passed') return null;
      return Object.freeze({
        workId:work.work_id,
        workKind:work.work_kind,
        workState:work.state,
        failureCode:result.unmetRequirementCodes?.[0] ||
          result.reasonCodes?.[0] || result.reasonCode ||
          'product_conformance_failed',
        resultDigest:binding.result_digest,
      });
    },
    openWorkCount(runId) {
      return runId ? Number(openWorkCount.get(runId).count) : 0;
    },
  });
}

function auditRow(detail, databaseEvidence) {
  const runId = databaseEvidence.runIdFor(detail);
  const blocker = databaseEvidence.blocker(runId);
  const baseUats = ['UAT-079','UAT-080','UAT-082','UAT-084'];
  const blockedStep = detail.organizingSteps?.find((item) => item.state === 'blocked') || null;
  let category, domainStage, lastValidFact, rootCause, recoveryAction, mappedUats;

  if (detail.classification === 'completed') {
    assert.equal(detail.arcaStatus?.stage, 'completed');
    assert.ok(detail.arcaStatus?.shelfEntryId);
    assert.equal(blocker, null, 'Completed Formation row has a terminal business or executor failure.');
    category = 'completed';
    domainStage = 'Arca / On-deck Commit';
    lastValidFact = 'Shelf Entry and Deck Fact committed';
    rootCause = null;
    recoveryAction = 'none';
    mappedUats = [...baseUats,'UAT-081'];
  } else if (detail.executorIssue?.owner === 'arca') {
    assert.equal(detail.executorIssue.canRetry, true);
    category = 'arca_acceptance_failure';
    domainStage = 'Arca / Shelf Acceptance';
    lastValidFact = 'Libra Product Package published; Handoff B Offer remains open';
    rootCause = detail.executorIssue.errorCode;
    recoveryAction = 'retry_acceptance';
    mappedUats = [...baseUats,'UAT-081'];
  } else if (detail.productIdentityIssue) {
    assert.equal(detail.currentRun?.state, 'active');
    category = 'identity_confirmation_required';
    domainStage = 'Libra / Product Identity';
    lastValidFact = 'Identity Evidence Result and provider candidate set recorded';
    rootCause = detail.productIdentityIssue.reasonCode;
    recoveryAction = 'choose_product_identity_or_discard';
    mappedUats = [...baseUats,'UAT-074','UAT-075'];
  } else if (detail.currentRun?.state === 'frozen' && blocker) {
    category = blocker.workKind === 'artifact_production'
      ? 'historical_artifact_handle_failure'
      : blocker.workKind === 'product_conformance'
        ? 'product_conformance_failure'
        : 'historical_executor_failure';
    domainStage = blocker.workKind === 'artifact_production'
      ? 'Libra / Artifact Production'
      : blocker.workKind === 'product_conformance'
        ? 'Libra / Product Conformance'
        : 'Libra / Product Identity';
    lastValidFact = blocker.workKind === 'artifact_production'
      ? 'Product Metadata committed; independent NFO result may already be durable'
      : blocker.workKind === 'product_conformance'
        ? 'Workspace product and Product Conformance Evidence Result committed'
        : 'Related NFO identity observation committed';
    rootCause = blocker.failureCode;
    recoveryAction = 'discard_current_run_then_reprocure';
    mappedUats = blocker.workKind === 'artifact_production'
      ? [...baseUats,'UAT-076','UAT-077']
      : blocker.workKind === 'product_conformance'
        ? [...baseUats,'UAT-081']
        : [...baseUats,'UAT-077','UAT-078'];
  } else {
    throw new Error('Formation row has no auditable user state: ' + detail.displayIdentity);
  }

  if (detail.classification === 'in_progress') {
    assert.equal(detail.currentRun?.state, 'active');
    assert.ok(databaseEvidence.openWorkCount(runId) > 0,
      'Formation row is in progress without open Work.');
  }
  if (detail.classification === 'completed') {
    assert.notEqual(rootCause, 'product_conformance_failed');
  }
  if (detail.myRating === null) {
    assert.ok(detail.ratingState || detail.ratingReasonCode,
      'Missing rating lacks an explicit resolution state or reason.');
  }

  return Object.freeze({
    formationViewId:detail.formationViewId,
    displayIdentity:detail.displayIdentity,
    userState:detail.nextAction?.label || detail.classification,
    classification:detail.classification,
    domainStage,
    lastValidFact,
    rootCause,
    recoveryAction,
    runId,
    runState:detail.currentRun?.state || null,
    blockedStep:blockedStep?.label || null,
    ratingState:detail.ratingState || null,
    ratingReasonCode:detail.ratingReasonCode || null,
    mappedUats:unique(mappedUats),
    category,
  });
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const runtimePath = path.resolve(args.runtime || '');
  const databasePath = path.resolve(args.database || '');
  const outputPath = path.resolve(args.output || '');
  const baseUrl = args['base-url'];
  assert.ok(baseUrl && /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(baseUrl),
    'Audit base URL must be a local ShelfDeck service.');
  assert.ok(runtimePath && databasePath && outputPath,
    'Audit requires runtime, database, and output paths.');
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  assert.ok(typeof runtime.adminApiKey === 'string' && runtime.adminApiKey);

  const [active, completed] = await Promise.all([
    jsonRequest(baseUrl, runtime.adminApiKey, '/v1/admin/formation?section=active&limit=100'),
    jsonRequest(baseUrl, runtime.adminApiKey, '/v1/admin/formation?section=completed&limit=100'),
  ]);
  const summaries = [active.summary, completed.summary];
  for (const summary of summaries) assert.equal(summary.totalCount, 25);
  const listItems = [...active.items, ...completed.items];
  assert.equal(listItems.length, 25, 'Every current Formation row must be returned exactly once.');
  assert.equal(new Set(listItems.map((item) => item.formationViewId)).size, 25);

  const details = [];
  for (const item of listItems) {
    details.push(await jsonRequest(baseUrl, runtime.adminApiKey,
      '/v1/admin/formation/' + encodeURIComponent(item.formationViewId)));
  }
  const database = new Database(databasePath, { readonly:true, fileMustExist:true });
  let rows;
  try {
    const databaseEvidence = createDatabaseEvidence(database);
    rows = details.map((detail) => auditRow(detail, databaseEvidence));
  } finally {
    database.close();
  }

  const categoryCounts = Object.fromEntries([...new Set(rows.map((row) => row.category))]
    .sort().map((category) => [category, rows.filter((row) => row.category === category).length]));
  assert.deepEqual(categoryCounts, {
    arca_acceptance_failure:1,
    completed:1,
    historical_artifact_handle_failure:9,
    historical_executor_failure:1,
    identity_confirmation_required:12,
    product_conformance_failure:1,
  });
  assert.equal(rows.filter((row) => row.classification === 'in_progress').length, 0);
  assert.equal(rows.filter((row) => row.classification === 'completed' && row.rootCause).length, 0);

  const evidence = Object.freeze({
    schema:'shelfdeck.uat-084-formation-audit@1',
    result:'PASS',
    generatedAt:new Date().toISOString(),
    service:{ baseUrl, rowCount:rows.length },
    summary:active.summary,
    categoryCounts,
    assertions:Object.freeze({
      everyCurrentRowExplained:true,
      noIdleInProgressRows:true,
      noFailedRowsReportedCompleted:true,
      everyAttentionRowHasRecoveryAction:true,
      missingRatingsExposeStateOrReason:true,
      credentialsExcluded:true,
    }),
    rows:Object.freeze(rows.sort((left, right) =>
      left.displayIdentity.localeCompare(right.displayIdentity, 'zh-CN') ||
      left.formationViewId.localeCompare(right.formationViewId))),
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive:true });
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    result:evidence.result,
    rows:evidence.service.rowCount,
    categoryCounts:evidence.categoryCounts,
    output:outputPath,
  }) + '\n');
}

main().catch((error) => {
  process.stderr.write((error?.stack || String(error)) + '\n');
  process.exitCode = 1;
});
