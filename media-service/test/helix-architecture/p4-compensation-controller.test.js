'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createCompensationController } = require('../../src/helix/foundation/execution/compensation-controller');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const EVIDENCE = 'a'.repeat(64);

function fixture(run, settings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-compensation-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000003000 });
  kernel.runPrimitive((transaction) => {
    transaction.prepare("INSERT INTO fx_supporting_works(work_id,state) VALUES('work','running')").run();
    transaction.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES('attempt','work','running')").run();
    transaction.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES('plan','attempt','planned')").run();
    transaction.prepare("INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,effect_class) VALUES('plan','target-node','libra.fixture.write@1',?)")
      .run(settings.targetEffectClass || 'workspace_write');
    transaction.prepare("INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,state) VALUES('target','plan','target-node','work','attempt',?)")
      .run(settings.targetState || 'failed');
    transaction.prepare("INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,effect_class,when_schema_ref,when_json) VALUES('plan','comp-node','libra.fixture.cleanup@1','workspace_write',?,?)")
      .run(settings.withWhen ? 'helix://fixture/when/v1' : null, settings.withWhen ? '{}' : null);
    transaction.prepare("INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,state) VALUES('comp','plan','comp-node','work','attempt','pending')").run();
    transaction.prepare("INSERT INTO fx_plan_edges(plan_id,from_node_id,to_node_id,dependency_kind) VALUES('plan','target-node','comp-node','terminal')").run();
  });
  const policyRegistry = {
    bindingFor: () => ({ compensationContractRefs: ['helix://foundation/compensation/workspace-cleanup/v1'] }),
    compensation: () => ({ ref: 'helix://foundation/compensation/workspace-cleanup/v1', targetEffectClasses: ['workspace_write'],
      compensationCapabilityRefs: ['libra.fixture.cleanup@1'], requiredDecision: 'compensate' })
  };
  const controller = createCompensationController({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }), policyRegistry,
    eligibilityEvaluator: { evaluate: () => settings.eligibility || 'authorize' } });
  try { return run({ controller, databasePath }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function request(overrides = {}) {
  return { compensationEventId: 'comp', targetEventId: 'target', recoveryDecision: 'compensate', evidenceDigest: EVIDENCE, ...overrides };
}

test('only predeclared exact compensation becomes ready from durable recovery evidence', () => fixture(({ controller, databasePath }) => {
  const result = controller.authorize(request());
  assert.equal(result.decision, 'ready');
  const database = new Database(databasePath, { readonly: true });
  try { assert.deepEqual(database.prepare("SELECT state,ready_at_ms FROM fx_workflow_events WHERE event_id='comp'").get(),
    { state: 'ready', ready_at_ms: 1700000003000 }); } finally { database.close(); }
}));

test('restricted applicability may skip but cannot invent another action', () => fixture(({ controller }) => {
  assert.equal(controller.authorize(request()).decision, 'skipped');
}, { withWhen: true, eligibility: 'skip' }));

test('wrong recovery decision, missing evidence, nonterminal target, and destructive rollback fail closed', () => {
  fixture(({ controller }) => assert.throws(() => controller.authorize(request({ recoveryDecision: 'safe_retry' })),
    { code: 'P4_COMPENSATION_AUTHORIZATION_INVALID' }));
  fixture(({ controller }) => assert.throws(() => controller.authorize(request({ evidenceDigest: 'bad' })),
    { code: 'P4_COMPENSATION_AUTHORIZATION_INVALID' }));
  fixture(({ controller }) => assert.throws(() => controller.authorize(request()),
    { code: 'P4_COMPENSATION_EVENT_STATE_INVALID' }), { targetState: 'executing' });
  fixture(({ controller }) => assert.throws(() => controller.authorize(request()),
    { code: 'P4_COMPENSATION_PLAN_CONTRACT_MISMATCH' }), { targetEffectClass: 'destructive_commit' });
});

test('ordinary Event advancement cannot activate compensation node after target terminal', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/event-runtime.js'), 'utf8');
  assert.equal(source.includes("if (inbound.some((edge) => edge.dependency_kind === 'terminal')) continue;"), true);
});
