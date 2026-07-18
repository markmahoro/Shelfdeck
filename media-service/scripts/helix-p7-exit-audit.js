'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { auditP7Exit } = require('./helix-architecture/p7-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '../..');
const requireClean = process.argv.includes('--require-clean');
const child = childProcess.spawnSync(process.execPath, ['scripts/helix-p7-procurement-verify.js'], {
  cwd:path.join(repositoryRoot, 'media-service'), encoding:'utf8', maxBuffer:60 * 1024 * 1024,
  env:{ ...process.env, NODE_ENV:'test', HELIX_SSOT_PATH:path.join(repositoryRoot, 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md') }
});
let verification;
try { verification = JSON.parse(child.stdout); }
catch (error) { verification = { ok:false, parseError:error.message }; }
const audit = auditP7Exit({ repositoryRoot, requireClean });
const gateFindings = child.status === 0 && verification.ok ? [] : [{ code:'P7_PROCUREMENT_AGGREGATE_GATE_FAILED' }];
const result = { ok:audit.ok && gateFindings.length === 0, scope:audit.scope,
  verification:{ procurement:verification }, evidence:audit.evidence, evidenceDigest:audit.evidenceDigest,
  findings:[...audit.findings, ...gateFindings] };
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
