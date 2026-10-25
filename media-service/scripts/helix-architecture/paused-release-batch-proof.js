'use strict';

const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const load = relative => require(path.join(root, relative));
const { createSqliteUnitOfWork } = load('src/helix/foundation/persistence/sqlite-unit-of-work');
const { createCatalogPlanProofReader } = load('src/helix/foundation/execution/catalog-plan-proof-reader');
const { createHelixExecutionPolicyRegistry } = load('src/helix/composition/create-procurement-execution-runtime');
const { createPausedReleaseBatchProof } = load('scripts/helix-architecture/history-evidence/paused-release-batches');
const { createReadonlyProofProjectionRegistry } = require('./readonly-history-projections');

function provePausedReleaseBatches(database, schemaManifest) {
  if (!database.inTransaction) throw new Error('Paused batch proof requires a read snapshot.');
  const rows = database.prepare(`SELECT p.plan_id FROM fx_workflow_plans p JOIN fx_work_attempts a ON a.attempt_id=p.attempt_id
    JOIN fx_supporting_works w ON w.work_id=a.work_id
    WHERE w.state IN ('admitted','ready','running','blocked') ORDER BY p.plan_id LIMIT 101`).all();
  const protectedIds = { fx_supporting_works: [], fx_work_attempts: [], fx_workflow_events: [] };
  if (!rows.length || rows.length > 100) return protectedIds;
  const schemas = new Map(), manifests = {};
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('schema.json') || entry.name === 'manifest.json') {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (value.$id) schemas.set(value.$id, value);
        if (value.capabilityRef) manifests[value.capabilityRef] = value;
      }
    }
  }
  walk(path.join(root, 'src/helix/contracts'));
  const kernel = { runPrimitive(operation) {
    return operation({ commitTimeMs: 0, prepare(sql) {
      if (!/^SELECT\b/i.test(sql)) throw new Error('Paused batch qualification cannot write.');
      return database.prepare(sql);
    } });
  } };
  const proofReader = createCatalogPlanProofReader({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }) });
  const proof = createPausedReleaseBatchProof({ proofReader, schemas,
    policyRegistry: createHelixExecutionPolicyRegistry(manifests),
    bindingProjectionRegistry: createReadonlyProofProjectionRegistry(load).registry,
    registry: { resolve(ref, owner) {
      const manifest = manifests[ref];
      if (!manifest || manifest.ownerScope !== owner) throw new Error('Paused batch current Owner mismatch.');
      return { manifest };
    } },
  });
  const sets = Object.fromEntries(Object.keys(protectedIds).map(key => [key, new Set()]));
  for (const row of rows) {
    const snapshot = proofReader.verify(reader => reader.read(row.plan_id));
    const facts = proof.inspect(snapshot);
    if (!facts) continue;
    for (const graph of facts) {
      sets.fx_supporting_works.add(graph.work.work_id);
      sets.fx_work_attempts.add(graph.workAttempt.attempt_id);
      graph.events.forEach(event => sets.fx_workflow_events.add(event.event_id));
    }
  }
  return Object.fromEntries(Object.entries(sets).map(([key, value]) => [key, [...value].sort()]));
}

module.exports = Object.freeze({ provePausedReleaseBatches });
