'use strict';

const fs = require('fs');
const path = require('path');
const { extractSsotContracts } = require('./helix-architecture/ssot-contract-extractor');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');
const relativePath = path.relative(repositoryRoot, sourcePath).split(path.sep).join('/');
const result = extractSsotContracts(fs.readFileSync(sourcePath, 'utf8'), { sourcePath: relativePath });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
