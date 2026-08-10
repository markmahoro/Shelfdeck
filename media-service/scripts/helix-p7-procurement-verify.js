'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const serviceRoot = path.resolve(__dirname, '..');
const testRoot = path.join(serviceRoot, 'test', 'helix-architecture');
const generatedManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');

function spawn(args) {
  return childProcess.spawnSync(process.execPath, args, {
    cwd:serviceRoot,
    encoding:'utf8',
    maxBuffer:60 * 1024 * 1024,
    env:{ ...process.env, NODE_ENV:'test', HELIX_SSOT_PATH:process.env.HELIX_SSOT_PATH ||
      path.resolve(serviceRoot, '../docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md') }
  });
}

function jsonGate(script) {
  const child = spawn([script]);
  let output;
  try { output = JSON.parse(child.stdout); }
  catch (error) { output = { ok:false, parseError:error.message }; }
  return { ok:child.status === 0 && output.ok === true, status:child.status, scope:output.scope,
    findings:output.findings || [], prohibitedActionsRun:output.prohibitedActionsRun || [],
    failure:output.failure, stderr:child.status === 0 ? undefined : child.stderr.slice(-4000) };
}

function capabilityInventory() {
  const root = path.join(serviceRoot, 'src', 'helix', 'contracts', 'capabilities', 'procurement');
  const manifests = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name === 'manifest.json') manifests.push(JSON.parse(fs.readFileSync(target, 'utf8')));
    }
  }
  visit(root);
  return manifests.sort((left, right) => left.capabilityRef.localeCompare(right.capabilityRef));
}

const p7Files = fs.readdirSync(testRoot).filter((name) => /^p7-.*\.test\.js$/.test(name)).sort()
  .map((name) => path.join('test', 'helix-architecture', name));
const p7 = spawn(['--test', ...p7Files]);
const tables = generatedManifest.tables.filter((table) => table.owner === 'procurement').map((table) => table.tableId).sort();
const capabilities = capabilityInventory();
const gates = {
  p2Contracts:jsonGate('scripts/helix-architecture-verify.js'),
  p3Persistence:jsonGate('scripts/helix-p3-persistence-verify.js'),
  p4Runtime:jsonGate('scripts/helix-p4-runtime-verify.js'),
  p5Platform:jsonGate('scripts/helix-p5-integration-verify.js'),
  p6Horizontal:jsonGate('scripts/helix-p6-horizontal-verify.js')
};
const findings = [];
if (p7.status !== 0) findings.push({ code:'P7_PROCUREMENT_FIXTURE_FAILED', output:p7.stdout.slice(-8000), stderr:p7.stderr.slice(-4000) });
if (tables.length !== 17) findings.push({ code:'P7_PROCUREMENT_TABLE_COUNT_MISMATCH', actual:tables.length });
if (capabilities.length !== 8) findings.push({ code:'P7_PROCUREMENT_CAPABILITY_COUNT_MISMATCH', actual:capabilities.length });
for (const [name, gate] of Object.entries(gates)) if (!gate.ok) findings.push({ code:'P7_REGRESSION_GATE_FAILED', gate:name });
const prohibitedActionsRun = [...new Set(Object.values(gates).flatMap((gate) => gate.prohibitedActionsRun))];
if (prohibitedActionsRun.length > 0) findings.push({ code:'P7_PROHIBITED_ACTION_REPORTED', actions:prohibitedActionsRun });

const result = {
  ok:findings.length === 0,
  scope:'P7_LOCAL_ISOLATED_PROCUREMENT',
  procurement:{ fixtureFileCount:p7Files.length, fixturesOk:p7.status === 0, tableCount:tables.length, tables,
    capabilityCount:capabilities.length,
    capabilities:capabilities.map(({ capabilityRef, effectClass, packageDigest }) => ({ capabilityRef, effectClass, packageDigest })) },
  regressions:gates,
  prohibitedActionsRun,
  findings
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
