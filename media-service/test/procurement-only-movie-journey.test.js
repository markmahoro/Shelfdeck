'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const secretRoot = 'procurement-only-movie-secret-root-20260802';

function mediaProbe() {
  return Object.freeze({
    async probe(readHandle) {
      if (String(readHandle.location || '').includes('Unplayable')) {
        return Object.freeze({ resultKind:'not_media', reasonCode:'fixture_not_media', sizeBytes:Number(readHandle.expectedSizeBytes) });
      }
      const result = {
        resultKind: 'probed',
        sourceHandleDigest: canonicalDigest(readHandle),
        durationMs: 1_000,
        videoStreams: [{
          streamIndex: 0,
          codec: 'hevc',
          dispositionDefault: true,
          width: 1920,
          height: 1080,
        }],
        audioStreams: [],
        subtitleStreams: [],
        discTopology: null,
        payloadDigest: '',
      };
      result.payloadDigest = canonicalDigest(Object.fromEntries(
        Object.entries(result).filter(([key]) => key !== 'payloadDigest'),
      ));
      return Object.freeze(result);
    },
  });
}

async function session(host, apiKey) {
  const response = await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

test('one bad Material is released while 65 Movie Candidates cross Handoff A through durable Libra Intake Work', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-procurement-only-'));
  t.after(() => {
    if (process.env.HELIX_KEEP_TEST_DATA === '1') process.stderr.write(`preserved=${root}\n`);
    else fs.rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const sourceRoot = path.join(root, 'movie-source');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const sourceBytes = Buffer.from('read-only-procurement-fixture');
  const sourcePaths = Array.from({ length: 65 }, (_unused, ordinal) => path.join(sourceRoot,
    `Example.Movie.${String(ordinal + 1).padStart(3, '0')}.2024.mkv`));
  sourcePaths.push(path.join(sourceRoot, 'Unplayable.Material.mkv'));
  for (const sourcePath of sourcePaths) fs.writeFileSync(sourcePath, sourceBytes);
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'procurement-only-policy',
    revision: 1,
    ...policyValue,
  };
  const accessBasis = {
    fieldId: 'procurement-only-field',
    revision: 1,
    endpointId: 'procurement-only-endpoint',
    rootLocation: sourceRoot,
    mountScopeId: 'procurement-only-mount',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/procurement-only-access/v1',
  };
  const registration = {
    idempotencyKey: 'procurement-only-register',
    fieldId: accessBasis.fieldId,
    name: 'Procurement Only Movie Field',
    contentProfileHint: 'movie',
    policy: {
      extractionPolicyId: policyBasis.extractionPolicyId,
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...accessBasis, accessDigest: canonicalDigest(accessBasis) },
  };
  const observation = {
    idempotencyKey: 'procurement-only-observe',
    fieldId: accessBasis.fieldId,
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 8,
  };

  let runtimeError = null;
  let observationWorkId = null;
  let preRestartResultCount = 0;
  let earlyCandidateCount = 0;
  let host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe: mediaProbe(),
    onExecutionRuntimeError(error) { runtimeError = error; },
  });
  try {
    const cookie = await session(host, initialized.adminApiKey);
    const created = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: registration,
    });
    assert.equal(created.statusCode, 201, created.body);
    const prepared = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${accessBasis.fieldId}/actions/observe`,
      headers: { cookie },
      payload: observation,
    });
    assert.equal(prepared.statusCode, 202, prepared.body);
    assert.equal(prepared.json().observation.state, 'admitted');
    assert.equal(prepared.json().observation.replayed, false);
    observationWorkId = prepared.json().observation.observationWorkId;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
      earlyCandidateCount = database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count;
      const runState = database.prepare('SELECT state FROM proc_procurement_runs LIMIT 1').get()?.state || null;
      preRestartResultCount=database.prepare('SELECT count(*) count FROM fx_event_result_bindings').get().count;
      database.close();
      if (runtimeError || earlyCandidateCount > 0 && earlyCandidateCount < 65 && runState === 'active') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ifError(runtimeError);
    assert.ok(earlyCandidateCount > 0 && earlyCandidateCount < 65, `earlyCandidateCount=${earlyCandidateCount}`);
  } finally {
    await host.close();
  }

  let database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  earlyCandidateCount=database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count;
  preRestartResultCount=database.prepare('SELECT count(*) count FROM fx_event_result_bindings').get().count;
  assert.ok(earlyCandidateCount>0&&earlyCandidateCount<65,`post-stop earlyCandidateCount=${earlyCandidateCount}`);
  assert.equal(database.prepare('SELECT state FROM proc_procurement_runs').get().state,'active');
  assert.equal(database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='open'").get().count,earlyCandidateCount);
  assert.ok(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE work_kind='candidate_assembly' AND state!='succeeded'").get().count>0);
  assert.ok(preRestartResultCount>0);
  database.close();
  for (const sourcePath of sourcePaths) assert.deepEqual(fs.readFileSync(sourcePath), sourceBytes);

  runtimeError=null;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe: mediaProbe(),
    onExecutionRuntimeError(error) { runtimeError=error; },
  });
  try {
    const deadline=Date.now()+Number(process.env.HELIX_TEST_DEADLINE_MS || 60_000);let candidateCount=0,subjectCount=0,runState=null,observationState=null;
    while(Date.now()<deadline){const current=new Database(path.join(dataDir,'shelfdeck.db'),{readonly:true});
      candidateCount=current.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count;
      subjectCount=current.prepare('SELECT count(*) count FROM libra_subjects').get().count;
      runState=current.prepare('SELECT state FROM proc_procurement_runs').get()?.state||null;
      observationState=current.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(observationWorkId)?.state||null;current.close();
      if(runtimeError||candidateCount===65&&subjectCount===65&&runState==='sealed'&&observationState==='succeeded')break;
      await new Promise((resolve)=>setTimeout(resolve,25));}
    assert.ifError(runtimeError);assert.equal(candidateCount,65);assert.equal(subjectCount,65);assert.equal(runState,'sealed');assert.equal(observationState,'succeeded');
    const cookie = await session(host, initialized.adminApiKey);
    const replay = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${accessBasis.fieldId}/actions/observe`,
      headers: { cookie },
      payload: observation,
    });
    assert.equal(replay.statusCode, 202, replay.body);
    assert.equal(replay.json().observation.state, 'admitted');
    assert.equal(replay.json().observation.replayed, true);
    const fields = await host.inject({ method:'GET',url:'/v1/admin/material-fields',headers:{cookie} });
    assert.equal(fields.statusCode,200,fields.body);
    assert.equal(fields.json().items.find((item)=>item.fieldId===accessBasis.fieldId).currentObservationRevision,1);
    const formation = await host.inject({ method:'GET',url:'/v1/admin/formation',headers:{cookie} });
    assert.equal(formation.statusCode,200,formation.body);
    assert.equal(formation.json().summary.subjectCount,65);
    assert.equal(formation.json().summary.awaitingDestinationCount,65);
    assert.equal(formation.json().items.length,65);
    assert.equal(new Set(formation.json().items.map((item)=>item.subjectId)).size,65);
    const invalidFormationItem=formation.json().items.find((item)=>item.stage!=='awaiting_destination'||item.intakeCount!==1||item.primaryMaterialCount!==1);
    assert.equal(invalidFormationItem,undefined,JSON.stringify(invalidFormationItem));
    const deregistered=await host.inject({method:'POST',url:`/v1/admin/material-fields/${accessBasis.fieldId}/actions/deregister`,headers:{cookie},payload:{
      idempotencyKey:'procurement-only-deregister',fieldId:accessBasis.fieldId,expectedAccessRevision:1,expectedPolicyRevision:1}});
    assert.equal(deregistered.statusCode,200,deregistered.body);
    assert.equal(deregistered.json().materialField.status,'deregistered');
  } finally { await host.close(); }

  database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  assert.equal(database.prepare('SELECT count(*) count FROM proc_field_observations').get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE work_kind='evidence_assessment' AND state='succeeded'").get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_procurement_runs').get().count, 1);
  assert.deepEqual(database.prepare('SELECT state,seal_outcome FROM proc_procurement_runs').get(), { state:'sealed', seal_outcome:'partial_failure' });
  assert.equal(database.prepare('SELECT count(*) count FROM proc_run_materials').get().count, 66);
  assert.deepEqual(database.prepare("SELECT selection_state,terminal_disposition,length(terminal_evidence_digest) evidence_length FROM proc_run_materials WHERE selection_state='released'").get(),
    {selection_state:'released',terminal_disposition:'triage_failed',evidence_length:64});
  assert.equal(database.prepare("SELECT count(*) count FROM fx_command_receipts WHERE command_contract='helix://procurement/commands/ProcurementRunAdmission/v1'").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM fx_command_receipts WHERE command_contract='helix://procurement/commands/ProcurementRunSeal/v1'").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE work_kind='candidate_assembly' AND state='succeeded'").get().count, 65);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count, 65);
  assert.equal(database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='accepted'").get().count, 65);
  assert.equal(database.prepare("SELECT count(*) count FROM libra_intake_decisions WHERE decision_kind='accepted_resolution'").get().count, 65);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_subjects').get().count, 65);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_runs').get().count, 0);
  assert.equal(database.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count, 0);
  assert.ok(database.prepare('SELECT count(*) count FROM fx_event_result_bindings').get().count>preRestartResultCount);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count, 65);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_procurement_runs').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_intake_decisions').get().count, 65);
  assert.equal(database.prepare("SELECT status FROM proc_material_fields WHERE field_id=?").get(accessBasis.fieldId).status, 'deregistered');
  database.close();
  for (const sourcePath of sourcePaths) assert.deepEqual(fs.readFileSync(sourcePath), sourceBytes);
});
