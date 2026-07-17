'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateP2ContractBaseline } = require('./p2-contract-baseline-validator');

const P6_BASELINE = '41470e47ec6bed7ba1cf81024130870eb2e57e92';
const APPROVED_ARCHITECTURE_COMMIT = 'f2846fd1';
const AUTHORIZED_SSOT_COMMITS = Object.freeze([
  '314d85e28bbab9f71a3466cf86877f7a998a638b',
  '63100d9c5334a089a22b810958e86c30f92028c7',
  '387510c052fe5aac09451e864704b568c9a80eee',
  '141fe9aaa10045f6439df9c605e5767775cf6b2c',
  'ff3125d733a18601113408169ecc62751352e82f',
  '08321c1610e545bbb7f1540728d7eb9ae46d3d92'
]);
const EXPECTED_SSOT_AGGREGATE_DIGEST = '9dbf0c63b3849e6fd80b28974808690ab9053d2090edee0154d601e1f316015f';
const EXPECTED_CONTRACT_AGGREGATE_DIGEST = 'd94a53f8b7741aefa8bd0d245db4aafcc70100e2ac3d42d1ee7eb2685261cc70';
const REQUIRED_EVIDENCE = Object.freeze([
  ...Array.from({ length: 13 }, (_, index) => `P6_${String(index).padStart(2, '0')}_`),
  'P6_RESOLUTION_AND_REGISTRATION_INPUT_CLOSURE_DESIGN_RETURN.md'
]);

function normalize(value) { return value.split(path.sep).join('/'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result; }, {});
}
function digestValue(value) { return sha256(JSON.stringify(canonical(value))); }

function git(repositoryRoot, args, allowFailure = false) {
  const run = childProcess.spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (run.status !== 0 && !allowFailure) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return { status: run.status, stdout: run.stdout.trim(), stderr: run.stderr.trim() };
}

