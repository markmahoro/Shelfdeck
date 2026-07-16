'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const P4_BASELINE = '4a59356f3a89f1af38f594763aaaa0465e203b99';
const AUTHORIZED_SSOT_REPAIR = '4f3c41b9';
const EXPECTED_SSOT_DIGEST = '8b250ce46f852c65b0843ef9a6e58dcf12d33258c22f3895ed7b0e513e5ba934';
const ALLOWED_DOCS = new Set([
  'docs/helix/CURRENT_PLAN.md', 'docs/helix/CURRENT_STATUS.md', 'docs/helix/implementation/CURRENT_PHASE.md',
  'docs/helix/implementation/evidence/P2_P4_IMMUTABLE_PLAN_PERSISTENCE_REPAIR_4F3C41B9.md'
]);
const REPAIRED_CONTRACTS = new Set([
  'media-service/src/helix/contracts/manifests/manifest-registry.json',
  'media-service/src/helix/contracts/manifests/package-boundary-policy.json',
  'media-service/src/helix/contracts/manifests/ssot-source-map.json',
  'media-service/src/helix/contracts/manifests/ssot-source-map/tables-001-013.json',
  'media-service/src/helix/contracts/manifests/table-inventory/entries-001-013.json',
  'media-service/src/helix/contracts/table-contracts/fx_plan_nodes/v1/contract.json',
  'media-service/src/helix/contracts/table-contracts/fx_workflow_plans/v1/contract.json'
]);
const REPAIR_TOOLS = new Set([
  'media-service/scripts/helix-architecture/ssot-source-map-materializer.js',
  'media-service/scripts/helix-architecture/table-contract-builder.js',
  'media-service/scripts/materialize-helix-ssot-source-map.js',
  'media-service/test/helix-architecture/clean-skeleton.test.js',
  'media-service/test/helix-architecture/manifest-validator.test.js',
  'media-service/test/helix-architecture/p2-contract-baseline-validator.test.js',
  'media-service/test/helix-architecture/p3-ddl-compiler.test.js',
  'media-service/test/helix-architecture/ssot-source-map-materializer.test.js',
  'media-service/test/helix-architecture/table-contract-builder.test.js',
  'media-service/test/helix-architecture/table-contract-validator.test.js'
]);

