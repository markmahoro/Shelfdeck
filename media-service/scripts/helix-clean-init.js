'use strict';

const path = require('path');
const cleanState = require('../src/helixCleanState');

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(argv = process.argv.slice(2)) {
  const dataDir = path.resolve(valueAfter(argv, '--data-dir')
    || process.env.CONTROL_PLANE_DATA_DIR
    || process.env.MEDIA_SERVICE_DATA_DIR
    || path.join(__dirname, '..', 'data'));
  const backupDir = valueAfter(argv, '--backup-dir');
  const apply = argv.includes('--apply');
  const options = {
    dataDir,
    backupDir: backupDir ? path.resolve(backupDir) : undefined,
    confirmation: valueAfter(argv, '--confirm'),
  };
  const result = apply ? cleanState.applyCleanInit(options) : cleanState.buildPlan(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    error: {
      code: error.code || 'HELIX_CLEAN_INIT_FAILED',
      message: error.message,
      details: error.details || undefined,
    },
  }, null, 2)}\n`);
  process.exitCode = 1;
}
