'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require(path.join(process.env.HELIX_TEST_SOURCE_ROOT || path.resolve(__dirname,'..'), 'src/clean-service-host'));
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

test('UAT-125 three Movie Intakes recover an uncommitted transaction after other Subjects advance the head', { timeout:120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-intake-recovery-'));
  const dataDir = path.join(root, 'data'), adminDistDir = path.join(root, 'admin'), source = path.join(root, 'source');
  fs.mkdirSync(adminDistDir); fs.mkdirSync(source);
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const sourceBytes = 'isolated-material-for-intake-recovery';
  for (const title of ['Alpha', 'Beta', 'Gamma']) fs.writeFileSync(path.join(source, title + '.2024.mkv'), sourceBytes);
  const secretRoot = 'isolated-intake-recovery-secret-root-20260912';
  const initialized = initializeCleanData({ dataDir, secretRoot, confirmation:'INITIALIZE_HELIX_CLEAN_V1' });
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const errors = [];
  const options = { dataDir, adminDistDir, secretRoot, onExecutionRuntimeError:error => errors.push(error.code),
    mediaProbe:{ async probe(handle) {
      const result = { resultKind:'probed', sourceHandleDigest:canonicalDigest(handle), durationMs:1000,
        videoStreams:[{ streamIndex:0, codec:'hevc', dispositionDefault:true, width:1920, height:1080 }],
        audioStreams:[], subtitleStreams:[], discTopology:null };
      return Object.freeze({ ...result, payloadDigest:canonicalDigest(result) });
    } } };
  let host = await createCleanServiceHost(options), cookie;
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 }); });
  function sql(query, ...args) {
    const db = new Database(databasePath, { readonly:true });
    try { return db.prepare(query).all(...args); } finally { db.close(); }
  }
  async function authenticate() {
    const response = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':initialized.adminApiKey } });
    assert.equal(response.statusCode, 204, response.body); cookie=response.headers['set-cookie'];
  }
  async function request(method, url, payload) {
    const response = await host.inject({ method, url, headers:{ cookie }, payload });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
    return response.json();
  }
  async function until(predicate, label) {
    const deadline = Date.now()+35000;
    do { if (predicate()) return; await new Promise(resolve=>setTimeout(resolve,25)); } while (Date.now()<deadline);
    assert.fail(label + ': ' + JSON.stringify({ errors, deliveries:sql('SELECT state FROM proc_candidate_deliveries') }));
  }
  await authenticate();
  const fieldId='recovery-field';
  const policy={ includedDirectories:[], excludedDirectories:[], allowedExtensions:['.mkv'], minimumSizeBytes:0, excludedMaterialKeys:[] };
  const policyBasis={ extractionPolicyId:'recovery-policy', revision:1, ...policy };
  const access={ fieldId, revision:1, endpointId:'recovery-endpoint', rootLocation:source, mountScopeId:'recovery-mount',
    mountScopeRevision:1, accessSchemaRef:'helix://fixtures/recovery-access/v1' };
  await request('POST','/v1/admin/material-fields',{ idempotencyKey:'create-recovery-field', fieldId, name:'Recovery', contentProfileHint:'movie',
    policy:{ extractionPolicyId:policyBasis.extractionPolicyId, revision:1, policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy, policyDigest:canonicalDigest(policyBasis) }, access:{ ...access, accessDigest:canonicalDigest(access) } });
  await request('PATCH',`/v1/admin/libra/material-fields/${fieldId}/intake-admission`,{ predeckPipelineSeats:0, idempotencyKey:'hold-intake' });
  await request('POST',`/v1/admin/material-fields/${fieldId}/actions/observe`,{ idempotencyKey:'scan', fieldId,
    expectedAccessRevision:1, expectedObservationRevision:0, pageBudget:8 });
  await until(()=>sql('SELECT count(*) n FROM proc_candidate_packages')[0].n===3,'three packages');
  const candidate=sql('SELECT d.offer_id,p.package_digest FROM proc_candidate_deliveries d JOIN proc_candidate_packages p USING(candidate_package_id) ORDER BY d.offer_id LIMIT 1')[0];
  const subjectId='libra-subject-'+canonicalDigest({ offerId:candidate.offer_id, packageDigest:candidate.package_digest }).slice(0,40);
  // The real SQLite transaction rolls back before Subject/Control/Result publication.
  // Other Movies still commit, reproducing the live-head change during recovery.
  const db=new Database(databasePath);
  db.exec(`CREATE TRIGGER fail_selected_intake BEFORE INSERT ON libra_subjects WHEN NEW.subject_id='${subjectId}'
    BEGIN SELECT RAISE(ABORT,'injected-intake-transaction-failure'); END`);
  db.close();
  await request('PATCH',`/v1/admin/libra/material-fields/${fieldId}/intake-admission`,{ predeckPipelineSeats:3, idempotencyKey:'start-three' });
  await until(()=>sql("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='accepted'")[0].n===2 &&
    sql("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.intake.accept.commit@1' AND state='executing'")[0].n===1,'two commits and one unresolved effect');
  assert.equal(sql('SELECT count(*) n FROM libra_predeck_pipeline_tokens')[0].n,3);
  assert.equal(sql('SELECT 1 FROM libra_subjects WHERE subject_id=?',subjectId).length,0);
  const frozen=sql("SELECT a.input_snapshot_digest FROM fx_event_attempts a JOIN fx_workflow_events e USING(event_id) WHERE e.capability_ref='libra.intake.accept.commit@1' AND e.state='executing'")[0];
  assert.ok(frozen.input_snapshot_digest);
  await host.close();
  const repair=new Database(databasePath); repair.exec('DROP TRIGGER fail_selected_intake'); repair.close();
  host=await createCleanServiceHost(options); await authenticate();
  await until(()=>sql("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='accepted'")[0].n===3,'recovered third commit');
  assert.equal(errors.includes('P4_EVENT_RECOVERY_INPUT_DRIFT'),false);
  assert.equal(sql('SELECT count(*) n FROM libra_subjects')[0].n,3);
  assert.equal(sql('SELECT count(*) n FROM libra_handoff_a_receipts')[0].n,3);
  assert.equal(sql('SELECT count(*) n FROM libra_subject_continuity_heads WHERE current_revision=3')[0].n,1);
  assert.equal(sql('SELECT count(*) n FROM fx_event_attempts WHERE input_snapshot_digest=?',frozen.input_snapshot_digest)[0].n,1);
  assert.equal(sql("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.intake.accept.commit@1' AND state!='succeeded'")[0].n,0);
  await host.close(); host=await createCleanServiceHost(options); await authenticate();
  assert.equal(sql('SELECT count(*) n FROM libra_subjects')[0].n,3);
  assert.equal(sql('SELECT count(*) n FROM libra_handoff_a_receipts')[0].n,3);
  for (const file of fs.readdirSync(source)) assert.equal(fs.readFileSync(path.join(source,file),'utf8'),sourceBytes);
});
