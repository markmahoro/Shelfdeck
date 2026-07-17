'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createEffectReconcilerRegistry } = require('../../src/helix/foundation/effects/effect-reconcilers');
const { createStartupRecovery } = require('../../src/helix/foundation/execution/startup-recovery');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const EFFECT_CLASSES = ['pure_observation', 'workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'];
const NON_PURE = EFFECT_CLASSES.filter((value) => value !== 'pure_observation');
const CRASH_POINTS = ['before_intent', 'after_intent', 'after_fake_effect', 'after_observation', 'after_commit'];

class P4RuntimeVerificationError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'P4RuntimeVerificationError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new P4RuntimeVerificationError(code, message, details); }

function containedPath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.length > 0 && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function spawnWorker(options, args) {
  const result = childProcess.spawnSync(process.execPath, [options.workerPath, ...args], {
    cwd: options.serviceRoot, encoding: 'utf8', timeout: 15000,
    env: { NODE_ENV: 'test', NODE_PATH: process.env.NODE_PATH || '' }
  });
  return result;
}

function seed(options, databasePath, effectClass) {
  const kernel = openSqliteKernel({ Database: options.Database, databasePath, schemaDdl: options.schemaDdl,
    schemaManifest: options.schemaManifest, now: () => 1700000010000 });
  kernel.runPrimitive((transaction) => {
    transaction.prepare("INSERT INTO fx_supporting_works(work_id,state) VALUES('work','running')").run();
    transaction.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES('work-attempt','work','running')").run();
    transaction.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES('plan','work-attempt','planned')").run();
    transaction.prepare("INSERT INTO fx_plan_nodes(plan_id,node_id,effect_class) VALUES('plan','node',?)").run(effectClass);
    transaction.prepare("INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,state) VALUES('event','plan','node','work','work-attempt','libra','libra.fixture@1','executing')").run();
    transaction.prepare("INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,started_at_ms) VALUES('event-attempt','event',1,'executing',1)").run();
  });
  kernel.close();
}

function inspect(options, databasePath, ledgerPath, effectClass) {
  const database = new options.Database(databasePath, { readonly: true });
  try {
    const integrity = database.pragma('integrity_check', { simple: true });
    const effect = database.prepare('SELECT effect_class,state FROM fx_effect_journal').get() || null;
    const markers = database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count;
    const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { applied: false, dispatchCount: 0 };
    if (integrity !== 'ok') fail('P4_RUNTIME_DATABASE_INTEGRITY_FAILED', 'Crash fixture database failed integrity check.', { effectClass });
    return { effect, markers, ledger };
  } finally { database.close(); }
}

async function classify(options, databasePath, ledgerPath) {
  const kernel = openSqliteKernel({ Database: options.Database, databasePath, schemaDdl: options.schemaDdl,
    schemaManifest: options.schemaManifest, now: () => 1700000010002 });
  function reality() { return fs.existsSync(ledgerPath) && JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).applied === true; }
  const evidenceDigest = 'c'.repeat(64);
  const reconciler = createEffectReconcilerRegistry({ observers: {
    workspace_write: { async observe() { return { status: reality() ? 'matching' : 'absent', evidenceDigest, cleanupDeclared: false }; } },
    external_request: { async observe() { return { status: reality() ? 'committed' : 'absent', evidenceDigest }; } },
    domain_fact_commit: { async observe() { return { status: reality() ? 'committed' : 'absent', revisionMatches: reality(), fenceValid: true, evidenceDigest }; } },
    responsibility_control_commit: { async observe() { return { status: reality() ? 'whole_established' : 'whole_absent', fenceValid: true, evidenceDigest }; } },
    material_commit: { async observe() { return { status: reality() ? 'committed' : 'forward_required', rollbackDeclared: false, evidenceDigest }; } },
    destructive_commit: { async observe() { return { status: reality() ? 'complete' : 'remaining', evidenceDigest }; } }
  } });
  const recovery = createStartupRecovery({
    schemaManifest: options.schemaManifest,
    unitOfWork: createSqliteUnitOfWork({ kernel }),
    registry: { resolve: () => ({}) },
    policyRegistry: { bindingFor: () => ({ retryPolicyRef: 'retry', timeoutPolicyRef: 'timeout' }) },
    integrityVerifier: { verify: () => ({ ok: true }) },
    catalogVerifier: { verify: () => true },
    effectReconciler: reconciler
  });
  try { return await recovery.recover(); }
  finally { kernel.close(); }
}

