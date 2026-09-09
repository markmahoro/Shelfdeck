'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createEffectJournal } = require('../../src/helix/foundation/effects/effect-journal');
const { createStartupRecovery } = require('../../src/helix/foundation/execution/startup-recovery');

const [databasePath, operation, scenario] = process.argv.slice(2);
const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000005000 });
const unitOfWork = createSqliteUnitOfWork({ kernel });
const classes = ['workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'];
const journal = createEffectJournal({ schemaManifest, unitOfWork, now: () => 1700000005001,
  realityVerifiers: Object.fromEntries(classes.map(key => [key, { verify() { throw new Error('No physical commit is authorized by this recovery test.'); } }])) });

async function main() {
  if (operation === 'seed-crash') {
    // Isolated Foundation fixture: only the Event/Attempt setup is seeded.
    // Effect states below are created and persisted through the actual journal.
    const effectClass = scenario === 'uncertain-material' ? 'material_commit' : 'workspace_write';
    kernel.runPrimitive(transaction => {
      transaction.prepare("INSERT INTO fx_supporting_works(work_id,state) VALUES('work','running')").run();
      transaction.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES('wa','work','running')").run();
      transaction.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES('plan','wa','planned')").run();
      transaction.prepare("INSERT INTO fx_plan_nodes(plan_id,node_id,effect_class) VALUES('plan','node',?)").run(effectClass);
      transaction.prepare("INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,state,retry_at_ms) VALUES('event','plan','node','work','wa','libra','libra.fixture@1','waiting_for_external',999)").run();
      transaction.prepare("INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms) VALUES('old','event',1,'completed',?,1)").run(scenario === 'unknown-old' ? 'deferred' : 'failed');
      transaction.prepare("INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms) VALUES('current','event',2,'completed','deferred',2)").run();
    });
    for (const id of ['old', 'current']) {
      const effect = journal.intend({ eventAttemptId: id, effectClass, idempotencyKey: id, intentDigest: 'a'.repeat(64) });
      journal.requireReconcile(effect.effect_id);
      if (id === 'current' && scenario !== 'live-unresolved') journal.abandonUncommitted(effect.effect_id);
    }
    process.exit(95);
  }
  const recovery = createStartupRecovery({ schemaManifest, unitOfWork,
    registry: { resolve() { return {}; } },
    policyRegistry: { bindingFor() { return { retryPolicyRef: 'retry', timeoutPolicyRef: 'timeout' }; } },
    integrityVerifier: { verify: () => ({ ok: true }) }, catalogVerifier: { verify: () => true },
    effectJournal: { abandonUncommitted(id) {
      const result = journal.abandonUncommitted(id);
      if (operation === 'recover-crash') process.exit(96);
      return result;
    } },
    effectReconciler: { async reconcile() { throw new Error('Unresolved current physical effect must remain protected.'); } },
  });
  const result = await recovery.recover();
  kernel.close();
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    process.stdout.write(JSON.stringify({ result,
      effects: db.prepare('SELECT event_attempt_id,state FROM fx_effect_journal ORDER BY event_attempt_id').all(),
      attempts: db.prepare('SELECT event_attempt_id,outcome_kind FROM fx_event_attempts ORDER BY ordinal').all() }));
  } finally { db.close(); }
}

main().catch(error => { console.error(error); kernel.close(); process.exitCode = 1; });
