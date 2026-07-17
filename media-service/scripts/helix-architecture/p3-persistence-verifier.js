'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');

const EXPECTED_MODULES = Object.freeze([
  'artifact-repository.js',
  'commit-foundation.js',
  'ddl-compiler.js',
  'domain-commit-registry.js',
  'material-control.js',
  'outbox-inbox.js',
  'owner-repository.js',
  'sqlite-kernel.js',
  'sqlite-unit-of-work.js'
]);

class P3PersistenceVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'P3PersistenceVerificationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new P3PersistenceVerificationError(code, message, details);
}

function containedPath(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative.length > 0 && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function assertIsolatedDatabasePath(tempRoot, databasePath) {
  if (typeof tempRoot !== 'string' || typeof databasePath !== 'string' || path.extname(databasePath) !== '.db' ||
      !containedPath(tempRoot, databasePath)) {
    fail('P3_VERIFY_DATABASE_PATH_OUTSIDE_TEMP_ROOT', 'P3 verification database must be a .db file below its owned temporary root.');
  }
}

function catalog(database) {
  return database.prepare(
    "SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
  ).all();
}

function verifyP3PersistenceBaseline(options) {
  if (!options || typeof options.Database !== 'function' || !options.schemaManifest || typeof options.schemaDdl !== 'string' ||
      typeof options.serviceRoot !== 'string') {
    fail('P3_VERIFY_INVALID_OPTIONS', 'P3 persistence verification options are incomplete.');
  }
  assertIsolatedDatabasePath(options.tempRoot, options.databasePath);
  const persistenceRoot = path.join(options.serviceRoot, 'src/helix/foundation/persistence');
  const actualModules = fs.readdirSync(persistenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js')).map((entry) => entry.name).sort();
  if (JSON.stringify(actualModules) !== JSON.stringify(EXPECTED_MODULES)) {
    fail('P3_VERIFY_UNKNOWN_PERSISTENCE_MODULE', 'P3 persistence source contains an unknown or missing participant module.', {
      expected: EXPECTED_MODULES, actual: actualModules
    });
  }
  const kernel = openSqliteKernel({
    Database: options.Database,
    databasePath: options.databasePath,
    schemaDdl: options.schemaDdl,
    schemaManifest: options.schemaManifest,
    now: options.now || (() => 1700000001000)
  });
  const generation = kernel.generation;
  kernel.close();
  const database = new options.Database(options.databasePath, { readonly: true });
  try {
    const rows = catalog(database);
    const expectedTables = options.schemaManifest.tables.map((table) => table.tableId).sort();
    const expectedIndexes = options.schemaManifest.tables.flatMap((table) => table.indexes.map((index) => index.name)).sort();
    const actualTables = rows.filter((row) => row.type === 'table').map((row) => row.name).sort();
    const actualIndexes = rows.filter((row) => row.type === 'index').map((row) => row.name).sort();
    const compatibilityObjects = rows.filter((row) => !['table', 'index'].includes(row.type));
    if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables) ||
        JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes) || compatibilityObjects.length > 0) {
      fail('P3_VERIFY_CATALOG_NOT_CLEAN_EXACT', 'P3 verification catalog contains legacy, compatibility, missing, or unknown objects.', {
        compatibilityObjects, expectedTableCount: expectedTables.length, actualTableCount: actualTables.length,
        expectedIndexCount: expectedIndexes.length, actualIndexCount: actualIndexes.length
      });
    }
    return Object.freeze({
      ok: true,
      databasePathClass: 'owned-temporary',
      generation: generation.generation,
      ddlDigest: options.schemaManifest.ddlDigest,
      tableContractDigest: options.schemaManifest.tableContractAggregateDigest,
      tableCount: actualTables.length,
      indexCount: actualIndexes.length,
      partialUniqueCount: options.schemaManifest.tables.flatMap((table) => table.indexes)
        .filter((index) => index.kind === 'partial-unique').length,
      persistenceModules: actualModules
    });
  } finally {
    database.close();
  }
}

module.exports = Object.freeze({
  EXPECTED_MODULES,
  P3PersistenceVerificationError,
  assertIsolatedDatabasePath,
  verifyP3PersistenceBaseline
});