async function verifyP4RuntimeCrossProcess(options) {
  if (!options || typeof options.Database !== 'function' || !options.schemaManifest || typeof options.schemaDdl !== 'string' ||
      typeof options.tempRoot !== 'string' || typeof options.serviceRoot !== 'string' || typeof options.workerPath !== 'string') {
    fail('P4_RUNTIME_VERIFY_OPTIONS_INVALID', 'P4 Runtime verifier options are incomplete.');
  }
  if (!path.isAbsolute(options.tempRoot) || !containedPath(os.tmpdir(), options.tempRoot) ||
      !containedPath(options.serviceRoot, options.workerPath) ||
      path.basename(options.workerPath) !== 'p4-crash-worker.js') {
    fail('P4_RUNTIME_VERIFY_BOUNDARY_INVALID', 'P4 Runtime verifier must own a temp root and exact local worker.');
  }
  const scenarios = [];

  const pureRoot = path.join(options.tempRoot, 'pure-observation');
  fs.mkdirSync(pureRoot, { recursive: true });
  const pureDatabase = path.join(pureRoot, 'shelfdeck.db');
  seed(options, pureDatabase, 'pure_observation');
  const pureFirst = await classify(options, pureDatabase, path.join(pureRoot, 'ledger.json'));
  const pureSecond = await classify(options, pureDatabase, path.join(pureRoot, 'ledger.json'));
  if (pureFirst.actions[0]?.decision !== 'safe_retry' || JSON.stringify(pureFirst) !== JSON.stringify(pureSecond)) fail(
    'P4_RUNTIME_PURE_RECOVERY_UNSTABLE', 'Pure crash recovery must be stable safe retry.'
  );
  scenarios.push({ effectClass: 'pure_observation', crashPoint: 'process_loss', decision: 'safe_retry' });

  for (const effectClass of NON_PURE) for (const crashPoint of CRASH_POINTS) {
    const root = path.join(options.tempRoot, effectClass + '-' + crashPoint);
    fs.mkdirSync(root, { recursive: true });
    const databasePath = path.join(root, 'shelfdeck.db');
    const ledgerPath = path.join(root, 'fake-effect.json');
    seed(options, databasePath, effectClass);
    const crashed = spawnWorker(options, ['crash', databasePath, ledgerPath, effectClass, crashPoint]);
    if (crashed.status !== 73) fail('P4_RUNTIME_CRASH_NOT_INJECTED', 'Crash worker did not stop at the requested boundary.', {
      effectClass, crashPoint, status: crashed.status, stderr: crashed.stderr
    });
    const before = inspect(options, databasePath, ledgerPath, effectClass);
    const first = await classify(options, databasePath, ledgerPath);
    const second = await classify(options, databasePath, ledgerPath);
    if (JSON.stringify(first) !== JSON.stringify(second) || first.state !== 'recovering' || first.normalSupplyAllowed !== false) fail(
      'P4_RUNTIME_RECOVERY_CLASSIFICATION_UNSTABLE', 'Crash recovery classification must be stable and fail closed.', { effectClass, crashPoint }
    );
    const expectedDecision = crashPoint === 'before_intent' ? 'safe_retry_before_intent'
      : (crashPoint === 'after_commit' ? 'already_committed'
        : (crashPoint === 'after_intent'
          ? (['material_commit', 'destructive_commit'].includes(effectClass) ? 'continue_forward' : 'safe_retry')
          : (effectClass === 'workspace_write' ? 'continue_forward' : 'already_committed')));
    if (first.actions[0]?.decision !== expectedDecision) fail('P4_RUNTIME_RECOVERY_DECISION_MISMATCH',
      'Crash boundary produced the wrong recovery decision.', { effectClass, crashPoint, expectedDecision, actual: first.actions[0] });
    const recovered = spawnWorker(options, ['recover', databasePath, ledgerPath, effectClass, 'none']);
    const replayed = spawnWorker(options, ['recover', databasePath, ledgerPath, effectClass, 'none']);
    if (recovered.status !== 0 || replayed.status !== 0) fail('P4_RUNTIME_RECOVERY_WORKER_FAILED', 'Recovery worker failed.', {
      effectClass, crashPoint, first: recovered.stderr, replay: replayed.stderr
    });
    const after = inspect(options, databasePath, ledgerPath, effectClass);
    if (!after.effect || after.effect.effect_class !== effectClass || after.effect.state !== 'committed' ||
        after.markers !== 1 || after.ledger.applied !== true || after.ledger.dispatchCount !== 1) fail(
      'P4_RUNTIME_EFFECT_DUPLICATED_OR_UNCOMMITTED', 'Recovery must converge one Effect, one marker, and one fake dispatch.', { effectClass, crashPoint, before, after }
    );
    scenarios.push({ effectClass, crashPoint, decision: expectedDecision, dispatchCount: after.ledger.dispatchCount });
  }
  return Object.freeze({ ok: true, effectClassCount: EFFECT_CLASSES.length, nonPureCrashPointCount: CRASH_POINTS.length,
    scenarioCount: scenarios.length, scenarios: Object.freeze(scenarios), prohibitedActionsRun: Object.freeze([]) });
}

module.exports = Object.freeze({ P4RuntimeVerificationError, verifyP4RuntimeCrossProcess });
