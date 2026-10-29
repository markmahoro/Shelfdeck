'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createMaterialFieldStore } = require('../../src/helix/domains/procurement/persistence/material-field-store');
const { createProcurementFieldStatusQuery } = require('../../src/helix/domains/procurement/application/field-procurement-status-query');
const { createWorkResultReader } = require('../../src/helix/foundation/execution/work-result-reader');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-field-scan-'));
  let now = 1_700_040_000_000;
  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(root, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest,
    now: () => now++,
  });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createMaterialFieldStore({ schemaManifest, unitOfWork });
  const workResultReader = createWorkResultReader({ schemaManifest, unitOfWork });
  const query = createProcurementFieldStatusQuery({ schemaManifest, unitOfWork, workResultReader });
  try { return run({ store, kernel, query }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function registration() {
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const accessBasis = {
    fieldId: 'field-1',
    revision: 1,
    endpointId: 'endpoint-1',
    rootLocation: '/media/field-1',
    mountScopeId: 'mount-1',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/field-access/v1',
  };
  return {
    fieldId: 'field-1',
    name: 'Field One',
    contentProfileHint: 'movie',
    policy: {
      extractionPolicyId: 'policy-1',
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest({ extractionPolicyId: 'policy-1', revision: 1, ...policyValue }),
    },
    access: { ...accessBasis, accessDigest: canonicalDigest(accessBasis) },
  };
}

function insertWork(kernel, workId, state, createdAtMs = 1) {
  kernel.runPrimitive((context) => {
    context.prepare(
      'INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    ).run(workId, 'procurement', 'material_field', 'field-1', 'field_observation', 'a'.repeat(64), 'background_observation', state, 'key-' + workId, createdAtMs, createdAtMs);
  });
}

function insertPage(kernel, workId, revision, pageOrdinal, completed) {
  kernel.runPrimitive((context) => {
    context.prepare(
      'INSERT INTO fx_commit_markers(commit_marker,owner_domain,scope_type,scope_id,commit_digest,committed_at_ms) VALUES(?,?,?,?,?,?)'
    ).run('marker-' + revision, 'procurement', 'material_field_observation', 'field-1', 'f'.repeat(64), 1_700_040_000_000);
    context.prepare(
      'INSERT INTO proc_field_observations(field_id,revision,observation_id,field_observation_work_id,access_revision,content_profile_hint,profile_hint_revision,profile_hint_digest,page_ordinal,expected_revision,cursor_in,cursor_out,page_digest,fact_digest,commit_marker,result_digest,observed_at_ms,completed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      'field-1', revision, 'obs-' + revision, workId, 1, 'movie', 1, 'b'.repeat(64),
      pageOrdinal, revision - 1, pageOrdinal === 0 ? null : 'cursor-' + (pageOrdinal - 1), 'cursor-' + pageOrdinal,
      'c'.repeat(64), 'd'.repeat(64), 'marker-' + revision, 'e'.repeat(64), 1_700_040_000_000, completed,
    );
    context.prepare(
      'UPDATE proc_material_fields SET current_observation_revision=? WHERE field_id=?'
    ).run(revision, 'field-1');
  });
}

function setWorkState(kernel, workId, state) {
  kernel.runPrimitive((context) => {
    context.prepare('UPDATE fx_supporting_works SET state=? WHERE work_id=?').run(state, workId);
  });
}

test('Field status projects waiting, scanning, and completed Observation, not latest Candidate Handoff', () => fixture(({ store, kernel, query }) => {
  store.registerMaterialField(registration());
  const waiting = query.read('field-1');
  assert.equal(waiting.observationScan.state, 'waiting');
  assert.equal(waiting.observationScan.inProgress, false);
  assert.equal(waiting.observationScan.pageCount, 0);
  assert.equal(waiting.stage, 'not_started');
  assert.deepEqual({
    generated: waiting.generatedPackageCount,
    accepted: waiting.acceptedPackageCount,
    waiting: waiting.waitingAcceptanceCount,
    rejected: waiting.rejectedPackageCount,
  }, { generated: 0, accepted: 0, waiting: 0, rejected: 0 });

  insertWork(kernel, 'work-scan', 'running');
  const scanning = query.read('field-1');
  assert.equal(scanning.observationScan.state, 'scanning');
  assert.equal(scanning.observationScan.inProgress, true);
  assert.equal(scanning.observationScan.accessAvailable, true);

  insertPage(kernel, 'work-scan', 1, 0, 0);
  insertPage(kernel, 'work-scan', 2, 1, 1);
  setWorkState(kernel, 'work-scan', 'succeeded');
  const completed = query.read('field-1');
  assert.equal(completed.observationScan.state, 'completed');
  assert.equal(completed.observationScan.pageCount, 2);
  assert.equal(completed.observationScan.observationRevision, 2);
  assert.equal(completed.observationScan.inProgress, false);
  assert.equal(completed.stage, 'not_started');
}));

test('Field status projects a failed Observation with a readable missing-root reason', () => fixture(({ store, kernel, query }) => {
  store.registerMaterialField(registration());
  insertWork(kernel, 'work-failed', 'failed');
  kernel.runPrimitive((context) => {
    context.prepare(
      'INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code) VALUES(?,?,?,?,?,?,?,?)'
    ).run('attempt-failed', 'work-failed', 1, 'a'.repeat(64), 'failed', 1, 2, 'FIELD_OBSERVATION_ROOT_UNAVAILABLE');
  });
  const failed = query.read('field-1');
  assert.equal(failed.observationScan.state, 'failed');
  assert.equal(failed.observationScan.inProgress, false);
  assert.equal(failed.observationScan.accessAvailable, false);
  assert.equal(failed.observationScan.failureCode, 'FIELD_OBSERVATION_ROOT_UNAVAILABLE');
  assert.match(failed.observationScan.failureMessage, /不存在或当前不可读取/);
  assert.equal(query.overviewScan('field-1').accessAvailable, false);
}));

for (const [code,message] of [
  ['P7_FIELD_ACCESS_EXPIRED','扫描超时'],
  ['COOPERATIVE_EXECUTION_DEADLINE_EXCEEDED','扫描超时'],
  ['FIELD_OBSERVATION_IO_DEADLINE_EXCEEDED','读取文件超时'],
  ['UNRECOGNIZED_SCAN_FAILURE',undefined],
  [null,undefined],
]) test(`latest zero-page failure reports its own progress and cause: ${code}`, () => fixture(({store,kernel,query}) => {
  store.registerMaterialField(registration());
  insertWork(kernel,'old-success','succeeded');
  insertPage(kernel,'old-success',1,0,1);
  insertWork(kernel,'latest-failure','failed',2);
  kernel.runPrimitive(context=>context.prepare(
    'INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code) VALUES(?,?,?,?,?,?,?,?)'
  ).run('latest-attempt','latest-failure',1,'a'.repeat(64),'failed',2,3,code));
  const failed=query.read('field-1').observationScan;
  assert.equal(failed.state,'failed');assert.equal(failed.pageCount,0);
  assert.equal(failed.failureMessage,message);assert.equal(failed.accessAvailable,true);
  assert.equal(query.overviewScan('field-1').accessAvailable,true);
  insertWork(kernel,'next-scan','running',3);
  const scanning=query.read('field-1').observationScan;
  assert.equal(scanning.state,'scanning');assert.equal(scanning.pageCount,0);
  assert.equal(scanning.failureMessage,undefined);
  insertPage(kernel,'next-scan',2,0,1);setWorkState(kernel,'next-scan','succeeded');
  const completed=query.read('field-1').observationScan;
  assert.equal(completed.state,'completed');assert.equal(completed.pageCount,1);
  assert.equal(completed.failureMessage,undefined);
}));


test('administratively retired Candidates stay in history but never count as waiting acceptance',()=>fixture(({store,kernel,query})=>{
  store.registerMaterialField(registration());
  kernel.runPrimitive(context=>{
    for(const [index,state] of ['open','accepted','rejected','administratively_retired'].entries()){
      const id='package-'+index;
      context.prepare("INSERT INTO proc_procurement_runs(procurement_run_id,field_id,state) VALUES (?, 'field-1','sealed')").run(id);
      context.prepare("INSERT INTO proc_candidate_packages(candidate_package_id,procurement_run_id,field_id,published_at_ms) VALUES (?,?,'field-1',?)").run(id,id,index+1);
      context.prepare('INSERT INTO proc_candidate_deliveries(offer_id,candidate_package_id,state) VALUES (?,?,?)').run(id,id,state);
    }
  });
  const result=query.read('field-1');
  assert.equal(result.generatedPackageCount,4);assert.equal(result.acceptedPackageCount,1);assert.equal(result.rejectedPackageCount,1);
  assert.equal(result.waitingAcceptanceCount,1);assert.equal(query.overviewWaitingCount(),1);
  assert.equal(result.stage,'administratively_retired');assert.equal(result.delivery.state,'administratively_retired');
}));
