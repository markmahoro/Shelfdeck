'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { checkPackageBoundaries } = require('./helix-architecture/package-boundary-guard');
const { checkForbiddenSemantics } = require('./helix-architecture/forbidden-semantic-guard');
const { validateManifestSet } = require('./helix-architecture/manifest-validator');
const { validateP2ContractBaseline } = require('./helix-architecture/p2-contract-baseline-validator');
const { runCheck, fixtureReport } = require('./helix-architecture/gate-report');

const serviceRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(serviceRoot, '..');
const rootPath = path.join(serviceRoot, 'src', 'helix');
const manifestDirectory = path.join(rootPath, 'contracts', 'manifests');
const testDirectory = path.join(serviceRoot, 'test', 'helix-architecture');
const testFiles = fs.readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.relative(serviceRoot, path.join(testDirectory, name)));

// Bound simultaneous SQLite/child-process fixtures so host CPU oversubscription
// does not consume service startup deadlines before the child can run.
const fixtureRun = childProcess.spawnSync(process.execPath, ['scripts/helix-architecture-test-execute.js', ...testFiles], {
  cwd: serviceRoot,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  env: { ...process.env, NODE_ENV: 'test' }
});
let executionReport = null;
try {
  executionReport = JSON.parse(fixtureRun.stdout);
  if (!Array.isArray(executionReport.jobs) || executionReport.sourceFileCount !== testFiles.length ||
      executionReport.jobs.some(job => !testFiles.includes(job.file)) ||
      new Set(executionReport.jobs.map(job => job.file)).size !== testFiles.length || !executionReport.ok) fixtureRun.status = 1;
} catch { fixtureRun.status = 1; }

const dependency = runCheck('package-boundaries', () => checkPackageBoundaries({
  rootPath,
  policyPath: path.join(manifestDirectory, 'package-boundary-policy.json')
}));
const semantic = runCheck('forbidden-semantics', () => checkForbiddenSemantics({
  rootPath,
  policyPath: path.join(manifestDirectory, 'forbidden-semantic-policy.json')
}));
const manifests = runCheck('manifest-set', () => validateManifestSet({ rootPath, repositoryRoot }));
const contracts = runCheck('contract-baseline', () => validateP2ContractBaseline({
  repositoryRoot,
  contractsRoot: path.join(rootPath, 'contracts')
}));
const fixturePassed = fixtureRun.status === 0 && !fixtureRun.error && !fixtureRun.signal;

const result = {
  ok: fixturePassed && dependency.ok && semantic.ok && manifests.ok && contracts.ok,
  scope: 'P2_LOCAL_ISOLATED_CONTRACT_BASELINE',
  fixture: { ...fixtureReport(fixtureRun, testFiles.map(filePath => path.basename(filePath)), [dependency, semantic, manifests, contracts]),
    execution: executionReport ? { strategy:executionReport.strategy, concurrency:executionReport.concurrency,
      jobCount:executionReport.jobs.length, counts:executionReport.counts } : null },
  dependency: {
    ok: dependency.ok,
    packageCount: dependency.packageCount,
    filesChecked: dependency.filesChecked,
    dependenciesChecked: dependency.dependenciesChecked,
    findings: dependency.findings
  },
  semantic: {
    ok: semantic.ok,
    filesChecked: semantic.filesChecked,
    exemptionsApplied: semantic.exemptionsApplied,
    findings: semantic.findings
  },
  manifests: {
    ok: manifests.ok,
    ownerCount: manifests.ownerCount,
    packageCount: manifests.packageCount,
    inventories: manifests.manifests,
    aggregateDigest: manifests.aggregateDigest,
    findings: manifests.findings
  },
  contracts: {
    ok: contracts.ok,
    counts: contracts.counts,
    componentDigests: contracts.componentDigests,
    aggregateDigest: contracts.aggregateDigest,
    findings: contracts.findings
  },
  prohibitedActionsRun: []
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
