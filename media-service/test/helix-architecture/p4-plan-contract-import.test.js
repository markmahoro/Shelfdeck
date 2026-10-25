'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createCatalogPlanProofReader } = require('../../src/helix/foundation/execution/catalog-plan-proof-reader');
const { createBoundedCatalogTransition } = require('../../src/helix/foundation/execution/bounded-catalog-transition');
const { createStoredPlanContractVerifier } = require('../../src/helix/foundation/execution/stored-plan-contract-verifier');
const { executionCatalogDigest } = require('../../src/helix/foundation/execution/workflow-plan');
const { createPlanContractImporter } = require('../../scripts/helix-architecture/plan-contract-import');
const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const HASH = 'a'.repeat(64);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-contract-import-'));
  const kernel = openSqliteKernel({ Database, databasePath: path.join(root, 'history.db'), schemaDdl, schemaManifest });
  t.after(() => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const proofReader = createCatalogPlanProofReader({ schemaManifest, unitOfWork });
  const registry = { snapshot: [] }, policyRegistry = { digest: HASH }, catalog = executionCatalogDigest(registry, policyRegistry);
  kernel.runPrimitive(db => {
    db.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,state) VALUES('work','libra','failed')").run();
    db.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,basis_digest,state) VALUES('attempt','work',?,'failed')").run(HASH);
    db.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,catalog_digest,basis_digest,graph_digest,state) VALUES('plan','attempt',?,?,?,'contract_unplannable')").run(catalog, HASH, HASH);
  });
  const source = { sourceCommit: 'b'.repeat(40), archiveDigest: 'c'.repeat(64) };
  const options = { schemaManifest, unitOfWork, proofReader, verifierDigest: 'd'.repeat(64), sourceForCatalog: value => value === catalog ? source : null,
    createHistoricalVerifier: reader => createBoundedCatalogTransition({ registry, policyRegistry, schemas: new Map(), proofReader: reader,
      witness: { capabilities: [], policyDigest: HASH, previousCatalogDigest: catalog, currentCatalogDigest: catalog,
        preboundEvidenceSchemas: {}, excludedActiveProcessTypes: [] }, terminalOnly: true }) };
  return { kernel, options, proofReader, source,
    facts: () => proofReader.verify(reader => reader.read('plan')),
    count: () => kernel.runPrimitive(db => db.prepare('SELECT COUNT(*) n FROM fx_plan_contracts').get().n) };
}

test('verified terminal import survives without the old verifier or registry and preserves all original facts', t => {
  const f = fixture(t), before = f.facts(), importer = createPlanContractImporter(f.options);
  assert.equal(importer.importPlan('plan').kind, 'imported');
  assert.equal(importer.importPlan('plan').kind, 'already_present');
  assert.equal(f.count(), 1);
  assert.deepEqual(f.facts(), before);
  const verifier = createStoredPlanContractVerifier({ proofReader: f.proofReader,
    registry: { resolve() { throw Error('No historical executor installed'); } } });
  assert.equal(verifier.verify(f.facts()), true);
  f.kernel.runPrimitive(db => db.prepare("UPDATE fx_workflow_plans SET graph_digest=? WHERE plan_id='plan'").run('e'.repeat(64)));
  assert.equal(verifier.verify(f.facts()), false);
});

test('unknown provenance and failed original proof never manufacture terminal evidence', t => {
  const f = fixture(t);
  assert.equal(createPlanContractImporter({ ...f.options, sourceForCatalog: () => null }).importPlan('plan').kind, 'unverified');
  assert.equal(createPlanContractImporter({ ...f.options, sourceForCatalog: () => null }).importPlan('plan').kind, 'unverified');
  assert.equal(f.kernel.runPrimitive(db => db.prepare('SELECT COUNT(*) n FROM fx_plan_history_audits').get().n), 1);
  f.kernel.runPrimitive(db => db.prepare("UPDATE fx_work_attempts SET state='running' WHERE attempt_id='attempt'").run());
  assert.equal(createPlanContractImporter(f.options).importPlan('plan').kind, 'unverified');
  assert.equal(f.count(), 0);
});

test('interrupted import rolls back document and binding together and can replay from unchanged history', t => {
  const f = fixture(t), actual = f.options.unitOfWork;
  const failing = { execute(participants) {
    return actual.execute(participants.map(participant => participant.participantId !== 'plan_contract_import' ? participant : {
      ...participant, execute(context) { participant.execute(context); throw Error('Injected import crash'); },
    }));
  } };
  assert.throws(() => createPlanContractImporter({ ...f.options, unitOfWork: failing }).importPlan('plan'), /Injected import crash/);
  assert.equal(f.count(), 0);
  assert.equal(f.kernel.runPrimitive(db => db.prepare('SELECT COUNT(*) n FROM fx_execution_contracts').get().n), 0);
  assert.equal(createPlanContractImporter(f.options).importPlan('plan').kind, 'imported');
});

test('fact drift between original proof and import commit is rejected', t => {
  const f = fixture(t), createVerifier = f.options.createHistoricalVerifier;
  const importer = createPlanContractImporter({ ...f.options, createHistoricalVerifier(reader) {
    const verifier = createVerifier(reader);
    return { verify(facts) { const result = verifier.verify(facts);
      f.kernel.runPrimitive(db => db.prepare("UPDATE fx_workflow_plans SET graph_digest=? WHERE plan_id='plan'").run('e'.repeat(64)));
      return result;
    } };
  } });
  assert.throws(() => importer.importPlan('plan'), /changed|differs/);
  assert.equal(f.count(), 0);
});
