'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { auditP3Exit } = require('./helix-architecture/p3-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '../..');
const requireClean = process.argv.includes('--require-clean');
const gate = childProcess.spawnSync(process.execPath, ['scripts/helix-p3-persistence-verify.js'], {
  cwd: path.join(repositoryRoot, 'media-service'), encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
  env: { NODE_ENV: 'test', NODE_PATH: process.env.NODE_PATH || '' }
});
let verification;
try {
  verification = JSON.parse(gate.stdout);
} catch (error) {
  verification = { ok: false, parseError: error.message, output: gate.stdout };
}
const audit = auditP3Exit({ repositoryRoot, requireClean });
const result = {
  ok: gate.status === 0 && verification.ok && audit.ok,
  scope: audit.scope,
  verification: {
    ok: gate.status === 0 && verification.ok,
    scope: verification.scope,
    persistence: verification.persistence,
    canonicalTransactions: verification.canonicalTransactions
  },
  evidence: audit.evidence,
  evidenceDigest: audit.evidenceDigest,
  findings: [...audit.findings, ...(gate.status === 0 && verification.ok ? [] : [{ code: 'P3_AGGREGATE_GATE_FAILED' }])]
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
