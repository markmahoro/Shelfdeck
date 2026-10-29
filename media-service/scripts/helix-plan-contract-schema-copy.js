'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const { preparePlanContractSchemaCopy } = require('./helix-architecture/plan-contract-schema-copy');

function main(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--source', '--target', '--source-schema'].includes(flag) || values[flag] || !value || value.startsWith('--'))
      throw new Error('Supply exact --source, new --target and frozen --source-schema digest.');
    values[flag] = value;
  }
  if (!values['--source'] || !values['--target'] || !/^[a-f0-9]{64}$/.test(values['--source-schema'] || ''))
    throw new Error('Exact source, target and schema digest are required.');
  const base = path.join(__dirname, '../src/helix/foundation/persistence');
  const source = path.join(base, 'release-schemas', values['--source-schema']);
  const sourceSchema = { schemaDdl: zlib.gunzipSync(fs.readFileSync(source + '.sql.gz')).toString(),
    schemaManifest: JSON.parse(zlib.gunzipSync(fs.readFileSync(source + '.manifest.json.gz'))) };
  if (sourceSchema.schemaManifest.ddlDigest !== values['--source-schema']) throw new Error('Source archive identity differs.');
  const targetSchema = { schemaDdl: fs.readFileSync(path.join(base, 'generated/clean-schema.sql'), 'utf8'),
    schemaManifest: JSON.parse(fs.readFileSync(path.join(base, 'generated/clean-schema.manifest.json'), 'utf8')) };
  return preparePlanContractSchemaCopy({ Database: require('better-sqlite3'), sourcePath: values['--source'], targetPath: values['--target'],
    sourceSchema, targetSchema });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { process.stderr.write(JSON.stringify({ error: { code: error.code || 'PLAN_CONTRACT_COPY_FAILED', message: error.message } }) + '\n'); process.exitCode = 1; }
}
module.exports = Object.freeze({ main });
