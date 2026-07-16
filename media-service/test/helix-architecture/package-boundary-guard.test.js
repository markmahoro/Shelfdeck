'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  checkPackageBoundaries,
  scanCommonJsDependencies
} = require('../../scripts/helix-architecture/package-boundary-guard');

const POLICY = Object.freeze({
  schemaVersion: 1,
  defaultInternalDecision: 'deny',
  defaultExternalDecision: 'deny',
  externalModuleRules: [],
  rules: [
    { source: 'composition', allow: ['domains.*.public', 'platform.public'] },
    { source: 'domains.*.public', allow: ['domains.{owner}.application'] },
    { source: 'domains.*.application', allow: ['domains.{owner}.public'] },
    { source: 'platform.public', allow: ['platform.application', 'platform.model'] },
    { source: 'platform.application', allow: ['platform.model', 'platform.persistence'] },
    { source: 'platform.model', allow: [] },
    { source: 'platform.persistence', allow: ['platform.model'] }
  ]
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function writePackage(rootPath, relativePath, packageId, owner) {
  writeJson(path.join(rootPath, relativePath, 'package.boundary.json'), {
    schemaVersion: 1,
    packageId,
    layer: packageId === 'helix' ? 'root' : 'fixture',
    owner
  });
}

function createFixture(source) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-boundary-'));
  const policyPath = path.join(rootPath, 'boundary-policy.json');
  writePackage(rootPath, '.', 'helix', 'application-composition');
  writePackage(rootPath, 'composition', 'composition', 'application-composition');
  writePackage(rootPath, 'domains/procurement/public', 'domains.procurement.public', 'procurement');
  writePackage(rootPath, 'domains/procurement/application', 'domains.procurement.application', 'procurement');
  writePackage(rootPath, 'domains/libra/public', 'domains.libra.public', 'libra');
  writePackage(rootPath, 'domains/libra/application', 'domains.libra.application', 'libra');
  writePackage(rootPath, 'platform/public', 'platform.public', 'platform-settings');
  writePackage(rootPath, 'platform/model', 'platform.model', 'platform-settings');
  writePackage(rootPath, 'platform/application', 'platform.application', 'platform-settings');
  writePackage(rootPath, 'platform/persistence', 'platform.persistence', 'platform-settings');
  writeJson(policyPath, POLICY);
  fs.writeFileSync(path.join(rootPath, 'domains/procurement/public/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'domains/procurement/application/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'domains/libra/public/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'domains/libra/application/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'platform/public/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'platform/model/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'platform/application/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'platform/persistence/index.js'), "'use strict';\n");
  fs.writeFileSync(path.join(rootPath, 'composition/index.js'), source);
  return { rootPath, policyPath };
}

function runFixture(source) {
  const fixture = createFixture(source);
  try {
    return checkPackageBoundaries(fixture);
  } finally {
    fs.rmSync(fixture.rootPath, { recursive: true, force: true });
  }
}

function findingCodes(result) {
  return result.findings.map((finding) => finding.code);
}

test('allows a declared dependency through a Domain public entry', () => {
  const result = runFixture("module.exports = require('../domains/procurement/public');\n");
  assert.equal(result.ok, true);
  assert.equal(result.dependenciesChecked, 1);
});

test('allows Platform public but rejects direct Platform internal imports', () => {
  assert.equal(runFixture("module.exports = require('../platform/public');\n").ok, true);
  const internal = runFixture("module.exports = require('../platform/persistence');\n");
  assert.equal(internal.ok, false);
  assert.ok(findingCodes(internal).includes('PACKAGE_DEPENDENCY_NOT_ALLOWED'));
});

test('rejects a cross-Domain internal import even when a broad package pattern could match', () => {
  const result = runFixture("module.exports = require('../domains/libra/application');\n");
  assert.equal(result.ok, false);
  assert.ok(findingCodes(result).includes('DOMAIN_INTERNAL_IMPORT_NOT_ALLOWED'));
});

test('rejects a public-entry dependency that is absent from the allowed-edge policy', () => {
  const fixture = createFixture("'use strict';\n");
  try {
    fs.writeFileSync(
      path.join(fixture.rootPath, 'domains/procurement/public/index.js'),
      "module.exports = require('../../libra/public');\n"
    );
    const result = checkPackageBoundaries(fixture);
    assert.ok(findingCodes(result).includes('PACKAGE_DEPENDENCY_NOT_ALLOWED'));
  } finally {
    fs.rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test('rejects clean-to-legacy relative paths that escape the clean root', () => {
  const result = runFixture("module.exports = require('../../legacy-runtime');\n");
  assert.equal(result.ok, false);
  assert.ok(findingCodes(result).includes('CLEAN_ROOT_ESCAPE'));
});

test('rejects dynamic require and fails closed on unsupported ESM syntax', () => {
  const dynamic = runFixture("module.exports = require(target);\n");
  const esm = runFixture("import value from '../domains/procurement/public/index.js';\n");
  assert.ok(findingCodes(dynamic).includes('DYNAMIC_REQUIRE_NOT_ALLOWED'));
  assert.ok(findingCodes(esm).some((code) => code === 'UNSUPPORTED_IMPORT_SYNTAX' || code === 'PARSE_FAILURE'));
});

test('fails closed for invalid source and require aliases', () => {
  const invalid = runFixture("module.exports = ;\n");
  const alias = runFixture("const load = require; module.exports = load('../domains/procurement/public');\n");
  assert.ok(findingCodes(invalid).includes('PARSE_FAILURE'));
  assert.ok(findingCodes(alias).includes('REQUIRE_REFERENCE_NOT_ALLOWED'));
});

test('rejects undeclared external modules and unmatched source packages', () => {
  const external = runFixture("module.exports = require('legacy-package');\n");
  assert.ok(findingCodes(external).includes('EXTERNAL_MODULE_NOT_ALLOWED'));

  const fixture = createFixture("'use strict';\n");
  try {
    fs.mkdirSync(path.join(fixture.rootPath, 'unclassified'), { recursive: true });
    fs.writeFileSync(
      path.join(fixture.rootPath, 'unclassified/index.js'),
      "module.exports = require('../domains/procurement/public');\n"
    );
    const result = checkPackageBoundaries(fixture);
    assert.ok(findingCodes(result).includes('SOURCE_IN_ROOT_PACKAGE_NOT_ALLOWED'));
  } finally {
    fs.rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});

test('does not treat comments, strings, or object properties as module loading', () => {
  const source = [
    "// require('../legacy')",
    "const text = \"require('../legacy')\";",
    "object.require('../legacy');"
  ].join('\n');
  const scanned = scanCommonJsDependencies(source, 'fixture.js');
  assert.deepEqual(scanned.dependencies, []);
  assert.deepEqual(scanned.findings, []);
});

test('CLI returns a non-zero status and structured findings for a violation', () => {
  const fixture = createFixture("module.exports = require('../../legacy-runtime');\n");
  try {
    const cliPath = path.resolve(__dirname, '../../scripts/helix-architecture-check.js');
    const completed = childProcess.spawnSync(
      process.execPath,
      [cliPath, '--root', fixture.rootPath, '--policy', fixture.policyPath],
      { encoding: 'utf8' }
    );
    assert.equal(completed.status, 1);
    const output = JSON.parse(completed.stdout);
    assert.equal(output.ok, false);
    assert.ok(findingCodes(output).includes('CLEAN_ROOT_ESCAPE'));
  } finally {
    fs.rmSync(fixture.rootPath, { recursive: true, force: true });
  }
});
