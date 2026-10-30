'use strict';
/**
 * Isolation E2E gate for libra.us_adult.catalogue.observe@1 after the
 * P4_CAPABILITY_SCHEMA_REJECTED / face_catalogue_observation fix (#40).
 *
 * Proves, without NAS:
 *  1. A temp offline catalogue volume enables Host catalogue configuration
 *     the same way SHELFDECK_US_ADULT_CATALOGUE_ROOT does in production.
 *  2. Owner projections validate against the production inputs schema
 *     (the exact EventExecutionInputProvider gate that froze live Runs).
 *  3. An admitted Observation Work runs under EventRuntime
 *     (Plan / Permit / Effect / Result) and publishes a real
 *     face_catalogue_observation Artifact.
 *  4. Catalogue coordination advances past observe to catalogue_candidate
 *     assessment (actor-match path evidence; People registration is separate).
 *
 * Real buffalo ONNX inference and a full stash-sense2-data volume are not
 * required to prove the schema-reject unblock; computeObservation is the
 * same CleanBuffaloCataloguePort used by Host, with a fixture observation.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createGeneration, MEMBER_NAMES } = require('../../src/helix/contracts/face-catalogue-generation');
const { canonicalDigest: D, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { CAPABILITY } = require('../../src/helix/contracts/us-adult-catalogue-work-types');
const {
  resolveCatalogueHostConfiguration,
  UNAVAILABLE,
} = require('../../src/helix/domains/libra/application/us-adult-catalogue-host-config');
const { createUsAdultCataloguePortFactories } =
  require('../../src/clean-us-adult-catalogue-ports');
const { createCleanBuffaloCataloguePort } = require('../../src/clean-buffalo-catalogue-port');
const { createCapabilityContractValidator } =
  require('../../src/helix/foundation/capability/contract-validator');
const { createValidator } = require('./fixtures/catalogue-nominal-schemas');
const { coordination } = require('./fixtures/us-adult-catalogue-coordination');
const {
  createUsAdultCatalogueObservationProjections,
  createUsAdultCatalogueObservationPlanner,
  PROJECTIONS,
} = require('../../src/helix/domains/libra/planning/us-adult-catalogue-observation-planner');
const {
  createUsAdultCatalogueObservationCapability,
  createUsAdultCatalogueObservationRegistration,
} = require('../../src/helix/domains/libra/capabilities/us-adult-catalogue-observation-capability');
const { createCapabilityRegistry } =
  require('../../src/helix/foundation/capability/capability-registry');
const { createExecutorDispatcher } =
  require('../../src/helix/foundation/capability/executor-dispatcher');
const { createWorkAdmission } =
  require('../../src/helix/foundation/execution/work-admission');
const { createWorkLifecycle } =
  require('../../src/helix/foundation/execution/work-lifecycle');
const { createWorkScheduler } =
  require('../../src/helix/foundation/execution/work-scheduler');
const { createWorkSupplyController } =
  require('../../src/helix/foundation/execution/work-supply-controller');
const { createWorkflowPlanPublisher, validateWorkflowPlan } =
  require('../../src/helix/foundation/execution/workflow-plan');
const { createInputBindingProjectionRegistry } =
  require('../../src/helix/foundation/execution/input-binding-projection-registry');
const { createEventExecutionInputProvider } =
  require('../../src/helix/foundation/execution/event-execution-input-provider');
const { createResourceGovernor } =
  require('../../src/helix/foundation/execution/resource-governor');
const { createResourceProfileMapper } =
  require('../../src/helix/foundation/execution/resource-profile-mapper');
const {
  createExecutionPolicyRegistry,
  createAttemptPolicyController,
} = require('../../src/helix/foundation/execution/execution-policy');
const { createCooperativeExecutionIsolation } =
  require('../../src/helix/foundation/execution/cooperative-execution-isolation');
const { createTimeoutController } =
  require('../../src/helix/foundation/execution/timeout-controller');
const { createEventRuntime } =
  require('../../src/helix/foundation/execution/event-runtime');
const { createWorkResultReader } =
  require('../../src/helix/foundation/execution/work-result-reader');
const { createCircuitBreaker } =
  require('../../src/helix/foundation/diagnostics/pressure-guard');
const { createEffectJournal } =
  require('../../src/helix/foundation/effects/effect-journal');
const { createEffectReconcilerRegistry } =
  require('../../src/helix/foundation/effects/effect-reconcilers');
const manifest = require('../../src/helix/contracts/capabilities/libra/us_adult/catalogue/observe/v1/manifest.json');

const INPUTS = 'helix://contracts/capabilities/libra.us_adult.catalogue.observe/v1/inputs';
const now = () => 1700000000000;

function productionSchemas() {
  const root = path.resolve(__dirname, '../../src/helix/contracts');
  const schemas = [];
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.name === 'schema.json') schemas.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
  }
  collect(path.join(root, 'types'));
  collect(path.join(root, 'domain-types'));
  collect(path.join(root, 'application-types'));
  for (const name of ['inputs', 'parameters', 'resource-demand', 'fence', 'evidence', 'failure', 'result']) {
    schemas.push(JSON.parse(fs.readFileSync(path.join(root,
      'capabilities/libra/us_adult/catalogue/observe/v1', name + '.schema.json'), 'utf8')));
  }
  return schemas;
}

function mountTempCatalogue(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'us-adult-observe-e2e-'));
  const catalogueRoot = path.join(root, 'catalogue');
  const buffaloModelRoot = path.join(root, 'buffalo-models');
  fs.mkdirSync(catalogueRoot);
  fs.mkdirSync(buffaloModelRoot);
  const members = MEMBER_NAMES.map((name) => {
    const bytes = Buffer.from('fixture-member:' + name);
    const file = path.join(catalogueRoot, name);
    fs.writeFileSync(file, bytes);
    return { name, bytes: bytes.length, sha256: D(name + ':fixture') };
  });
  // Host config digests are independent of on-disk member content for enablement;
  // use stable fixture digests so generation remains a closed contract value.
  const generation = createGeneration({
    datasetVersion: 'isolation-e2e-v1',
    manifestDigest: D('isolation-e2e-manifest'),
    members: MEMBER_NAMES.map((name) => ({ name, bytes: 8, sha256: D(name) })),
  });
  const generationPath = path.join(catalogueRoot, 'generation.json');
  fs.writeFileSync(generationPath, canonicalJson(generation));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
  return { root, catalogueRoot, buffaloModelRoot, generation, generationPath, members };
}

test('temp catalogue volume enables Host config the same way production SHELFDECK_US_ADULT_CATALOGUE_ROOT does', (t) => {
  const mount = mountTempCatalogue(t);
  const previous = {
    root: process.env.SHELFDECK_US_ADULT_CATALOGUE_ROOT,
    generation: process.env.SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH,
    buffalo: process.env.SHELFDECK_BUFFALO_MODEL_ROOT,
  };
  t.after(() => {
    for (const [key, value] of Object.entries({
      SHELFDECK_US_ADULT_CATALOGUE_ROOT: previous.root,
      SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH: previous.generation,
      SHELFDECK_BUFFALO_MODEL_ROOT: previous.buffalo,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  assert.equal(resolveCatalogueHostConfiguration({}), null);

  process.env.SHELFDECK_US_ADULT_CATALOGUE_ROOT = mount.catalogueRoot;
  process.env.SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH = mount.generationPath;
  process.env.SHELFDECK_BUFFALO_MODEL_ROOT = mount.buffaloModelRoot;

  const resolved = resolveCatalogueHostConfiguration({});
  assert.equal(resolved.catalogueRoot, path.resolve(mount.catalogueRoot));
  assert.equal(resolved.buffaloModelRoot, path.resolve(mount.buffaloModelRoot));
  assert.equal(resolved.catalogueConfiguration.catalogueGeneration.generationDigest,
    mount.generation.generationDigest);

  const ports = createUsAdultCataloguePortFactories({
    catalogueHost: resolved,
    frameExtractor: {},
    workspaceProductPort: {
      materializeArtifact() { throw new Error('unused'); },
      recoverMaterializedArtifact() { return null; },
      readArtifactBytes() { throw new Error('unused'); },
      rootSnapshot() { return {}; },
    },
    now,
  });
  assert.equal(typeof ports.createCatalogueObservationPort, 'function');
  assert.equal(typeof ports.createCatalogueFramePort, 'function');
  // Unconfigured Host still fails closed (no silent degrade to old People match).
  assert.throws(
    () => createUsAdultCataloguePortFactories({ catalogueHost: null }).createCatalogueObservationPort({}),
    (error) => error.code === UNAVAILABLE,
  );
});

test('production observe inputs schema admits Owner projections with face_catalogue_observation', async (t) => {
  const f = coordination(t);
  f.reconcile();
  await f.completeFrames('initial');
  const observed = await f.completeObservation('initial');
  const production = createCapabilityContractValidator({ schemas: productionSchemas() });
  const validator = createValidator({
    includeProposed: true,
    includeApplicationTypes: true,
    capabilitySchemaRefs: [CAPABILITY],
  });
  const options = { ...f.options, contractValidator: validator, workspaceProductPort: f.workspace };
  const projections = new Map(createUsAdultCatalogueObservationProjections(options)
    .map((entry) => [entry.projectionRef, entry.projection]));
  const parameters = {
    analysisId: f.basis.analysisId,
    basisDigest: f.basis.basisDigest,
    mode: 'initial',
    completedBatchSetDigest: observed.completedBatches.setDigest,
  };
  const ownerScope = { ownerDomain: 'libra', processType: 'libra_run', processId: 'run' };
  const namedInputs = {
    usAdultCatalogueAnalysisBasis: projections.get(PROJECTIONS.basis).project({ ownerScope, parameters }),
    usAdultCatalogueCompletedBatchSet: projections.get(PROJECTIONS.batches).project({ ownerScope, parameters }),
    workspaceArtifactOutputTarget: projections.get(PROJECTIONS.target).project({ ownerScope, parameters }),
  };
  assert.equal(namedInputs.workspaceArtifactOutputTarget.outputKind, 'face_catalogue_observation');
  // This is the production EventExecutionInputProvider gate that previously
  // raised P4_CAPABILITY_SCHEMA_REJECTED / failureClass=input_projection.
  assert.doesNotThrow(() => production.validate(INPUTS, namedInputs));
  assert.equal(production.validate(INPUTS, namedInputs).workspaceArtifactOutputTarget.outputKind,
    'face_catalogue_observation');
});

test('admitted Observation Work executes under EventRuntime and publishes face_catalogue_observation', async (t) => {
  const f = coordination(t);
  f.reconcile();
  await f.completeFrames('initial');
  const fixtureObservation = await f.completeObservation('initial');
  const validator = createValidator({
    includeProposed: true,
    includeApplicationTypes: true,
    capabilitySchemaRefs: [CAPABILITY],
  });
  const production = createCapabilityContractValidator({ schemas: productionSchemas() });
  const common = { schemaManifest: f.workspaceOptions.schemaManifest, unitOfWork: f.workspaceOptions.unitOfWork };
  const root = f.workspace.rootSnapshot();
  const prior = fixtureObservation.completedBatches.batches[0].workId;
  const priorWork = f.submissions.find((work) => work.workId === prior);
  const priorJson = canonicalJson(priorWork);
  const work = fixtureObservation.work;
  assert.ok(priorWork);

  f.db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(priorWork.workId, priorWork.ownerDomain, priorWork.processType, priorWork.processId, priorWork.workKind,
      priorWork.executionBasisDigest, priorWork.priorityClass, priorWork.schemaRef, priorJson, D(priorWork),
      'succeeded', priorWork.idempotencyKey, now(), now());

  const executionProjectionProvider = {
    read: () => ({ priorityClass: 'normal_foreground', localPriority: 0, priorityRevision: 1, supplyRole: 'completion' }),
  };
  const supply = createWorkSupplyController({ ...common, executionProjectionProvider, now });
  const scheduler = createWorkScheduler({
    ...common, supplyController: supply, priorityProjectionProvider: executionProjectionProvider, now,
    nextLeaseId: (() => { let n = 0; return () => 'lease-' + (++n); })(),
  });
  const profile = createResourceProfileMapper({
    profileKey: 'default', profileRevision: 1, logicalCpu: 1, integrations: [],
    volumes: [{ volumeKey: root.mountScopeId }], encoders: [], aiDevices: [], workers: [],
  });
  const governor = createResourceGovernor({
    ...common, now, profileProvider: { current: () => profile },
    nextPermitId: (() => { let n = 0; return () => 'permit-' + (++n); })(),
  });
  const policy = createExecutionPolicyRegistry({
    expectedCapabilityRefs: [CAPABILITY],
    retryPolicies: [{
      ref: 'helix://fixture/retry/workspace/v1', effectClass: 'workspace_write',
      maxFailureAttempts: 1, backoffMs: [], retryableFailureClasses: [],
    }],
    timeoutPolicies: [{
      ref: 'helix://fixture/timeout/v1', timeoutMs: 120000,
      minObservationCadenceMs: null, maxObservationElapsedMs: null, maxObservationCount: null,
    }],
    compensationContracts: [],
    capabilityBindings: [{
      capabilityRef: CAPABILITY, effectClass: 'workspace_write',
      retryPolicyRef: 'helix://fixture/retry/workspace/v1',
      timeoutPolicyRef: 'helix://fixture/timeout/v1', compensationContractRefs: [],
    }],
  });
  const lifecycle = createWorkLifecycle({
    ...common, nextWorkAttemptId: (id) => 'attempt-' + D(id).slice(0, 24),
  });
  const workResultReader = createWorkResultReader(common);

  let computes = 0;
  let lastOutcome = null;
  const capabilityOptions = {
    ...f.options, unitOfWork: f.workspaceOptions.unitOfWork, contractValidator: validator,
    workspaceProductPort: f.workspace, now,
    createCatalogueObservationPort({ context, validateObservation, capturePublicationFence }) {
      const authority = {
        effectClass: 'workspace_write', eventAttemptId: context.eventAttemptId,
        idempotencyKey: context.idempotencyKey, recoveryDecision: context.recoveryDecision,
      };
      const scoped = {
        recoverMaterializedArtifact: (request) => f.workspace.recoverMaterializedArtifact({
          ...request, runtimeEffectAuthority: authority,
        }),
        materializeArtifact: (request) => f.workspace.materializeArtifact({
          ...request, runtimeEffectAuthority: authority,
        }),
        readArtifactBytes: (handle) => f.workspace.readArtifactBytes(handle),
      };
      return createCleanBuffaloCataloguePort({
        context, validateObservation, capturePublicationFence,
        workspaceProductPort: scoped,
        async computeObservation() {
          computes += 1;
          return fixtureObservation.observation;
        },
      });
    },
  };
  const port = createUsAdultCatalogueObservationCapability(capabilityOptions);
  const registered = {
    ...port,
    async execute(context) {
      lastOutcome = await port.execute(context);
      return lastOutcome;
    },
  };
  const registry = createCapabilityRegistry({
    registrations: [createUsAdultCatalogueObservationRegistration({ manifest, port: registered })],
    expectedCapabilityRefs: [CAPABILITY],
  });
  const planning = { ...capabilityOptions, registry, policyRegistry: policy };
  const planner = createUsAdultCatalogueObservationPlanner(planning);
  const projectionRegistry = createInputBindingProjectionRegistry({
    registrations: createUsAdultCatalogueObservationProjections(planning),
  });
  // Gate: EventExecutionInputProvider must validate against production schemas.
  const inputProvider = createEventExecutionInputProvider({
    ...common,
    contractValidator: production,
    bindingProjectionRegistry: projectionRegistry,
    workResultReader,
  });
  const publisher = createWorkflowPlanPublisher({
    ...common, contractValidator: validator, registry, policyRegistry: policy,
  });
  const admission = createWorkAdmission({
    ...common,
    limits: { globalOpenWorks: 32, ownerOpenWorks: 16, openEvents: 32 },
    eligibilityProvider: {
      check(request) {
        const current = f.store.readForExecution({
          libraRunId: request.processId, expectedBasisDigest: f.basis.basisDigest,
        });
        return {
          eligible: request.ownerDomain === 'libra' && request.processType === 'libra_run' &&
            current.runExecutionBasisDigest === request.executionBasisDigest,
          basisDigest: current.runExecutionBasisDigest,
        };
      },
    },
  });
  const verifiers = Object.fromEntries(
    ['workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit',
      'material_commit', 'destructive_commit']
      .map((effectClass) => [effectClass, {
        async verify({ receipt }) {
          assert.equal(effectClass, 'workspace_write');
          assert.ok(lastOutcome);
          const result = lastOutcome.result;
          const bytes = f.workspace.readArtifactBytes(result.observationArtifactHandle).bytes;
          assert.equal(D(JSON.parse(bytes)), result.observationArtifactHandle.digestHex);
          assert.equal(D(result), receipt.verificationEvidenceDigest);
          return { verified: true, evidenceDigest: receipt.verificationEvidenceDigest };
        },
      }]),
  );
  const journal = createEffectJournal({ ...common, now, realityVerifiers: verifiers });
  const breaker = createCircuitBreaker(common);
  const effectReconciler = createEffectReconcilerRegistry({
    observers: Object.fromEntries(
      ['workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit',
        'material_commit', 'destructive_commit']
        .map((effectClass) => [effectClass, {
          async observe(context) {
            if (effectClass !== 'workspace_write') throw new Error('unexpected recovery');
            return port.observeEffectReality(context);
          },
        }])),
  });
  const runtime = createEventRuntime({
    ...common, contractValidator: validator, scheduler, governor, registry,
    dispatcher: createExecutorDispatcher({ registry, contractValidator: validator }),
    effectJournal: journal, effectReconciler,
    attemptPolicy: createAttemptPolicyController({ registry: policy, now }),
    timeoutController: createTimeoutController({
      now, isolation: createCooperativeExecutionIsolation({ now }),
    }),
    circuitBreaker: breaker, executionInputProvider: inputProvider,
    whenEvaluator: { evaluate: () => 'run' },
    fenceValidator: {
      validate({ snapshot }) {
        const value = JSON.parse(snapshot.node.fence_basis_json);
        return { valid: true, digest: D(value), snapshot: value };
      },
    },
    resourceDemandResolver: {
      resolve({ snapshot }) {
        return {
          eventId: snapshot.event.event_id, queueClass: 'normal_foreground',
          localPriority: 0, priorityRevision: 1,
          resources: [
            { resourceKey: 'cpu_heavy', units: 1 },
            { resourceKey: 'volume_read:' + root.mountScopeId, units: 1 },
            { resourceKey: 'volume_write:' + root.mountScopeId, units: 1 },
            { resourceKey: 'sqlite_write', units: 1 },
          ],
        };
      },
    },
    nextEventAttemptId: () => 'isolation-observe-event-attempt',
    nextExecutionId: () => 'isolation-observe-execution',
    nextResultId: () => 'isolation-observe-result',
    now,
  });

  assert.equal(admission.submit(work).kind, 'admitted');
  const workLease = scheduler.acquire({ targetType: 'work' });
  assert.equal(workLease.kind, 'leased');
  const ready = lifecycle.ensurePlanningAttempt(work.workId);
  const plan = planner.plan({ ...work, workAttemptId: ready.attempt.attempt_id });
  assert.equal(validateWorkflowPlan(plan, planning).plan.planId, plan.planId);
  publisher.publish(plan);
  lifecycle.startPlanned(work.workId, ready.attempt.attempt_id);
  scheduler.release(workLease.lease);
  const eventLease = scheduler.acquire({ targetType: 'event' });
  assert.equal(eventLease.kind, 'leased');

  const outcome = await runtime.run({ schedulerLease: eventLease.lease });
  assert.equal(outcome.kind, 'succeeded', JSON.stringify(outcome));
  assert.equal(computes, 1);
  assert.equal(lastOutcome.result.observationArtifactHandle.artifactKind, 'face_catalogue_observation');
  assert.equal(
    f.db.prepare("SELECT count(*) n FROM fx_artifact_registry WHERE artifact_kind='face_catalogue_observation'").get().n,
    1,
  );
  assert.equal(
    f.db.prepare("SELECT state FROM fx_effect_journal WHERE effect_class='workspace_write' AND event_attempt_id=?")
      .get('isolation-observe-event-attempt').state,
    'committed',
  );
  lifecycle.settleWork({
    workId: work.workId, workAttemptId: ready.attempt.attempt_id, disposition: 'succeeded',
  });
  const records = workResultReader.read(work.workId).filter((value) => value.capabilityRef === CAPABILITY);
  assert.equal(records.length, 1);
  assert.equal(records[0].outcomeKind, 'succeeded');
});

test('catalogue coordination advances past observe to catalogue_candidate assessment', async (t) => {
  const f = coordination(t);
  const first = f.reconcile();
  assert.equal(first.phase, 'us_adult_catalogue_initial_frames');
  await f.completeFrames('initial');
  const pending = f.reconcile();
  assert.equal(pending.phase, 'us_adult_catalogue_initial_observation');
  assert.equal(pending.kind, 'pending');
  await f.completeObservation('initial');
  const result = f.reconcile();
  assert.equal(result.kind, 'catalogue_candidate');
  assert.equal(result.assessment.status, 'qualified_candidate');
  assert.equal(result.assessment.winner.name, 'Example Performer');
  // Observe / assessment evidence must not invent a Person id.
  assert.equal(Object.hasOwn(result.assessment.winner, 'personId'), false);
});
