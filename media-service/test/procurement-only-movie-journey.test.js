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

test('UAT-174 per-field pause and UAT-175 predeck tokens survive Host restart without extra Intake', { timeout:120_000 }, async (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-per-field-seats-'));
  const dataDir=path.join(root,'data'),adminDistDir=path.join(root,'admin');
  fs.mkdirSync(adminDistDir,{recursive:true});
  fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div id="root"></div>');
  const initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot});
  const databasePath=path.join(dataDir,'shelfdeck.db');
  let runtimeError=null;
  const options={dataDir,adminDistDir,secretRoot,mediaProbe:mediaProbe(),onExecutionRuntimeError(error){runtimeError=error;}};
  let host=await createCleanServiceHost(options);
  t.after(async()=>{await host.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  let cookie=await session(host,initialized.adminApiKey);
  async function request(method,url,payload){const response=await host.inject({method,url,headers:{cookie},payload});
    assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response.json();}
  async function seats(fieldId,count){return request('PATCH',`/v1/admin/libra/material-fields/${fieldId}/intake-admission`,{predeckPipelineSeats:count,idempotencyKey:`seats-${fieldId}-${count}`});}
  function snapshot(){const db=new Database(databasePath,{readonly:true});try{return {
    packages:db.prepare('SELECT count(*) n FROM proc_candidate_packages').get().n,
    subjects:db.prepare('SELECT count(*) n FROM libra_subjects').get().n,
    runs:db.prepare('SELECT count(*) n FROM libra_runs').get().n,
    tokens:db.prepare('SELECT * FROM libra_predeck_pipeline_tokens ORDER BY subject_id').all(),
    decisions:db.prepare("SELECT source_field_id,count(*) n FROM libra_intake_decisions WHERE decision_kind='accepted_resolution' GROUP BY source_field_id ORDER BY source_field_id").all(),
    works:db.prepare("SELECT work_id,state FROM fx_supporting_works WHERE owner_domain='libra' ORDER BY work_id").all(),
  };}finally{db.close();}}
  async function waitForSnapshot(predicate){const deadline=Date.now()+45_000;let value;
    do{assert.ifError(runtimeError);value=snapshot();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);
    assert.fail('Per-field admission did not converge: '+JSON.stringify(value));}
  const sourceFiles=[];
  for(const fieldId of ['seat-field-a','seat-field-b']){
    const fieldRoot=path.join(root,fieldId);fs.mkdirSync(fieldRoot);
    for(let i=1;i<=3;i++){const location=path.join(fieldRoot,`Seat.Movie.${i}.2024.mkv`);fs.writeFileSync(location,'read-only-seats-fixture');sourceFiles.push(location);}
    const policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]};
    const policyBasis={extractionPolicyId:fieldId+'-policy',revision:1,...policy};
    const access={fieldId,revision:1,endpointId:fieldId+'-endpoint',rootLocation:fieldRoot,mountScopeId:fieldId+'-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/per-field-access/v1'};
    await request('POST','/v1/admin/material-fields',{idempotencyKey:fieldId+'-register',fieldId,name:fieldId,contentProfileHint:'movie',
      policy:{extractionPolicyId:policyBasis.extractionPolicyId,revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,policyDigest:canonicalDigest(policyBasis)},
      access:{...access,accessDigest:canonicalDigest(access)}});
    await seats(fieldId,fieldId==='seat-field-a'?0:1);
    await request('POST',`/v1/admin/material-fields/${fieldId}/actions/observe`,{idempotencyKey:fieldId+'-observe',fieldId,expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8});
  }
  const admittedB=await waitForSnapshot(value=>value.packages===6&&value.subjects===1);
  assert.deepEqual(admittedB.decisions,[{source_field_id:'seat-field-b',n:1}]);
  assert.equal(admittedB.tokens.length,1);
  assert.equal(admittedB.tokens[0].source_field_id,'seat-field-b');
  assert.equal(admittedB.runs,0,'Intake-to-Run waiting must retain a token');
  await host.close();host=await createCleanServiceHost(options);cookie=await session(host,initialized.adminApiKey);
  await new Promise(resolve=>setTimeout(resolve,1_500));
  const restarted=snapshot();
  assert.deepEqual(restarted.tokens,admittedB.tokens);
  assert.equal(restarted.subjects,1);
  const pausedA=await request('GET','/v1/admin/libra/material-fields/seat-field-a/intake-admission');
  assert.equal(pausedA.predeckPipelineSeats,0);assert.equal(pausedA.pipelineTokensHeld,0);
  const pausedB=await seats('seat-field-b',0);
  assert.equal(pausedB.pipelineTokensHeld,1,'Reducing capacity must retain admitted work');
  assert.equal(pausedB.pipelineSeatsFree,0);
  assert.deepEqual(await seats('seat-field-b',0),pausedB,'Repeated PATCH must keep the durable policy revision');
  await seats('seat-field-a',1);
  const admittedA=await waitForSnapshot(value=>value.subjects===2);
  assert.equal(admittedA.tokens.length,2);
  assert.deepEqual(admittedA.decisions,[{source_field_id:'seat-field-a',n:1},{source_field_id:'seat-field-b',n:1}]);
  assert.ok(admittedA.tokens.some(token=>JSON.stringify(token)===JSON.stringify(admittedB.tokens[0])));
  const closedA=await seats('seat-field-a',0);assert.equal(closedA.pipelineTokensHeld,1);
  await host.close();host=await createCleanServiceHost(options);cookie=await session(host,initialized.adminApiKey);
  await new Promise(resolve=>setTimeout(resolve,1_500));
  const final=snapshot();assert.deepEqual(final.tokens,admittedA.tokens);assert.equal(final.subjects,2);assert.equal(final.runs,0);
  // With both sources paused, startup replay must not manufacture new downstream Work.
  const workIds=final.works.map(work=>work.work_id);
  await new Promise(resolve=>setTimeout(resolve,1_500));
  assert.deepEqual(snapshot().works.map(work=>work.work_id),workIds);
  const formation=await request('GET','/v1/admin/formation?limit=25');
  assert.equal(formation.items.length,2,'Only accepted Subjects holding a token belong to the workspace');
  await host.close();
  // Isolated historical-state fault injection: retain the formally accepted
  // Subject but remove only its token, as in the original UAT-175 incident.
  // This is a rejection test, not a migration or repair path.
  const historicalSubject=final.tokens.find(token=>token.source_field_id==='seat-field-a').subject_id;
  const interrupted=new Database(databasePath);
  assert.equal(interrupted.prepare('DELETE FROM libra_predeck_pipeline_tokens WHERE subject_id=?').run(historicalSubject).changes,1);
  interrupted.close();
  host=await createCleanServiceHost(options);cookie=await session(host,initialized.adminApiKey);
  await new Promise(resolve=>setTimeout(resolve,1_500));
  const historical=snapshot();
  assert.equal(historical.subjects,2,'Historical acceptance facts must remain intact');
  assert.deepEqual(historical.tokens,final.tokens.filter(token=>token.subject_id!==historicalSubject));
  assert.deepEqual(historical.works.map(work=>work.work_id),workIds,'Zero seats must not recreate downstream Work for tokenless history');
  const filtered=await request('GET','/v1/admin/formation?limit=25');
  assert.equal(filtered.items.length,1);
  assert.equal(filtered.items.some(item=>item.subjectId===historicalSubject),false);
  assert.ifError(runtimeError);
  for(const sourceFile of sourceFiles)assert.equal(fs.readFileSync(sourceFile,'utf8'),'read-only-seats-fixture');
});

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

