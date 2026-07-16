'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { checkForbiddenSemantics } = require('../../scripts/helix-architecture/forbidden-semantic-guard');

const repositoryPolicy = JSON.parse(fs.readFileSync(path.resolve(
  __dirname,
  '../../src/helix/contracts/manifests/forbidden-semantic-policy.json'
), 'utf8'));

function createFixture(files, mutatePolicy) {
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-semantic-'));
  const rootPath = path.join(basePath, 'helix');
  const policyPath = path.join(basePath, 'semantic-policy.json');
  fs.mkdirSync(rootPath, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(rootPath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  const policy = JSON.parse(JSON.stringify(repositoryPolicy));
  policy.exemptions = [];
  if (mutatePolicy) mutatePolicy(policy);
  fs.writeFileSync(policyPath, JSON.stringify(policy));
  return { basePath, rootPath, policyPath };
}

function runFixture(files, mutatePolicy) {
  const fixture = createFixture(files, mutatePolicy);
  try {
    return checkForbiddenSemantics(fixture);
  } finally {
    fs.rmSync(fixture.basePath, { recursive: true, force: true });
  }
}

function forbiddenRuleIds(result) {
  return new Set(result.findings
    .filter((item) => item.code === 'FORBIDDEN_LEGACY_SEMANTIC')
    .map((item) => item.ruleId));
}

test('accepts canonical clean terminology including Work Admission', () => {
  const result = runFixture({
    'clean.js': [
      'class WorkAdmission {}',
      'const work_admission = true;',
      'const fieldObservation = true;',
      'const capabilityRef = "inspect@1";'
    ].join('\n')
  });
  assert.equal(result.ok, true);
});

test('each forbidden semantic family has an executable negative example', () => {
  const examples = {
    'legacy.membership': 'MembershipStore',
    'legacy.admission': 'AdmissionStore',
    'legacy.gate-fields': 'targetGate',
    'legacy.maintenance-complete': 'maintenanceComplete',
    'legacy.flow-routing': 'flowKind',
    'legacy.source-binding': 'SourceBinding',
    'legacy.named-runtime': 'KairoxRuntime',
    'legacy.media-item-identity': 'mediaItemId',
    'legacy.task-user-surface': 'retryTask',
    'legacy.global-owner': 'CrossDomainStore',
    'legacy.compatibility-path': 'dualRead',
    'legacy.hidden-effect-routing': 'hiddenPostEffect'
  };
  const content = Object.values(examples).map((value, index) => `const legacy${index} = '${value}';`).join('\n');
  const result = runFixture({ 'negative.js': content });
  const matched = forbiddenRuleIds(result);
  assert.equal(result.ok, false);
  for (const ruleId of Object.keys(examples)) assert.ok(matched.has(ruleId), `missing ${ruleId}`);
});

test('scans comments, string values, and exact relative paths', () => {
  const result = runFixture({
    'MembershipStore.js': "// flowKind\nconst value = 'SourceBinding';\n"
  });
  const matched = forbiddenRuleIds(result);
  assert.ok(matched.has('legacy.membership'));
  assert.ok(matched.has('legacy.flow-routing'));
  assert.ok(matched.has('legacy.source-binding'));
  assert.ok(result.findings.some((item) => item.locationType === 'path'));
  assert.ok(result.findings.some((item) => item.locationType === 'content'));
});

test('applies only exact file and exact rule exemptions', () => {
  const result = runFixture(
    {
      'allowed.js': "const first = 'Membership'; const second = 'flowKind';\n",
      'other.js': "const value = 'Membership';\n"
    },
    (policy) => policy.exemptions.push({
      id: 'bounded-evidence',
      relativePath: 'allowed.js',
      purpose: 'evidence-locator',
      allowedLocationTypes: ['content'],
      allowedRuleIds: ['legacy.membership']
    })
  );
  const membershipFindings = result.findings.filter((item) => item.ruleId === 'legacy.membership');
  assert.equal(membershipFindings.length, 1);
  assert.equal(membershipFindings[0].file, 'other.js');
  assert.ok(forbiddenRuleIds(result).has('legacy.flow-routing'));
});

test('unknown, wildcard, escaping, and unresolved exemptions fail closed', () => {
  const cases = [
    { id: 'unknown-rule', relativePath: 'clean.js', purpose: 'negative-fixture', allowedLocationTypes: ['content'], allowedRuleIds: ['missing.rule'] },
    { id: 'wildcard', relativePath: 'clean.js', purpose: 'negative-fixture', allowedLocationTypes: ['content'], allowedRuleIds: ['*'] },
    { id: 'escape', relativePath: '../clean.js', purpose: 'negative-fixture', allowedLocationTypes: ['content'], allowedRuleIds: ['legacy.membership'] },
    { id: 'unresolved', relativePath: 'missing.js', purpose: 'negative-fixture', allowedLocationTypes: ['content'], allowedRuleIds: ['legacy.membership'] }
  ];
  for (const exemption of cases) {
    const result = runFixture({ 'clean.js': "'use strict';\n" }, (policy) => policy.exemptions.push(exemption));
    assert.equal(result.ok, false, exemption.id);
    assert.ok(result.findings.some((item) =>
      item.code === 'INVALID_SEMANTIC_EXEMPTION' || item.code === 'UNRESOLVED_SEMANTIC_EXEMPTION'
    ), exemption.id);
  }
});

test('CLI exits non-zero with structured semantic findings', () => {
  const fixture = createFixture({ 'negative.js': "const value = 'legacyFallback';\n" });
  try {
    const cliPath = path.resolve(__dirname, '../../scripts/helix-semantic-check.js');
    const completed = childProcess.spawnSync(
      process.execPath,
      [cliPath, '--root', fixture.rootPath, '--policy', fixture.policyPath],
      { encoding: 'utf8' }
    );
    assert.equal(completed.status, 1);
    const output = JSON.parse(completed.stdout);
    assert.equal(output.ok, false);
    assert.ok(forbiddenRuleIds(output).has('legacy.compatibility-path'));
  } finally {
    fs.rmSync(fixture.basePath, { recursive: true, force: true });
  }
});
