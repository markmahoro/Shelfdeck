'use strict';

const path = require('path');
const { validateManifestSet } = require('./helix-architecture/manifest-validator');

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const serviceRoot = path.resolve(__dirname, '..');
const repositoryRoot = argumentValue('--repository-root') || path.resolve(serviceRoot, '..');
const rootPath = argumentValue('--root') || path.join(serviceRoot, 'src', 'helix');
const result = validateManifestSet({ rootPath, repositoryRoot });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
