'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const sourceRoot = process.env.HELIX_MOVIE_TEST_LIBRARY_ROOT
  ? path.resolve(process.env.HELIX_MOVIE_TEST_LIBRARY_ROOT)
  : null;

async function authenticate(host, apiKey) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey } });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

function snapshot(databasePath) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const scalar = (sql) => database.prepare(sql).get().count;
    const releasedDetails = database.prepare("SELECT field_relative_location fieldRelativeLocation,terminal_disposition terminalDisposition FROM proc_run_materials WHERE selection_state='released' ORDER BY field_relative_location").all();
    return Object.freeze({
      runs:scalar('SELECT count(*) count FROM proc_procurement_runs'),
      sealedRuns:scalar("SELECT count(*) count FROM proc_procurement_runs WHERE state='sealed'"),
      openWorks:scalar("SELECT count(*) count FROM fx_supporting_works WHERE state IN ('admitted','ready','running','blocked')"),
      failedWorks:scalar("SELECT count(*) count FROM fx_supporting_works WHERE state='failed'"),
      failedEvents:scalar("SELECT count(*) count FROM fx_workflow_events WHERE state='failed'"),
      candidates:scalar('SELECT count(*) count FROM proc_candidate_packages'),
      offers:scalar("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='open'"),
      bdmvCandidates:scalar("SELECT count(*) count FROM proc_candidate_packages WHERE material_input_form='bdmv'"),
      bdmvAssessments:scalar("SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='procurement.triage.bdmv.assess@1'"),
      releasedTriageFailures:scalar("SELECT count(*) count FROM proc_run_materials WHERE selection_state='released' AND terminal_disposition='triage_failed'"),
      overflowFailures:scalar("SELECT count(*) count FROM proc_run_materials WHERE terminal_disposition='triage_failed' AND terminal_evidence_digest IS NOT NULL AND field_relative_location LIKE 'SDT-G10-%'"),
      releasedDetails:Object.freeze(releasedDetails),
    });
  } finally { database.close(); }
}

test('generated Movie test library reaches Handoff A Ready without a Process-local failure faulting the Runtime', {
  skip:sourceRoot === null ? 'Set HELIX_MOVIE_TEST_LIBRARY_ROOT to run the local read-only vertical fixture.' : false,
  timeout:240_000,
}, async (t) => {
  assert.equal(fs.statSync(sourceRoot).isDirectory(), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-movie-test-procurement-'));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir, { recursive:true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const secretRoot = 'movie-test-library-' + crypto.randomUUID();
  const initialized = initializeCleanData({
    dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  let runtimeError = null;
  const host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    onExecutionRuntimeError(error) { runtimeError = error; },
  });
  t.after(async () => {
    await host.close();
    fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await authenticate(host, initialized.adminApiKey);
  const fieldId = 'movie-test-field';
  const policyValue = Object.freeze({
    includedDirectories:[],
    excludedDirectories:[],
    allowedExtensions:['.avi','.bdmv','.clpi','.m2ts','.m4v','.mkv','.mov','.mp4','.mpls','.ts','.wmv'],
    minimumSizeBytes:0,
    excludedMaterialKeys:[],
  });
  const policyBasis = Object.freeze({ extractionPolicyId:'movie-test-policy', revision:1, ...policyValue });
  const accessBasis = Object.freeze({
    fieldId,
    revision:1,
    endpointId:'movie-test-endpoint',
    rootLocation:sourceRoot,
    mountScopeId:'movie-test-mount',
    mountScopeRevision:1,
    accessSchemaRef:'helix://fixtures/movie-test-library-access/v1',
  });
  const created = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers:{ cookie }, payload:{
    idempotencyKey:'movie-test-register',
    fieldId,
    name:'Movie Test Field',
    contentProfileHint:'movie',
    policy:{
      extractionPolicyId:policyBasis.extractionPolicyId,
      revision:1,
      policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy:policyValue,
      policyDigest:canonicalDigest(policyBasis),
    },
    access:{ ...accessBasis, accessDigest:canonicalDigest(accessBasis) },
  }});
  assert.equal(created.statusCode, 201, created.body);
  const observed = await host.inject({ method:'POST', url:`/v1/admin/material-fields/${fieldId}/actions/observe`, headers:{ cookie }, payload:{
    idempotencyKey:'movie-test-observe',
    fieldId,
    expectedAccessRevision:1,
    expectedObservationRevision:0,
    pageBudget:256,
  }});
  assert.equal(observed.statusCode, 202, observed.body);

  const deadline = Date.now() + 220_000;
  let facts = snapshot(databasePath);
  while (Date.now() < deadline && !runtimeError && !(facts.runs > 0 && facts.sealedRuns === facts.runs && facts.openWorks === 0)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    facts = snapshot(databasePath);
  }

  assert.ifError(runtimeError);
  const { releasedDetails, ...coreFacts } = facts;
  assert.deepEqual(coreFacts, {
    runs:1,
    sealedRuns:1,
    openWorks:0,
    failedWorks:1,
    failedEvents:0,
    candidates:17,
    offers:17,
    bdmvCandidates:3,
    bdmvAssessments:3,
    releasedTriageFailures:7,
    overflowFailures:1,
  });
  assert.equal(releasedDetails.some((item) => item.fieldRelativeLocation.startsWith('SDT-G10-')), true);
  t.diagnostic(`movie-test-library Procurement facts: ${JSON.stringify(facts)}`);
});
