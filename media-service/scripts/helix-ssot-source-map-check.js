'use strict';

const path = require('path');
const { validateSsotSourceMap } = require('./helix-architecture/ssot-source-map-validator');

function value(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
}

const repositoryRoot = path.resolve(value('--repository-root') || path.join(__dirname, '..', '..'));
const mapPath = path.resolve(value('--map') || path.join(
  repositoryRoot,
  'media-service', 'src', 'helix', 'contracts', 'manifests', 'ssot-source-map.json'
));
const result = validateSsotSourceMap({ repositoryRoot, mapPath });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!result.ok) process.exitCode = 1;
