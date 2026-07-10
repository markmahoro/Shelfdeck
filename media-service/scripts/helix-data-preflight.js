'use strict';

const path = require('path');
const cleanState = require('../src/helixCleanState');

if (process.argv.some((argument) => argument === '--apply' || argument.startsWith('--apply='))) {
  throw Object.assign(new Error('Helix data preflight is read-only'), { code: 'HELIX_PREFLIGHT_READ_ONLY' });
}

const dataDirArgument = process.argv.find((argument) => argument.startsWith('--data-dir='));
const dataDir = path.resolve(dataDirArgument
  ? dataDirArgument.slice('--data-dir='.length)
  : process.env.MEDIA_SERVICE_DATA_DIR || process.env.CONTROL_PLANE_DATA_DIR || path.join(__dirname, '..', 'data'));

try {
  const inspection = cleanState.assertCleanState({ dataDir });
  process.stdout.write(`${JSON.stringify({ mode: 'read-only', status: 'ready', inspection }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: { code: error.code || 'HELIX_PREFLIGHT_FAILED', message: error.message, details: error.details } }, null, 2)}\n`);
  process.exitCode = 1;
}