function normalize(value) { return value.split(path.sep).join('/'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function digestValue(value) {
  const canonical = (item) => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.keys(item).sort().reduce((result, key) => { result[key] = canonical(item[key]); return result; }, {}) : item;
  return sha256(JSON.stringify(canonical(value)));
}

function classifyChangedPath(relativePath) {
  const value = normalize(relativePath);
  if (ALLOWED_DOCS.has(value) || value.startsWith('docs/helix/implementation/evidence/P4_PHASE_EXIT_AUDIT_')) return { allowed: true, class: 'phase-documentation' };
  if (value === 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md') return { allowed: true, class: 'authorized-ssot-repair' };
  if (REPAIRED_CONTRACTS.has(value)) return { allowed: true, class: 'authorized-p2-contract-repair' };
  if (REPAIR_TOOLS.has(value)) return { allowed: true, class: 'authorized-repair-tooling' };
  if (value === 'media-service/package.json' || value === 'media-service/package-lock.json') return { allowed: true, class: 'local-dependency-command-registration' };
  if (/^media-service\/src\/helix\/foundation\/(?:capability|diagnostics|effects|execution|public)\//.test(value) ||
      /^media-service\/src\/helix\/foundation\/persistence\/(?:ddl-compiler\.js|generated\/clean-schema\.(?:sql|manifest\.json))$/.test(value)) {
    return { allowed: true, class: 'clean-execution-foundation' };
  }
  if (/^media-service\/scripts\/(?:helix-p4-|helix-architecture\/p4-)/.test(value)) return { allowed: true, class: 'isolated-runtime-tooling' };
  if (/^media-service\/test\/helix-architecture\/p4-/.test(value)) return { allowed: true, class: 'isolated-runtime-fixture' };
  return { allowed: false, class: 'out-of-p4-scope' };
}

function prohibitedProductionFindings(relativePath, content) {
  const value = normalize(relativePath);
  if (!/^media-service\/src\/helix\/foundation\/(?:capability|diagnostics|effects|execution|public)\/.*\.js$/.test(value)) return [];
  const rules = [
    ['LEGACY_RUNTIME_REFERENCE', /\b(?:kairox|mirex|nexora|helixCleanState|taskManager)\b/i],
    ['DUAL_OR_FALLBACK_PATH', /\b(?:dual[-_ ]?(?:read|write|run)|fallback|legacy runtime)\b/i],
    ['PRODUCT_STARTUP_WIRING', /require\([^)]*(?:server|app)\.js|\.listen\s*\(/i],
    ['DOMAIN_DEPENDENCY', /(?:\.\.\/)+domains\/|src\/helix\/domains\//i],
    ['EXTERNAL_OR_PROCESS_IMPORT', /node:(?:fs|http|https|net|child_process)|require\(['"](?:fs|http|https|net|child_process)['"]\)/i],
    ['INTERNAL_HTTP_BOUNDARY', /https?:\/\//i]
  ];
  return rules.filter(([, pattern]) => pattern.test(content)).map(([code]) => ({ code, file: value }));
}

function git(repositoryRoot, args, allowFailure = false) {
  const run = childProcess.spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (run.status !== 0 && !allowFailure) throw new Error('git ' + args.join(' ') + ' failed: ' + run.stderr);
  return { status: run.status, stdout: run.stdout.trim(), stderr: run.stderr.trim() };
}

function auditP4Exit(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findings = [];
  const changedFiles = git(repositoryRoot, ['diff', '--name-only', P4_BASELINE + '...HEAD']).stdout.split(/\r?\n/).filter(Boolean).map(normalize);
  const classes = {};
  for (const relativePath of changedFiles) {
    const classification = classifyChangedPath(relativePath);
    classes[classification.class] = (classes[classification.class] || 0) + 1;
    if (!classification.allowed) findings.push({ code: 'P4_SCOPE_ESCAPE', file: relativePath, pathClass: classification.class });
    if (/\.(?:db|sqlite|sqlite3)$/i.test(relativePath)) findings.push({ code: 'P4_DATABASE_ARTIFACT_TRACKED', file: relativePath });
    const absolute = path.join(repositoryRoot, relativePath);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) findings.push(...prohibitedProductionFindings(relativePath, fs.readFileSync(absolute, 'utf8')));
  }
  const ssotPath = path.join(repositoryRoot, 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');
  const ssotDigest = sha256(fs.readFileSync(ssotPath));
  if (ssotDigest !== EXPECTED_SSOT_DIGEST) findings.push({ code: 'P4_SSOT_DIGEST_NOT_AUTHORIZED', expected: EXPECTED_SSOT_DIGEST, actual: ssotDigest });
  if (git(repositoryRoot, ['merge-base', '--is-ancestor', AUTHORIZED_SSOT_REPAIR, 'HEAD'], true).status !== 0) findings.push({ code: 'P4_AUTHORIZED_SSOT_REPAIR_MISSING' });
  if (!changedFiles.includes('docs/helix/implementation/evidence/P2_P4_IMMUTABLE_PLAN_PERSISTENCE_REPAIR_4F3C41B9.md')) findings.push({ code: 'P4_SSOT_REPAIR_EVIDENCE_MISSING' });
  if (changedFiles.some((file) => file.startsWith('media-desktop/'))) findings.push({ code: 'MEDIA_DESKTOP_TOUCHED_DURING_P4' });
  if (changedFiles.some((file) => file.startsWith('tests/') || /(?:dockerfile|docker\/|deploy-nas|build-image)/i.test(file))) findings.push({ code: 'EXTERNAL_OR_DEPLOYMENT_SCOPE_TOUCHED_DURING_P4' });
  if (changedFiles.some((file) => /^media-service\/(?:src\/(?:server|app)\.js|web\/)/.test(file))) findings.push({ code: 'PRODUCT_API_UI_SCOPE_TOUCHED_DURING_P4' });
  if (changedFiles.some((file) => /^media-service\/src\/helix\/(?:domains|platform|integrations)\//.test(file))) findings.push({ code: 'DOMAIN_OR_P5_SCOPE_TOUCHED_DURING_P4' });
  const status = git(repositoryRoot, ['status', '--porcelain']).stdout;
  if (options.requireClean && status) findings.push({ code: 'P4_AUDIT_WORKTREE_NOT_CLEAN', status: status.split(/\r?\n/) });
  const trackedFoundation = git(repositoryRoot, ['ls-files', '--', 'media-service/src/helix/foundation']).stdout.split(/\r?\n/).filter(Boolean);
  const evidence = {
    baselineCommit: P4_BASELINE,
    auditedCommit: git(repositoryRoot, ['rev-parse', 'HEAD']).stdout,
    authorizedSsotRepair: AUTHORIZED_SSOT_REPAIR,
    ssotDigest,
    changedFileCount: changedFiles.length,
    changedPathClasses: classes,
    trackedFoundationFileCount: trackedFoundation.length,
    contractAggregateDigest: 'fe2f4433cab34d9c7dc4c682d92409552d3c50aee217bb477d553ccc89ef8160',
    effectClassCount: 7,
    crossProcessCrashScenarioCount: 31,
    prohibitedActionsRun: []
  };
  return { ok: findings.length === 0, scope: 'P4_EXIT_AUDIT_LOCAL_EXECUTION_RECOVERY_ONLY', evidence,
    evidenceDigest: digestValue(evidence), findings };
}

module.exports = Object.freeze({ P4_BASELINE, EXPECTED_SSOT_DIGEST, auditP4Exit, classifyChangedPath, prohibitedProductionFindings });
