'use strict';

const path = require('path');
const { materializeDomainInputs } = require('./helix-architecture/domain-input-materializer');

const serviceRoot = path.resolve(__dirname, '..');
const registry = materializeDomainInputs({
  contractsRoot: path.join(serviceRoot, 'src', 'helix', 'contracts'),
  repositoryRoot: path.resolve(serviceRoot, '..')
});
process.stdout.write(`${JSON.stringify({ entryCount: registry.entries.length }, null, 2)}\n`);
