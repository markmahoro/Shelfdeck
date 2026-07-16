'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { verifyP4RuntimeCrossProcess } = require('./helix-architecture/p4-runtime-verifier');

const serviceRoot = path.resolve(__dirname, '..');
const generatedRoot = path.join(serviceRoot, 'src/helix/foundation/persistence/generated');
const coverage = Object.freeze({
  stateMachines: ['p4-runtime-contracts.test.js', 'p4-event-runtime.test.js', 'p4-startup-recovery.test.js'],
  ownerAndPorts: ['p4-foundation-public.test.js', 'package-boundary-guard.test.js', 'p4-capability-registry.test.js'],
  dagAndSupply: ['p4-workflow-plan.test.js', 'p4-work-supply.test.js', 'p4-work-scheduler.test.js'],
  backpressureAndPermit: ['p4-resource-governor.test.js', 'p4-pressure-guard.test.js'],
  fenceAndProgress: ['p4-event-runtime.test.js', 'p4-progress-reporter.test.js'],
  sevenRecoveries: ['p4-effect-reconcilers.test.js', 'p4-effect-journal.test.js', 'p4-runtime-verifier.test.js']
});

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p4-runtime-verify-'));
  let architecture;
  let runtime;
  let failure;
  try {
    const gate = childProcess.spawnSync(process.execPath, ['scripts/helix-architecture-verify.js'], {
      cwd: serviceRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
      env: { NODE_ENV: 'test', NODE_PATH: process.env.NODE_PATH || '' }
    });
    architecture = JSON.parse(gate.stdout);
    if (gate.status !== 0 || !architecture.ok) throw Object.assign(new Error('Architecture gate failed.'), { code: 'P4_VERIFY_ARCHITECTURE_FAILED' });
    const missingCoverage = [...new Set(Object.values(coverage).flat())].filter((fixture) => !architecture.fixture.files.includes(fixture));
    if (missingCoverage.length > 0) throw Object.assign(new Error('P4 Runtime coverage fixture is missing.'), {
      code: 'P4_VERIFY_COVERAGE_MISSING', details: { missingCoverage }
    });
    runtime = await verifyP4RuntimeCrossProcess({
      Database, tempRoot, serviceRoot,
      workerPath: path.join(serviceRoot, 'scripts/helix-architecture/p4-crash-worker.js'),
      schemaDdl: fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8'),
      schemaManifest: JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'))
    });
  } catch (error) {
    failure = { code: error.code || 'P4_VERIFY_UNEXPECTED_FAILURE', message: error.message, details: error.details };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  const result = {
    ok: !failure && architecture && architecture.ok && runtime && runtime.ok,
    scope: 'P4_LOCAL_CROSS_RUNTIME_RECOVERY',
    runtime,
    coverage,
    architecture: architecture && { ok: architecture.ok, fixtureFileCount: architecture.fixture.fileCount,
      contractAggregateDigest: architecture.contracts.aggregateDigest, findings: [...architecture.dependency.findings, ...architecture.semantic.findings] },
    prohibitedActionsRun: [], failure
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

main();
