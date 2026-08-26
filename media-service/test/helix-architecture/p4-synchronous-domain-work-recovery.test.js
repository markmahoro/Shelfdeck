'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createSynchronousDomainWork } = require('../../src/helix/foundation/execution/synchronous-domain-work');
const { createWorkAdmission } = require('../../src/helix/foundation/execution/work-admission');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

test('synchronous Work recovers an exact ready first Attempt claimed before its external supply exclusion', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-synchronous-work-recovery-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000003300 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const workId = 'synchronous-recovery-work';
  const basisDigest = canonicalDigest({ workId });
  try {
    const admitted = createWorkAdmission({
      schemaManifest,
      unitOfWork,
      eligibilityProvider: { check: () => ({ eligible: true, basisDigest }) },
      limits: { globalOpenWorks: 10, ownerOpenWorks: 10, openEvents: 10 },
    }).submit({
      schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1, workId,
      ownerDomain: 'procurement', processType: 'procurement_run', processId: 'run-1',
      workKind: 'failed_preparation_retry', workObjectiveTypeRef: 'helix://procurement/work/FailedPreparationRetry/v1',
      workObjectiveVersion: 1, executionBasisId: 'basis-1', executionBasisDigest: basisDigest,
      dependencyRefs: [], priorityClass: 'normal_foreground', priorityRevision: 1,
      capabilityCatalogScope: 'procurement', workspaceMaterialScope: [], idempotencyKey: 'retry-key-1',
      concurrencyScope: 'field-1/failed-preparation-retry',
      outputContractRef: 'helix://contracts/application-types/ProcurementRetryAdmissionResult/v1',
    });
    assert.equal(admitted.kind, 'admitted');
    const database = new Database(databasePath);
    try {
      database.prepare(`INSERT INTO fx_work_attempts
        (attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code)
        VALUES (?,?,?,?,?,?,?,?)`).run(workId + ':attempt:1', workId, 1, basisDigest, 'ready', null, null, null);
      database.prepare("UPDATE fx_supporting_works SET state='ready' WHERE work_id=?").run(workId);
    } finally {
      database.close();
    }
    const runtime = createSynchronousDomainWork({ schemaManifest, unitOfWork });
    const input = Object.freeze({ retry: true });
    const demand = Object.freeze({ resourceKinds: Object.freeze(['cpu']) });
    const activated = runtime.activate({
      workId, ownerDomain: 'procurement', basisDigest,
      plannerRef: 'procurement.failed-preparation-retry-planner@1',
      catalogDigest: canonicalDigest({ capability: 'procurement.retry.intent.create@1' }),
      steps: [Object.freeze({
        nodeId: 'retry-intent', eventId: 'retry-intent-event', capabilityRef: 'procurement.retry.intent.create@1',
        effectClass: 'domain_fact_commit', inputSchemaRef: 'helix://fixtures/retry/input/v1', input,
        parametersSchemaRef: 'helix://fixtures/retry/parameters/v1', parameters: Object.freeze({}),
        fenceSchemaRef: 'helix://fixtures/retry/fence/v1', fenceBasis: Object.freeze({
          basisDigest, inputSetDigest: canonicalDigest(input), eventFenceDigest: canonicalDigest({ event: 1 }),
          effectScopeDigest: canonicalDigest({ scope: 1 }),
        }),
        resourceDemandSchemaRef: 'helix://fixtures/retry/demand/v1',
        resourceDemand: Object.freeze({ ...demand, demandDigest: canonicalDigest(demand) }),
      })],
    });
    assert.equal(activated.replayed, false);
    assert.equal(activated.snapshot.work.state, 'running');
    assert.equal(activated.snapshot.attempt.state, 'running');
    assert.equal(activated.snapshot.events.length, 1);
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
