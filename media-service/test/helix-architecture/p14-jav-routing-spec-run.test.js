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
const {
  createCapabilityContractValidator,
} = require('../../src/helix/foundation/capability/contract-validator');
const metadataObservationSchema = require(
  '../../src/helix/contracts/types/MetadataObservation/v1/schema.json'
);
const resolvedProviderIdentitySchema = require(
  '../../src/helix/contracts/domain-types/ResolvedProviderIdentity/v1/schema.json'
);

const secretRoot = 'p14-jav-routing-spec-run-secret-root-0123456789abcdef';
const metadataObservationValidator = createCapabilityContractValidator({
  schemas: [resolvedProviderIdentitySchema, metadataObservationSchema],
});

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

test('JAV public route closes Run and reclaims only its Libra Workspace exactly once', async (t) => {
  const retainedSampleRoot = String(
    process.env.P14_JAV_SAMPLE_ROOT || '',
  ).trim();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-jav-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const shelfTargetRoot = path.join(root, 'jav-shelf-target');
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
  let artifactProviderCalls = 0;
  const javProviderIdentityBasis = {
    provider: 'jav',
    namespace: 'jav_code',
    providerKey: 'SDKI-001',
    seasonNumber: null,
  };
  const javProviderIdentity = Object.freeze({
    ...javProviderIdentityBasis,
    identityAnchorDigest: canonicalDigest(javProviderIdentityBasis),
  });
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
    async fetchProviderMetadata(request) {
      metadataProviderCalls += 1;
      const { metadataFetchIntent:intent, integrationHandle } = request;
      assert.equal(intent.sourceKind, 'provider');
      assert.equal(intent.providerKind, 'jav');
      assert.equal(intent.contentProfile, 'jav');
      assert.equal(intent.integrationId, 'jav-construction');
      assert.equal(intent.configRevision, 1);
      assert.deepEqual(intent.resolvedProviderIdentity, javProviderIdentity);
      assert.equal(
        integrationHandle.allowedOperation,
        'libra.product_metadata.fetch@1',
      );
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
        providerIdentities: Object.freeze([javProviderIdentity]),
        peopleHints: Object.freeze([]),
      });
    },
    async fetchProviderArtifact(request) {
      artifactProviderCalls += 1;
      assert.deepEqual(
        request.resolvedProviderIdentity,
        javProviderIdentity,
      );
      assert.equal(
        request.integrationHandle.allowedOperation,
        'libra.product_artifact.acquire@1',
      );
      return Object.freeze({
        resultKind: 'acquired',
        artifactKind: request.artifactKind,
        integrationId: request.integrationHandle.integrationId,
        configRevision: request.integrationHandle.configRevision,
        resolvedProviderIdentity: javProviderIdentity,
        mediaType: 'image/jpeg',
        bytes: request.artifactKind === 'poster'
          ? Buffer.from([0xff, 0xd8, 0xff, 0xd9])
          : Buffer.from([0xff, 0xd8, 0x01, 0xff, 0xd9]),
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

  async function interruptCapability(capabilityRef, reasonCode) {
    let shouldInterrupt = true;
    const interruptedHost = await createCleanServiceHost({
      dataDir,
      adminDistDir,
      secretRoot,
      mediaProbe,
      ...productionOptions,
      afterCapabilityResultCommit(result) {
        if (!shouldInterrupt ||
            result.capabilityRef !== capabilityRef) return;
        shouldInterrupt = false;
        throw Object.assign(
          new Error(`fault after ${capabilityRef} Result commit`),
          { code:reasonCode },
        );
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

  await interruptCapability(
    'libra.product_metadata.fetch@1',
    'P14_JAV_FAULT_AFTER_METADATA_RESULT_COMMIT',
  );
  assert.equal(metadataProviderCalls, 1);

  await interruptProduction(
    'afterWorkspacePhysicalEffect',
    'P14_JAV_FAULT_AFTER_WORKSPACE_PHYSICAL_EFFECT',
  );
  assert.equal(artifactProviderCalls, 1);

  await interruptCapability(
    'libra.product_artifact.acquire@1',
    'P14_JAV_FAULT_AFTER_ARTIFACT_RESULT_COMMIT',
  );
  assert.equal(artifactProviderCalls, 1);

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

  await interruptProduction(
    'afterAcceptedResponsibilityInsert',
    'P14_JAV_FAULT_AFTER_HANDOFF_B_RESPONSIBILITY_INSERT',
  );
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM arca_acceptance_attempts
      WHERE state='active' AND finished_at_ms IS NULL`,
  ).get().count, 1);
  for (const table of [
    'arca_acceptance_decisions',
    'arca_ondeck_custodies',
    'arca_handoff_b_receipts',
    'arca_ondeck_runs',
    'arca_final_inventory_decisions',
    'arca_material_bindings',
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) count FROM ${table}`).get().count,
      0,
      table,
    );
  }
  database.close();

  await interruptProduction(
    'afterArcaInventoryPhysicalEffect',
    'P14_JAV_FAULT_AFTER_ARCA_INVENTORY_PHYSICAL_EFFECT',
  );
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM arca_acceptance_attempts
      WHERE state='accepted' AND finished_at_ms IS NOT NULL`,
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_acceptance_decisions',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_ondeck_custodies',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_ondeck_runs',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_final_inventory_decisions',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_material_bindings',
  ).get().count, 5);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM arca_material_bindings
      WHERE role LIKE 'product:%'`,
  ).get().count, 4);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_shelf_entries',
  ).get().count, 0);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_effect_journal
      WHERE effect_class='material_commit' AND state='intended'`,
  ).get().count, 1);
  database.close();

  await interruptProduction(
    'afterOnDeckCommit',
    'P14_JAV_FAULT_AFTER_ONDECK_COMMIT',
  );
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_shelf_entries',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_inventory_materials',
  ).get().count, 4);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_deck_fact_revisions',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_ondeck_commit_receipts',
  ).get().count, 1);
  database.close();

  await interruptProduction(
    'afterRunCompletion',
    'P14_JAV_FAULT_AFTER_RUN_COMPLETION',
  );
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    `SELECT count(*) count FROM libra_runs WHERE state='completed'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_delivery_receipts',
  ).get().count, 1);
  const lifecycleSchemaRef =
    'helix://contracts/application-types/LibraRunLifecycleResult/v1';
  const committedLifecycleResult = database.prepare(
    `SELECT result_json,result_digest
       FROM fx_event_result_bindings
      WHERE result_schema_ref=?
      ORDER BY committed_at_ms DESC
      LIMIT 1`,
  ).get(lifecycleSchemaRef);
  assert.ok(committedLifecycleResult);
  const completionWriteCounts = Object.freeze({
    revisions: database.prepare(
      `SELECT count(*) count
         FROM libra_run_revisions
        WHERE transition_kind='complete'`,
    ).get().count,
    results: database.prepare(
      `SELECT count(*) count
         FROM fx_event_result_bindings
        WHERE result_schema_ref=?`,
    ).get(lifecycleSchemaRef).count,
    markers: database.prepare(
      `SELECT count(*) count
         FROM fx_commit_markers
        WHERE result_schema_ref=?`,
    ).get(lifecycleSchemaRef).count,
  });
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
    assert.equal(production.stage, 'movie_on_deck_committed');
    assert.equal(production.offerStage, 'handoff_b_offer_open');
    assert.equal(production.contentProfile, 'jav');
    assert.equal(production.replayed, true);
    assert.equal(
      production.responsibilityClosure.stage,
      'workspace_cleanup_grace_active',
    );
    const replayedLifecycleResult =
      production.responsibilityClosure.runClosure.result;
    assert.equal(
      canonicalJson(replayedLifecycleResult),
      committedLifecycleResult.result_json,
    );
    assert.equal(
      canonicalDigest(replayedLifecycleResult),
      committedLifecycleResult.result_digest,
    );
    assert.equal(
      replayedLifecycleResult.resultDigest,
      JSON.parse(committedLifecycleResult.result_json).resultDigest,
    );
    assert.equal(production.productDelivery.resultKind, 'found');
    assert.equal(
      production.productDelivery.onDeckProductPackage
        .productStructureSnapshot.contentProfile,
      'jav',
    );
    assert.equal(
      production.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.length,
      4,
    );
    assert.deepEqual(
      production.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.map((item) => item.role).sort(),
      ['fanart', 'metadata_sidecar', 'poster', 'primary_payload'],
    );
    assert.equal(
      production.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.every((item) =>
          item.episodeClaims.length === 0),
      true,
    );
    assert.equal(production.handoffB.acceptedMessage.messageKind,
      'arca.product.accepted@1');
    assert.equal(production.onDeck.result.offloadCompletionFact.factSchemaRef,
      'arca.offload-completion@1');
  } finally {
    await host.close();
  }
  assert.ok(identityProviderCalls >= 1);
  assert.equal(metadataProviderCalls, 1);
  assert.equal(artifactProviderCalls, 2);

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
  const metadataResults = database.prepare(
    `SELECT result_schema_ref,result_json,result_digest
       FROM fx_event_result_bindings
      WHERE result_schema_ref=?
      ORDER BY result_id`,
  ).all(metadataObservationSchema.$id);
  assert.equal(metadataResults.length, 1);
  const persistedMetadataObservation = JSON.parse(
    metadataResults[0].result_json,
  );
  assert.doesNotThrow(() => metadataObservationValidator.validate(
    metadataResults[0].result_schema_ref,
    persistedMetadataObservation,
  ));
  assert.equal(
    canonicalDigest(persistedMetadataObservation),
    metadataResults[0].result_digest,
  );
  assert.deepEqual(
    persistedMetadataObservation.providerIdentitySet.entries,
    identityFact.providerIdentities,
  );
  assert.deepEqual(persistedMetadataObservation.peopleHints, []);
  assert.deepEqual(persistedMetadataObservation.artifactHints, []);

  const oldKeyValueIdentity = structuredClone(persistedMetadataObservation);
  oldKeyValueIdentity.providerIdentitySet.entries = [{
    key: 'providerKey',
    value: 'SDKI-001',
  }];
  assert.throws(
    () => metadataObservationValidator.validate(
      metadataObservationSchema.$id,
      oldKeyValueIdentity,
    ),
    (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED',
  );
  const syntheticArtifactHint = structuredClone(persistedMetadataObservation);
  syntheticArtifactHint.artifactHints = [{
    artifactKind: 'poster',
    sourceRef: 'jav:jav-construction@1:poster',
    evidenceDigest: canonicalDigest({ synthetic: true }),
  }];
  assert.throws(
    () => metadataObservationValidator.validate(
      metadataObservationSchema.$id,
      syntheticArtifactHint,
    ),
    (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED',
  );
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
  const activeArtifactHandles = database.prepare(
    `SELECT artifact_kind,storage_ref
       FROM fx_artifact_registry
      WHERE owner_domain='libra' AND state='active'
      ORDER BY artifact_kind`,
  ).all();
  assert.equal(activeArtifactHandles.length, 3);
  assert.deepEqual(
    activeArtifactHandles.map((item) => item.artifact_kind),
    ['fanart', 'nfo', 'poster'],
  );
  assert.equal(
    activeArtifactHandles.filter((item) => {
      const relativeStorage = item.storage_ref.slice('workspace://'.length);
      return item.storage_ref.startsWith('workspace://') &&
        fs.existsSync(path.join(
          dataDir,
          'workspace',
          ...relativeStorage.split('/'),
        ));
    }).length,
    3,
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_event_result_bindings result
       JOIN fx_workflow_events event ON event.result_id=result.result_id
      WHERE event.capability_ref='libra.product_sidecar.render@1'
        AND result.result_schema_ref=
          'helix://contracts/types/ArtifactHandle/v1'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_event_result_bindings result
       JOIN fx_workflow_events event ON event.result_id=result.result_id
      WHERE event.capability_ref='libra.product_artifact.acquire@1'
        AND result.result_schema_ref=
          'helix://contracts/types/ArtifactAcquisitionResult/v1'`,
  ).get().count, 2);
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
        AND inbox.consumer_domain='arca'
        AND inbox.consumed_at_ms IS NOT NULL`,
  ).get().count, 1);
  const emptyClaims = canonicalJson({
    items: [],
    episodeClaimSetDigest: canonicalDigest({
      schema: 'libra.production-material-episode-claims@1',
      items: [],
    }),
  });
  const bindingRows = database.prepare(
    `SELECT role,episode_claims_json
       FROM arca_material_bindings
      ORDER BY role`,
  ).all();
  assert.equal(bindingRows.length, 5);
  assert.equal(bindingRows.filter((item) =>
    item.role.startsWith('product:')).length, 4);
  assert.equal(bindingRows.every((item) =>
    item.episode_claims_json === emptyClaims), true);
  const inventoryRows = database.prepare(
    `SELECT role,episode_claims_json,location
       FROM arca_inventory_materials
      ORDER BY ordinal`,
  ).all();
  assert.equal(inventoryRows.length, 4);
  assert.deepEqual(
    inventoryRows.map((item) => item.role).sort(),
    ['fanart', 'metadata_sidecar', 'poster', 'primary'],
  );
  assert.equal(inventoryRows.every((item) =>
    item.episode_claims_json === emptyClaims), true);
  assert.equal(inventoryRows.every((item) =>
    item.location.startsWith(shelfTargetRoot) &&
    fs.existsSync(item.location)), true);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM arca_shelf_entries
      WHERE status='active'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM arca_deck_fact_revisions
      WHERE state='active'`,
  ).get().count, 1);
  for (const table of [
    'arca_acceptance_attempts',
    'arca_acceptance_decisions',
    'arca_ondeck_custodies',
    'arca_handoff_b_receipts',
    'arca_final_inventory_decisions',
    'arca_ondeck_commit_receipts',
    'arca_offload_completions',
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) count FROM ${table}`).get().count,
      1,
      table,
    );
  }
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM arca_ondeck_runs
      WHERE state='committed'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
      FROM fx_effect_journal
      WHERE effect_class='material_commit' AND state='committed'`,
  ).get().count, 4);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_material_controls
      WHERE owner_domain='arca'
        AND owner_scope_type='shelf_entry'
        AND state='controlled'`,
  ).get().count, 4);
  for (const messageKind of ['arca.product.accepted@1',
    'arca.offload.completed@1']) {
    assert.equal(database.prepare(
      `SELECT count(*) count
         FROM fx_outbox
        WHERE message_kind=?`,
    ).get(messageKind).count, 1);
    const expectedInboxCount =
      messageKind === 'arca.product.accepted@1' ? 1 : 0;
    assert.equal(database.prepare(
      `SELECT count(*) count
         FROM fx_inbox inbox
         JOIN fx_outbox outbox ON outbox.message_id=inbox.message_id
        WHERE outbox.message_kind=?
          AND inbox.consumer_domain='libra'`,
    ).get(messageKind).count, expectedInboxCount);
  }
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_runs
      WHERE state='completed'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_delivery_receipts',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_workspace_cleanup_scopes',
  ).get().count, 0);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_run_revisions
      WHERE transition_kind='complete'`,
  ).get().count, completionWriteCounts.revisions);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_event_result_bindings
      WHERE result_schema_ref=?`,
  ).get(lifecycleSchemaRef).count, completionWriteCounts.results);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_commit_markers
      WHERE result_schema_ref=?`,
  ).get(lifecycleSchemaRef).count, completionWriteCounts.markers);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='arca.product.accepted@1'
        AND state='fully_acked'`,
  ).get().count, 1);
  const workspaceRows = database.prepare(
    `SELECT workspace_id,relative_path
       FROM fx_workspace_materials
      WHERE state='active'
      ORDER BY relative_path`,
  ).all();
  const cleanupAtMs = Number(database.prepare(
    'SELECT committed_at_ms FROM arca_offload_completions',
  ).get().committed_at_ms) + 86_400_000 + 60_000;
  database.close();

  const inventoryBefore = new Map(inventoryRows.map((row) => [
    row.location,
    {
      bytes: fs.readFileSync(row.location),
      mtimeMs: fs.statSync(row.location).mtimeMs,
    },
  ]));
  assert.ok(workspaceRows.length > 0);
  const workspaceFiles = workspaceRows.map((row) => path.join(
    dataDir,
    'workspace',
    row.workspace_id,
    ...row.relative_path.split('/'),
  ));
  assert.equal(workspaceFiles.every((file) => fs.existsSync(file)), true);

  let cleanupClock = cleanupAtMs;
  let cleanupPhysicalEffects = 0;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    offloadWakeVisible: false,
  });
  try {
    const firstAudit = await requestProduction(host);
    assert.equal(firstAudit.statusCode, 200, firstAudit.body);
    assert.equal(
      firstAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
  } finally {
    await host.close();
  }
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_workspace_cleanup_scopes',
  ).get().count, 0);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_effect_journal
      WHERE effect_class='libra_workspace_material_reclaim'`,
  ).get().count, 0);
  database.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    offloadWakeVisible: false,
    afterCleanupPhysicalEffect() {
      cleanupPhysicalEffects += 1;
      throw Object.assign(
        new Error('JAV cleanup physical effect interruption'),
        { code: 'P14_JAV_CLEANUP_PHYSICAL_EFFECT_INTERRUPTION' },
      );
    },
  });
  try {
    const restartedFirstAudit = await requestProduction(host);
    assert.equal(
      restartedFirstAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
    cleanupClock = cleanupAtMs + 60_000 - 1;
    const earlySecondAudit = await requestProduction(host);
    assert.equal(
      earlySecondAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
    cleanupClock = cleanupAtMs + 60_000;
    const interrupted = await requestProduction(host);
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_JAV_CLEANUP_PHYSICAL_EFFECT_INTERRUPTION',
    );
  } finally {
    await host.close();
  }
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspace_cleanup_scopes
      WHERE state='active'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspace_cleanup_members
      WHERE state='completed'`,
  ).get().count, 0);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_effect_journal
      WHERE effect_class='libra_workspace_material_reclaim'
        AND state='intended'`,
  ).get().count, 1);
  database.close();
  assert.equal(cleanupPhysicalEffects, 1);
  assert.equal(
    workspaceFiles.filter((file) => !fs.existsSync(file)).length,
    1,
  );

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    afterCleanupCommit() {
      throw Object.assign(
        new Error('JAV cleanup member commit interruption'),
        { code: 'P14_JAV_CLEANUP_MEMBER_COMMIT_INTERRUPTION' },
      );
    },
  });
  try {
    const interrupted = await requestProduction(host);
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_JAV_CLEANUP_MEMBER_COMMIT_INTERRUPTION',
    );
  } finally {
    await host.close();
  }
  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspace_cleanup_members
      WHERE state='completed'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_effect_journal
      WHERE effect_class='libra_workspace_material_reclaim'
        AND state='committed'`,
  ).get().count, 1);
  database.close();

  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    ...productionOptions,
    cleanupNow: () => cleanupClock,
    afterCleanupPhysicalEffect() {
      cleanupPhysicalEffects += 1;
    },
  });
  let cleanedProduction;
  try {
    const cleaned = await requestProduction(host);
    assert.equal(cleaned.statusCode, 200, cleaned.body);
    cleanedProduction = cleaned.json().movieJourney.handoff.production;
    assert.equal(
      cleanedProduction.responsibilityClosure.stage,
      'workspace_cleanup_completed',
    );
    assert.equal(cleanedProduction.productDelivery.resultKind, 'found');
    assert.equal(
      cleanedProduction.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.length,
      4,
    );
    assert.equal(
      cleanedProduction.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.every((member) =>
          member.episodeClaims.length === 0),
      true,
    );
  } finally {
    await host.close();
  }

  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspace_cleanup_scopes
      WHERE state='completed'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspace_cleanup_members
      WHERE state='completed'`,
  ).get().count, workspaceFiles.length);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspace_material_refs
      WHERE reference_state='released'`,
  ).get().count, workspaceFiles.length);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_workspace_materials
      WHERE state='reclaimed'`,
  ).get().count, workspaceFiles.length);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_workspaces
      WHERE state='reclaimed'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_workspace_registry
      WHERE state='reclaimed'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind IN (
        'arca.product.accepted@1',
        'arca.offload.completed@1'
      ) AND state='fully_acked'`,
  ).get().count, 2);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_inventory_materials',
  ).get().count, 4);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM arca_deck_fact_revisions
      WHERE state='active'`,
  ).get().count, 1);
  assert.deepEqual(database.prepare(
    `SELECT role,episode_claims_json,location
       FROM arca_inventory_materials
      ORDER BY ordinal`,
  ).all(), inventoryRows);
  assert.deepEqual(database.prepare(
    `SELECT inbox.consumer_domain,count(*) count
       FROM fx_inbox inbox
       JOIN fx_outbox outbox ON outbox.message_id=inbox.message_id
      WHERE outbox.message_kind IN (
        'arca.product.accepted@1',
        'arca.offload.completed@1'
      )
      GROUP BY inbox.consumer_domain`,
  ).all(), [{ consumer_domain: 'libra', count: 2 }]);
  database.close();
  assert.equal(cleanupPhysicalEffects, workspaceFiles.length);
  assert.equal(workspaceFiles.every((file) => !fs.existsSync(file)), true);
  assert.equal(inventoryRows.every((row) => fs.existsSync(row.location)), true);
  for (const [location, before] of inventoryBefore) {
    assert.deepEqual(fs.readFileSync(location), before.bytes);
    assert.equal(fs.statSync(location).mtimeMs, before.mtimeMs);
  }

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
  const identityBasis = {
    provider: 'jav',
    namespace: 'jav_code',
    providerKey: 'SDKI-001',
    seasonNumber: null,
  };
  const resolvedProviderIdentity = {
    ...identityBasis,
    identityAnchorDigest: canonicalDigest(identityBasis),
  };
  const port = createCleanProductProductionPort({
    mediaProbe: { probe: async () => ({}) },
    workspaceProductPort: {
      acquireArtifact() {},
      materializeArtifact() {},
    },
    async searchProviderIdentity() {
      return {
        provider: 'jav',
        namespace: 'jav_code',
        providerKey: 'FOREIGN-999',
      };
    },
    async fetchProviderMetadata({ metadataFetchIntent:intent }) {
      return {
        providerKind: 'jav',
        integrationId: intent.integrationId,
        configRevision: intent.configRevision,
        descriptiveEntries: [],
        providerIdentities: [{
          ...resolvedProviderIdentity,
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
  const intent = {
    sourceKind: 'provider',
    contentProfile: 'jav',
    providerKind: 'jav',
    integrationId: 'jav-construction',
    configRevision: 1,
    resolvedProviderIdentity,
  };
  const integrationHandle = port.resolveIntegrationHandle({
    intent,
    operationId: 'libra.product_metadata.fetch@1',
  });
  await assert.rejects(
    port.fetchProvider(intent, integrationHandle),
    (error) => error.code === 'CLEAN_PRODUCT_PROVIDER_RESULT_INVALID',
  );
});

test('JAV Artifact acquisition fences kind, identity, handle, and unavailable outcome', async () => {
  const identityBasis = {
    provider: 'jav',
    namespace: 'jav_code',
    providerKey: 'SDKI-001',
    seasonNumber: null,
  };
  const identity = Object.freeze({
    ...identityBasis,
    identityAnchorDigest: canonicalDigest(identityBasis),
  });
  const requirement = Object.freeze({
    artifactKind: 'poster',
    requirementDigest: canonicalDigest({ kind:'poster' }),
  });
  const draft = Object.freeze({
    providerIdentities: Object.freeze([identity]),
    artifactRequirements: Object.freeze([requirement]),
  });
  const artifactHandle = Object.freeze({
    schemaRef: 'helix://contracts/types/ArtifactHandle/v1',
    schemaVersion: 1,
    artifactHandleId: 'artifact-poster',
    artifactKind: 'poster',
    ownerDomain: 'libra',
    ownerScope: Object.freeze({
      scopeType: 'libra_run',
      scopeId: 'run-1',
    }),
    storageRef: 'workspace://workspace-1/product/poster.jpg',
    digestAlgorithm: 'sha256',
    digestHex: canonicalDigest({ bytes:'poster' }),
    sizeBytes: 4,
    mediaType: 'image/jpeg',
    provenanceRef: Object.freeze({
      objectType: 'metadata_observation',
      objectId: 'observation-1',
      revision: 1,
      digest: canonicalDigest({ observation:1 }),
    }),
    referenceRevision: 1,
  });
  let providerOutcome;
  const workspaceProductPort = {
    async acquireArtifact(request) {
      const outcome = await request.acquireBytes();
      if (outcome.resultKind === 'not_available') return outcome;
      return Object.freeze({
        resultKind: 'acquired',
        materialized: Object.freeze({ artifactHandle }),
      });
    },
    materializeArtifact() {},
  };
  const port = createCleanProductProductionPort({
    mediaProbe: { probe:async () => ({}) },
    workspaceProductPort,
    async fetchProviderArtifact() {
      return providerOutcome;
    },
  });
  const intent = {
    sourceKind: 'provider',
    providerKind: 'jav',
    integrationId: 'jav-construction',
    configRevision: 1,
  };
  const integrationHandle = port.resolveIntegrationHandle({
    intent,
    operationId: 'libra.product_artifact.acquire@1',
    artifactKind: 'poster',
  });
  const request = {
    productMetadataDraft: draft,
    artifactKind: 'poster',
    integrationHandle,
    libraRunId: 'run-1',
    workspaceId: 'workspace-1',
    relativePath: 'product/poster.jpg',
    integrationId: 'jav-construction',
    configRevision: 1,
    metadataObservationId: 'observation-1',
    metadataObservationDigest: canonicalDigest({ observation:1 }),
  };
  providerOutcome = Object.freeze({
    resultKind: 'not_available',
    reasonCode: 'provider_asset_absent',
  });
  const unavailable = await port.acquireProviderArtifact(request);
  assert.equal(unavailable.resultKind, 'not_available');
  assert.equal(unavailable.artifactHandle, null);

  providerOutcome = Object.freeze({
    resultKind: 'acquired',
    artifactKind: 'fanart',
    integrationId: 'jav-construction',
    configRevision: 1,
    resolvedProviderIdentity: identity,
    mediaType: 'image/jpeg',
    bytes: Buffer.from([1]),
  });
  await assert.rejects(
    port.acquireProviderArtifact(request),
    (error) => error.code === 'CLEAN_PRODUCT_ARTIFACT_RESULT_INVALID',
  );
  providerOutcome = Object.freeze({
    ...providerOutcome,
    artifactKind: 'poster',
    resolvedProviderIdentity: Object.freeze({
      ...identity,
      providerKey: 'FOREIGN-999',
    }),
  });
  await assert.rejects(
    port.acquireProviderArtifact(request),
    (error) => error.code === 'CLEAN_PRODUCT_PROVIDER_IDENTITY_MISMATCH',
  );
  await assert.rejects(
    port.acquireProviderArtifact({
      ...request,
      integrationHandle: {
        ...integrationHandle,
        fenceDigest: canonicalDigest({ foreign:true }),
      },
    }),
    (error) => error.code === 'CLEAN_PRODUCT_ARTIFACT_INPUT_INVALID',
  );
});
