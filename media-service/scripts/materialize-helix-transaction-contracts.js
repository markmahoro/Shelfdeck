'use strict';

const path = require('path');
const { materializeTransactionContracts } = require('./helix-architecture/transaction-contract-materializer');

const contractsRoot = path.resolve(__dirname, '..', 'src', 'helix', 'contracts');
const result = materializeTransactionContracts(contractsRoot);
process.stdout.write(`${JSON.stringify({ entryCount: result.entries.length }, null, 2)}\n`);
