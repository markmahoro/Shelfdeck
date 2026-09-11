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
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createProcurementAutomationService } = require('../src/helix/domains/procurement/application/procurement-automation-service');
const { createDefaultTriageRuleRegistry } = require('../src/helix/domains/procurement/model/procurement-run-contracts');
const generated = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');

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


test('UAT-257 rejected packages end; later ordinary scans reselect available materials and preserve all package history', { timeout:120_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-rejection-cycle-'));
  const dataDir = path.join(root, 'data'), adminDistDir = path.join(root, 'admin'), source = path.join(root, 'source');
  fs.mkdirSync(adminDistDir); fs.mkdirSync(source);
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const secretRoot = 'isolated-rejection-cycle-secret-root-20260912';
  const initialized = initializeCleanData({ dataDir, secretRoot, confirmation:'INITIALIZE_HELIX_CLEAN_V1' });
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const returnFile = path.join(source, 'Return.Movie.2024.mkv'), goneFile = path.join(source, 'Gone.Movie.2024.mkv');
  for (const file of [returnFile, goneFile, path.join(source, 'Unplayable.Material.mkv')]) fs.writeFileSync(file, 'isolated-source-content');
  let runtimeError;
  const options = { dataDir, secretRoot, adminDistDir, mediaProbe:mediaProbe(), onExecutionRuntimeError(error) { runtimeError = error; } };
  let host = await createCleanServiceHost(options);
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 }); });
  let cookie = await session(host, initialized.adminApiKey);
  const fieldId = 'rejection-field';
  async function request(method, url, payload) {
    const response = await host.inject({ method, url, headers:{ cookie }, payload });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, response.body);
    return response.json();
  }
  function read(sql, ...args) {
    const db = new Database(databasePath, { readonly:true });
    try { return db.prepare(sql).all(...args); } finally { db.close(); }
  }
  async function until(predicate) {
    const deadline = Date.now() + 35_000;
    do { assert.ifError(runtimeError); if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); } while (Date.now() < deadline);
    assert.fail('Cycle did not converge: ' + JSON.stringify(read('SELECT state FROM proc_candidate_deliveries')));
  }
  async function seats(count, id) {
    await request('PATCH', `/v1/admin/libra/material-fields/${fieldId}/intake-admission`, { predeckPipelineSeats:count, idempotencyKey:id });
  }
  async function counts(expected) {
    const field = (await request('GET', '/v1/admin/material-fields')).items.find(item => item.fieldId === fieldId);
    const s = field.procurementStatus;
    assert.deepEqual([s.generatedPackageCount, s.acceptedPackageCount, s.rejectedPackageCount, s.waitingAcceptanceCount], expected);
    assert.equal(s.generatedPackageCount, s.acceptedPackageCount + s.rejectedPackageCount + s.waitingAcceptanceCount);
    return field;
  }
  async function scan(id, packageCount) {
    const field = (await request('GET', '/v1/admin/material-fields')).items.find(item => item.fieldId === fieldId);
    const result = await request('POST', `/v1/admin/material-fields/${fieldId}/actions/observe`, {
      idempotencyKey:id, fieldId, expectedAccessRevision:1, expectedObservationRevision:field.currentObservationRevision || 0, pageBudget:8,
    });
    await until(() => read('SELECT state FROM fx_supporting_works WHERE work_id=?', result.observation.observationWorkId)[0]?.state === 'succeeded' &&
      read('SELECT count(*) n FROM proc_candidate_packages')[0].n === packageCount &&
      read("SELECT count(*) n FROM proc_procurement_runs WHERE state!='sealed'")[0].n === 0);
    return result;
  }
  function replayCompletion() {
    const observation = read('SELECT * FROM proc_field_observations ORDER BY revision DESC LIMIT 1')[0];
    const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest });
    try {
      const automation = createProcurementAutomationService({ schemaManifest, unitOfWork:createSqliteUnitOfWork({ kernel }), triageRegistry:createDefaultTriageRuleRegistry() });
      assert.equal(automation.reconcileFromObservation({ state:'succeeded', fieldId, accessRevision:1,
        terminalObservationRevision:observation.revision, observationWorkId:observation.field_observation_work_id }).runs.length, 0);
    } finally { kernel.close(); }
  }
  const policy = { includedDirectories:[], excludedDirectories:[], allowedExtensions:['.mkv'], minimumSizeBytes:0, excludedMaterialKeys:[] };
  const policyBasis = { extractionPolicyId:'cycle-policy', revision:1, ...policy };
  const access = { fieldId, revision:1, endpointId:'cycle-endpoint', rootLocation:source, mountScopeId:'cycle-mount', mountScopeRevision:1, accessSchemaRef:'helix://fixtures/cycle-access/v1' };
  await request('POST', '/v1/admin/material-fields', { idempotencyKey:'register-cycle', fieldId, name:'Cycle', contentProfileHint:'movie',
    policy:{ extractionPolicyId:policyBasis.extractionPolicyId, revision:1, policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy, policyDigest:canonicalDigest(policyBasis) },
    access:{ ...access, accessDigest:canonicalDigest(access) } });
  await seats(0, 'pause-initial');
  await scan('first-scan', 2);
  const originalPackages = read('SELECT * FROM proc_candidate_packages ORDER BY candidate_package_id');
  await counts([2, 0, 0, 2]);
  await scan('pending-delivery-scan', 2);
  assert.equal(read('SELECT count(*) n FROM proc_procurement_runs')[0].n, 1, 'Sealed Run delivery guards and unchanged failed preparation prevent duplicate admission');
  replayCompletion();
  fs.renameSync(returnFile, path.join(root, 'return-held.mkv'));
  fs.renameSync(goneFile, path.join(root, 'gone-held.mkv'));
  await seats(2, 'allow-rejection');
  await until(() => read("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='rejected'")[0].n === 2);
  await counts([2, 0, 2, 0]);
  replayCompletion();
  const closedDeliveries = read('SELECT * FROM proc_candidate_deliveries ORDER BY offer_id');
  assert.equal(read("SELECT count(*) n FROM proc_run_materials WHERE terminal_disposition='handoff_rejected' AND selection_state='released'")[0].n, 2);
  assert.equal(read('SELECT count(*) n FROM proc_procurement_retry_intents')[0].n, 0);
  await scan('missing-files-scan', 2);
  await counts([2, 0, 2, 0]);
  await seats(0, 'pause-second');
  fs.renameSync(path.join(root, 'return-held.mkv'), returnFile);
  await scan('normal-next-round', 3);
  await counts([3, 0, 2, 1]);
  replayCompletion();
  // The same physical material can be rejected again without a hidden blacklist.
  fs.renameSync(returnFile, path.join(root, 'return-held.mkv'));
  await seats(2, 'allow-second-rejection');
  await until(() => read("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='rejected'")[0].n === 3);
  await counts([3, 0, 3, 0]);
  replayCompletion();
  fs.renameSync(path.join(root, 'return-held.mkv'), returnFile);
  await scan('normal-final-round', 4);
  await until(() => read("SELECT count(*) n FROM proc_candidate_deliveries WHERE state='accepted'")[0].n === 1);
  await counts([4, 1, 3, 0]);
  assert.deepEqual(read('SELECT * FROM proc_candidate_packages ORDER BY candidate_package_id').filter(item => originalPackages.some(old => old.candidate_package_id === item.candidate_package_id)), originalPackages);
  assert.deepEqual(read('SELECT * FROM proc_candidate_deliveries ORDER BY offer_id').filter(item => closedDeliveries.some(old => old.offer_id === item.offer_id)), closedDeliveries);
  assert.equal(read('SELECT count(*) n FROM proc_procurement_retry_intents')[0].n, 0);
  assert.equal(read('SELECT count(*) n FROM libra_subjects')[0].n, 1);
  await scan('accepted-custody-scan', 4);
  await counts([4, 1, 3, 0]);
  await host.close(); host = await createCleanServiceHost(options); cookie = await session(host, initialized.adminApiKey);
  replayCompletion(); await counts([4, 1, 3, 0]);
  assert.equal(fs.readFileSync(returnFile, 'utf8'), 'isolated-source-content');
});
