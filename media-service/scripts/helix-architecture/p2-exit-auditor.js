'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateP2ContractBaseline } = require('./p2-contract-baseline-validator');

const P1_BASELINE = 'c52e67fa2b49c605d0971f2150238ea37c50816a';
const ALLOWED_DOCS = new Set([
  'AGENTS.md',
  'docs/helix/README.md',
  'docs/helix/CURRENT_PLAN.md',
  'docs/helix/CURRENT_STATUS.md',
  'docs/helix/implementation/CURRENT_PHASE.md'
]);

function normalize(value) {
  return value.split(path.sep).join('/');
}

function digestValue(value) {
  const canonicalize = (item) => Array.isArray(item) ? item.map(canonicalize) : item && typeof item === 'object'
    ? Object.keys(item).sort().reduce((result, key) => { result[key] = canonicalize(item[key]); return result; }, {})
    : item;
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function classifyChangedPath(relativePath) {
  const value = normalize(relativePath);
  if (ALLOWED_DOCS.has(value)) return { allowed: true, class: 'phase-documentation' };
  if (value.startsWith('media-service/src/helix/contracts/')) return { allowed: true, class: 'contract-artifact' };
  if (value.startsWith('media-service/scripts/helix-architecture/') || /^media-service\/scripts\/(?:helix-|materialize-helix-)/.test(value)) {
    return { allowed: true, class: 'contract-tooling' };
  }
  if (value.startsWith('media-service/test/helix-architecture/')) return { allowed: true, class: 'isolated-contract-fixture' };
  return { allowed: false, class: 'out-of-p2-scope' };
}

function prohibitedContentFindings(relativePath, content) {
  const value = normalize(relativePath);
  if (value.startsWith('media-service/test/') || value === 'media-service/scripts/helix-architecture/p2-exit-auditor.js' ||
      value === 'AGENTS.md' || value.startsWith('docs/')) return [];
  const rules = [
    ['DDL_EXECUTION_TOKEN', /\b(?:CREATE|ALTER|DROP)\s+TABLE\b/i],
    ['DATABASE_RUNTIME_IMPORT', /better-sqlite3|\bnew\s+Database\s*\(/i],
    ['SERVER_RUNTIME_WIRING', /\.(?:listen)\s*\(|require\([^)]*(?:server|app)\.js/i],
    ['LEGACY_RUNTIME_FALLBACK', /dual[-_ ]?(?:read|write|run)|legacy[-_ ]runtime[-_ ]fallback/i]
  ];
  return rules.filter(([, pattern]) => pattern.test(content)).map(([code]) => ({ code, file: value }));
}

function git(repositoryRoot, args) {
  const run = childProcess.spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return run.stdout.trim();
}

function auditP2Exit(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const contractsRoot = path.join(repositoryRoot, 'media-service', 'src', 'helix', 'contracts');
  const findings = [];
  const baseline = validateP2ContractBaseline({ repositoryRoot, contractsRoot });
  if (!baseline.ok) findings.push(...baseline.findings.map((item) => ({ component: 'contract-baseline', ...item })));

  const changedFiles = git(repositoryRoot, ['diff', '--name-only', `${P1_BASELINE}...HEAD`]).split(/\r?\n/).filter(Boolean).map(normalize);
  const classes = {};
  for (const relativePath of changedFiles) {
    const classification = classifyChangedPath(relativePath);
    classes[classification.class] = (classes[classification.class] || 0) + 1;
    if (!classification.allowed) findings.push({ code: 'P2_SCOPE_ESCAPE', file: relativePath, pathClass: classification.class });
    if (/\.(?:sql|db|sqlite|sqlite3)$/i.test(relativePath)) findings.push({ code: 'P2_EXECUTABLE_SCHEMA_OR_DB_ARTIFACT', file: relativePath });
    const absolutePath = path.join(repositoryRoot, relativePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      findings.push(...prohibitedContentFindings(relativePath, fs.readFileSync(absolutePath, 'utf8')));
    }
  }
  if (changedFiles.includes('docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md')) findings.push({ code: 'SSOT_MODIFIED_DURING_P2' });
  if (changedFiles.some((file) => file.startsWith('media-desktop/'))) findings.push({ code: 'MEDIA_DESKTOP_TOUCHED_DURING_P2' });
  if (changedFiles.some((file) => file.startsWith('tests/') || /docker/i.test(file))) findings.push({ code: 'EXTERNAL_TEST_OR_DOCKER_SCOPE_TOUCHED' });

  const capabilityFiles = changedFiles.filter((file) => file.startsWith('media-service/src/helix/contracts/capabilities/'));
  const nonJsonCapabilityFile = capabilityFiles.find((file) => !file.endsWith('.json'));
  if (nonJsonCapabilityFile) findings.push({ code: 'P2_EXECUTOR_OR_RUNTIME_FILE_PRESENT', file: nonJsonCapabilityFile });

  const worktreeStatus = git(repositoryRoot, ['status', '--porcelain']);
  if (options.requireClean && worktreeStatus) findings.push({ code: 'P2_AUDIT_WORKTREE_NOT_CLEAN', status: worktreeStatus.split(/\r?\n/) });

  const evidence = {
    baselineCommit: P1_BASELINE,
    auditedCommit: git(repositoryRoot, ['rev-parse', 'HEAD']),
    changedFileCount: changedFiles.length,
    changedPathClasses: classes,
    contractCounts: baseline.counts,
    contractAggregateDigest: baseline.aggregateDigest,
    prohibitedActionsRun: []
  };
  return {
    ok: findings.length === 0,
    scope: 'P2_EXIT_AUDIT_LOCAL_CONTRACT_ONLY',
    evidence,
    evidenceDigest: digestValue(evidence),
    findings
  };
}

module.exports = Object.freeze({ P1_BASELINE, auditP2Exit, classifyChangedPath, prohibitedContentFindings });
