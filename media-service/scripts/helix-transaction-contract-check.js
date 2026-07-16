'use strict';

const path = require('path');
const { validateTransactionContracts } = require('./helix-architecture/transaction-contract-validator');

function value(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const serviceRoot = path.resolve(__dirname, '..');
const contractsRoot = path.resolve(value('--contracts-root') || path.join(serviceRoot, 'src', 'helix', 'contracts'));
const result = validateTransactionContracts({ contractsRoot });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
