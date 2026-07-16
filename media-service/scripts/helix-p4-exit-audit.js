'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { auditP4Exit } = require('./helix-architecture/p4-exit-auditor');

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

const runtime = run('scripts/helix-p4-runtime-verify.js');
const persistence = run('scripts/helix-p3-persistence-verify.js');
const audit = auditP4Exit({ repositoryRoot, requireClean });
const gateFindings = [];
if (runtime.status !== 0 || !runtime.output.ok) gateFindings.push({ code: 'P4_RUNTIME_AGGREGATE_GATE_FAILED' });
if (persistence.status !== 0 || !persistence.output.ok) gateFindings.push({ code: 'P3_PERSISTENCE_REGRESSION_GATE_FAILED' });
const result = {
  ok: audit.ok && gateFindings.length === 0,
  scope: audit.scope,
  verification: {
    runtime: runtime.output && { ok: runtime.output.ok, scope: runtime.output.scope, runtime: runtime.output.runtime,
      coverage: runtime.output.coverage, prohibitedActionsRun: runtime.output.prohibitedActionsRun },
    persistence: persistence.output && { ok: persistence.output.ok, scope: persistence.output.scope,
      persistence: persistence.output.persistence, canonicalTransactions: persistence.output.canonicalTransactions }
  },
  evidence: audit.evidence, evidenceDigest: audit.evidenceDigest,
  findings: [...audit.findings, ...gateFindings]
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
