'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const {
  reconstruct,
} = require('../../src/helix/domains/procurement/application/candidate-delivery-service');
const {
  createCandidateDeliveryReader,
} = require('../../src/helix/domains/procurement/persistence/candidate-delivery-reader');
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const cleanSchemaManifest = require(
  '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'
);
const candidateAssemblyBindingSchemaRef =
  'helix://contracts/application-types/ProcurementCandidateAssemblyPlanBinding/v1';

const secretRoot = 'p14-series-handoff-a-secret-root-0123456789abcdef';
const cleanSchemaDdl = fs.readFileSync(path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

function probe(readHandle) {
  const value = {
    resultKind: 'probed',
    sourceHandleDigest: canonicalDigest(readHandle),
    durationMs: 1000,
    videoStreams: [{
      streamIndex: 0,
      codec: 'hevc',
      dispositionDefault: true,
      width: 1920,
      height: 1080,
    }],
    audioStreams: [],
    subtitleStreams: [],
    discTopology: null,
    payloadDigest: '',
  };
  value.payloadDigest = canonicalDigest(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'payloadDigest'),
  ));
  return Object.freeze(value);
}

async function session(host, apiKey) {
  return (await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  })).headers['set-cookie'];
}

async function establishSeriesShelfAndRouting(
  host,
  apiKey,
  root,
  fieldId,
) {
  const cookie = await session(host, apiKey);
  const shelfRoot = path.join(root, 'series-shelf');
  fs.mkdirSync(shelfRoot, { recursive: true });
  const initialStandard = { profileRuleSets: [] };
  const placement = { folderTemplate: '{title}', collisionPolicy: 'reject' };
  const created = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves',
    headers: { cookie },
    payload: {
      idempotencyKey: 'series-handoff-shelf-create',
      shelfId: 'series-handoff-shelf',
      name: 'Series Shelf',
      target: {
        endpointId: 'series-handoff-shelf-endpoint',
        rootLocation: shelfRoot,
        mountScopeId: 'series-handoff-shelf-mount',
        mountScopeRevision: 1,
      },
      standard: {
        ruleTemplateId: 'series-initial-template',
        ruleTemplateRevision: 1,
        schemaRef: 'helix://fixtures/series-initial-standard/v1',
        value: initialStandard,
        digest: canonicalDigest(initialStandard),
      },
      placement: {
        schemaRef: 'helix://fixtures/series-placement/v1',
        value: placement,
        digest: canonicalDigest(placement),
      },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const bound = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves/series-handoff-shelf/actions/bind-template',
    headers: { cookie },
    payload: {
      idempotencyKey: 'series-handoff-shelf-bind',
      shelfId: 'series-handoff-shelf',
      expectedStandardRevision: 1,
      expectedRoutingProjectionRevision: 1,
      ruleTemplateId: 'system-beta-recommended',
      expectedTemplateRevision: 1,
    },
  });
  assert.equal(bound.statusCode, 200, bound.body);
  const routed = await host.inject({
    method: 'PATCH',
    url: `/v1/admin/routing/material-fields/${fieldId}`,
    headers: { cookie },
    payload: {
      idempotencyKey: 'series-handoff-routing-publish',
      fieldId,
      expectedPolicyId: null,
      expectedRevision: 0,
      policy: {
        routingPolicyId: 'series-handoff-routing-policy',
        mode: 'sorting',
        targets: [{
          shelfId: 'series-handoff-shelf',
          rank: 1,
          matchExpression: {
            nodeKind: 'predicate',
            factKind: 'content_profile',
            operator: 'eq',
            expectedValue: 'series',
          },
        }],
      },
    },
  });
  assert.equal(routed.statusCode, 200, routed.body);
  return Object.freeze({ shelfRoot });
}

