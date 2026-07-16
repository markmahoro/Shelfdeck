'use strict';

const path = require('path');
const { validateSharedTypeSchemas } = require('./helix-architecture/shared-type-schema-validator');

function value(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const serviceRoot = path.resolve(__dirname, '..');
const contractsRoot = path.resolve(value('--contracts-root') || path.join(serviceRoot, 'src', 'helix', 'contracts'));
const registryPath = value('--registry') || path.join(contractsRoot, 'shared-type-registry.json');
const result = validateSharedTypeSchemas({ contractsRoot, registryPath });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
