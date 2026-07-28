'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const serviceRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(serviceRoot, '..');
const IMMUTABLE_VERTICAL_BASELINE =
  'ddc3e51909ca4e9f5729c4326b05daee4792326f';

const H1_PHASES = Object.freeze([
  'H1.0',
  'H1.1',
  'H1.2',
  'H1.3',
  'H1.4',
  'H1.5',
]);

const FROZEN_VERTICAL_SENTINEL_FILES = Object.freeze([
  'media-service/test/helix-architecture/p14-clean-service-entrypoint.test.js',
  'media-service/test/helix-architecture/p14-series-handoff-a.test.js',
  'media-service/test/helix-architecture/p14-jav-routing-spec-run.test.js',
  'media-service/test/helix-architecture/p14-western-routing-spec-run.test.js',
  'media-service/test/helix-architecture/p14-workspace-cleanup-audit.test.js',
]);

const H1_0_ALLOWED = Object.freeze([
  'docs/helix/implementation/CURRENT_PHASE.md',
  'docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md',
  'media-service/scripts/p14-h1-change-scope-guard.js',
  'media-service/test/helix-architecture/p14-h1-change-scope-guard.test.js',
]);

const GOVERNANCE_REVIEW_FILES = Object.freeze([...H1_0_ALLOWED]);

const IMPLEMENTATION_EVIDENCE_PREFIX =
  'docs/helix/implementation/evidence/';
const COMMON_FUTURE_ALLOWED_PREFIXES = Object.freeze([
  IMPLEMENTATION_EVIDENCE_PREFIX,
  'media-service/src/helix/platform/',
  'media-service/src/helix/integrations/',
  'media-service/src/helix/composition/',
  'media-service/test/helix-architecture/',
]);
const COMMON_FUTURE_ALLOWED_FILES = Object.freeze([
  'docs/helix/implementation/CURRENT_PHASE.md',
  'docs/helix/implementation/evidence/P14_BETA_IMPL_03_PRODUCT_SURFACE_CONSTRUCTION_MATRIX.md',
  'media-service/src/clean-service-host.js',
  'media-service/scripts/p14-h1-change-scope-guard.js',
  'media-service/test/helix-architecture/p14-h1-change-scope-guard.test.js',
]);

const FORBIDDEN_PREFIXES = Object.freeze([
  'media-worker/',
  'media-desktop/',
  'media-service/src/helix/contracts/',
  'media-service/src/helix/domains/',
  'media-service/src/helix/foundation/',
  'media-service/src/legacy/',
]);
const FORBIDDEN_FILES = Object.freeze([
  'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
  'docs/helix/BETA_FEATURE_ACCEPTANCE_BASELINE.md',
  'media-service/src/app.js',
]);

const SENTINEL_REGRESSIONS = Object.freeze({
  'H1.0': Object.freeze([
    'test/helix-architecture/p14-h1-change-scope-guard.test.js',
  ]),
  'H1.1': Object.freeze([
    'test/helix-architecture/p5-secret-lease.test.js',
    'test/helix-architecture/p5-provider-protocol.test.js',
    'test/helix-architecture/p5-public-ports.test.js',
    'test/helix-architecture/p5-integration-verifier.test.js',
    'test/helix-architecture/p14-clean-service-entrypoint.test.js',
    'test/helix-architecture/p14-series-handoff-a.test.js',
    'test/helix-architecture/p14-jav-routing-spec-run.test.js',
    'test/helix-architecture/p14-western-routing-spec-run.test.js',
    'test/helix-architecture/p14-workspace-cleanup-audit.test.js',
  ]),
  'H1.2': Object.freeze([
    'test/helix-architecture/p5-provider-protocol.test.js',
    'test/helix-architecture/p5-integration-verifier.test.js',
    'test/helix-architecture/p14-clean-service-entrypoint.test.js',
    'test/helix-architecture/p14-series-handoff-a.test.js',
    'test/helix-architecture/p14-jav-routing-spec-run.test.js',
    'test/helix-architecture/p14-western-routing-spec-run.test.js',
    'test/helix-architecture/p14-workspace-cleanup-audit.test.js',
  ]),
  'H1.3': Object.freeze([
    'test/helix-architecture/p5-location-registry.test.js',
    'test/helix-architecture/p5-resource-worker-registry.test.js',
    'test/helix-architecture/p13-operational-cutover.test.js',
    'test/helix-architecture/p14-clean-service-entrypoint.test.js',
    'test/helix-architecture/p14-series-handoff-a.test.js',
    'test/helix-architecture/p14-jav-routing-spec-run.test.js',
    'test/helix-architecture/p14-western-routing-spec-run.test.js',
    'test/helix-architecture/p14-workspace-cleanup-audit.test.js',
  ]),
  'H1.4': Object.freeze([
    'test/helix-architecture/p5-artifact-registry.test.js',
    'test/helix-architecture/p6-people-reference-lifecycle.test.js',
    'test/helix-architecture/p14-western-routing-spec-run.test.js',
    'test/helix-architecture/p14-clean-service-entrypoint.test.js',
    'test/helix-architecture/p14-series-handoff-a.test.js',
    'test/helix-architecture/p14-jav-routing-spec-run.test.js',
    'test/helix-architecture/p14-workspace-cleanup-audit.test.js',
  ]),
  'H1.5': Object.freeze([
    'test/helix-architecture/p12-product-surface.test.js',
    'test/helix-architecture/p13-operational-cutover.test.js',
    'test/helix-architecture/p14-clean-service-entrypoint.test.js',
    'test/helix-architecture/p14-series-handoff-a.test.js',
    'test/helix-architecture/p14-jav-routing-spec-run.test.js',
    'test/helix-architecture/p14-western-routing-spec-run.test.js',
    'test/helix-architecture/p14-workspace-cleanup-audit.test.js',
  ]),
});

