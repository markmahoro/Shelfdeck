'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

const serviceRoot = path.resolve(__dirname, '..');
function run(script) {
  const child = childProcess.spawnSync(process.execPath, [script], { cwd: serviceRoot, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
    env: { NODE_ENV: 'test', NODE_PATH: process.env.NODE_PATH || '', HELIX_SSOT_PATH: process.env.HELIX_SSOT_PATH || '' } });
  let output;
  try { output = JSON.parse(child.stdout); } catch (error) { output = { ok: false, parseError: error.message }; }
  return { status: child.status, output, stderr: child.stderr };
}

const architecture = run('scripts/helix-architecture-verify.js');
const persistence = run('scripts/helix-p3-persistence-verify.js');
const findings = [];
if (architecture.status !== 0 || !architecture.output.ok) findings.push({ code: 'P6_ARCHITECTURE_GATE_FAILED' });
if (persistence.status !== 0 || !persistence.output.ok) findings.push({ code: 'P6_PERSISTENCE_GATE_FAILED' });
const result = { ok: findings.length === 0, scope: 'P6_LOCAL_ISOLATED_HORIZONTAL_DOMAINS',
  architecture: { ok: architecture.output.ok, fixtureFileCount: architecture.output.fixture && architecture.output.fixture.fileCount,
    contracts: architecture.output.contracts, dependency: architecture.output.dependency, semantic: architecture.output.semantic },
  persistence: { ok: persistence.output.ok, persistence: persistence.output.persistence,
    canonicalTransactions: persistence.output.canonicalTransactions },
  prohibitedActionsRun: [], findings };
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
