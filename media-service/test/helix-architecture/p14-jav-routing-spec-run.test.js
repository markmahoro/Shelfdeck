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
