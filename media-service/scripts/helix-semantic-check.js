'use strict';

const path = require('path');
const { checkForbiddenSemantics } = require('./helix-architecture/forbidden-semantic-guard');

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
  'forbidden-semantic-policy.json'
);
const result = checkForbiddenSemantics({ rootPath, policyPath });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
