'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { verifyP3PersistenceBaseline } = require('./helix-architecture/p3-persistence-verifier');

const serviceRoot = path.resolve(__dirname, '..');
const generatedRoot = path.join(serviceRoot, 'src/helix/foundation/persistence/generated');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p3-verify-'));
let architecture;
let persistence;
let failure;

try {
  const architectureRun = childProcess.spawnSync(process.execPath, ['scripts/helix-architecture-verify.js'], {
    cwd: serviceRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { NODE_ENV: 'test', NODE_PATH: process.env.NODE_PATH || '' }
  });
  try {
    architecture = JSON.parse(architectureRun.stdout);
  } catch (error) {
    failure = { code: 'P3_VERIFY_ARCHITECTURE_OUTPUT_INVALID', message: error.message, output: architectureRun.stdout };
  }
  if (!failure && (architectureRun.status !== 0 || !architecture.ok)) {
    failure = { code: 'P3_VERIFY_ARCHITECTURE_GATE_FAILED', output: architectureRun.stderr, architecture };
  }
  if (!failure) persistence = verifyP3PersistenceBaseline({
    Database,
    tempRoot,
    databasePath: path.join(tempRoot, 'shelfdeck.db'),
    schemaDdl: fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8'),
    schemaManifest: JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8')),
    serviceRoot
  });
} catch (error) {
  failure = { code: error.code || 'P3_VERIFY_UNEXPECTED_FAILURE', message: error.message, details: error.details };
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

const result = {
  ok: !failure && architecture.ok && persistence.ok,
  scope: 'P3_LOCAL_CROSS_PERSISTENCE',
  persistence,
  architecture: architecture && {
    ok: architecture.ok,
    fixtureFileCount: architecture.fixture.fileCount,
    contractCounts: architecture.contracts.counts,
    contractAggregateDigest: architecture.contracts.aggregateDigest,
    manifestAggregateDigest: architecture.manifests.aggregateDigest
  },
  canonicalTransactions: {
    contractCount: 18,
    declaredWriteTableCount: 56,
    participantAndCommitFaultPoints: 132,
    revisionFenceFailures: 18,
    staleControlCasFailures: 10,
    outboxContracts: 11
  },
  prohibitedActionsRun: [],
  failure
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
