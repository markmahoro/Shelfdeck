'use strict';

const path = require('path');
const { checkPackageBoundaries } = require('./helix-architecture/package-boundary-guard');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const serviceRoot = path.resolve(__dirname, '..');
const rootPath = argumentValue('--root') || path.join(serviceRoot, 'src', 'helix');
const policyPath = argumentValue('--policy') || path.join(
  rootPath,
  'contracts',
  'manifests',
  'package-boundary-policy.json'
);

const result = checkPackageBoundaries({ rootPath, policyPath });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
