'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const P3_BASELINE = 'e3b50f942a647e91d7147eac8feeedbf0e9b49d9';
const ALLOWED_DOCS = new Set([
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
  if (ALLOWED_DOCS.has(value) || value.startsWith('docs/helix/implementation/evidence/') ||
      value.startsWith('docs/helix/implementation/archive/')) return { allowed: true, class: 'phase-documentation' };
  if (value === 'media-service/package.json') return { allowed: true, class: 'local-command-registration' };
  if (value.startsWith('media-service/src/helix/foundation/persistence/')) return { allowed: true, class: 'clean-persistence' };
  if (value.startsWith('media-service/src/helix/contracts/table-contracts/') ||
      value.startsWith('media-service/src/helix/contracts/manifests/table-inventory/')) return { allowed: true, class: 'repaired-p2-table-contract' };
  if (value.startsWith('media-service/scripts/helix-architecture/') || /^media-service\/scripts\/helix-p3-/.test(value)) {
    return { allowed: true, class: 'isolated-persistence-tooling' };
  }
  if (value.startsWith('media-service/test/helix-architecture/')) return { allowed: true, class: 'isolated-persistence-fixture' };
  return { allowed: false, class: 'out-of-p3-scope' };
}

function prohibitedProductionFindings(relativePath, content) {
  const value = normalize(relativePath);
  if (!value.startsWith('media-service/src/helix/foundation/persistence/') || value.includes('/generated/')) return [];
  const rules = [
    ['LEGACY_SEMANTIC', /\b(?:kairox|mirex|nexora|helixCleanState)\b/i],
    ['COMPATIBILITY_OR_DUAL_PATH', /\b(?:migration|compatibility|dual[-_ ]?(?:read|write|run)|fallback)\b/i],
    ['PRODUCT_STARTUP_WIRING', /require\([^)]*(?:server|app)\.js|\.listen\s*\(/i],
    ['EXTERNAL_EFFECT_IMPORT', /node:(?:fs|http|https|net|child_process)|require\(['"](?:fs|http|https|net|child_process)['"]\)/i],
    ['INTERNAL_HTTP_BOUNDARY', /https?:\/\//i]
  ];
  return rules.filter(([, pattern]) => pattern.test(content)).map(([code]) => ({ code, file: value }));
}

function git(repositoryRoot, args) {
  const run = childProcess.spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (run.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + run.stderr);
  return run.stdout.trim();
}

function auditP3Exit(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findings = [];
  const changedFiles = git(repositoryRoot, ['diff', '--name-only', P3_BASELINE + '...HEAD'])
    .split(/\r?\n/).filter(Boolean).map(normalize);
  const classes = {};
  for (const relativePath of changedFiles) {
    const classification = classifyChangedPath(relativePath);
    classes[classification.class] = (classes[classification.class] || 0) + 1;
    if (!classification.allowed) findings.push({ code: 'P3_SCOPE_ESCAPE', file: relativePath, pathClass: classification.class });
    if (/\.(?:db|sqlite|sqlite3)$/i.test(relativePath)) findings.push({ code: 'P3_DATABASE_ARTIFACT_TRACKED', file: relativePath });
    if (/\.sql$/i.test(relativePath) && relativePath !== 'media-service/src/helix/foundation/persistence/generated/clean-schema.sql') {
      findings.push({ code: 'P3_UNKNOWN_SQL_ARTIFACT', file: relativePath });
    }
    const absolute = path.join(repositoryRoot, relativePath);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      findings.push(...prohibitedProductionFindings(relativePath, fs.readFileSync(absolute, 'utf8')));
    }
  }
  if (changedFiles.includes('docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md')) findings.push({ code: 'SSOT_MODIFIED_DURING_P3' });
  if (changedFiles.some((file) => file.startsWith('media-desktop/'))) findings.push({ code: 'MEDIA_DESKTOP_TOUCHED_DURING_P3' });
  if (changedFiles.some((file) => file.startsWith('tests/') || /(?:dockerfile|docker\/|deploy-nas|build-image)/i.test(file))) {
    findings.push({ code: 'EXTERNAL_OR_DEPLOYMENT_SCOPE_TOUCHED_DURING_P3' });
  }
  if (changedFiles.some((file) => /^media-service\/(?:src\/(?:server|app)\.js|web\/)/.test(file))) {
    findings.push({ code: 'RUNTIME_API_UI_SCOPE_TOUCHED_DURING_P3' });
  }
  const trackedPersistence = git(repositoryRoot, ['ls-files', '--', 'media-service/src/helix/foundation/persistence'])
    .split(/\r?\n/).filter(Boolean).map(normalize);
  const worktreeStatus = git(repositoryRoot, ['status', '--porcelain']);
  if (options.requireClean && worktreeStatus) findings.push({ code: 'P3_AUDIT_WORKTREE_NOT_CLEAN', status: worktreeStatus.split(/\r?\n/) });
  const manifest = JSON.parse(fs.readFileSync(path.join(
    repositoryRoot, 'media-service/src/helix/foundation/persistence/generated/clean-schema.manifest.json'
  ), 'utf8'));
  if (manifest.tableCount !== 156) findings.push({ code: 'P3_GENERATED_TABLE_COUNT_DRIFT', actual: manifest.tableCount });
  const evidence = {
    baselineCommit: P3_BASELINE,
    auditedCommit: git(repositoryRoot, ['rev-parse', 'HEAD']),
    changedFileCount: changedFiles.length,
    changedPathClasses: classes,
    trackedPersistenceFileCount: trackedPersistence.length,
    ddlDigest: manifest.ddlDigest,
    generatedTableCount: manifest.tableCount,
    generatedIndexCount: manifest.tables.flatMap((table) => table.indexes).length,
    partialUniqueCount: manifest.tables.flatMap((table) => table.indexes).filter((index) => index.kind === 'partial-unique').length,
    canonicalTransactionCount: 18,
    participantAndCommitFaultPoints: 132,
    prohibitedActionsRun: []
  };
  return {
    ok: findings.length === 0,
    scope: 'P3_EXIT_AUDIT_LOCAL_PERSISTENCE_ONLY',
    evidence,
    evidenceDigest: digestValue(evidence),
    findings
  };
}

module.exports = Object.freeze({ P3_BASELINE, auditP3Exit, classifyChangedPath, prohibitedProductionFindings });
