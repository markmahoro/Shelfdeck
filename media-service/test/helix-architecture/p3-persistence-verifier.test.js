'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  EXPECTED_MODULES,
  assertIsolatedDatabasePath,
  verifyP3PersistenceBaseline
} = require('../../scripts/helix-architecture/p3-persistence-verifier');

const serviceRoot = path.resolve(__dirname, '../..');
const generatedRoot = path.join(serviceRoot, 'src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function temporary(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p3-verifier-test-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('P3 verifier rematerializes the exact clean persistence catalog below its owned temp root', () => {
  temporary((tempRoot) => {
    const result = verifyP3PersistenceBaseline({
      Database, tempRoot, databasePath: path.join(tempRoot, 'nested', '..', 'shelfdeck.db'),
      schemaDdl, schemaManifest, serviceRoot
    });
    assert.equal(result.ok, true);
    assert.equal(result.databasePathClass, 'owned-temporary');
    assert.equal(result.generation, 'helix-clean-v1');
    assert.equal(result.tableCount, 169);
    assert.equal(result.indexCount, 78);
    assert.equal(result.partialUniqueCount, 22);
    assert.deepEqual(result.persistenceModules, EXPECTED_MODULES);
  });
});

test('P3 verifier rejects a DB path outside or equal to its owned temp root', () => {
  temporary((tempRoot) => {
    assert.throws(() => assertIsolatedDatabasePath(tempRoot, path.join(path.dirname(tempRoot), 'escaped.db')),
      (error) => error.code === 'P3_VERIFY_DATABASE_PATH_OUTSIDE_TEMP_ROOT');
    assert.throws(() => assertIsolatedDatabasePath(tempRoot, tempRoot),
      (error) => error.code === 'P3_VERIFY_DATABASE_PATH_OUTSIDE_TEMP_ROOT');
    assert.throws(() => assertIsolatedDatabasePath(tempRoot, path.join(tempRoot, 'not-a-database.json')),
      (error) => error.code === 'P3_VERIFY_DATABASE_PATH_OUTSIDE_TEMP_ROOT');
  });
});

test('P3 verifier rejects an unknown persistence module without opening a database', () => {
  temporary((tempRoot) => {
    const fakeService = path.join(tempRoot, 'service');
    const persistenceRoot = path.join(fakeService, 'src/helix/foundation/persistence');
    fs.mkdirSync(persistenceRoot, { recursive: true });
    fs.writeFileSync(path.join(persistenceRoot, 'unknown-participant.js'), 'module.exports = {};\n');
    assert.throws(() => verifyP3PersistenceBaseline({
      Database, tempRoot, databasePath: path.join(tempRoot, 'shelfdeck.db'), schemaDdl, schemaManifest, serviceRoot: fakeService
    }), (error) => error.code === 'P3_VERIFY_UNKNOWN_PERSISTENCE_MODULE');
    assert.equal(fs.existsSync(path.join(tempRoot, 'shelfdeck.db')), false);
  });
});

test('P3 verifier rejects legacy and compatibility catalog objects', () => {
  temporary((tempRoot) => {
    const legacyPath = path.join(tempRoot, 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec('CREATE TABLE legacy_tasks(id TEXT PRIMARY KEY)');
    legacy.close();
    assert.throws(() => verifyP3PersistenceBaseline({
      Database, tempRoot, databasePath: legacyPath, schemaDdl, schemaManifest, serviceRoot
    }), (error) => error.code === 'P3_SQLITE_MIXED_OR_LEGACY_SCHEMA');

    const compatibilityPath = path.join(tempRoot, 'compatibility.db');
    verifyP3PersistenceBaseline({ Database, tempRoot, databasePath: compatibilityPath, schemaDdl, schemaManifest, serviceRoot });
    const compatibility = new Database(compatibilityPath);
    compatibility.exec('CREATE VIEW compatibility_tasks AS SELECT subject_id FROM libra_subjects');
    compatibility.close();
    assert.throws(() => verifyP3PersistenceBaseline({
      Database, tempRoot, databasePath: compatibilityPath, schemaDdl, schemaManifest, serviceRoot
    }), (error) => error.code === 'P3_SQLITE_CATALOG_SHAPE_MISMATCH');
  });
});

test('P3 verifier source cannot start product or external verification actions', () => {
  const source = fs.readFileSync(path.join(serviceRoot, 'scripts/helix-p3-persistence-verify.js'), 'utf8');
  const fragments = [['server', '.js'], ['runner', '.sh'], ['build-image', '.js'], ['deploy-nas', '.js'], ['listen', '(']];
  for (const parts of fragments) assert.equal(source.includes(parts.join('')), false, parts.join(''));
  assert.equal(source.includes('...process.env'), false);
});