test('one bad Material is released while a bounded Movie Candidate set queues behind durable Libra Intake seats', async (t) => {
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
  const movieCount = Number(process.env.HELIX_PROCUREMENT_MOVIE_COUNT || 65);
  const intakeSeats = Math.min(movieCount, 3);
  assert.ok(Number.isSafeInteger(movieCount) && movieCount >= 2 && movieCount <= 1024);
  const sourcePaths = Array.from({ length: movieCount }, (_unused, ordinal) => path.join(sourceRoot,
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
    const deadline = Date.now() + Number(process.env.HELIX_TEST_EARLY_DEADLINE_MS || 30_000);
    while (Date.now() < deadline) {
      const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
      earlyCandidateCount = database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count;
      const runState = database.prepare('SELECT state FROM proc_procurement_runs LIMIT 1').get()?.state || null;
      preRestartResultCount=database.prepare('SELECT count(*) count FROM fx_event_result_bindings').get().count;
      database.close();
      if (runtimeError || earlyCandidateCount > 0 && earlyCandidateCount < movieCount && runState === 'active') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ifError(runtimeError);
    assert.ok(earlyCandidateCount > 0 && earlyCandidateCount < movieCount, `earlyCandidateCount=${earlyCandidateCount}`);
  } finally {
    await host.close();
  }

  let database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  earlyCandidateCount=database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count;
  preRestartResultCount=database.prepare('SELECT count(*) count FROM fx_event_result_bindings').get().count;
  assert.ok(earlyCandidateCount>0&&earlyCandidateCount<movieCount,`post-stop earlyCandidateCount=${earlyCandidateCount}`);
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
      if(runtimeError||candidateCount===movieCount&&subjectCount===intakeSeats&&runState==='sealed'&&observationState==='succeeded')break;
      await new Promise((resolve)=>setTimeout(resolve,25));}
    assert.ifError(runtimeError);assert.equal(candidateCount,movieCount);assert.equal(subjectCount,intakeSeats);assert.equal(runState,'sealed');assert.equal(observationState,'succeeded');
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
    const fieldProjection=fields.json().items.find((item)=>item.fieldId===accessBasis.fieldId);
    assert.ok(fieldProjection.currentObservationRevision>=1);
    assert.deepEqual({
      generated:fieldProjection.procurementStatus.generatedPackageCount,
      accepted:fieldProjection.procurementStatus.acceptedPackageCount,
      waiting:fieldProjection.procurementStatus.waitingAcceptanceCount,
      rejected:fieldProjection.procurementStatus.rejectedPackageCount,
    },{generated:movieCount,accepted:intakeSeats,waiting:movieCount-intakeSeats,rejected:0});
    const formationItems = [];
    let formationCursor = null;
    let formation = null;
    do {
      const query = new URLSearchParams({ limit: '25' });
      if (formationCursor) query.set('cursor', formationCursor);
      const page = await host.inject({ method:'GET',url:`/v1/admin/formation?${query.toString()}`,headers:{cookie} });
      assert.equal(page.statusCode,200,page.body);
      formation ??= page;
      formationItems.push(...page.json().items);
      formationCursor = page.json().nextCursor;
    } while (formationCursor);
    assert.equal(formation.json().summary.totalCount,intakeSeats);
    assert.equal(formation.json().summary.inProgressCount,intakeSeats);
    assert.equal(formationItems.length,intakeSeats);
    assert.equal(new Set(formationItems.map((item)=>item.subjectId)).size,intakeSeats);
    const invalidFormationItem=formationItems.find((item)=>item.classification!=='in_progress'||item.primaryMaterialCount!==1);
    assert.equal(invalidFormationItem,undefined,JSON.stringify(invalidFormationItem));
    const deregistered=await host.inject({method:'POST',url:`/v1/admin/material-fields/${accessBasis.fieldId}/actions/deregister`,headers:{cookie},payload:{
      idempotencyKey:'procurement-only-deregister',fieldId:accessBasis.fieldId,expectedAccessRevision:1,expectedPolicyRevision:1}});
    assert.equal(deregistered.statusCode,200,deregistered.body);
    assert.equal(deregistered.json().materialField.status,'deregistered');
  } finally { await host.close(); }

  database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  assert.ok(database.prepare('SELECT count(*) count FROM proc_field_observations').get().count>=1);
  assert.equal(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE work_kind='evidence_assessment' AND state='succeeded'").get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_procurement_runs').get().count, 1);
  assert.deepEqual(database.prepare('SELECT state,seal_outcome FROM proc_procurement_runs').get(), { state:'sealed', seal_outcome:'partial_failure' });
  assert.equal(database.prepare('SELECT count(*) count FROM proc_run_materials').get().count, movieCount + 1);
  assert.deepEqual(database.prepare("SELECT selection_state,terminal_disposition,length(terminal_evidence_digest) evidence_length FROM proc_run_materials WHERE selection_state='released'").get(),
    {selection_state:'released',terminal_disposition:'triage_failed',evidence_length:64});
  assert.equal(database.prepare("SELECT count(*) count FROM fx_command_receipts WHERE command_contract='helix://procurement/commands/ProcurementRunAdmission/v1'").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM fx_command_receipts WHERE command_contract='helix://procurement/commands/ProcurementRunSeal/v1'").get().count, 1);
  assert.equal(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE work_kind='candidate_assembly' AND state='succeeded'").get().count, movieCount);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count, movieCount);
  assert.equal(database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='accepted'").get().count, intakeSeats);
  assert.equal(database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='open'").get().count, movieCount - intakeSeats);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_predeck_pipeline_tokens').get().count, intakeSeats);
  assert.equal(database.prepare("SELECT count(*) count FROM libra_intake_decisions WHERE decision_kind='accepted_resolution'").get().count, intakeSeats);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_subjects').get().count, intakeSeats);
  assert.equal(database.prepare("SELECT count(*) count FROM proc_field_materials material JOIN fx_material_controls control ON control.material_key=material.material_key WHERE material.eligibility_state='ineligible' AND control.owner_domain='libra'").get().count, intakeSeats);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_runs').get().count, 0);
  assert.equal(database.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count, 0);
  assert.ok(database.prepare('SELECT count(*) count FROM fx_event_result_bindings').get().count>preRestartResultCount);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count, movieCount);
  assert.equal(database.prepare('SELECT count(*) count FROM proc_procurement_runs').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) count FROM libra_intake_decisions').get().count, intakeSeats);
  assert.equal(database.prepare("SELECT status FROM proc_material_fields WHERE field_id=?").get(accessBasis.fieldId).status, 'deregistered');
  database.close();
  for (const sourcePath of sourcePaths) assert.deepEqual(fs.readFileSync(sourcePath), sourceBytes);
});
