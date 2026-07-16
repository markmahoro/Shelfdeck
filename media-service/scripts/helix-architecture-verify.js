'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { checkPackageBoundaries } = require('./helix-architecture/package-boundary-guard');
const { checkForbiddenSemantics } = require('./helix-architecture/forbidden-semantic-guard');
const { validateManifestSet } = require('./helix-architecture/manifest-validator');

const serviceRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(serviceRoot, '..');
const rootPath = path.join(serviceRoot, 'src', 'helix');
const manifestDirectory = path.join(rootPath, 'contracts', 'manifests');
const testDirectory = path.join(serviceRoot, 'test', 'helix-architecture');
const testFiles = fs.readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(testDirectory, name));

const fixtureRun = childProcess.spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: serviceRoot,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
  env: { ...process.env, NODE_ENV: 'test' }
});

const dependency = checkPackageBoundaries({
  rootPath,
  policyPath: path.join(manifestDirectory, 'package-boundary-policy.json')
});
const semantic = checkForbiddenSemantics({
  rootPath,
  policyPath: path.join(manifestDirectory, 'forbidden-semantic-policy.json')
});
const manifests = validateManifestSet({ rootPath, repositoryRoot });
const fixturePassed = fixtureRun.status === 0;

const result = {
  ok: fixturePassed && dependency.ok && semantic.ok && manifests.ok,
  scope: 'P1_LOCAL_ISOLATED_ARCHITECTURE_ONLY',
  fixture: {
    ok: fixturePassed,
    fileCount: testFiles.length,
    files: testFiles.map((filePath) => path.basename(filePath)),
    failureOutput: fixturePassed ? undefined : `${fixtureRun.stdout || ''}${fixtureRun.stderr || ''}`
  },
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
  prohibitedActionsRun: []
};

process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
