'use strict';

const Database = require('better-sqlite3');
const { inspectJavSchemaSource, prepareJavSchemaCopy, verifyJavSchemaRollback } = require('./helix-architecture/jav-release-schema-copy');

function main(args) {
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--source', '--target', '--rollback-check', '--inspect'].includes(flag) || Object.hasOwn(values, flag))
      throw Object.assign(new Error('Unsupported or repeated operator argument.'), { code: 'JAV_SCHEMA_ARGUMENT_INVALID' });
    if (flag === '--inspect') values[flag] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Object.assign(new Error('Operator path argument is required.'), { code: 'JAV_SCHEMA_ARGUMENT_INVALID' });
      values[flag] = value;
    }
  }
  if (!values['--source'] || Number(Boolean(values['--target'])) + Number(Boolean(values['--inspect'])) + Number(Boolean(values['--rollback-check'])) !== 1)
    throw Object.assign(new Error('Supply --source and exactly one of --inspect, --target or --rollback-check.'), { code: 'JAV_SCHEMA_ARGUMENT_INVALID' });
  const options = { Database, sourcePath: values['--source'] };
  if (values['--inspect']) return inspectJavSchemaSource(options);
  if (values['--rollback-check']) return verifyJavSchemaRollback({ ...options, upgradedPath: values['--rollback-check'] });
  return prepareJavSchemaCopy({ ...options, targetPath: values['--target'] });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) {
    process.stderr.write(JSON.stringify({ error: { code: error.code || 'JAV_SCHEMA_PREPARATION_FAILED',
      message: 'Release schema preparation failed.', details: error.details || {} } }) + '\n');
    process.exitCode = 1;
  }
}
module.exports = Object.freeze({ main });