function normalizePath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '');
}

function phaseAllowedFiles(phase) {
  if (phase === 'H1.0') return new Set(H1_0_ALLOWED);
  const files = new Set(COMMON_FUTURE_ALLOWED_FILES);
  if (phase === 'H1.4') {
    files.add('media-service/package.json');
    files.add('media-service/package-lock.json');
  }
  return files;
}

function phaseAllowedPrefixes(phase) {
  if (phase === 'H1.0') return [];
  const prefixes = [...COMMON_FUTURE_ALLOWED_PREFIXES];
  if (phase === 'H1.5') prefixes.push('media-service/src/helix/projections/');
  return prefixes;
}

function classifyPath(phase, inputPath) {
  if (!H1_PHASES.includes(phase)) {
    throw new TypeError(`Unknown H1 phase: ${phase}`);
  }
  const file = normalizePath(inputPath);
  if (FROZEN_VERTICAL_SENTINEL_FILES.includes(file)) {
    return Object.freeze({
      allowed: false,
      file,
      reason: 'immutable_vertical_sentinel',
    });
  }
  if (FORBIDDEN_FILES.includes(file) ||
      FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return Object.freeze({
      allowed: false,
      file,
      reason: 'immutable_vertical_or_product_boundary',
    });
  }
  if (GOVERNANCE_REVIEW_FILES.includes(file) &&
      phaseAllowedFiles(phase).has(file)) {
    return Object.freeze({
      allowed: true,
      file,
      reason: 'governance_checkpoint_review',
    });
  }
  if (phaseAllowedFiles(phase).has(file) ||
      phaseAllowedPrefixes(phase).some((prefix) => file.startsWith(prefix))) {
    return Object.freeze({ allowed: true, file, reason: 'phase_allowlist' });
  }
  return Object.freeze({
    allowed: false,
    file,
    reason: 'outside_phase_construction_seam',
  });
}

function gitLines(args) {
  const value = execFileSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  return value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
}

function changedPaths(base = IMMUTABLE_VERTICAL_BASELINE) {
  return [...new Set([
    ...gitLines(['diff', '--name-only', base, '--']),
    ...gitLines(['ls-files', '--others', '--exclude-standard']),
  ].map(normalizePath))].sort();
}

function routeImplementationStatus() {
  const registry = require('../src/helix/composition/admin-route-registry');
  const source = fs.readFileSync(
    path.join(serviceRoot, 'src/helix/composition/create-clean-facades.js'),
    'utf8',
  );
  const implemented = new Set();
  const assignment = /facades\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*=/gu;
  for (const match of source.matchAll(assignment)) {
    implemented.add(`${match[1]}.${match[2]}`);
  }
  const rows = registry.entries.map((route) => {
    const key = `${route.facade}.${route.facadeMethod}`;
    const worker404 = route.facade === 'PlatformAdminFacade' &&
      route.facadeMethod.includes('workers');
    return Object.freeze({
      routeId: route.routeId,
      state: implemented.has(key)
        ? 'real'
        : worker404
          ? 'worker_beta_404'
          : 'unavailable_503',
    });
  });
  const counts = Object.freeze({
    total: rows.length,
    real: rows.filter((row) => row.state === 'real').length,
    workerBeta404: rows.filter((row) => row.state === 'worker_beta_404').length,
    unavailable503: rows.filter((row) => row.state === 'unavailable_503').length,
  });
  return Object.freeze({ counts, rows: Object.freeze(rows) });
}

function evaluatePaths(
  phase,
  inputFiles,
  base = IMMUTABLE_VERTICAL_BASELINE,
) {
  const files = [...new Set(inputFiles.map(normalizePath))].sort();
  const decisions = files.map((file) => classifyPath(phase, file));
  const violations = decisions.filter((item) => !item.allowed);
  const routeStatus = routeImplementationStatus();
  return Object.freeze({
    ok: violations.length === 0,
    phase,
    base,
    files,
    violations,
    governanceReviewRequired: decisions
      .filter((item) => item.reason === 'governance_checkpoint_review')
      .map((item) => item.file),
    routeStatus: routeStatus.counts,
    sentinelRegressions: SENTINEL_REGRESSIONS[phase],
  });
}

function verify(phase, base = IMMUTABLE_VERTICAL_BASELINE) {
  return evaluatePaths(phase, changedPaths(base), base);
}

function parseArgs(argv) {
  const result = {
    phase: 'H1.0',
    base: IMMUTABLE_VERTICAL_BASELINE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--phase') result.phase = argv[++index];
    else if (value === '--base') result.base = argv[++index];
    else throw new TypeError(`Unknown argument: ${value}`);
  }
  return result;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const report = verify(args.phase, args.base);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = Object.freeze({
  FROZEN_VERTICAL_SENTINEL_FILES,
  GOVERNANCE_REVIEW_FILES,
  H1_PHASES,
  IMMUTABLE_VERTICAL_BASELINE,
  SENTINEL_REGRESSIONS,
  changedPaths,
  classifyPath,
  evaluatePaths,
  routeImplementationStatus,
  verify,
});
