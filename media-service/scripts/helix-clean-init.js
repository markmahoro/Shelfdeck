'use strict';

const path = require('node:path');
const { initializeCleanData, inspectReadiness } = require('./helix-operational-safety');

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(argv = process.argv.slice(2)) {
  const dataDir = path.resolve(valueAfter(argv, '--data-dir')
    || process.env.MEDIA_SERVICE_DATA_DIR
    || path.join(__dirname, '..', 'data'));
  const backup = valueAfter(argv, '--backup-dir');

  if (argv.includes('--readiness')) {
    return inspectReadiness({
      dataDir,
      adminDistDir: path.join(__dirname, '../dist/admin'),
      secretRoot: process.env.SHELFDECK_SECRET_ROOT,
    });
  }
  if (!argv.includes('--apply')) {
    return {
      operation: 'initialize_clean_data',
      generation: 'helix-clean-v1',
      dataDir,
      backupDir: backup ? path.resolve(backup) : null,
      confirmationRequired: 'INITIALIZE_HELIX_CLEAN_V1',
      secretRootRequired: 'SHELFDECK_SECRET_ROOT (minimum 32 UTF-8 bytes)',
    };
  }
  return initializeCleanData({
    dataDir,
    backupDir: backup ? path.resolve(backup) : undefined,
    confirmation: valueAfter(argv, '--confirm'),
    secretRoot: process.env.SHELFDECK_SECRET_ROOT,
  });
}

try {
  process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: { code: error.message, message: error.message },
  }, null, 2)}\n`);
  process.exitCode = 1;
}
