'use strict';

const path = require('path');
const { materializeResultTypes } = require('./helix-architecture/result-type-materializer');

const contractsRoot = path.resolve(__dirname, '..', 'src', 'helix', 'contracts');
const registry = materializeResultTypes(contractsRoot);
process.stdout.write(`${JSON.stringify({ entryCount: registry.entries.length }, null, 2)}\n`);
