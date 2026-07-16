'use strict';

const path = require('path');
const { auditP2Exit } = require('./helix-architecture/p2-exit-auditor');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const result = auditP2Exit({ repositoryRoot, requireClean: process.argv.includes('--require-clean') });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