test('Candidate assembly physical Probe is invoked only by a formally begun phase Event', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/helix/domains/procurement/application/movie-run-coordinator.js',
  ), 'utf8');
  assert.equal(
    [...source.matchAll(/options\.mediaProbe\.probe\(handle\)/g)].length,
    1,
  );
  const formalRunner = source.indexOf('async function runFormalPhase');
  const beginEvent = source.indexOf(
    'options.workRuntime.beginEvent(planned.eventId)',
    formalRunner,
  );
  const physicalProbe = source.indexOf(
    'execute: () => options.mediaProbe.probe(handle)',
    beginEvent,
  );
  assert.ok(formalRunner >= 0);
  assert.ok(beginEvent > formalRunner);
  assert.ok(physicalProbe > beginEvent);
  assert.equal(
    source.slice(source.indexOf('async function advance'), physicalProbe)
      .includes('await options.mediaProbe.probe(handle)'),
    false,
  );
});

test('Series public HTTP publishes one Season Candidate and accepts one new Subject with N:M Episodes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-series-handoff-a-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const sourceRoot = path.join(root, 'series-source');
  const seasonRoot = path.join(sourceRoot, 'Season 1');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.mkdirSync(seasonRoot, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<!doctype html><div id="root"></div>');

  const sources = [
    ['Demo.Show.S01E01.mkv', Buffer.from('series-episode-1')],
    ['Demo.Show.S01E01.nfo', Buffer.from('<episodedetails><season>1</season><episode>1</episode></episodedetails>')],
    ['Demo.Show.S01E02.mkv', Buffer.from('series-episode-2')],
    ['Demo.Show.S01E02.nfo', Buffer.from('<episodedetails><season>1</season><episode>2</episode></episodedetails>')],
  ];
  for (const [name, bytes] of sources) fs.writeFileSync(path.join(seasonRoot, name), bytes);
  const rootSidecars = [
    ['tvshow.nfo', Buffer.from('<tvshow><title>Demo Show</title></tvshow>')],
    ['season01-poster.jpg', Buffer.from('series-season-poster')],
  ];
  for (const [name, bytes] of rootSidecars) fs.writeFileSync(path.join(sourceRoot, name), bytes);
  const before = new Map([
    ...sources.map(([name]) => path.join(seasonRoot, name)),
    ...rootSidecars.map(([name]) => path.join(sourceRoot, name)),
  ].map((file) => {
    return [file, { bytes: fs.readFileSync(file), mtimeMs: fs.statSync(file).mtimeMs }];
  }));

  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  let mediaProbeCalls = 0;
  const mediaProbe = Object.freeze({ async probe(readHandle) {
    mediaProbeCalls += 1;
    return probe(readHandle);
  } });
  const access = {
    fieldId: 'series-handoff-field',
    revision: 1,
    endpointId: 'series-handoff-endpoint',
    rootLocation: sourceRoot,
    mountScopeId: 'series-handoff-mount',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/series-handoff-access/v1',
  };
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.jpg', '.mkv', '.nfo'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'series-handoff-policy',
    revision: 1,
    ...policyValue,
  };
  const register = {
    idempotencyKey: 'series-handoff-register',
    fieldId: access.fieldId,
    name: 'Series Handoff Source',
    policy: {
      extractionPolicyId: policyBasis.extractionPolicyId,
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...access, accessDigest: canonicalDigest(access) },
  };
  const observe = {
    idempotencyKey: 'series-handoff-observe',
    fieldId: access.fieldId,
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 8,
  };

  let injected = false;
  let host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    movieRunFaultInjector(point, details) {
      if (!injected &&
          point === 'after_formal_probe_event_begin_before_result' &&
          details.ordinal === 0) {
        injected = true;
        throw new Error('fixture-crash-after-formal-probe-begin');
      }
    },
  });
  try {
    const unauthorized = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      payload: observe,
    });
    assert.equal(unauthorized.statusCode, 401);
    const cookie = await session(host, initialized.adminApiKey);
    await establishSeriesShelfAndRouting(
      host,
      initialized.adminApiKey,
      root,
      access.fieldId,
    );
    const registered = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: register,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const observed = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie },
      payload: observe,
    });
    assert.equal(observed.statusCode, 400, observed.body);
    assert.equal(mediaProbeCalls, 0);
  } finally {
    await host.close();
  }

  let interrupted = new Database(path.join(dataDir, 'shelfdeck.db'));
  const firstProbeEvent = interrupted.prepare(
    `SELECT event_id,state
       FROM fx_workflow_events
      WHERE capability_ref='shared.material.media.probe@1'
      ORDER BY event_id
      LIMIT 1`
  ).get();
  assert.equal(firstProbeEvent.state, 'executing');
  assert.equal(interrupted.prepare(
    'SELECT count(*) count FROM fx_event_result_bindings WHERE event_id=?'
  ).get(firstProbeEvent.event_id).count, 0);
  interrupted.close();

  injected = false;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    movieRunFaultInjector(point, details) {
      if (!injected &&
          point === 'after_formal_probe_result_before_event_success' &&
          details.ordinal === 0) {
        injected = true;
        throw new Error('fixture-crash-after-formal-probe-result');
      }
    },
  });
  try {
    const observed = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(observed.statusCode, 400, observed.body);
    assert.equal(mediaProbeCalls, 1);
  } finally {
    await host.close();
  }

  interrupted = new Database(path.join(dataDir, 'shelfdeck.db'));
  assert.equal(interrupted.prepare(
    'SELECT state FROM fx_workflow_events WHERE event_id=?'
  ).get(firstProbeEvent.event_id).state, 'executing');
  assert.equal(interrupted.prepare(
    'SELECT count(*) count FROM fx_event_result_bindings WHERE event_id=?'
  ).get(firstProbeEvent.event_id).count, 1);
  interrupted.close();

  injected = false;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    movieRunFaultInjector(point) {
      if (!injected && point === 'after_triage_results_before_publication') {
        injected = true;
        throw new Error('fixture-crash-after-triage-results');
      }
    },
  });
  try {
    const observed = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(observed.statusCode, 400, observed.body);
    assert.equal(mediaProbeCalls, 2);
  } finally {
    await host.close();
  }

  interrupted = new Database(path.join(dataDir, 'shelfdeck.db'));
  assert.equal(interrupted.prepare(
    'SELECT count(*) count FROM proc_candidate_packages'
  ).get().count, 0);
  assert.equal(interrupted.prepare(
    `SELECT count(*) count
       FROM fx_event_result_bindings result
       JOIN fx_workflow_events event ON event.event_id=result.event_id
      WHERE event.capability_ref IN (
        'shared.material.media.probe@1',
        'procurement.triage.playability.inspect@1',
        'procurement.triage.structure.inspect@1',
        'procurement.triage.identity_claim.resolve@1',
        'procurement.triage.primary_manifest.build@1'
      )`
  ).get().count, 6);
  const planRows = interrupted.prepare(
    `SELECT node_id,input_binding_schema_ref,input_bindings_json
      FROM fx_plan_nodes
      WHERE input_binding_schema_ref=
        ?
      ORDER BY node_id`
  ).all(candidateAssemblyBindingSchemaRef);
  assert.equal(planRows.length, 7);
  for (const row of planRows) {
    assert.equal(
      row.input_binding_schema_ref,
      candidateAssemblyBindingSchemaRef,
    );
    assert.ok(Buffer.byteLength(row.input_bindings_json, 'utf8') <= 16384);
    assert.equal(row.input_bindings_json.includes('"candidateDraft"'), false);
    assert.equal(row.input_bindings_json.includes('"relatedReferences"'), false);
    assert.equal(row.input_bindings_json.includes('"primaryInputManifestDraft"'), false);
  }
  const publicationNode = planRows.find((row) =>
    JSON.parse(row.input_bindings_json).bindingKind === 'candidate_publication');
  assert.ok(publicationNode);
  const originalPublicationBinding = publicationNode.input_bindings_json;
  const structureResult = interrupted.prepare(
    `SELECT result.result_id,result.result_json
       FROM fx_event_result_bindings result
       JOIN fx_workflow_events event ON event.event_id=result.event_id
      WHERE event.capability_ref='procurement.triage.structure.inspect@1'`
  ).get();
  interrupted.prepare(
    'UPDATE fx_event_result_bindings SET result_json=? WHERE result_id=?'
  ).run('{}', structureResult.result_id);
  interrupted.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const tampered = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(tampered.statusCode, 400, tampered.body);
  } finally {
    await host.close();
  }
  const refTamper = new Database(path.join(dataDir, 'shelfdeck.db'));
  assert.equal(refTamper.prepare(
    'SELECT count(*) count FROM proc_candidate_packages'
  ).get().count, 0);
  refTamper.prepare(
    'UPDATE fx_event_result_bindings SET result_json=? WHERE result_id=?'
  ).run(structureResult.result_json, structureResult.result_id);
  refTamper.close();

  async function assertBindingTamperRejected(mutator) {
    const tamperDb = new Database(path.join(dataDir, 'shelfdeck.db'));
    const binding = JSON.parse(originalPublicationBinding);
    mutator(binding);
    binding.bindingDigest = canonicalDigest(Object.fromEntries(
      Object.entries(binding).filter(([key]) => key !== 'bindingDigest'),
    ));
    tamperDb.prepare(
      'UPDATE fx_plan_nodes SET input_bindings_json=? WHERE node_id=?'
    ).run(JSON.stringify(binding), publicationNode.node_id);
    tamperDb.close();
    host = await createCleanServiceHost({
      dataDir,
      adminDistDir,
      secretRoot,
      mediaProbe,
    });
    try {
      const rejected = await host.inject({
        method: 'POST',
        url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
        headers: { cookie: await session(host, initialized.adminApiKey) },
        payload: observe,
      });
      assert.equal(rejected.statusCode, 400, rejected.body);
    } finally {
      await host.close();
    }
    const restoreDb = new Database(path.join(dataDir, 'shelfdeck.db'));
    assert.equal(restoreDb.prepare(
      'SELECT count(*) count FROM proc_candidate_packages'
    ).get().count, 0);
    restoreDb.prepare(
      'UPDATE fx_plan_nodes SET input_bindings_json=? WHERE node_id=?'
    ).run(originalPublicationBinding, publicationNode.node_id);
    restoreDb.close();
  }

  await assertBindingTamperRejected((binding) => {
    binding.schemaRef =
      'helix://contracts/application-types/ProcurementCandidateAssemblyPlanBinding/v2';
  });
  await assertBindingTamperRejected((binding) => {
    binding.bindingKind = 'unregistered_candidate_variant';
  });

  const missingRefDb = new Database(path.join(dataDir, 'shelfdeck.db'));
  const missingRefBinding = JSON.parse(originalPublicationBinding);
  missingRefBinding.sourceResultRefs[0].resultId = 'missing-result-ref';
  missingRefBinding.bindingDigest = canonicalDigest(Object.fromEntries(
    Object.entries(missingRefBinding).filter(([key]) => key !== 'bindingDigest'),
  ));
  missingRefDb.prepare(
    'UPDATE fx_plan_nodes SET input_bindings_json=? WHERE node_id=?'
  ).run(JSON.stringify(missingRefBinding), publicationNode.node_id);
  missingRefDb.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const failedClosed = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(failedClosed.statusCode, 400, failedClosed.body);
  } finally {
    await host.close();
  }
  const restore = new Database(path.join(dataDir, 'shelfdeck.db'));
  assert.equal(restore.prepare(
    'SELECT count(*) count FROM proc_candidate_packages'
  ).get().count, 0);
  restore.prepare(
    'UPDATE fx_plan_nodes SET input_bindings_json=? WHERE node_id=?'
  ).run(originalPublicationBinding, publicationNode.node_id);
  restore.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const admissionFault = new Database(path.join(dataDir, 'shelfdeck.db'));
    admissionFault.exec(`
      CREATE TRIGGER p14_series_run_admission_fault
      BEFORE INSERT ON libra_runs
      BEGIN
        SELECT RAISE(ABORT, 'p14-series-run-admission-fault');
      END
    `);
    admissionFault.close();
    const rejected = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(rejected.statusCode, 400, rejected.body);
  } finally {
    await host.close();
  }
  const admissionCrash = new Database(path.join(dataDir, 'shelfdeck.db'));
  assert.equal(admissionCrash.prepare(
    'SELECT count(*) count FROM libra_acceptance_specs'
  ).get().count, 1);
  assert.equal(admissionCrash.prepare(
    'SELECT count(*) count FROM libra_runs'
  ).get().count, 0);
  assert.equal(admissionCrash.prepare(
    'SELECT count(*) count FROM libra_run_material_manifests'
  ).get().count, 0);
  admissionCrash.exec('DROP TRIGGER p14_series_run_admission_fault');
  admissionCrash.close();

  const callsBeforeRestart = mediaProbeCalls;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const resumed = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().movieJourney.stage, 'handoff_a_accepted');
    assert.equal(resumed.json().movieJourney.handoff.formation.stage, 'libra_run_active');
    assert.equal(resumed.json().movieJourney.handoff.production, null);
    assert.equal(
      resumed.json().movieJourney.handoff.formation.routing.targetShelfId,
      'series-handoff-shelf',
    );
  } finally {
    await host.close();
  }
  assert.equal(mediaProbeCalls, callsBeforeRestart);

  const db = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  const candidate = db.prepare(
    'SELECT candidate_package_id,media_type,content_profile,structure_kind FROM proc_candidate_packages'
  ).get();
  assert.deepEqual(
    {
      mediaType: candidate.media_type,
      contentProfile: candidate.content_profile,
      structureKind: candidate.structure_kind,
    },
    { mediaType: 'group', contentProfile: 'series', structureKind: 'season' },
  );
  assert.equal(db.prepare(
    'SELECT count(*) count FROM proc_candidate_primary_materials WHERE candidate_package_id=?'
  ).get(candidate.candidate_package_id).count, 2);
  assert.deepEqual(db.prepare(
    'SELECT episode_key FROM proc_candidate_primary_material_episode_claims WHERE candidate_package_id=? ORDER BY episode_key'
  ).all(candidate.candidate_package_id).map((row) => row.episode_key), ['E001', 'E002']);
  assert.equal(db.prepare(
    'SELECT count(*) count FROM proc_candidate_related_references WHERE candidate_package_id=? AND role=?'
  ).get(candidate.candidate_package_id, 'nfo').count, 3);
  assert.equal(db.prepare(
    'SELECT count(*) count FROM proc_candidate_related_references WHERE candidate_package_id=? AND role=?'
  ).get(candidate.candidate_package_id, 'poster').count, 1);
  assert.equal(db.prepare(
    'SELECT count(*) count FROM proc_candidate_season_continuity_claims WHERE candidate_package_id=?'
  ).get(candidate.candidate_package_id).count, 0);
  const subject = db.prepare(
    'SELECT subject_id,structure_kind,content_profile,intake_revision FROM libra_subjects'
  ).get();
  assert.equal(subject.structure_kind, 'season');
  assert.equal(subject.content_profile, 'series');
  assert.equal(Number(subject.intake_revision), 1);
  assert.deepEqual(db.prepare(
    'SELECT episode_key FROM libra_subject_episode_scopes WHERE subject_id=? ORDER BY episode_key'
  ).all(subject.subject_id).map((row) => row.episode_key), ['E001', 'E002']);
  const decision = db.prepare(
    'SELECT accepted_result,match_cardinality,target_subject_id FROM libra_intake_decisions'
  ).get();
  assert.equal(decision.accepted_result, 'new_subject');
  assert.equal(decision.match_cardinality, 'none');
  assert.equal(decision.target_subject_id, subject.subject_id);
  const routingDecision = db.prepare(
    `SELECT decision,shelf_id,routing_policy_id,routing_policy_revision
       FROM libra_routing_decisions`
  ).get();
  assert.deepEqual(routingDecision, {
    decision: 'resolved',
    shelf_id: 'series-handoff-shelf',
    routing_policy_id: 'series-handoff-routing-policy',
    routing_policy_revision: 1,
  });
  const specRow = db.prepare(
    `SELECT acceptance_spec_id,shelf_id,spec_json,spec_digest,
            product_scope_digest
       FROM libra_acceptance_specs`
  ).get();
  const spec = JSON.parse(specRow.spec_json);
  assert.equal(specRow.shelf_id, 'series-handoff-shelf');
  assert.equal(spec.contentProfile, 'series');
  assert.equal(spec.structureKind, 'season');
  assert.equal(spec.productScope.scopeKind, 'episode_manifest');
  assert.deepEqual(spec.productScope.episodeKeys, ['E001', 'E002']);
  assert.equal(spec.productScope.scopeDigest, specRow.product_scope_digest);
  assert.equal(spec.specDigest, specRow.spec_digest);
  const run = db.prepare(
    `SELECT libra_run_id,acceptance_spec_id,state,state_revision,
            run_material_manifest_id,execution_basis_digest,run_scope_digest
       FROM libra_runs`
  ).get();
  assert.equal(run.acceptance_spec_id, specRow.acceptance_spec_id);
  assert.equal(run.state, 'active');
  assert.equal(run.state_revision, 1);
  const manifest = db.prepare(
    `SELECT scope_kind,member_count,episode_scope_digest,manifest_digest
       FROM libra_run_material_manifests
      WHERE run_material_manifest_id=?`
  ).get(run.run_material_manifest_id);
  assert.equal(manifest.scope_kind, 'episode_delivery');
  assert.equal(manifest.member_count, 2);
  assert.deepEqual(db.prepare(
    `SELECT episode_key
       FROM libra_run_material_episode_claims
      WHERE run_material_manifest_id=?
      ORDER BY episode_key`
  ).all(run.run_material_manifest_id).map((row) => row.episode_key),
  ['E001', 'E002']);
  assert.equal(db.prepare(
    `SELECT count(*) count
       FROM libra_run_material_members
      WHERE run_material_manifest_id=?`
  ).get(run.run_material_manifest_id).count, 2);
  assert.equal(db.prepare(
    "SELECT count(*) count FROM fx_material_controls WHERE owner_domain='libra' AND owner_scope_type='subject' AND owner_scope_id=?"
  ).get(subject.subject_id).count, 2);
  const delivery = db.prepare(
    'SELECT offer_id FROM proc_candidate_deliveries WHERE candidate_package_id=?'
  ).get(candidate.candidate_package_id);
  db.close();

  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(dataDir, 'shelfdeck.db'),
    schemaDdl: cleanSchemaDdl,
    schemaManifest: cleanSchemaManifest,
  });
  try {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const reader = createCandidateDeliveryReader({
      schemaManifest: cleanSchemaManifest,
      unitOfWork,
    });
    const snapshot = reconstruct(reader.readRows({ offerId: delivery.offer_id }));
    assert.equal(snapshot.candidatePackage.relatedReferences.length, 4);
    assert.equal(snapshot.candidatePackage.relatedReferences.filter(
      (item) => item.role === 'nfo'
    ).length, 3);
    assert.equal(snapshot.candidatePackage.relatedReferences.filter(
      (item) => item.role === 'poster'
    ).length, 1);
    assert.deepEqual(
      snapshot.primaryInputManifest.members.flatMap((member) =>
        member.episodeClaims.map((claim) => claim.episodeKey)).sort(),
      ['E001', 'E002'],
    );
  } finally {
    kernel.close();
  }

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const replay = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().movieJourney.stage, 'handoff_a_accepted');
    assert.equal(replay.json().movieJourney.replayed, true);
    assert.equal(
      replay.json().movieJourney.handoff.formation.stage,
      'libra_run_active',
    );
    assert.equal(
      replay.json().movieJourney.handoff.formation.replayed,
      true,
    );
  } finally {
    await host.close();
  }

  const replayDb = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
  assert.equal(replayDb.prepare('SELECT count(*) count FROM proc_candidate_packages').get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_subjects').get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_intake_decisions').get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_subject_episode_scopes').get().count, 2);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_routing_decisions').get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_acceptance_specs').get().count, 1);
  assert.equal(replayDb.prepare("SELECT count(*) count FROM libra_runs WHERE state='active'").get().count, 1);
  assert.equal(replayDb.prepare('SELECT count(*) count FROM libra_run_material_manifests').get().count, 1);
  replayDb.close();

  for (const [file, expected] of before) {
    assert.deepEqual(fs.readFileSync(file), expected.bytes);
    assert.equal(fs.statSync(file).mtimeMs, expected.mtimeMs);
  }
});