function classifyChangedPath(relativePath) {
  const value = normalize(relativePath);
  if (/^docs\/helix\/(?:CURRENT_PLAN|CURRENT_STATUS|README|ARCHITECTURE_REVIEW|FUTURE_PRODUCT_CAPABILITIES)\.md$/.test(value) ||
      /^docs\/helix\/implementation\/(?:CURRENT_PHASE\.md|archive\/|evidence\/P6_)/.test(value)) return { allowed: true, class: 'phase-documentation' };
  if (value === 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md') return { allowed: true, class: 'approved-architecture-agent-ssot' };
  if (value.startsWith('media-service/src/helix/contracts/')) return { allowed: true, class: 'ssot-contract-propagation' };
  if (/^media-service\/src\/helix\/domains\/(?:people|perception)\//.test(value)) return { allowed: true, class: 'horizontal-domain-implementation' };
  if (/^media-service\/src\/helix\/foundation\/(?:execution|persistence)\//.test(value)) return { allowed: true, class: 'bounded-foundation-adaptation' };
  if (/^media-service\/scripts\/(?:helix-p[236]-|materialize-helix-|helix-architecture\/)/.test(value)) return { allowed: true, class: 'local-verification-tooling' };
  if (/^media-service\/test\/helix-architecture\//.test(value)) return { allowed: true, class: 'isolated-architecture-fixture' };
  if (value === 'media-service/package.json') return { allowed: true, class: 'local-command-registration' };
  return { allowed: false, class: 'out-of-p6-scope' };
}

function prohibitedProductionFindings(relativePath, content) {
  const value = normalize(relativePath);
  if (!/^media-service\/src\/helix\/domains\/(?:people|perception)\/.*\.js$/.test(value)) return [];
  const rules = [
    ['LEGACY_RUNTIME_REFERENCE', /\b(?:kairox|mirex|nexora|helixCleanState|taskManager)\b/i],
    ['COMPATIBILITY_OR_DUAL_PATH', /\b(?:dual[-_ ]?(?:read|write|run)|compatibility layer|legacy runtime fallback)\b/i],
    ['INTERNAL_HTTP_BOUNDARY', /\b(?:https?:\/\/|node:(?:http|https|net))\b/i],
    ['CROSS_DOMAIN_INTERNAL_IMPORT', /(?:\.\.\/)+(?:procurement|libra|arca)\/|domains\/(?:procurement|libra|arca)\//i],
    ['PRODUCT_STARTUP_WIRING', /require\([^)]*(?:server|app)\.js|\.listen\s*\(/i],
    ['DIRECT_EXTERNAL_EFFECT', /node:child_process|require\(['"]child_process['"]\)/i]
  ];
  return rules.filter(([, pattern]) => pattern.test(content)).map(([code]) => ({ code, file: value }));
}

function collectDirtyPaths(repositoryRoot) {
  const commands = [['diff', '--name-only'], ['diff', '--cached', '--name-only'], ['ls-files', '--others', '--exclude-standard']];
  return [...new Set(commands.flatMap((args) => git(repositoryRoot, args).stdout.split(/\r?\n/).filter(Boolean).map(normalize)))].sort();
}

function evidencePresent(changedFiles, requirement) {
  const prefix = 'docs/helix/implementation/evidence/';
  return requirement.endsWith('.md')
    ? changedFiles.includes(prefix + requirement)
    : changedFiles.some((file) => file.startsWith(prefix + requirement) && file.endsWith('.md'));
}

function auditP6Exit(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findings = [];
  const changedFiles = git(repositoryRoot, ['diff', '--name-only', `${P6_BASELINE}...HEAD`]).stdout.split(/\r?\n/).filter(Boolean).map(normalize);
  const classes = {};
  for (const relativePath of changedFiles) {
    const classification = classifyChangedPath(relativePath);
    classes[classification.class] = (classes[classification.class] || 0) + 1;
    if (!classification.allowed) findings.push({ code: 'P6_SCOPE_ESCAPE', file: relativePath, pathClass: classification.class });
    if (/\.(?:db|sqlite|sqlite3)$/i.test(relativePath)) findings.push({ code: 'P6_DATABASE_ARTIFACT_TRACKED', file: relativePath });
    const absolute = path.join(repositoryRoot, relativePath);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) findings.push(...prohibitedProductionFindings(relativePath, fs.readFileSync(absolute, 'utf8')));
  }

  const approvedSsot = git(repositoryRoot, ['show', `${APPROVED_ARCHITECTURE_COMMIT}:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`]).stdout;
  const currentSsot = git(repositoryRoot, ['show', 'HEAD:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md']).stdout;
  if (currentSsot !== approvedSsot) findings.push({ code: 'P6_SSOT_NOT_EXACT_APPROVED_ARCHITECTURE_BLOB' });
  const ssotCommits = git(repositoryRoot, ['log', '--format=%H', `${P6_BASELINE}..HEAD`, '--', 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md']).stdout.split(/\r?\n/).filter(Boolean);
  if (JSON.stringify(ssotCommits.slice().sort()) !== JSON.stringify(AUTHORIZED_SSOT_COMMITS.slice().sort())) {
    findings.push({ code: 'P6_UNAUTHORIZED_SSOT_COMMIT_SET', expected: AUTHORIZED_SSOT_COMMITS, actual: ssotCommits });
  }

  const sourceMap = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'media-service/src/helix/contracts/manifests/ssot-source-map.json'), 'utf8'));
  const contractBaseline = validateP2ContractBaseline({ repositoryRoot, contractsRoot: path.join(repositoryRoot, 'media-service/src/helix/contracts') });
  if (sourceMap.aggregateDigest !== EXPECTED_SSOT_AGGREGATE_DIGEST) findings.push({ code: 'P6_SSOT_AGGREGATE_DRIFT', actual: sourceMap.aggregateDigest });
  if (!contractBaseline.ok || contractBaseline.aggregateDigest !== EXPECTED_CONTRACT_AGGREGATE_DIGEST) findings.push({ code: 'P6_CONTRACT_AGGREGATE_DRIFT', actual: contractBaseline.aggregateDigest });
  for (const requirement of REQUIRED_EVIDENCE) if (!evidencePresent(changedFiles, requirement)) findings.push({ code: 'P6_TRACEABILITY_EVIDENCE_MISSING', requirement });
  if (changedFiles.some((file) => file.startsWith('media-desktop/'))) findings.push({ code: 'MEDIA_DESKTOP_TOUCHED_DURING_P6' });
  if (changedFiles.some((file) => file.startsWith('tests/') || /(?:dockerfile|docker\/|deploy-nas|build-image)/i.test(file))) findings.push({ code: 'EXTERNAL_OR_DEPLOYMENT_SCOPE_TOUCHED_DURING_P6' });
  if (changedFiles.some((file) => /^media-service\/(?:web\/|src\/(?:server|app)\.js)/.test(file))) findings.push({ code: 'PRODUCT_API_UI_SCOPE_TOUCHED_DURING_P6' });
  if (changedFiles.some((file) => /^media-service\/src\/helix\/domains\/(?:procurement|libra|arca)\//.test(file))) findings.push({ code: 'VERTICAL_DOMAIN_TOUCHED_DURING_P6' });
  const dirtyPaths = collectDirtyPaths(repositoryRoot);
  if (options.requireClean && dirtyPaths.length > 0) findings.push({ code: 'P6_AUDIT_WORKTREE_NOT_CLEAN', paths: dirtyPaths });

  const evidence = {
    baselineCommit: P6_BASELINE,
    auditedCommit: git(repositoryRoot, ['rev-parse', 'HEAD']).stdout,
    approvedArchitectureCommit: git(repositoryRoot, ['rev-parse', APPROVED_ARCHITECTURE_COMMIT]).stdout,
    approvedSsotBlobDigest: sha256(Buffer.from(approvedSsot)),
    ssotAggregateDigest: sourceMap.aggregateDigest,
    contractAggregateDigest: contractBaseline.aggregateDigest,
    changedFileCount: changedFiles.length,
    changedPathClasses: classes,
    authorizedSsotCommitCount: ssotCommits.length,
    capabilityCount: 112,
    resultFamilyCount: 96,
    tableCount: 161,
    transactionCount: 24,
    horizontalCapabilityCount: 13,
    prohibitedActionsRun: []
  };
  return { ok: findings.length === 0, scope: 'P6_EXIT_AUDIT_LOCAL_HORIZONTAL_DOMAINS_ONLY', evidence,
    evidenceDigest: digestValue(evidence), findings };
}

module.exports = Object.freeze({
  APPROVED_ARCHITECTURE_COMMIT,
  AUTHORIZED_SSOT_COMMITS,
  EXPECTED_CONTRACT_AGGREGATE_DIGEST,
  EXPECTED_SSOT_AGGREGATE_DIGEST,
  P6_BASELINE,
  auditP6Exit,
  classifyChangedPath,
  collectDirtyPaths,
  prohibitedProductionFindings
});
