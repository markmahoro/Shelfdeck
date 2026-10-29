'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createReconcileCursorStore } = require('../../src/helix/foundation/execution/reconcile-cursor-store');
const { createPlanHistoryAudit } = require('../../src/helix/foundation/execution/plan-history-audit');
const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-history-audit-'));
  const kernel = openSqliteKernel({ Database, databasePath: path.join(root, 'shelfdeck.db'), schemaDdl, schemaManifest });
  t.after(() => { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); });
  kernel.runPrimitive(db => {
    for (const id of ['a', 'b', 'c', 'd']) {
      db.prepare('INSERT INTO fx_supporting_works(work_id,state) VALUES(?,?)').run(id, 'succeeded');
      db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES(?,?,?)').run(id, id, 'succeeded');
      db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES(?,?,?)').run(id, id, 'planned');
    }
  });
  let clock = 1000;
  const now = () => clock, unitOfWork = createSqliteUnitOfWork({ kernel }), findings = [], verified = [];
  const cursorStore = createReconcileCursorStore({ schemaManifest, unitOfWork, now });
  const states = { a: 'succeeded', b: 'succeeded', c: 'running', d: 'succeeded' };
  const options = { schemaManifest, unitOfWork, now, cursorStore,
    proofReader: { verify: callback => callback({ read: id => ({ plan: { plan_id: id }, work: {}, workAttempt: { state: states[id] } }),
      readContract: id => id === 'a' ? null : { binding: { contract_digest: 'f'.repeat(64) } } }) },
    verifier: { verify(facts) { verified.push(facts.plan.plan_id); return facts.plan.plan_id !== 'b'; } },
    onFinding: value => findings.push(value) };
  return { kernel, options, findings, verified, advance: () => { clock += 86400001; },
    receipts: () => kernel.runPrimitive(db => db.prepare('SELECT audit_json FROM fx_plan_history_audits ORDER BY plan_id').all().map(row => JSON.parse(row.audit_json))) };
}

test('bounded audit persists failures, skips active execution and continues independent history across restarts', async t => {
  const f = fixture(t);
  assert.equal((await createPlanHistoryAudit(f.options).scan({ limit: 2 })).processed, 2);
  assert.equal((await createPlanHistoryAudit(f.options).scan({ limit: 2 })).processed, 2);
  assert.deepEqual(f.receipts().map(row => [row.planId, row.findingCode]), [
    ['a', 'PLAN_CONTRACT_EVIDENCE_MISSING'], ['b', 'PLAN_HISTORY_PROOF_REJECTED'], ['d', null] ]);
  assert.deepEqual(f.verified, ['b', 'd']);
  assert.equal(f.findings.length, 2);
  assert.equal((await createPlanHistoryAudit(f.options).scan({ limit: 2 })).finished, true);
  assert.equal((await createPlanHistoryAudit(f.options).scan()).kind, 'not_due');
  f.advance();
  await createPlanHistoryAudit(f.options).scan();
  assert.equal(f.receipts().length, 3, 'Unchanged facts and verdicts deduplicate across sweeps.');
  assert.equal(f.kernel.runPrimitive(db => db.prepare('SELECT COUNT(*) count FROM fx_workflow_plans').get().count), 4);
});

test('crash after receipt commit replays safely before advancing the durable cursor', async t => {
  const f = fixture(t), actual = f.options.cursorStore;
  f.options.cursorStore = { read: actual.read, advance() { throw Error('Injected crash'); } };
  await assert.rejects(createPlanHistoryAudit(f.options).scan({ limit: 1 }), /Injected crash/);
  assert.equal(f.receipts().length, 1);
  f.options.cursorStore = actual;
  await createPlanHistoryAudit(f.options).scan({ limit: 1 });
  assert.equal(f.receipts().length, 1);
});

test('fact changes during verification cannot be recorded as verified', async t => {
  const f = fixture(t);
  let changed = false;
  f.options.proofReader = { verify: callback => callback({ read: id => ({ plan: { plan_id: id }, work: {},
    workAttempt: { state: 'succeeded' }, revision: changed ? 2 : 1 }), readContract: () => ({ binding: { contract_digest: 'f'.repeat(64) } }) }) };
  f.options.verifier = { verify() { changed = true; return true; } };
  await createPlanHistoryAudit(f.options).scan({ limit: 1 });
  assert.equal(f.receipts()[0].findingCode, 'PLAN_HISTORY_CHANGED_DURING_AUDIT');
});
