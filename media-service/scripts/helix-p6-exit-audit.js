'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { auditP6Exit } = require('./helix-architecture/p6-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '../..');
const requireClean = process.argv.includes('--require-clean');

function run(script) {
  const result = childProcess.spawnSync(process.execPath, [script], {
    cwd: path.join(repositoryRoot, 'media-service'), encoding: 'utf8', maxBuffer: 40 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: 'test', HELIX_SSOT_PATH: path.join(repositoryRoot, 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md') }
  });
  try { return { status: result.status, output: JSON.parse(result.stdout), stderr: result.stderr }; }
  catch (error) { return { status: result.status, output: { ok: false, parseError: error.message }, stderr: result.stderr }; }
}

const horizontal = run('scripts/helix-p6-horizontal-verify.js');
const audit = auditP6Exit({ repositoryRoot, requireClean });
const gateFindings = horizontal.status === 0 && horizontal.output.ok ? [] : [{ code: 'P6_HORIZONTAL_AGGREGATE_GATE_FAILED' }];
const result = {
  ok: audit.ok && gateFindings.length === 0,
  scope: audit.scope,
  verification: { horizontal: horizontal.output },
  evidence: audit.evidence,
  evidenceDigest: audit.evidenceDigest,
  findings: [...audit.findings, ...gateFindings]
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
