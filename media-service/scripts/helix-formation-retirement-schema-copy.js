'use strict';
const Database = require('better-sqlite3');
const { prepareFormationRetirementSchemaCopy } = require('./helix-architecture/formation-retirement-schema-copy');

// Prepare a separate structural copy only. This command never switches the live
// database, retires a Subject, resumes execution or edits physical media.
function main(args) {
  const values = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!['--source', '--target', '--rollback'].includes(flag) || Object.hasOwn(values, flag))
      throw new Error('Unsupported or repeated argument.');
    if (flag === '--rollback') values[flag] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('A path argument is required.');
      values[flag] = value;
    }
  }
  if (!values['--source'] || !values['--target']) throw new Error('Supply exact --source and new --target snapshot paths.');
  return prepareFormationRetirementSchemaCopy({ Database, sourcePath: values['--source'], targetPath: values['--target'], rollback: Boolean(values['--rollback']) });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) {
    process.stderr.write(JSON.stringify({ error: { code: error.code || 'RETIREMENT_SCHEMA_COPY_FAILED',
      message: 'Formation retirement schema copy failed.', details: error.details || {} } }) + '\n');
    process.exitCode = 1;
  }
}
module.exports = Object.freeze({ main });
