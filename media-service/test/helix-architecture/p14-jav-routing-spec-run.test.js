'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  initializeCleanData,
} = require('../../scripts/helix-operational-safety');
const {
  canonicalDigest,
  canonicalJson,
} = require('../../src/helix/contracts/canonical-json');
const {
  createCleanServiceHost,
} = require('../../src/clean-service-host');
const {
  createCleanMediaProbe,
} = require('../../src/clean-media-probe');
const {
  createCleanProductProductionPort,
} = require('../../src/clean-product-production-port');

const secretRoot = 'p14-jav-routing-spec-run-secret-root-0123456789abcdef';

function syntheticProbe(readHandle) {
  const value = {
    resultKind: 'probed',
    sourceHandleDigest: canonicalDigest(readHandle),
    durationMs: 122_480,
    videoStreams: [{
      streamIndex: 0,
      codec: 'hevc',
      dispositionDefault: true,
      width: 1920,
      height: 1080,
    }],
    audioStreams: [{
      streamIndex: 1,
      codec: 'aac',
      dispositionDefault: true,
      profile: 'LC',
      channels: 2,
      channelLayout: 'stereo',
    }],
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

async function createJavShelfAndRouting(host, apiKey, root, fieldId) {
  const cookie = await session(host, apiKey);
  const shelfRoot = path.join(root, 'jav-shelf-target');
  fs.mkdirSync(shelfRoot, { recursive: true });
  const initialStandard = { profileRuleSets: [] };
  const placement = { folderTemplate: '{title}', collisionPolicy: 'reject' };
  const created = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves',
    headers: { cookie },
    payload: {
      idempotencyKey: 'jav-routing-shelf-create',
      shelfId: 'jav-routing-shelf',
      name: 'JAV Shelf',
      target: {
        endpointId: 'jav-routing-shelf-endpoint',
        rootLocation: shelfRoot,
        mountScopeId: 'jav-routing-shelf-mount',
        mountScopeRevision: 1,
      },
      standard: {
        ruleTemplateId: 'jav-routing-initial-template',
        ruleTemplateRevision: 1,
        schemaRef: 'helix://fixtures/jav-routing-initial-standard/v1',
        value: initialStandard,
        digest: canonicalDigest(initialStandard),
      },
      placement: {
        schemaRef: 'helix://fixtures/jav-routing-placement/v1',
        value: placement,
        digest: canonicalDigest(placement),
      },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const bound = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves/jav-routing-shelf/actions/bind-template',
    headers: { cookie },
    payload: {
      idempotencyKey: 'jav-routing-shelf-bind',
      shelfId: 'jav-routing-shelf',
      expectedStandardRevision: 1,
      expectedRoutingProjectionRevision: 1,
      ruleTemplateId: 'system-beta-recommended',
      expectedTemplateRevision: 1,
    },
  });
  assert.equal(bound.statusCode, 200, bound.body);
  const expression = {
    nodeKind: 'predicate',
    factKind: 'content_profile',
    operator: 'eq',
    expectedValue: 'jav',
  };
  const routed = await host.inject({
    method: 'PATCH',
    url: `/v1/admin/routing/material-fields/${fieldId}`,
    headers: { cookie },
    payload: {
      idempotencyKey: 'jav-routing-policy-publish',
      fieldId,
      expectedPolicyId: null,
      expectedRevision: 0,
      policy: {
        routingPolicyId: 'jav-routing-policy',
        mode: 'sorting',
        targets: [{
          shelfId: 'jav-routing-shelf',
          rank: 1,
          matchExpression: expression,
        }],
      },
    },
  });
  assert.equal(routed.statusCode, 200, routed.body);
  return Object.freeze({ shelfRoot });
}

test('JAV public route publishes an input-free Spec and one active single Run', async (t) => {
  const retainedSampleRoot = String(
    process.env.P14_JAV_SAMPLE_ROOT || '',
  ).trim();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-jav-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const sourceRoot = retainedSampleRoot || path.join(root, 'jav-source');
  fs.mkdirSync(adminDistDir, { recursive: true });
  if (!retainedSampleRoot) fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<!doctype html><div id="root"></div>',
  );
  const names = retainedSampleRoot
    ? [
        'SDKI-001 Skin Diamond.mkv',
        'SDKI-001 Skin Diamond.nfo',
        'movie.nfo',
        'poster.jpg',
      ]
    : [
        'SDKI-001 Skin Diamond.mkv',
        'SDKI-001 Skin Diamond.nfo',
        'movie.nfo',
        'poster.jpg',
      ];
  if (!retainedSampleRoot) {
    fs.writeFileSync(
      path.join(sourceRoot, names[0]),
      Buffer.from('jav-primary'),
    );
    fs.writeFileSync(
      path.join(sourceRoot, names[1]),
      Buffer.from('<movie><id>SDKI-001</id></movie>'),
    );
    fs.writeFileSync(
      path.join(sourceRoot, names[2]),
      Buffer.from('<movie><title>Local JAV metadata</title></movie>'),
    );
    fs.writeFileSync(path.join(sourceRoot, names[3]), Buffer.from('poster'));
  }
  const sourceBefore = new Map(names.map((name) => {
    const location = path.join(sourceRoot, name);
    return [location, {
      bytes: fs.readFileSync(location),
      size: fs.statSync(location).size,
      mtimeMs: fs.statSync(location).mtimeMs,
    }];
  }));
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  const fieldId = 'jav-routing-field';
  const access = {
    fieldId,
    revision: 1,
    endpointId: 'jav-routing-endpoint',
    rootLocation: sourceRoot,
    mountScopeId: 'jav-routing-mount',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/jav-routing-access/v1',
  };
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.jpg', '.mkv', '.nfo'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'jav-routing-extraction-policy',
    revision: 1,
    ...policyValue,
  };
  const register = {
    idempotencyKey: 'jav-routing-field-register',
    fieldId,
    name: 'JAV Routing Source',
    policy: {
      extractionPolicyId: policyBasis.extractionPolicyId,
      revision: 1,
      policySchemaRef:
        'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: { ...access, accessDigest: canonicalDigest(access) },
  };
  const observe = {
    idempotencyKey: 'jav-routing-observe',
    fieldId,
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 8,
  };
  let mediaProbeCalls = 0;
  const realMediaProbe = retainedSampleRoot ? createCleanMediaProbe() : null;
  const mediaProbe = Object.freeze({
    async probe(readHandle) {
      mediaProbeCalls += 1;
      return realMediaProbe
        ? realMediaProbe.probe(readHandle)
        : syntheticProbe(readHandle);
    },
  });
  let identityProviderCalls = 0;
  let metadataProviderCalls = 0;
  const productionOptions = Object.freeze({
    async searchProviderIdentity(request) {
      identityProviderCalls += 1;
      assert.equal(request.operationId, 'shared.integration.search@1');
      assert.equal(request.contentProfile, 'jav');
      assert.equal(request.javCode, 'SDKI-001');
      assert.equal(Object.hasOwn(request, 'title'), false);
      return Object.freeze({
        provider: 'jav',
        namespace: 'jav_code',
        providerKey: 'SDKI-001',
        integrationId: 'jav-construction',
        configRevision: 1,
      });
    },
    async fetchProviderMetadata(intent) {
      metadataProviderCalls += 1;
      assert.equal(intent.sourceKind, 'provider');
      assert.equal(intent.providerKind, 'jav');
      assert.equal(intent.contentProfile, 'jav');
      assert.equal(intent.integrationId, 'jav-construction');
      assert.equal(intent.configRevision, 1);
      assert.deepEqual(intent.requestedFields, [
        'genre',
        'jav_code',
        'release_date',
        'studio',
        'title',
      ]);
      return Object.freeze({
        providerKind: 'jav',
        integrationId: intent.integrationId,
        configRevision: intent.configRevision,
        sourceRef: 'jav:SDKI-001',
        descriptiveEntries: Object.freeze([
          { key: 'genre', value: 'Drama' },
          { key: 'jav_code', value: 'SDKI-001' },
          { key: 'release_date', value: '2020-01-02' },
          { key: 'studio', value: 'Construction Studio' },
          { key: 'title', value: 'Skin Diamond' },
        ]),
        providerIdentities: Object.freeze([{
          provider: 'jav',
          namespace: 'jav_code',
          providerKey: 'SDKI-001',
          seasonNumber: null,
        }]),
        peopleHints: Object.freeze([]),
        posterBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        fanartBytes: Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
      });
    },
  });
  let host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  let first;
  try {
    await createJavShelfAndRouting(
      host,
      initialized.adminApiKey,
      root,
      fieldId,
    );
    const cookie = await session(host, initialized.adminApiKey);
    const registered = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: register,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    first = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${fieldId}/actions/observe`,
      headers: { cookie },
      payload: observe,
    });
    assert.equal(first.statusCode, 200, first.body);
    const journey = first.json().movieJourney;
    assert.equal(journey.stage, 'handoff_a_accepted');
    assert.equal(journey.handoff.formation.stage, 'libra_run_active');
    assert.equal(journey.handoff.formation.contentProfile, 'jav');
    assert.equal(journey.handoff.formation.structureKind, 'single');
    assert.equal(journey.handoff.production, null);
  } finally {
    await host.close();
  }
  assert.equal(mediaProbeCalls, 1);

  let database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  const subject = database.prepare(
    `SELECT subject_id,structure_kind,content_profile,intake_revision
       FROM libra_subjects`,
  ).get();
  assert.equal(subject.structure_kind, 'single');
  assert.equal(subject.content_profile, 'jav');
  const routing = database.prepare(
    `SELECT routing_decision_id,decision,shelf_id,routing_policy_id,
            routing_policy_revision,decision_digest
       FROM libra_routing_decisions`,
  ).get();
  assert.equal(routing.decision, 'resolved');
  assert.equal(routing.shelf_id, 'jav-routing-shelf');
  assert.equal(routing.routing_policy_id, 'jav-routing-policy');
  assert.equal(Number(routing.routing_policy_revision), 1);
  const basisRows = database.prepare(
    `SELECT basis_kind,status,query_result_set_digest,basis_digest
       FROM libra_decision_basis_revisions
      ORDER BY basis_revision`,
  ).all();
  assert.deepEqual(
    basisRows.map((row) => [row.basis_kind, row.status]),
    [['routing', 'ready'], ['acceptance_spec', 'ready']],
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_decision_basis_inputs
      WHERE input_kind IN ('decision_fact','query_result')`,
  ).get().count, 0);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM perception_resolution_revisions',
  ).get().count, 0);
  const specRow = database.prepare(
    `SELECT acceptance_spec_id,shelf_id,spec_revision,spec_json,
            spec_digest,record_digest,structure_kind,content_profile
       FROM libra_acceptance_specs`,
  ).get();
  const spec = JSON.parse(specRow.spec_json);
  assert.equal(specRow.shelf_id, 'jav-routing-shelf');
  assert.equal(specRow.structure_kind, 'single');
  assert.equal(specRow.content_profile, 'jav');
  assert.equal(spec.contentProfile, 'jav');
  assert.equal(spec.structureKind, 'single');
  assert.equal(spec.productScope.scopeKind, 'single');
  assert.deepEqual(spec.productScope.episodeKeys, []);
  assert.deepEqual(spec.requirements.identity, {
    identityKind: 'jav_code',
    requireSeasonNumber: false,
  });
  assert.equal(spec.requirements.structure.structureKind, 'single');
  assert.equal(spec.requirements.mandatoryMedia.videoCodec, 'hevc');
  assert.equal(spec.requirements.mandatoryMedia.container, 'matroska');
  assert.equal(spec.requirements.mandatoryMedia.fileExtension, 'mkv');
  assert.equal(spec.requirements.space.maxSizeGiB, 2);
  assert.equal(spec.requirements.space.maxSizeBytes, 2147483648);
  assert.deepEqual(
    spec.requirements.metadata.requiredFieldCodes,
    ['genre', 'jav_code', 'release_date', 'studio', 'title'],
  );
  assert.deepEqual(
    spec.requirements.metadata.requiredArtifactKinds,
    ['fanart', 'nfo', 'poster'],
  );
  const run = database.prepare(
    `SELECT libra_run_id,subject_id,acceptance_spec_id,state,
            state_revision,execution_basis_digest,run_scope_digest
       FROM libra_runs`,
  ).get();
  assert.equal(run.subject_id, subject.subject_id);
  assert.equal(run.acceptance_spec_id, specRow.acceptance_spec_id);
  assert.equal(run.state, 'active');
  assert.equal(Number(run.state_revision), 1);
  const manifest = database.prepare(
    `SELECT run_material_manifest_id,libra_run_id,manifest_role,scope_kind,
            member_count,episode_scope_digest,manifest_digest
       FROM libra_run_material_manifests`,
  ).get();
  assert.equal(manifest.libra_run_id, run.libra_run_id);
  assert.equal(manifest.manifest_role, 'run_input');
  assert.equal(manifest.scope_kind, 'single');
  assert.equal(Number(manifest.member_count), 1);
  const member = database.prepare(
    `SELECT role,origin_candidate_package_id,origin_package_revision,
            admitted_control_revision,admitted_control_projection_digest
       FROM libra_run_material_members`,
  ).get();
  assert.equal(member.role, 'primary_payload');
  assert.equal(Number(member.origin_package_revision), 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_run_material_episode_claims',
  ).get().count, 0);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM fx_workspace_registry',
  ).get().count, 0);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_fact_revisions',
  ).get().count, 0);
  const frozen = {
    routingDecisionId: routing.routing_decision_id,
    routingDecisionDigest: routing.decision_digest,
    basisDigests: basisRows.map((row) => row.basis_digest),
    acceptanceSpecId: specRow.acceptance_spec_id,
    specDigest: specRow.spec_digest,
    specRecordDigest: specRow.record_digest,
    libraRunId: run.libra_run_id,
    executionBasisDigest: run.execution_basis_digest,
    runScopeDigest: run.run_scope_digest,
    manifestDigest: manifest.manifest_digest,
    canonicalSpec: canonicalJson(spec),
  };
  database.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  try {
    const replay = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: observe,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().observation.replayed, true);
    assert.equal(replay.json().movieJourney.replayed, true);
    const conflict = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${fieldId}/actions/observe`,
      headers: { cookie: await session(host, initialized.adminApiKey) },
      payload: { ...observe, pageBudget: 7 },
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
  } finally {
    await host.close();
  }
  assert.equal(mediaProbeCalls, 1);
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  const replayRouting = database.prepare(
    'SELECT routing_decision_id,decision_digest FROM libra_routing_decisions',
  ).all();
  const replayBasis = database.prepare(
    'SELECT basis_digest FROM libra_decision_basis_revisions ORDER BY basis_revision',
  ).all();
  const replaySpec = database.prepare(
    'SELECT acceptance_spec_id,spec_json,spec_digest,record_digest FROM libra_acceptance_specs',
  ).all();
  const replayRun = database.prepare(
    'SELECT libra_run_id,execution_basis_digest,run_scope_digest FROM libra_runs',
  ).all();
  const replayManifest = database.prepare(
    'SELECT manifest_digest FROM libra_run_material_manifests',
  ).all();
  assert.deepEqual(replayRouting, [{
    routing_decision_id: frozen.routingDecisionId,
    decision_digest: frozen.routingDecisionDigest,
  }]);
  assert.deepEqual(
    replayBasis.map((row) => row.basis_digest),
    frozen.basisDigests,
  );
  assert.deepEqual(replaySpec, [{
    acceptance_spec_id: frozen.acceptanceSpecId,
    spec_json: frozen.canonicalSpec,
    spec_digest: frozen.specDigest,
    record_digest: frozen.specRecordDigest,
  }]);
  assert.deepEqual(replayRun, [{
    libra_run_id: frozen.libraRunId,
    execution_basis_digest: frozen.executionBasisDigest,
    run_scope_digest: frozen.runScopeDigest,
  }]);
  assert.deepEqual(replayManifest, [{
    manifest_digest: frozen.manifestDigest,
  }]);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM fx_workspace_registry',
  ).get().count, 0);
  database.close();

  async function requestProduction(activeHost) {
    return activeHost.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${fieldId}/actions/observe`,
      headers: {
        cookie: await session(activeHost, initialized.adminApiKey),
      },
      payload: observe,
    });
  }

  async function interruptProduction(hookName, reasonCode) {
    let shouldInterrupt = true;
    const interruptedHost = await createCleanServiceHost({
      dataDir,
      adminDistDir,
      secretRoot,
      mediaProbe,
      ...productionOptions,
      [hookName]() {
        if (!shouldInterrupt) return;
        shouldInterrupt = false;
        throw Object.assign(new Error(`fault at ${hookName}`), {
          code: reasonCode,
        });
      },
    });
    try {
      const response = await requestProduction(interruptedHost);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(
        response.json().error.details.reasonCode,
        reasonCode,
        response.body,
      );
    } finally {
      await interruptedHost.close();
    }
  }

  await interruptProduction(
    'afterWorkspacePhysicalEffect',
    'P14_JAV_FAULT_AFTER_WORKSPACE_PHYSICAL_EFFECT',
  );
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_packages',
  ).get().count, 0);
  database.close();

  await interruptProduction(
    'afterProductFactsCommit',
    'P14_JAV_FAULT_AFTER_PRODUCT_FACTS_COMMIT',
  );
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_fact_revisions',
  ).get().count, 3);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_packages',
  ).get().count, 0);
  database.close();

  await interruptProduction(
    'afterPackageCommit',
    'P14_JAV_FAULT_AFTER_PACKAGE_COMMIT',
  );
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_packages',
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='libra.product-offer.available@1'`,
  ).get().count, 1);
  for (const table of [
    'arca_acceptance_attempts',
    'arca_acceptance_decisions',
    'arca_ondeck_custodies',
    'arca_material_bindings',
    'arca_inventory_materials',
    'arca_shelf_entries',
    'arca_deck_fact_revisions',
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) count FROM ${table}`).get().count,
      0,
      table,
    );
  }
  database.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
  });
  let production;
  try {
    const response = await requestProduction(host);
    assert.equal(response.statusCode, 200, response.body);
    production = response.json().movieJourney.handoff.production;
    assert.equal(production.stage, 'handoff_b_offer_open');
    assert.equal(production.contentProfile, 'jav');
    assert.equal(production.replayed, true);
    assert.equal(production.productDelivery.resultKind, 'found');
    assert.equal(
      production.productDelivery.onDeckProductPackage
        .productStructureSnapshot.contentProfile,
      'jav',
    );
  } finally {
    await host.close();
  }
  assert.ok(identityProviderCalls >= 1);
  assert.equal(identityProviderCalls, metadataProviderCalls);

  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  const identityFact = JSON.parse(database.prepare(
    `SELECT fact_json
       FROM libra_product_fact_revisions
      WHERE fact_kind='resolved_identity'`,
  ).get().fact_json);
  assert.equal(identityFact.contentProfile, 'jav');
  assert.equal(identityFact.identityKind, 'jav_code');
  assert.deepEqual(identityFact.providerIdentities, [{
    provider: 'jav',
    namespace: 'jav_code',
    providerKey: 'SDKI-001',
    seasonNumber: null,
    identityAnchorDigest:
      identityFact.providerIdentities[0].identityAnchorDigest,
  }]);
  const metadataFact = JSON.parse(database.prepare(
    `SELECT fact_json
       FROM libra_product_fact_revisions
      WHERE fact_kind='product_metadata'`,
  ).get().fact_json);
  assert.deepEqual(
    metadataFact.fieldProvenance.map((item) => item.sourceKind),
    ['provider', 'provider', 'provider', 'provider', 'provider'],
  );
  assert.equal(
    metadataFact.fieldProvenance.some((item) =>
      item.sourceKind === 'related_nfo'),
    false,
  );
  const castFact = JSON.parse(database.prepare(
    `SELECT fact_json
       FROM libra_product_fact_revisions
      WHERE fact_kind='media_cast'`,
  ).get().fact_json);
  assert.deepEqual(castFact.relations, []);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_product_fact_source_refs source
       JOIN libra_product_fact_revisions fact
         ON fact.product_fact_id=source.product_fact_id
      WHERE fact.fact_kind='media_cast'
        AND source.source_basis_kind='metadata_observation'
        AND source.source_ref='jav:jav-construction@1'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_packages',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_package_artifact_refs',
  ).get().count, 3);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_package_materials',
  ).get().count, 4);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_package_material_episode_claims',
  ).get().count, 0);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_artifact_registry
      WHERE owner_domain='libra' AND state='active'`,
  ).get().count, 3);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspace_material_refs
      WHERE reference_state='product_staging'`,
  ).get().count, 3);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_product_package_materials
      WHERE role='primary_payload'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_product_package_materials
      WHERE role IN ('metadata_sidecar','poster','fanart')`,
  ).get().count, 3);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='libra.product-offer.available@1'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_inbox inbox
       JOIN fx_outbox outbox ON outbox.message_id=inbox.message_id
      WHERE outbox.message_kind='libra.product-offer.available@1'
        AND inbox.consumer_domain='arca'`,
  ).get().count, 0);
  for (const table of [
    'arca_acceptance_attempts',
    'arca_acceptance_decisions',
    'arca_ondeck_custodies',
    'arca_material_bindings',
    'arca_inventory_materials',
    'arca_shelf_entries',
    'arca_deck_fact_revisions',
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) count FROM ${table}`).get().count,
      0,
      table,
    );
  }
  database.close();

  for (const [location, before] of sourceBefore) {
    assert.deepEqual(fs.readFileSync(location), before.bytes);
    const stat = fs.statSync(location);
    assert.equal(stat.size, before.size);
    assert.equal(stat.mtimeMs, before.mtimeMs);
  }
});

test('clean host keeps JAV before Production without a formal Provider adapter', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/clean-service-host.js'),
    'utf8',
  );
  assert.match(
    source,
    /\['series', 'jav'\]\.includes\(formation\.contentProfile\)[\s\S]*?typeof options\.searchProviderIdentity !== 'function'/,
  );
  assert.doesNotMatch(
    source,
    /formation\.contentProfile === 'jav'[\s\S]{0,240}(fallback|legacy|workspace)/i,
  );
});

test('JAV Provider adapter rejects foreign identity and incomplete Artifact bytes', async () => {
  const port = createCleanProductProductionPort({
    mediaProbe: { probe: async () => ({}) },
    async searchProviderIdentity() {
      return {
        provider: 'jav',
        namespace: 'jav_code',
        providerKey: 'FOREIGN-999',
      };
    },
    async fetchProviderMetadata(intent) {
      return {
        providerKind: 'jav',
        integrationId: intent.integrationId,
        configRevision: intent.configRevision,
        descriptiveEntries: [],
        providerIdentities: [{
          provider: 'jav',
          namespace: 'jav_code',
          providerKey: 'SDKI-001',
        }],
        peopleHints: [],
        posterBytes: Buffer.from([1]),
      };
    },
  });
  await assert.rejects(
    port.searchProviderIdentity({
      contentProfile: 'jav',
      javCode: 'SDKI-001',
    }),
    (error) =>
      error.code === 'CLEAN_PRODUCT_IDENTITY_PROVIDER_RESULT_INVALID',
  );
  await assert.rejects(
    port.fetchProvider({
      sourceKind: 'provider',
      contentProfile: 'jav',
      providerKind: 'jav',
      integrationId: 'jav-construction',
      configRevision: 1,
    }),
    (error) => error.code === 'CLEAN_PRODUCT_PROVIDER_RESULT_INVALID',
  );
});
