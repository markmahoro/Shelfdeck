'use strict';

const path = require('path');
const { validateP2ContractBaseline } = require('./helix-architecture/p2-contract-baseline-validator');

function value(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const serviceRoot = path.resolve(__dirname, '..');
const result = validateP2ContractBaseline({
  repositoryRoot: path.resolve(value('--repository-root') || path.resolve(serviceRoot, '..')),
  contractsRoot: path.resolve(value('--contracts-root') || path.join(serviceRoot, 'src', 'helix', 'contracts'))
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
