'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRepositoryDefinition } = require('../src/helix/foundation/persistence/owner-repository');
const { createPlanContractImporter } = require('./helix-architecture/plan-contract-import');
const { createHistoryImportBundle } = require('./helix-architecture/history-import-bundle');
const { verifyPreparedCopy } = require('./helix-architecture/plan-contract-schema-copy');

async function importPreparedHistory({ dataDir, adminDistDir, receiptPath, reportPath }) {
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.schemaRef !== 'shelfdeck.plan-contract-schema-copy@1' || receipt.prepared !== true || receipt.applied !== false)
    throw new Error('A qualified additive copy receipt is required.');
  const intent = JSON.parse(fs.readFileSync(path.join(dataDir, 'operator-runtime/intent.json'), 'utf8'));
  if (intent.schema !== 'shelfdeck.runtime-intent@1' || intent.desiredMode !== 'stopped' || intent.pendingReset !== null)
    throw new Error('History import requires a stopped prepared data copy without pending Reset.');
  const targetSchema = { schemaManifest: require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    schemaDdl: fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8') };
  const checkProtectedFacts = () => verifyPreparedCopy({ Database: require('better-sqlite3'),
    databasePath: path.join(dataDir, 'shelfdeck.db'), receipt, targetSchema });
  checkProtectedFacts();
  // Capture current contracts in a disposable clean Host. Normal Host startup
  // can seed system templates; it must never open the import target.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-contract-capture-'));
  const captureData = path.join(scratch, 'data'), captureSecret = crypto.randomBytes(32).toString('hex');
  const modulePath = require.resolve('../src/helix/composition/create-procurement-execution-runtime');
  const original = require(modulePath);
  let composition, dependencies;
  require.cache[modulePath].exports = { ...original, createHelixExecutionRuntime(options) {
    dependencies = options; composition = original.createHelixExecutionRuntime(options); return composition;
  } };
  let host, kernel;
  const out = fs.openSync(reportPath, 'a', 0o600);
  const emit = value => fs.writeSync(out, JSON.stringify(value) + '\n');
  try {
    require('./helix-operational-safety').initializeCleanData({ dataDir: captureData, secretRoot: captureSecret,
      confirmation: 'INITIALIZE_HELIX_CLEAN_V1' });
    fs.mkdirSync(path.join(captureData, 'operator-runtime'));
    fs.writeFileSync(path.join(captureData, 'operator-runtime/intent.json'), JSON.stringify({ schema: 'shelfdeck.runtime-intent@1',
      desiredMode: 'stopped', revision: 1, pendingReset: null }));
    host = await require('../src/clean-service-host').createCleanServiceHost({ dataDir: captureData, adminDistDir, secretRoot: captureSecret,
      onExecutionRuntimeError: error => emit({ kind: 'host_error', code: error.code || error.name }) });
    require.cache[modulePath].exports = original;
    if (!composition || !dependencies || dependencies.schemaManifest.ddlDigest !== receipt.target.schemaDigest)
      throw new Error('Prepared copy does not match its qualified target schema.');
    if (composition.host.readiness().normalSupplyAllowed === true) throw new Error('History import cannot run with supply enabled.');
    const { registry, policyRegistry, contractValidator, bindingProjectionRegistry } = composition;
    const currentContracts = { registry, policyRegistry, contractValidator };
    await host.close(); host = null;
    kernel = require('../src/helix/foundation/persistence/sqlite-kernel').openSqliteKernel({ Database: require('better-sqlite3'),
      databasePath: path.join(dataDir, 'shelfdeck.db'), ...targetSchema });
    const restrictedKernel = { runPrimitive(operation) { return kernel.runPrimitive(transaction => operation({ ...transaction,
      prepare(sql) {
        if (!/^SELECT\b/i.test(sql.trim()) && !/^INSERT INTO "?fx_(execution_contracts|plan_contracts)"?\s*\(/i.test(sql.trim()))
          throw new Error('Evidence import cannot write existing facts.');
        return transaction.prepare(sql);
      } })); } };
    dependencies = { schemaManifest: targetSchema.schemaManifest,
      unitOfWork: require('../src/helix/foundation/persistence/sqlite-unit-of-work').createSqliteUnitOfWork({ kernel: restrictedKernel }) };
    const proofReader = require('../src/helix/foundation/execution/catalog-plan-proof-reader').createCatalogPlanProofReader(dependencies);
    const ownerOptions = { ...dependencies,
      workResultReader: require('../src/helix/foundation/execution/work-result-reader').createWorkResultReader(dependencies),
      productDeliveryPort: require('../src/helix/domains/libra/persistence/product-delivery-reader').createProductDeliveryReader(dependencies),
      stageHistoryLibraBindingReader: require('../src/helix/domains/libra/public').LibraExecutionRegistration.createMaterialBindingScopeReader(dependencies),
      inventoryPort: { observeEmptyStageSlot: require('../src/helix/integrations/empty-stage-slot-observer').observeEmptyStageSlot },
      readTechnicalWork: workId => proofReader.verify(reader => reader.workPlanIds(workId).map(id => reader.read(id))) };
    const terminalEffectObserver = require('../src/helix/domains/arca/application/terminal-effect-history-observer').createTerminalEffectHistoryObserver(ownerOptions);
    const schemas = { get: ref => contractValidator.readSchema(ref) };
    const bundle = createHistoryImportBundle({ currentContracts, schemas, bindingProjectionRegistry, terminalEffectObserver,
      onRejected: reason => emit({ kind: 'original_proof_rejected', reason }) });
    const importer = createPlanContractImporter({ ...dependencies, proofReader, currentContracts, ...bundle });
    const repository = createRepositoryDefinition({ repositoryId: 'contract_import_scan', owner: 'execution-foundation',
      schemaManifest: dependencies.schemaManifest, statements: { page: { kind: 'select-page-after', tableId: 'fx_workflow_plans',
        columns: ['plan_id'], keyColumn: 'plan_id', maxItems: 100 } } });
    let cursor = null;
    const counts = { imported: 0, already_present: 0, unverified: 0 };
    for (;;) {
      const rows = dependencies.unitOfWork.execute([{ participantId: 'contract_import_scan', owner: 'execution-foundation', repositories: [repository],
        execute: context => context.repository(repository.repositoryId).invoke('page', { cursor, limit: 100 }) }]).contract_import_scan;
      if (!rows.length) break;
      for (const row of rows) {
        const result = importer.importPlan(row.plan_id); counts[result.kind]++; emit(result);
        await new Promise(resolve => setImmediate(resolve));
      }
      cursor = rows.at(-1).plan_id; fs.fsyncSync(out);
      process.stdout.write(JSON.stringify({ kind: 'progress', counts }) + '\n');
    }
    kernel.close(); kernel = null;
    const protection = checkProtectedFacts();
    emit({ kind: 'finished', counts, protection, verifierDigest: bundle.verifierDigest, productionApplied: false });
    fs.fsyncSync(out);
    return counts;
  } finally {
    require.cache[modulePath].exports = original; await host?.close(); kernel?.close(); fs.closeSync(out);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

async function main(args) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--data-dir', '--admin-dist-dir', '--copy-receipt', '--report', '--confirm'].includes(args[i]) ||
      values[args[i]] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid import arguments.');
    values[args[i]] = args[i + 1];
  }
  if (values['--confirm'] !== 'IMPORT_PLAN_CONTRACT_EVIDENCE' ||
      ['--data-dir', '--admin-dist-dir', '--copy-receipt', '--report'].some(key => !values[key]))
    throw new Error('Supply the stopped prepared copy, receipt, report and exact confirmation.');
  return importPreparedHistory({ dataDir: path.resolve(values['--data-dir']), adminDistDir: path.resolve(values['--admin-dist-dir']),
    receiptPath: path.resolve(values['--copy-receipt']), reportPath: path.resolve(values['--report']) });
}
if (require.main === module) main(process.argv.slice(2)).then(counts => process.stdout.write(JSON.stringify({ counts }) + '\n')).catch(error => {
  process.stderr.write(JSON.stringify({ error: { code: error.code || 'PLAN_CONTRACT_IMPORT_FAILED', message: error.message } }) + '\n'); process.exitCode = 1;
});
module.exports = Object.freeze({ importPreparedHistory, main });
