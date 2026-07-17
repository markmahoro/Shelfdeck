'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { auditP5Exit } = require('./helix-architecture/p5-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '../..');
const requireClean = process.argv.includes('--require-clean');

function run(script) {
  const result = childProcess.spawnSync(process.execPath, [script], {
    cwd: path.join(repositoryRoot, 'media-service'), encoding: 'utf8', maxBuffer: 30 * 1024 * 1024,
    env: { NODE_ENV: 'test', NODE_PATH: process.env.NODE_PATH || '' }
  });
  try { return { status: result.status, output: JSON.parse(result.stdout), stderr: result.stderr }; }
  catch (error) { return { status: result.status, output: { ok: false, parseError: error.message }, stderr: result.stderr }; }
}

const platform = run('scripts/helix-p5-integration-verify.js');
const architecture = run('scripts/helix-architecture-verify.js');
const persistence = run('scripts/helix-p3-persistence-verify.js');
const runtime = run('scripts/helix-p4-runtime-verify.js');
const audit = auditP5Exit({ repositoryRoot, requireClean });
const gateFindings = [];
for (const [code, result] of [
  ['P5_PLATFORM_AGGREGATE_GATE_FAILED', platform],
  ['P5_ARCHITECTURE_AGGREGATE_GATE_FAILED', architecture],
  ['P3_PERSISTENCE_REGRESSION_GATE_FAILED', persistence],
  ['P4_RUNTIME_REGRESSION_GATE_FAILED', runtime]
]) if (result.status !== 0 || !result.output.ok) gateFindings.push({ code });
const result = {
  ok: audit.ok && gateFindings.length === 0,
  scope: audit.scope,
  verification: {
    platform: platform.output && { ok: platform.output.ok, scope: platform.output.scope, integration: platform.output.integration },
    architecture: architecture.output && { ok: architecture.output.ok, fixtureFileCount: architecture.output.fixture && architecture.output.fixture.fileCount,
      dependency: architecture.output.dependency, semantic: architecture.output.semantic, contracts: architecture.output.contracts },
    persistence: persistence.output && { ok: persistence.output.ok, persistence: persistence.output.persistence,
      canonicalTransactions: persistence.output.canonicalTransactions },
    runtime: runtime.output && { ok: runtime.output.ok, runtime: runtime.output.runtime }
  },
  evidence: audit.evidence,
  evidenceDigest: audit.evidenceDigest,
  findings: [...audit.findings, ...gateFindings]
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
