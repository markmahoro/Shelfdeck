'use strict';

const path = require('path');
const { materializeTableContracts } = require('./helix-architecture/table-contract-materializer');

const contractsRoot = path.resolve(__dirname, '..', 'src', 'helix', 'contracts');
const result = materializeTableContracts(contractsRoot);
process.stdout.write(`${JSON.stringify({ entryCount: result.entries.length, shardCount: result.manifest.entryFiles.length }, null, 2)}\n`);
