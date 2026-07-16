'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { verifyP4RuntimeCrossProcess } = require('../../scripts/helix-architecture/p4-runtime-verifier');

const serviceRoot = path.resolve(__dirname, '../..');
const generatedRoot = path.join(serviceRoot, 'src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

test('cross-process crash matrix converges seven Effect Classes without duplicate fake effects', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p4-runtime-test-'));
  try {
    const result = await verifyP4RuntimeCrossProcess({ Database, tempRoot, serviceRoot, schemaDdl, schemaManifest,
      workerPath: path.join(serviceRoot, 'scripts/helix-architecture/p4-crash-worker.js') });
    assert.equal(result.ok, true);
    assert.equal(result.effectClassCount, 7);
    assert.equal(result.nonPureCrashPointCount, 5);
    assert.equal(result.scenarioCount, 31);
    assert.deepEqual(result.prohibitedActionsRun, []);
    assert.equal(result.scenarios.filter((scenario) => scenario.dispatchCount === 1).length, 30);
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
});

test('verifier and worker are isolated from product startup, credentials, network, and legacy Runtime', () => {
  const files = ['scripts/helix-p4-runtime-verify.js', 'scripts/helix-architecture/p4-runtime-verifier.js',
    'scripts/helix-architecture/p4-crash-worker.js'];
  const source = files.map((file) => fs.readFileSync(path.join(serviceRoot, file), 'utf8').toLowerCase()).join('\n');
  for (const forbidden of ['src/server', 'listen(', 'x-api-key', 'process.env.emby', 'process.env.tmdb',
    'kairox', 'taskmanager', 'docker', 'media-desktop', 'child_process.exec(', 'shell: true']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('verifier rejects a database root or crash worker outside its isolated boundaries', async () => {
  const validRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p4-boundary-'));
  const base = { Database, serviceRoot, schemaDdl, schemaManifest,
    workerPath: path.join(serviceRoot, 'scripts/helix-architecture/p4-crash-worker.js') };
  try {
    await assert.rejects(verifyP4RuntimeCrossProcess({ ...base, tempRoot: serviceRoot }), { code: 'P4_RUNTIME_VERIFY_BOUNDARY_INVALID' });
    await assert.rejects(verifyP4RuntimeCrossProcess({ ...base, tempRoot: validRoot, workerPath: __filename }),
      { code: 'P4_RUNTIME_VERIFY_BOUNDARY_INVALID' });
  } finally { fs.rmSync(validRoot, { recursive: true, force: true }); }
});
