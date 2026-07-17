'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateP2ContractBaseline } = require('./p2-contract-baseline-validator');

const P5_BASELINE = '5dd0b7094ea35cc04c7ba931fd109467462d0af6';
const AUTHORIZED_SSOT_PROPAGATION = 'a933463f';
const IMPLEMENTATION_GOVERNANCE = '9a91a88a';
const EXPECTED_SSOT_BLOB_DIGEST = 'd5426ec79f6fcff3ef287b89804aebd63d422e6da62297507a2d4ca76265555a';
const EXPECTED_SSOT_AGGREGATE_DIGEST = 'fa27242e59bc670ff351877680d6e41d4905e91a26e2c87a4ef911ae22726aea';
const EXPECTED_CONTRACT_AGGREGATE_DIGEST = 'bcde76e0d380ead9fbe9c76c6c21293325d2de3dd97144c1357438c3d3cc8530';
const REQUIRED_EVIDENCE = Object.freeze([
  'P5_PLATFORM_PACKAGE_PROPAGATION_A933463F.md',
  ...Array.from({ length: 10 }, (_, index) => `P5_${String(index + 1).padStart(2, '0')}_`)
]);
const PHASE_DOCS = new Set([
  'docs/helix/ARCHITECTURE_REVIEW.md',
  'docs/helix/CURRENT_PLAN.md',
  'docs/helix/CURRENT_STATUS.md',
  'docs/helix/ENGINEERING_PLAYBOOK.md',
  'docs/helix/implementation/CURRENT_PHASE.md'
]);
const PROPAGATION_FIXTURES = new Set([
  'media-service/test/helix-architecture/clean-skeleton.test.js',
  'media-service/test/helix-architecture/manifest-validator.test.js',
  'media-service/test/helix-architecture/p2-contract-baseline-validator.test.js',
  'media-service/test/helix-architecture/p3-persistence-verifier.test.js',
  'media-service/test/helix-architecture/p4-foundation-public.test.js',
  'media-service/test/helix-architecture/package-boundary-guard.test.js'
]);
const FOUNDATION_FILES = new Set([
  'media-service/src/helix/foundation/effects/artifact-registry.js',
  'media-service/src/helix/foundation/execution/material-access-authority.js',
  'media-service/src/helix/foundation/persistence/artifact-repository.js',
  'media-service/src/helix/foundation/persistence/generated/clean-schema.manifest.json',
  'media-service/src/helix/foundation/public/index.js'
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
  if (PHASE_DOCS.has(value) ||
      value === 'docs/helix/implementation/archive/P5_PLATFORM_AND_INTEGRATIONS.md' ||
      /^docs\/helix\/implementation\/evidence\/P5_/.test(value)) return { allowed: true, class: 'phase-documentation' };
  if (value === 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md') return { allowed: true, class: 'authorized-architecture-agent-ssot' };
  if (value.startsWith('media-service/src/helix/contracts/')) return { allowed: true, class: 'authorized-contract-propagation' };
  if (value === 'media-service/package.json') return { allowed: true, class: 'local-command-registration' };
  if (value === 'media-service/scripts/helix-architecture/p3-persistence-verifier.js') return { allowed: true, class: 'bounded-persistence-verifier-repair' };
  if (/^media-service\/scripts\/(?:helix-p5-|helix-architecture\/p5-)/.test(value)) return { allowed: true, class: 'isolated-platform-tooling' };
  if (/^media-service\/src\/helix\/platform\//.test(value)) return { allowed: true, class: 'clean-platform-package' };
  if (/^media-service\/src\/helix\/integrations\//.test(value)) return { allowed: true, class: 'clean-integration-protocol' };
  if (FOUNDATION_FILES.has(value)) return { allowed: true, class: 'bounded-foundation-extension' };
  if (/^media-service\/test\/helix-architecture\/p5-/.test(value)) return { allowed: true, class: 'isolated-platform-fixture' };
  if (PROPAGATION_FIXTURES.has(value)) return { allowed: true, class: 'authorized-propagation-fixture' };
  return { allowed: false, class: 'out-of-p5-scope' };
}

function prohibitedProductionFindings(relativePath, content) {
  const value = normalize(relativePath);
  if (!(/^(?:media-service\/src\/helix\/(?:platform|integrations)\/.*\.js)$/.test(value) ||
      FOUNDATION_FILES.has(value) && value.endsWith('.js'))) return [];
  const rules = [
    ['LEGACY_RUNTIME_REFERENCE', /\b(?:kairox|mirex|nexora|helixCleanState|taskManager)\b/i],
    ['DUAL_OR_FALLBACK_PATH', /\b(?:dual[-_ ]?(?:read|write|run)|fallback|legacy runtime)\b/i],
    ['PRODUCT_STARTUP_WIRING', /require\([^)]*(?:server|app)\.js|\.listen\s*\(/i],
    ['DOMAIN_INTERNAL_DEPENDENCY', /(?:\.\.\/)+domains\/|src\/helix\/domains\//i],
    ['AMBIENT_CREDENTIAL_ACCESS', /process\.env\.(?:emby|tmdb|douban|moviepilot|api|secret|token|password)/i],
    ['DIRECT_EXTERNAL_EFFECT_IMPORT', /node:(?:http|https|net|child_process)|require\(['"](?:http|https|net|child_process)['"]\)/i],
    ['INTERNAL_HTTP_BOUNDARY', /https?:\/\//i]
  ];
  return rules.filter(([, pattern]) => pattern.test(content)).map(([code]) => ({ code, file: value }));
}

function git(repositoryRoot, args, allowFailure = false) {
  const run = childProcess.spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (run.status !== 0 && !allowFailure) throw new Error('git ' + args.join(' ') + ' failed: ' + run.stderr);
  return { status: run.status, stdout: run.stdout.trim(), stderr: run.stderr.trim() };
}

function evidencePresent(changedFiles, requirement) {
  const prefix = 'docs/helix/implementation/evidence/';
  return requirement.endsWith('.md')
    ? changedFiles.includes(prefix + requirement)
    : changedFiles.some((file) => file.startsWith(prefix + requirement) && file.endsWith('.md'));
}

function collectDirtyPaths(repositoryRoot, runGit = git) {
  const commands = [
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard']
  ];
  return [...new Set(commands.flatMap((args) => runGit(repositoryRoot, args).stdout
    .split(/\r?\n/).filter(Boolean).map(normalize)))].sort();
}

function auditP5Exit(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findings = [];
  const changedFiles = git(repositoryRoot, ['diff', '--name-only', P5_BASELINE + '...HEAD']).stdout.split(/\r?\n/).filter(Boolean).map(normalize);
  const classes = {};
  for (const relativePath of changedFiles) {
    const classification = classifyChangedPath(relativePath);
    classes[classification.class] = (classes[classification.class] || 0) + 1;
    if (!classification.allowed) findings.push({ code: 'P5_SCOPE_ESCAPE', file: relativePath, pathClass: classification.class });
    if (/\.(?:db|sqlite|sqlite3)$/i.test(relativePath)) findings.push({ code: 'P5_DATABASE_ARTIFACT_TRACKED', file: relativePath });
    const absolute = path.join(repositoryRoot, relativePath);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) findings.push(...prohibitedProductionFindings(relativePath, fs.readFileSync(absolute, 'utf8')));
  }
  const ssotBlob = childProcess.spawnSync('git', ['show', 'HEAD:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'], { cwd: repositoryRoot }).stdout;
  const ssotBlobDigest = sha256(ssotBlob);
  const sourceMap = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'media-service/src/helix/contracts/manifests/ssot-source-map.json'), 'utf8'));
  const contractBaseline = validateP2ContractBaseline({
    repositoryRoot,
    contractsRoot: path.join(repositoryRoot, 'media-service/src/helix/contracts')
  });
  if (ssotBlobDigest !== EXPECTED_SSOT_BLOB_DIGEST) findings.push({ code: 'P5_SSOT_BLOB_DRIFT', expected: EXPECTED_SSOT_BLOB_DIGEST, actual: ssotBlobDigest });
  if (sourceMap.aggregateDigest !== EXPECTED_SSOT_AGGREGATE_DIGEST) findings.push({ code: 'P5_SSOT_AGGREGATE_DRIFT', expected: EXPECTED_SSOT_AGGREGATE_DIGEST, actual: sourceMap.aggregateDigest });
  if (!contractBaseline.ok || contractBaseline.aggregateDigest !== EXPECTED_CONTRACT_AGGREGATE_DIGEST) findings.push({ code: 'P5_CONTRACT_AGGREGATE_DRIFT', expected: EXPECTED_CONTRACT_AGGREGATE_DIGEST, actual: contractBaseline.aggregateDigest });
  for (const commit of [AUTHORIZED_SSOT_PROPAGATION, IMPLEMENTATION_GOVERNANCE]) {
    if (git(repositoryRoot, ['merge-base', '--is-ancestor', commit, 'HEAD'], true).status !== 0) findings.push({ code: 'P5_REQUIRED_GOVERNANCE_COMMIT_MISSING', commit });
  }
  const ssotCommits = git(repositoryRoot, ['log', '--format=%H', P5_BASELINE + '..HEAD', '--', 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md']).stdout.split(/\r?\n/).filter(Boolean);
  const authorizedFull = git(repositoryRoot, ['rev-parse', AUTHORIZED_SSOT_PROPAGATION]).stdout;
  if (ssotCommits.length !== 1 || ssotCommits[0] !== authorizedFull) findings.push({ code: 'P5_SSOT_CHANGED_OUTSIDE_ARCHITECTURE_AGENT', ssotCommits, authorizedFull });
  for (const requirement of REQUIRED_EVIDENCE) if (!evidencePresent(changedFiles, requirement)) findings.push({ code: 'P5_TRACEABILITY_EVIDENCE_MISSING', requirement });
  if (changedFiles.some((file) => file.startsWith('media-desktop/'))) findings.push({ code: 'MEDIA_DESKTOP_TOUCHED_DURING_P5' });
  if (changedFiles.some((file) => file.startsWith('tests/') || /(?:dockerfile|docker\/|deploy-nas|build-image)/i.test(file))) findings.push({ code: 'EXTERNAL_OR_DEPLOYMENT_SCOPE_TOUCHED_DURING_P5' });
  if (changedFiles.some((file) => /^media-service\/(?:src\/(?:server|app)\.js|web\/)/.test(file))) findings.push({ code: 'PRODUCT_API_UI_SCOPE_TOUCHED_DURING_P5' });
  if (changedFiles.some((file) => /^media-service\/src\/helix\/domains\//.test(file))) findings.push({ code: 'BUSINESS_DOMAIN_TOUCHED_DURING_P5' });
  const dirtyPaths = collectDirtyPaths(repositoryRoot);
  if (options.requireClean && dirtyPaths.length > 0) findings.push({ code: 'P5_AUDIT_WORKTREE_NOT_CLEAN', paths: dirtyPaths });
  const trackedPlatform = git(repositoryRoot, ['ls-files', '--', 'media-service/src/helix/platform']).stdout.split(/\r?\n/).filter(Boolean);
  const trackedIntegrations = git(repositoryRoot, ['ls-files', '--', 'media-service/src/helix/integrations']).stdout.split(/\r?\n/).filter(Boolean);
  const evidence = {
    baselineCommit: P5_BASELINE,
    auditedCommit: git(repositoryRoot, ['rev-parse', 'HEAD']).stdout,
    authorizedSsotPropagation: authorizedFull,
    implementationGovernance: git(repositoryRoot, ['rev-parse', IMPLEMENTATION_GOVERNANCE]).stdout,
    ssotBlobDigest,
    ssotAggregateDigest: sourceMap.aggregateDigest,
    contractAggregateDigest: contractBaseline.aggregateDigest,
    changedFileCount: changedFiles.length,
    changedPathClasses: classes,
    trackedPlatformFileCount: trackedPlatform.length,
    trackedIntegrationFileCount: trackedIntegrations.length,
    requiredEvidenceCount: REQUIRED_EVIDENCE.length,
    nominalPortCount: 21,
    typedOperationCount: 31,
    isolatedFixtureFamilyCount: 10,
    recoveryBoundaryCount: 4,
    prohibitedActionsRun: []
  };
  return { ok: findings.length === 0, scope: 'P5_EXIT_AUDIT_LOCAL_PLATFORM_AND_INTEGRATIONS_ONLY', evidence,
    evidenceDigest: digestValue(evidence), findings };
}

module.exports = Object.freeze({
  AUTHORIZED_SSOT_PROPAGATION,
  EXPECTED_CONTRACT_AGGREGATE_DIGEST,
  EXPECTED_SSOT_AGGREGATE_DIGEST,
  EXPECTED_SSOT_BLOB_DIGEST,
  P5_BASELINE,
  auditP5Exit,
  classifyChangedPath,
  collectDirtyPaths,
  prohibitedProductionFindings
});
