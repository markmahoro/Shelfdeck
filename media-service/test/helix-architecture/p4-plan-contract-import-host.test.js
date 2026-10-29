'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { preparePlanContractSchemaCopy } = require('../../scripts/helix-architecture/plan-contract-schema-copy');
const { fileDigest } = require('../../scripts/formation-reset-generation');
const service = path.resolve(__dirname, '../..'), persistence = path.join(service, 'src/helix/foundation/persistence');
const digest = '14ba9e5ab6833fedf39adc6d4dd492d18ea6c9387a3e0a1671a3d1338b999d53';
const oldSchema = { schemaDdl: zlib.gunzipSync(fs.readFileSync(path.join(persistence, 'release-schemas', digest + '.sql.gz'))).toString(),
  schemaManifest: JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(persistence, 'release-schemas', digest + '.manifest.json.gz')))) };
const historicalTargetSchema = require('../helpers/plan-contract-target-schema');

test('an obsolete additive import receipt cannot authorize opening the current Host or changing its historical target', { timeout: 90000 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-import-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data'), admin = path.join(root, 'admin'), secretRoot = 'isolated-history-import-secret-0123456789abcdef';
  fs.mkdirSync(admin); fs.writeFileSync(path.join(admin, 'index.html'), '<div></div>');
  initializeCleanData({ dataDir, secretRoot, confirmation: 'INITIALIZE_HELIX_CLEAN_V1' });
  const originalInit = path.join(root, 'initialized.db');
  fs.renameSync(path.join(dataDir, 'shelfdeck.db'), originalInit);
  const seed = new Database(originalInit, { readonly: true });
  const sourcePath = path.join(root, 'old.db'), targetPath = path.join(dataDir, 'shelfdeck.db');
  const old = openSqliteKernel({ Database, databasePath: sourcePath, ...oldSchema });
  try {
    old.runPrimitive(db => {
      for (const name of ['platform_secret_refs', 'platform_admin_credentials', 'arca_rule_templates', 'arca_rule_template_revisions']) {
        const rows = seed.prepare('SELECT * FROM ' + name).all();
        for (const row of rows) {
          const keys = Object.keys(row);
          db.prepare('INSERT INTO ' + name + '(' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')').run(...keys.map(key => row[key]));
        }
      }
      const hash = 'a'.repeat(64), catalog = '8f5dded28a5fea846f45a7c7b715109f1cf92ef36473d7a1b7f67cc68b4208db';
      db.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,state) VALUES('history','libra','failed')").run();
      db.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,basis_digest,state) VALUES('history','history',?,'failed')").run(hash);
      db.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,catalog_digest,basis_digest,graph_digest,state) VALUES('history','history',?,?,?,'contract_unplannable')").run(catalog, hash, hash);
    });
  } finally { old.close(); seed.close(); }
  // The original three-table cutover stays frozen at its qualified target.
  // The new application schema has a Procurement generation barrier; do not
  // expand this historical tool or add startup compatibility to satisfy it.
  const receipt = preparePlanContractSchemaCopy({ Database, sourcePath, targetPath, sourceSchema: oldSchema, targetSchema: historicalTargetSchema });
  const receiptPath = path.join(root, 'copy.json'), report = path.join(root, 'import.jsonl');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  fs.mkdirSync(path.join(dataDir, 'operator-runtime'));
  fs.writeFileSync(path.join(dataDir, 'operator-runtime/intent.json'), JSON.stringify({ schema: 'shelfdeck.runtime-intent@1',
    desiredMode: 'stopped', revision: 1, pendingReset: null }));
  const beforeDigest = fileDigest(targetPath);
  const result = spawnSync(process.execPath, ['scripts/helix-import-plan-contracts.js', '--data-dir', dataDir,
    '--admin-dist-dir', admin, '--copy-receipt', receiptPath, '--report', report, '--confirm', 'IMPORT_PLAN_CONTRACT_EVIDENCE'],
  { cwd: service, encoding: 'utf8', timeout: 80000, env: { ...process.env, SHELFDECK_SECRET_ROOT: secretRoot } });
  assert.equal(result.status, 1, result.stdout + '\n' + result.stderr);
  assert.equal(JSON.parse(result.stderr).error.code, 'CONTRACT_COPY_RECEIPT_INVALID');
  assert.equal(fileDigest(targetPath), beforeDigest);
  assert.equal(fs.existsSync(report), false, 'schema qualification must fail before import begins');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'operator-runtime/intent.json'))).desiredMode, 'stopped');
  const checked = new Database(targetPath, { readonly: true });
  try {
    assert.equal(checked.prepare('SELECT COUNT(*) n FROM fx_plan_contracts').get().n, 0);
    assert.equal(checked.prepare('SELECT COUNT(*) n FROM fx_supporting_works').get().n, 1);
    assert.equal(checked.prepare("SELECT state FROM fx_work_attempts WHERE attempt_id='history'").get().state, 'failed');
  } finally { checked.close(); }
});
