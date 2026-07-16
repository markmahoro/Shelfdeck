'use strict';

const path = require('path');
const { validateDomainInputSchemas } = require('./helix-architecture/domain-input-schema-validator');

function value(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const serviceRoot = path.resolve(__dirname, '..');
const result = validateDomainInputSchemas({
  contractsRoot: path.resolve(value('--contracts-root') || path.join(serviceRoot, 'src', 'helix', 'contracts')),
  repositoryRoot: path.resolve(value('--repository-root') || path.resolve(serviceRoot, '..'))
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
