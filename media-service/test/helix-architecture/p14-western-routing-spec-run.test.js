'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  createCleanWesternAnalysisPort,
} = require('../../src/clean-western-analysis-port');
const {
  createCleanMediaProbe,
} = require('../../src/clean-media-probe');
const {
  createCapabilityContractValidator,
} = require(
  '../../src/helix/foundation/capability/contract-validator'
);
const westernAnalysisPlanSchemaGraph = require(
  '../../src/helix/domains/libra/application/western-analysis-plan-schema-graph'
);
const westernPhasePlanBindingSchema = require(
  '../../src/helix/contracts/application-types/LibraWesternAnalysisPhasePlanBinding/v1/schema.json'
);
const artifactHandleSchema = require(
  '../../src/helix/contracts/types/ArtifactHandle/v1/schema.json'
);
const faceClusterSetHandleSchema = require(
  '../../src/helix/contracts/types/FaceClusterSetHandle/v1/schema.json'
);
const faceEmbeddingSetHandleSchema = require(
  '../../src/helix/contracts/types/FaceEmbeddingSetHandle/v1/schema.json'
);
const frameArtifactSetSchema = require(
  '../../src/helix/contracts/types/FrameArtifactSet/v1/schema.json'
);
const personMatchEvidenceSchema = require(
  '../../src/helix/contracts/types/PersonMatchEvidence/v1/schema.json'
);
const westernAnalysisResultSchema = require(
  '../../src/helix/contracts/types/WesternAnalysisResult/v1/schema.json'
);
const {
  reconstruct,
} = require(
  '../../src/helix/domains/procurement/application/candidate-delivery-service'
);
const {
  createCandidateDeliveryReader,
} = require(
  '../../src/helix/domains/procurement/persistence/candidate-delivery-reader'
);
const {
  openSqliteKernel,
} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {
  createSqliteUnitOfWork,
} = require(
  '../../src/helix/foundation/persistence/sqlite-unit-of-work'
);
const cleanSchemaManifest = require(
  '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'
);

const secretRoot = 'p14-western-routing-spec-run-secret-root-0123456789abcdef';
const schemaDdl = fs.readFileSync(path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

function deterministicProbe(readHandle) {
  const value = {
    resultKind: 'probed',
    sourceHandleDigest: canonicalDigest(readHandle),
    durationMs: 101_000,
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

function westernConstructionRuntime(calls = {}) {
  for (const method of [
    'extractFrameSet',
    'computeEmbeddings',
    'computeClusters',
    'analyzeWestern',
    'matchReferences',
    'renderPoster',
  ]) calls[method] = calls[method] || 0;
  const counted = (method, implementation) => async (input) => {
    calls[method] += 1;
    return implementation(input);
  };
  return Object.freeze({
    modelPack: Object.freeze({
      modelId: 'shelfdeck-western-construction-face',
      modelRevision: 1,
      modelDigest: canonicalDigest('western-model-bytes'),
      inputContractDigest: canonicalDigest('western-model-input-v1'),
      outputContractDigest: canonicalDigest('western-model-output-v1'),
      licenseDigest: canonicalDigest('western-model-license'),
      clusterDistanceThreshold: 0.42,
      clusterMinSize: 1,
    }),
    engine: Object.freeze({
      extractFrameSet: counted('extractFrameSet', ({
        samplingPlan,
        outputSink,
      }) => {
        assert.equal(outputSink.contract.artifactKind, 'western_frame_set');
        outputSink.writeFrame({
          timestampMs: 0,
          bytes: Buffer.from('western-frame-0:' + samplingPlan.digest),
        });
        outputSink.writeFrame({
          timestampMs: samplingPlan.intervalMs,
          bytes: Buffer.from('western-frame-1:' + samplingPlan.digest),
        });
        return { frameCount: 2 };
      }),
      computeEmbeddings: counted('computeEmbeddings', () => ({
        detectedFaceCount: 2,
        vectorCount: 2,
        dimension: 4,
        vectors: [[0.1, 0.2, 0.3, 0.4], [0.2, 0.3, 0.4, 0.5]],
      })),
      computeClusters: counted('computeClusters', () => ({
        clusters: [{
          clusterId: 'western-cluster-1',
          vectorOrdinals: [0, 1],
        }],
      })),
      analyzeWestern: counted('analyzeWestern', () => ({
        identityAnchor: 'western-internal-identity-1',
        descriptiveFacts: [{
          key: 'title',
          value: 'Western Sample Feature',
        }],
      })),
      matchReferences: counted('matchReferences', ({
        personReferenceProjections,
      }) => {
        assert.deepEqual(personReferenceProjections, []);
        return { matches: [] };
      }),
      renderPoster: counted('renderPoster', () =>
        Buffer.from('western-construction-poster')),
    }),
  });
}

test('Western analysis fails closed on model, Handle, and People projection drift', async () => {
  const runtime = westernConstructionRuntime();
  const clusterHandle = Object.freeze({
    schemaRef: 'helix://contracts/types/FaceClusterSetHandle/v1',
    schemaVersion: 1,
    artifactHandleId: 'cluster-artifact',
    artifactHandle: Object.freeze({
      schemaRef: 'helix://contracts/types/ArtifactHandle/v1',
      schemaVersion: 1,
      artifactHandleId: 'cluster-artifact',
      artifactKind: 'face_cluster_set',
      ownerDomain: 'libra',
      ownerScope: Object.freeze({
        scopeType: 'libra_run',
        scopeId: 'western-run',
      }),
    }),
    computationMode: 'western_frame_set',
    libraRunId: 'western-run',
    workspaceId: 'western-workspace',
    embeddingSetDigest: canonicalDigest('embedding-set'),
    clusterParameterDigest: canonicalDigest('cluster-parameters'),
    clusterCount: 1,
    handleDigest: canonicalDigest('cluster-handle'),
  });
  const workspaceProductPort = Object.freeze({
    materializeArtifact() {
      throw new Error('not used');
    },
    openFrameCompositeSink() {
      throw new Error('not used');
    },
    recoverMaterializedArtifact() {
      return null;
    },
    readArtifactBytes(handle) {
      assert.equal(handle.artifactKind, 'face_cluster_set');
      return Object.freeze({
        bytes: Buffer.from(canonicalJson({
          clusters: [{
            clusterId: 'western-cluster-1',
            vectorOrdinals: [0, 1],
          }],
        })),
      });
    },
  });
  assert.throws(() => createCleanWesternAnalysisPort({
    workspaceProductPort,
    engine: runtime.engine,
    modelPack: { ...runtime.modelPack, untrustedPath: 'legacy.onnx' },
  }), (error) => error.code === 'CLEAN_WESTERN_MODEL_PACK_INVALID');
  assert.throws(() => createCleanWesternAnalysisPort({
    workspaceProductPort,
    engine: runtime.engine,
    modelPack: {
      ...runtime.modelPack,
      modelDigest: 'not-a-digest',
    },
  }), (error) => error.code === 'CLEAN_WESTERN_DIGEST_INVALID');

  const port = createCleanWesternAnalysisPort({
    workspaceProductPort,
    engine: runtime.engine,
    modelPack: runtime.modelPack,
    now: () => 100,
  });
  await assert.rejects(port.matchReferences({
    faceClusterSetHandle: {
      ...clusterHandle,
      artifactHandle: {
        ...clusterHandle.artifactHandle,
        artifactKind: 'poster',
      },
    },
    personReferenceProjectionList: [],
  }), (error) => error.code === 'CLEAN_WESTERN_ARTIFACT_HANDLE_INVALID');
  await assert.rejects(port.matchReferences({
    faceClusterSetHandle: clusterHandle,
    personReferenceProjectionList: [{
      projectionContract: 'people.person-reference-projection@0',
      personId: 'person-1',
    }],
  }), (error) => error.code === 'CLEAN_WESTERN_MATCH_INPUT_INVALID');
  const empty = await port.matchReferences({
    faceClusterSetHandle: clusterHandle,
    personReferenceProjectionList: [],
  });
  assert.deepEqual(empty.matches, []);
  assert.deepEqual(empty.unmatchedClusterIds, ['western-cluster-1']);
});

async function session(host, apiKey) {
  return (await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  })).headers['set-cookie'];
}

async function createWesternShelfAndRouting(host, apiKey, root, fieldId) {
  const cookie = await session(host, apiKey);
  const shelfRoot = path.join(root, 'western-shelf-target');
  fs.mkdirSync(shelfRoot, { recursive: true });
  const initialStandard = { profileRuleSets: [] };
  const placement = { folderTemplate: '{title}', collisionPolicy: 'reject' };
  const created = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves',
    headers: { cookie },
    payload: {
      idempotencyKey: 'western-routing-shelf-create',
      shelfId: 'western-routing-shelf',
      name: 'Western Adult Shelf',
      target: {
        endpointId: 'western-routing-shelf-endpoint',
        rootLocation: shelfRoot,
        mountScopeId: 'western-routing-shelf-mount',
        mountScopeRevision: 1,
      },
      standard: {
        ruleTemplateId: 'western-routing-initial-template',
        ruleTemplateRevision: 1,
        schemaRef:
          'helix://fixtures/western-routing-initial-standard/v1',
        value: initialStandard,
        digest: canonicalDigest(initialStandard),
      },
      placement: {
        schemaRef: 'helix://fixtures/western-routing-placement/v1',
        value: placement,
        digest: canonicalDigest(placement),
      },
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const bound = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves/western-routing-shelf/actions/bind-template',
    headers: { cookie },
    payload: {
      idempotencyKey: 'western-routing-shelf-bind',
      shelfId: 'western-routing-shelf',
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
    expectedValue: 'western_adult',
  };
  const routed = await host.inject({
    method: 'PATCH',
    url: `/v1/admin/routing/material-fields/${fieldId}`,
    headers: { cookie },
    payload: {
      idempotencyKey: 'western-routing-policy-publish',
      fieldId,
      expectedPolicyId: null,
      expectedRevision: 0,
      policy: {
        routingPolicyId: 'western-routing-policy',
        mode: 'sorting',
        targets: [{
          shelfId: 'western-routing-shelf',
          rank: 1,
          matchExpression: expression,
        }],
      },
    },
  });
  assert.equal(routed.statusCode, 200, routed.body);
  return Object.freeze({ shelfRoot });
}

async function sha256(location) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    fs.createReadStream(location)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

async function snapshotFiles(locations) {
  return new Map(await Promise.all(locations.map(async (location) => {
    const stat = fs.statSync(location);
    return [location, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: await sha256(location),
    }];
  })));
}

test('Western active Run stays before Production without service-local Analysis', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/clean-service-host.js',
  ), 'utf8');
  assert.match(
    source,
    /formation\.contentProfile === 'western_adult'[\s\S]*?!westernAnalysisPort/,
  );
  assert.doesNotMatch(
    source,
    /formation\.contentProfile === 'western_adult'[\s\S]{0,240}(fallback|legacy)/i,
  );
  assert.doesNotMatch(source,
    /WorkerAssetReceipt|WorkerUploadReceipt|ExternalJobReceipt|Mirex|FastAPI|Ollama/);
});

test.skip('Western Adult Libra production is intentionally outside the Movie milestone', async (t) => {
  const retainedPrimary = String(
    process.env.P14_WESTERN_SAMPLE_FILE || ''
  ).trim();
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    'helix-p14-western-handoff-a-',
  ));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const sourceRoot = path.join(root, 'western-source');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<!doctype html><div id="root"></div>',
  );
  const primaryLocation = path.join(
    sourceRoot,
    'Western Sample Feature.mkv',
  );
  if (retainedPrimary) {
    assert.equal(fs.statSync(retainedPrimary).isFile(), true);
    fs.linkSync(retainedPrimary, primaryLocation);
  } else {
    fs.writeFileSync(primaryLocation, Buffer.from('western-primary'));
  }
  const sidecars = new Map([
    [
      'Western Sample Feature.nfo',
      Buffer.from('<movie><title>Western Sample Feature</title></movie>'),
    ],
    ['poster.jpg', Buffer.from('western-poster')],
    [
      'Unrelated Title.nfo',
      Buffer.from('<movie><title>Unrelated Title</title></movie>'),
    ],
  ]);
  for (const [name, bytes] of sidecars) {
    fs.writeFileSync(path.join(sourceRoot, name), bytes);
  }
  const sourceLocations = [
    primaryLocation,
    ...[...sidecars].map(([name]) => path.join(sourceRoot, name)),
  ];
  const sourceBefore = await snapshotFiles(sourceLocations);

  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  const access = {
    fieldId: 'western-handoff-field',
    revision: 1,
    endpointId: 'western-handoff-endpoint',
    rootLocation: sourceRoot,
    mountScopeId: 'western-handoff-mount',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/western-handoff-access/v1',
  };
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.jpg', '.mkv', '.nfo'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'western-handoff-policy',
    revision: 1,
    ...policyValue,
  };
  const register = {
    idempotencyKey: 'western-handoff-register',
    fieldId: access.fieldId,
    name: 'Western Adult Handoff Source',
    contentProfileHint: 'western_adult',
    policy: {
      extractionPolicyId: policyBasis.extractionPolicyId,
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest(policyBasis),
    },
    access: {
      ...access,
      accessDigest: canonicalDigest(access),
    },
  };
  const observe = {
    idempotencyKey: 'western-handoff-observe',
    fieldId: access.fieldId,
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 8,
  };
  let mediaProbeCalls = 0;
  const realMediaProbe = retainedPrimary
    ? createCleanMediaProbe()
    : null;
  const mediaProbe = Object.freeze({
    async probe(readHandle) {
      mediaProbeCalls += 1;
      if (realMediaProbe) return realMediaProbe.probe(readHandle);
      return deterministicProbe(readHandle);
    },
  });

  let injected = false;
  let host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    movieRunFaultInjector(point) {
      if (!injected && point === 'after_triage_results_before_publication') {
        injected = true;
        throw Object.assign(
          new Error('Western fault after Triage Results'),
          { code: 'P14_WESTERN_FAULT_AFTER_TRIAGE_RESULTS' },
        );
      }
    },
  });
  try {
    const unauthenticated = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      payload: register,
    });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);
    const cookie = await session(host, initialized.adminApiKey);
    const registered = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: register,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    await createWesternShelfAndRouting(
      host,
      initialized.adminApiKey,
      root,
      access.fieldId,
    );
    const interrupted = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie },
      payload: observe,
    });
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_WESTERN_FAULT_AFTER_TRIAGE_RESULTS',
    );
  } finally {
    await host.close();
  }
  assert.equal(mediaProbeCalls, 1);
  let database = new Database(path.join(dataDir, 'shelfdeck.db'));
  assert.equal(database.prepare(
    'SELECT count(*) count FROM proc_candidate_packages'
  ).get().count, 0);
  assert.ok(database.prepare(
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
  ).get().count >= 5);
  database.close();

  const callsBeforeAcceptance = mediaProbeCalls;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
  });
  let accepted;
  try {
    accepted = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: {
        cookie: await session(host, initialized.adminApiKey),
      },
      payload: observe,
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(accepted.json().movieJourney.stage, 'handoff_a_accepted');
    assert.equal(
      accepted.json().movieJourney.handoff.formation.stage,
      'libra_run_active',
    );
    assert.equal(
      accepted.json().movieJourney.handoff.formation.contentProfile,
      'western_adult',
    );
    assert.equal(
      accepted.json().movieJourney.handoff.formation.structureKind,
      'single',
    );
    assert.equal(accepted.json().movieJourney.handoff.production, null);
  } finally {
    await host.close();
  }
  assert.equal(mediaProbeCalls, callsBeforeAcceptance);

  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  const hint = database.prepare(
    `SELECT revision,content_profile_hint,hint_digest
       FROM proc_field_profile_hint_revisions
      WHERE field_id=?`
  ).get(access.fieldId);
  const observation = database.prepare(
    `SELECT content_profile_hint,profile_hint_revision,profile_hint_digest
       FROM proc_field_observations
      WHERE field_id=? AND completed=1`
  ).get(access.fieldId);
  const run = database.prepare(
    `SELECT procurement_run_id,content_profile_hint,profile_hint_revision,
            profile_hint_digest,state
       FROM proc_procurement_runs
      WHERE field_id=?`
  ).get(access.fieldId);
  assert.deepEqual({
    hint: hint.content_profile_hint,
    observation: observation.content_profile_hint,
    run: run.content_profile_hint,
    revisions: [
      hint.revision,
      observation.profile_hint_revision,
      run.profile_hint_revision,
    ],
    digests: [
      hint.hint_digest,
      observation.profile_hint_digest,
      run.profile_hint_digest,
    ],
  }, {
    hint: 'western_adult',
    observation: 'western_adult',
    run: 'western_adult',
    revisions: [1, 1, 1],
    digests: [hint.hint_digest, hint.hint_digest, hint.hint_digest],
  });
  assert.equal(run.state, 'active');

  const candidate = database.prepare(
    `SELECT candidate_package_id,media_type,content_profile,structure_kind,
            display_identity,identity_claim_json
       FROM proc_candidate_packages`
  ).get();
  assert.deepEqual({
    mediaType: candidate.media_type,
    contentProfile: candidate.content_profile,
    structureKind: candidate.structure_kind,
    displayIdentity: candidate.display_identity,
  }, {
    mediaType: 'single',
    contentProfile: 'western_adult',
    structureKind: 'single',
    displayIdentity: 'Western Sample Feature.mkv',
  });
  const claim = JSON.parse(candidate.identity_claim_json);
  assert.equal(claim.claimKind, 'western_temporary');
  assert.equal(claim.contentProfile, 'western_adult');
  assert.equal(claim.displayIdentity, 'Western Sample Feature.mkv');
  assert.equal(Object.hasOwn(claim, 'javCode'), false);
  assert.equal(claim.sourceHints.some(
    (item) => item.hintKind === 'jav_code'
  ), false);
  assert.deepEqual(
    claim.sourceHints.map((item) => item.hintKind),
    ['field_content_profile_hint', 'filename_title'],
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM proc_candidate_primary_materials
      WHERE candidate_package_id=?`
  ).get(candidate.candidate_package_id).count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM proc_candidate_primary_material_episode_claims
      WHERE candidate_package_id=?`
  ).get(candidate.candidate_package_id).count, 0);
  const related = database.prepare(
    `SELECT role,location
       FROM proc_candidate_related_references
      WHERE candidate_package_id=?
      ORDER BY role,location`
  ).all(candidate.candidate_package_id);
  assert.equal(related.filter((item) => item.role === 'nfo').length, 1);
  assert.equal(related.filter((item) => item.role === 'poster').length, 1);
  assert.equal(related.some((item) =>
    item.location.endsWith('Unrelated Title.nfo')), false);

  const subject = database.prepare(
    `SELECT subject_id,structure_kind,content_profile,intake_revision
       FROM libra_subjects`
  ).get();
  assert.equal(subject.structure_kind, 'single');
  assert.equal(subject.content_profile, 'western_adult');
  assert.equal(Number(subject.intake_revision), 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_material_bindings
      WHERE subject_id=? AND current=1`
  ).get(subject.subject_id).count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_material_controls
      WHERE owner_domain='libra'
        AND owner_scope_type='subject'
        AND owner_scope_id=?`
  ).get(subject.subject_id).count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_intake_decisions
      WHERE accepted_result='new_subject'
        AND target_subject_id=?`
  ).get(subject.subject_id).count, 1);
  const delivery = database.prepare(
    `SELECT offer_id
       FROM proc_candidate_deliveries
      WHERE candidate_package_id=? AND state='accepted'`
  ).get(candidate.candidate_package_id);
  assert.ok(delivery);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_field_routing_heads
      WHERE field_id=?`
  ).get(access.fieldId).count, 1);
  const routing = database.prepare(
    `SELECT routing_decision_id,decision,shelf_id,routing_policy_id,
            routing_policy_revision,decision_digest
       FROM libra_routing_decisions`
  ).get();
  assert.equal(routing.decision, 'resolved');
  assert.equal(routing.shelf_id, 'western-routing-shelf');
  assert.equal(routing.routing_policy_id, 'western-routing-policy');
  assert.equal(Number(routing.routing_policy_revision), 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_routing_assessments'
  ).get().count, 1);
  const basisRows = database.prepare(
    `SELECT basis_kind,status,query_result_set_digest,basis_digest
       FROM libra_decision_basis_revisions
      ORDER BY basis_revision`
  ).all();
  assert.deepEqual(
    basisRows.map((row) => [row.basis_kind, row.status]),
    [['routing', 'ready'], ['acceptance_spec', 'ready']],
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM libra_decision_basis_inputs
      WHERE input_kind IN ('decision_fact','query_result')`
  ).get().count, 0);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM perception_resolution_revisions'
  ).get().count, 0);
  const specRow = database.prepare(
    `SELECT acceptance_spec_id,shelf_id,spec_revision,spec_json,
            spec_digest,record_digest,structure_kind,content_profile
       FROM libra_acceptance_specs`
  ).get();
  const spec = JSON.parse(specRow.spec_json);
  assert.equal(specRow.shelf_id, 'western-routing-shelf');
  assert.equal(specRow.structure_kind, 'single');
  assert.equal(specRow.content_profile, 'western_adult');
  assert.equal(spec.contentProfile, 'western_adult');
  assert.equal(spec.structureKind, 'single');
  assert.equal(spec.productScope.scopeKind, 'single');
  assert.deepEqual(spec.productScope.episodeKeys, []);
  assert.deepEqual(spec.requirements.identity, {
    identityKind: 'internal_identity',
    requireSeasonNumber: false,
  });
  assert.equal(spec.requirements.structure.structureKind, 'single');
  assert.equal(spec.requirements.mandatoryMedia.videoCodec, 'hevc');
  assert.equal(spec.requirements.mandatoryMedia.container, 'matroska');
  assert.equal(spec.requirements.mandatoryMedia.fileExtension, 'mkv');
  assert.equal(spec.requirements.space.maxSizeGiB, 1);
  assert.equal(spec.requirements.space.maxSizeBytes, 1073741824);
  assert.deepEqual(
    spec.requirements.metadata.requiredFieldCodes,
    ['internal_identity', 'title'],
  );
  assert.deepEqual(
    spec.requirements.metadata.requiredArtifactKinds,
    ['nfo', 'poster'],
  );
  const runRow = database.prepare(
    `SELECT libra_run_id,subject_id,acceptance_spec_id,state,
            state_revision,execution_basis_digest,run_scope_digest
       FROM libra_runs`
  ).get();
  assert.equal(runRow.subject_id, subject.subject_id);
  assert.equal(runRow.acceptance_spec_id, specRow.acceptance_spec_id);
  assert.equal(runRow.state, 'active');
  assert.equal(Number(runRow.state_revision), 1);
  const manifest = database.prepare(
    `SELECT run_material_manifest_id,libra_run_id,manifest_role,scope_kind,
            member_count,episode_scope_digest,manifest_digest
       FROM libra_run_material_manifests`
  ).get();
  assert.equal(manifest.libra_run_id, runRow.libra_run_id);
  assert.equal(manifest.manifest_role, 'run_input');
  assert.equal(manifest.scope_kind, 'single');
  assert.equal(Number(manifest.member_count), 1);
  const runMember = database.prepare(
    `SELECT role,origin_candidate_package_id,origin_package_revision,
            admitted_control_revision,admitted_control_projection_digest
       FROM libra_run_material_members`
  ).get();
  assert.equal(runMember.role, 'primary_payload');
  assert.equal(runMember.origin_candidate_package_id,
    candidate.candidate_package_id);
  assert.equal(Number(runMember.origin_package_revision), 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_run_material_episode_claims'
  ).get().count, 0);
  for (const table of [
    'fx_workspace_registry',
    'libra_workspaces',
    'libra_workspace_revisions',
    'libra_workspace_material_refs',
    'libra_product_fact_revisions',
    'libra_product_identity_revisions',
    'libra_product_packages',
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
  const formationFrozen = Object.freeze({
    routingDecisionId: routing.routing_decision_id,
    routingDecisionDigest: routing.decision_digest,
    basisDigests: basisRows.map((row) => row.basis_digest),
    acceptanceSpecId: specRow.acceptance_spec_id,
    specDigest: specRow.spec_digest,
    specRecordDigest: specRow.record_digest,
    canonicalSpec: canonicalJson(spec),
    libraRunId: runRow.libra_run_id,
    executionBasisDigest: runRow.execution_basis_digest,
    runScopeDigest: runRow.run_scope_digest,
    manifestDigest: manifest.manifest_digest,
  });
  const frozenCounts = Object.freeze({
    candidates: database.prepare(
      'SELECT count(*) count FROM proc_candidate_packages'
    ).get().count,
    subjects: database.prepare(
      'SELECT count(*) count FROM libra_subjects'
    ).get().count,
    intakes: database.prepare(
      'SELECT count(*) count FROM libra_intake_decisions'
    ).get().count,
    bindings: database.prepare(
      'SELECT count(*) count FROM libra_material_bindings'
    ).get().count,
  });
  database.close();

  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(dataDir, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest: cleanSchemaManifest,
  });
  try {
    const reader = createCandidateDeliveryReader({
      schemaManifest: cleanSchemaManifest,
      unitOfWork: createSqliteUnitOfWork({ kernel }),
    });
    const snapshot = reconstruct(reader.readRows({
      offerId: delivery.offer_id,
    }));
    assert.equal(snapshot.candidatePackage.contentProfile, 'western_adult');
    assert.equal(snapshot.primaryInputManifest.structureKind, 'single');
    assert.equal(
      snapshot.candidatePackage.identityClaim.claimKind,
      'western_temporary',
    );
    assert.equal(snapshot.primaryInputManifest.members.length, 1);
    assert.equal(snapshot.candidatePackage.relatedReferences.length, 2);
    assert.equal(snapshot.candidatePackage.relatedReferences.some((item) =>
      item.location.endsWith('Unrelated Title.nfo')), false);
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
    const cookie = await session(host, initialized.adminApiKey);
    const replay = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie },
      payload: observe,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().observation.replayed, true);
    assert.equal(replay.json().movieJourney.replayed, true);
    assert.equal(
      replay.json().movieJourney.handoff.formation.stage,
      'libra_run_active',
    );
    assert.equal(replay.json().movieJourney.handoff.production, null);
    const conflict = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie },
      payload: { ...observe, pageBudget: 7 },
    });
    assert.equal(conflict.statusCode, 409, conflict.body);
  } finally {
    await host.close();
  }
  assert.equal(mediaProbeCalls, callsBeforeAcceptance);

  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.deepEqual({
    candidates: database.prepare(
      'SELECT count(*) count FROM proc_candidate_packages'
    ).get().count,
    subjects: database.prepare(
      'SELECT count(*) count FROM libra_subjects'
    ).get().count,
    intakes: database.prepare(
      'SELECT count(*) count FROM libra_intake_decisions'
    ).get().count,
    bindings: database.prepare(
      'SELECT count(*) count FROM libra_material_bindings'
    ).get().count,
  }, frozenCounts);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='procurement_candidate_offer_available'`
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='libra_candidate_accepted'`
  ).get().count, 1);
  assert.deepEqual(database.prepare(
    'SELECT routing_decision_id,decision_digest FROM libra_routing_decisions'
  ).all(), [{
    routing_decision_id: formationFrozen.routingDecisionId,
    decision_digest: formationFrozen.routingDecisionDigest,
  }]);
  assert.deepEqual(database.prepare(
    `SELECT basis_digest
       FROM libra_decision_basis_revisions
      ORDER BY basis_revision`
  ).all().map((row) => row.basis_digest), formationFrozen.basisDigests);
  assert.deepEqual(database.prepare(
    `SELECT acceptance_spec_id,spec_json,spec_digest,record_digest
       FROM libra_acceptance_specs`
  ).all(), [{
    acceptance_spec_id: formationFrozen.acceptanceSpecId,
    spec_json: formationFrozen.canonicalSpec,
    spec_digest: formationFrozen.specDigest,
    record_digest: formationFrozen.specRecordDigest,
  }]);
  assert.deepEqual(database.prepare(
    `SELECT libra_run_id,execution_basis_digest,run_scope_digest
       FROM libra_runs`
  ).all(), [{
    libra_run_id: formationFrozen.libraRunId,
    execution_basis_digest: formationFrozen.executionBasisDigest,
    run_scope_digest: formationFrozen.runScopeDigest,
  }]);
  assert.deepEqual(database.prepare(
    'SELECT manifest_digest FROM libra_run_material_manifests'
  ).all(), [{ manifest_digest: formationFrozen.manifestDigest }]);
  for (const table of [
    'fx_workspace_registry',
    'libra_workspaces',
    'libra_workspace_revisions',
    'libra_workspace_material_refs',
    'libra_product_fact_revisions',
    'libra_product_identity_revisions',
    'libra_product_packages',
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

  const westernCalls = {};
  const westernRuntime = westernConstructionRuntime(westernCalls);
  let physicalFault = false;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    westernAnalysisEngine: westernRuntime.engine,
    westernModelPack: westernRuntime.modelPack,
    afterWorkspacePhysicalEffect({ target }) {
      if (!physicalFault &&
          target.includes(`${path.sep}analysis${path.sep}frames${path.sep}`)) {
        physicalFault = true;
        throw Object.assign(
          new Error('Western fault after Frame physical effect'),
          { code: 'P14_WESTERN_FAULT_AFTER_FRAME_EFFECT' },
        );
      }
    },
  });
  try {
    const interrupted = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: {
        cookie: await session(host, initialized.adminApiKey),
      },
      payload: observe,
    });
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_WESTERN_FAULT_AFTER_FRAME_EFFECT',
      interrupted.body,
    );
  } finally {
    await host.close();
  }
  assert.deepEqual(westernCalls, {
    extractFrameSet: 1,
    computeEmbeddings: 0,
    computeClusters: 0,
    analyzeWestern: 0,
    matchReferences: 0,
    renderPoster: 0,
  });

  let resultFault = false;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    westernAnalysisEngine: westernRuntime.engine,
    westernModelPack: westernRuntime.modelPack,
    afterCapabilityResultCommit({ capabilityRef }) {
      if (!resultFault &&
          capabilityRef === 'libra.western.analysis.request@1') {
        resultFault = true;
        throw Object.assign(
          new Error('Western fault after Analysis Result commit'),
          { code: 'P14_WESTERN_FAULT_AFTER_ANALYSIS_RESULT' },
        );
      }
    },
  });
  try {
    const interrupted = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: {
        cookie: await session(host, initialized.adminApiKey),
      },
      payload: observe,
    });
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_WESTERN_FAULT_AFTER_ANALYSIS_RESULT',
    );
  } finally {
    await host.close();
  }
  assert.deepEqual(westernCalls, {
    extractFrameSet: 1,
    computeEmbeddings: 1,
    computeClusters: 1,
    analyzeWestern: 1,
    matchReferences: 0,
    renderPoster: 0,
  });

  let packageFault = false;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    westernAnalysisEngine: westernRuntime.engine,
    westernModelPack: westernRuntime.modelPack,
    afterPackageCommit() {
      if (!packageFault) {
        packageFault = true;
        throw Object.assign(
          new Error('Western fault after Package commit'),
          { code: 'P14_WESTERN_FAULT_AFTER_PACKAGE_COMMIT' },
        );
      }
    },
  });
  try {
    const interrupted = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: {
        cookie: await session(host, initialized.adminApiKey),
      },
      payload: observe,
    });
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_WESTERN_FAULT_AFTER_PACKAGE_COMMIT',
      interrupted.body,
    );
  } finally {
    await host.close();
  }
  assert.deepEqual(westernCalls, {
    extractFrameSet: 1,
    computeEmbeddings: 1,
    computeClusters: 1,
    analyzeWestern: 1,
    matchReferences: 1,
    renderPoster: 1,
  });

  const onDeckOptions = Object.freeze({
    dataDir,
    adminDistDir,
    secretRoot,
    mediaProbe,
    westernAnalysisEngine: westernRuntime.engine,
    westernModelPack: westernRuntime.modelPack,
  });
  const requestOnDeck = async (activeHost) => activeHost.inject({
    method: 'POST',
    url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
    headers: {
      cookie: await session(activeHost, initialized.adminApiKey),
    },
    payload: observe,
  });
  const interruptOnDeck = async (hookName, reasonCode) => {
    let shouldInterrupt = true;
    const interruptedHost = await createCleanServiceHost({
      ...onDeckOptions,
      [hookName]() {
        if (!shouldInterrupt) return;
        shouldInterrupt = false;
        throw Object.assign(new Error(`Western fault at ${hookName}`), {
          code: reasonCode,
        });
      },
    });
    try {
      const response = await requestOnDeck(interruptedHost);
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(
        response.json().error.details.reasonCode,
        reasonCode,
        response.body,
      );
    } finally {
      await interruptedHost.close();
    }
  };

  await interruptOnDeck(
    'afterAcceptedResponsibilityInsert',
    'P14_WESTERN_FAULT_AFTER_HANDOFF_B_RESPONSIBILITY_INSERT',
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

  await interruptOnDeck(
    'afterArcaInventoryPhysicalEffect',
    'P14_WESTERN_FAULT_AFTER_ARCA_INVENTORY_PHYSICAL_EFFECT',
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
  for (const table of [
    'arca_acceptance_decisions',
    'arca_ondeck_custodies',
    'arca_handoff_b_receipts',
    'arca_ondeck_runs',
    'arca_final_inventory_decisions',
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) count FROM ${table}`).get().count,
      1,
      table,
    );
  }
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_shelf_entries',
  ).get().count, 0);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_effect_journal
      WHERE effect_class='material_commit' AND state='intended'`,
  ).get().count, 1);
  database.close();

  await interruptOnDeck(
    'afterOnDeckCommit',
    'P14_WESTERN_FAULT_AFTER_ONDECK_COMMIT',
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
  ).get().count, 3);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_deck_fact_revisions',
  ).get().count, 1);
  assert.equal(database.prepare(
    'SELECT count(*) count FROM arca_ondeck_commit_receipts',
  ).get().count, 1);
  const targetLocations = database.prepare(
    `SELECT location
       FROM arca_inventory_materials
      ORDER BY ordinal`,
  ).all().map((row) => row.location);
  const workspaceRows = database.prepare(
    `SELECT workspace_id,relative_path
       FROM fx_workspace_materials
      WHERE state='active'
      ORDER BY relative_path`,
  ).all();
  database.close();
  const targetsBeforeReplay = await snapshotFiles(targetLocations);
  const workspaceFiles = workspaceRows.map((row) => path.join(
    dataDir,
    'workspace',
    row.workspace_id,
    ...row.relative_path.split('/'),
  ));
  assert.ok(workspaceFiles.length > 0);
  assert.equal(workspaceFiles.every((file) => fs.existsSync(file)), true);

  host = await createCleanServiceHost({
    ...onDeckOptions,
    afterRunCompletion() {
      throw Object.assign(
        new Error('Western fault after Run completion'),
        { code: 'P14_WESTERN_FAULT_AFTER_RUN_COMPLETION' },
      );
    },
  });
  try {
    const replay = await requestOnDeck(host);
    assert.equal(replay.statusCode, 400, replay.body);
    assert.equal(
      replay.json().error.details.reasonCode,
      'P14_WESTERN_FAULT_AFTER_RUN_COMPLETION',
      replay.body,
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
       FROM libra_runs
      WHERE state='completed'`,
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
  const offloadCommittedAtMs = Number(database.prepare(
    'SELECT committed_at_ms FROM arca_offload_completions',
  ).get().committed_at_ms);
  const cleanupAtMs = offloadCommittedAtMs + 86_400_000 + 60_000;
  database.close();

  host = await createCleanServiceHost({
    ...onDeckOptions,
    cleanupNow: () => offloadCommittedAtMs + 86_400_000 - 1,
    offloadWakeVisible: false,
  });
  try {
    const grace = await requestOnDeck(host);
    assert.equal(grace.statusCode, 200, grace.body);
    const production = grace.json().movieJourney.handoff.production;
    assert.equal(
      production.responsibilityClosure.stage,
      'workspace_cleanup_grace_active',
    );
    assert.equal(
      canonicalJson(production.responsibilityClosure.runClosure.result),
      committedLifecycleResult.result_json,
    );
    assert.equal(
      canonicalDigest(production.responsibilityClosure.runClosure.result),
      committedLifecycleResult.result_digest,
    );
  } finally {
    await host.close();
  }

  let cleanupClock = cleanupAtMs;
  let committedProduction;
  host = await createCleanServiceHost({
    ...onDeckOptions,
    cleanupNow: () => cleanupClock,
    offloadWakeVisible: false,
  });
  try {
    const firstAudit = await requestOnDeck(host);
    assert.equal(firstAudit.statusCode, 200, firstAudit.body);
    const production = firstAudit.json().movieJourney.handoff.production;
    committedProduction = production;
    assert.equal(
      production.responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
    assert.equal(
      canonicalJson(production.responsibilityClosure.runClosure.result),
      committedLifecycleResult.result_json,
    );
    assert.equal(
      canonicalDigest(production.responsibilityClosure.runClosure.result),
      committedLifecycleResult.result_digest,
    );
    assert.equal(
      production.responsibilityClosure.runClosure.result.resultDigest,
      JSON.parse(committedLifecycleResult.result_json).resultDigest,
    );
    assert.equal(production.productDelivery.resultKind, 'found');
    assert.equal(
      production.productDelivery.onDeckProductPackage
        .productStructureSnapshot.contentProfile,
      'western_adult',
    );
    assert.equal(
      production.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.length,
      3,
    );
    assert.deepEqual(
      production.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.map((item) => item.role).sort(),
      ['metadata_sidecar', 'poster', 'primary_payload'],
    );
    assert.equal(
      production.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.every((item) =>
          item.episodeClaims.length === 0),
      true,
    );
  } finally {
    await host.close();
  }
  assert.deepEqual(westernCalls, {
    extractFrameSet: 1,
    computeEmbeddings: 1,
    computeClusters: 1,
    analyzeWestern: 1,
    matchReferences: 1,
    renderPoster: 1,
  });

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
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='arca.product.accepted@1'
        AND state='fully_acked'`,
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='arca.offload.completed@1'
        AND state='pending'`,
  ).get().count, 1);
  database.close();

  let cleanupPhysicalEffects = 0;
  host = await createCleanServiceHost({
    ...onDeckOptions,
    cleanupNow: () => cleanupClock,
    offloadWakeVisible: false,
    afterCleanupPhysicalEffect() {
      cleanupPhysicalEffects += 1;
      throw Object.assign(
        new Error('Western cleanup physical effect interruption'),
        { code: 'P14_WESTERN_CLEANUP_PHYSICAL_EFFECT_INTERRUPTION' },
      );
    },
  });
  try {
    const restartedFirstAudit = await requestOnDeck(host);
    assert.equal(restartedFirstAudit.statusCode, 200,
      restartedFirstAudit.body);
    assert.equal(
      restartedFirstAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
    cleanupClock = cleanupAtMs + 60_000 - 1;
    const earlySecondAudit = await requestOnDeck(host);
    assert.equal(earlySecondAudit.statusCode, 200,
      earlySecondAudit.body);
    assert.equal(
      earlySecondAudit.json().movieJourney.handoff.production
        .responsibilityClosure.stage,
      'workspace_cleanup_audit_pending',
    );
    cleanupClock = cleanupAtMs + 60_000;
    const interrupted = await requestOnDeck(host);
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_WESTERN_CLEANUP_PHYSICAL_EFFECT_INTERRUPTION',
      interrupted.body,
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
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_outbox
      WHERE message_kind='arca.offload.completed@1'
        AND state='pending'`,
  ).get().count, 1);
  database.close();
  assert.equal(cleanupPhysicalEffects, 1);
  assert.equal(
    workspaceFiles.filter((file) => !fs.existsSync(file)).length,
    1,
  );

  host = await createCleanServiceHost({
    ...onDeckOptions,
    cleanupNow: () => cleanupClock,
    afterCleanupCommit() {
      throw Object.assign(
        new Error('Western cleanup member commit interruption'),
        { code: 'P14_WESTERN_CLEANUP_MEMBER_COMMIT_INTERRUPTION' },
      );
    },
  });
  try {
    const interrupted = await requestOnDeck(host);
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_WESTERN_CLEANUP_MEMBER_COMMIT_INTERRUPTION',
      interrupted.body,
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
    ...onDeckOptions,
    cleanupNow: () => cleanupClock,
    afterCleanupPhysicalEffect() {
      cleanupPhysicalEffects += 1;
    },
  });
  let cleanedProduction;
  try {
    const cleaned = await requestOnDeck(host);
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
      3,
    );
    assert.equal(
      cleanedProduction.productDelivery.onDeckProductPackage
        .productMaterialManifest.members.every((member) =>
          member.episodeClaims.length === 0),
      true,
    );
    assert.equal(
      canonicalJson(
        cleanedProduction.responsibilityClosure.runClosure.result,
      ),
      committedLifecycleResult.result_json,
    );
  } finally {
    await host.close();
  }
  assert.equal(cleanupPhysicalEffects, workspaceFiles.length);
  assert.equal(workspaceFiles.every((file) => !fs.existsSync(file)), true);
  assert.deepEqual(
    await snapshotFiles(targetLocations),
    targetsBeforeReplay,
  );

  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
  assert.equal(database.prepare(
    'SELECT count(*) count FROM libra_product_packages'
  ).get().count, 1);
  assert.equal(database.prepare(
    `SELECT count(*) count FROM libra_product_fact_revisions
      WHERE fact_kind IN ('resolved_identity','product_metadata','media_cast')`
  ).get().count, 3);
  assert.equal(database.prepare(
    `SELECT count(*) count FROM fx_artifact_registry
      WHERE owner_scope_type='libra_run'`
  ).get().count >= 6, true);
  assert.equal(database.prepare(
    `SELECT count(*) count FROM fx_outbox
      WHERE message_kind='libra.product-offer.available@1'`
  ).get().count, 1);
  for (const table of [
    'arca_acceptance_attempts',
    'arca_acceptance_decisions',
    'arca_ondeck_custodies',
    'arca_handoff_b_receipts',
    'arca_final_inventory_decisions',
    'arca_ondeck_commit_receipts',
    'arca_offload_completions',
    'arca_shelf_entries',
    'arca_deck_fact_revisions',
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
  const packageMembers = committedProduction.productDelivery
    .onDeckProductPackage.productMaterialManifest.members;
  const productBindings = database.prepare(
    `SELECT material_key,role,episode_claims_json
       FROM arca_material_bindings
      WHERE role LIKE 'product:%'
      ORDER BY material_key`,
  ).all();
  assert.deepEqual(
    productBindings.map((item) => [item.material_key, item.role]),
    packageMembers.map((item) => [
      item.materialKey,
      'product:' + item.role,
    ]).sort((left, right) =>
      Buffer.compare(Buffer.from(left[0]), Buffer.from(right[0]))),
  );
  assert.equal(
    productBindings.every((item) =>
      JSON.parse(item.episode_claims_json).items.length === 0),
    true,
  );
  const inventoryRows = database.prepare(
    `SELECT role,episode_claims_json,location
       FROM arca_inventory_materials
      ORDER BY ordinal`,
  ).all();
  assert.equal(inventoryRows.length, 3);
  assert.deepEqual(
    inventoryRows.map((item) => item.role).sort(),
    ['metadata_sidecar', 'poster', 'primary'],
  );
  assert.equal(
    inventoryRows.every((item) =>
      JSON.parse(item.episode_claims_json).items.length === 0 &&
      targetLocations.includes(item.location)),
    true,
  );
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_effect_journal
      WHERE effect_class='material_commit' AND state='committed'`,
  ).get().count, 3);
  assert.equal(database.prepare(
    `SELECT count(*) count
       FROM fx_material_controls
      WHERE owner_domain='arca'
        AND owner_scope_type='shelf_entry'
        AND state='controlled'`,
  ).get().count, 3);
  for (const messageKind of [
    'arca.product.accepted@1',
    'arca.offload.completed@1',
  ]) {
    assert.equal(database.prepare(
      `SELECT count(*) count
         FROM fx_outbox
        WHERE message_kind=? AND state='fully_acked'`,
    ).get(messageKind).count, 1);
    assert.equal(database.prepare(
      `SELECT count(*) count
         FROM fx_inbox inbox
         JOIN fx_outbox outbox ON outbox.message_id=inbox.message_id
        WHERE outbox.message_kind=?
          AND inbox.consumer_domain='libra'
          AND inbox.consumed_at_ms IS NOT NULL`,
    ).get(messageKind).count, 1);
    assert.equal(database.prepare(
      `SELECT count(*) count
         FROM fx_outbox_deliveries delivery
         JOIN fx_outbox outbox ON outbox.message_id=delivery.message_id
        WHERE outbox.message_kind=?
          AND delivery.consumer_domain='libra'
          AND delivery.state='acked'`,
    ).get(messageKind).count, 1);
    assert.equal(database.prepare(
      `SELECT count(*) count
         FROM fx_inbox inbox
         JOIN fx_outbox outbox ON outbox.message_id=inbox.message_id
        WHERE outbox.message_kind=?
          AND inbox.consumer_domain<>'libra'`,
    ).get(messageKind).count, 0);
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
       FROM fx_effect_journal
      WHERE effect_class='libra_workspace_material_reclaim'
        AND state='committed'`,
  ).get().count, workspaceFiles.length);
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
    `SELECT count(*) count FROM fx_plan_nodes
      WHERE input_binding_schema_ref=
        'helix://contracts/application-types/LibraWesternAnalysisPhasePlanBinding/v1'`
  ).get().count >= 12, true);
  const westernPlanValidator = createCapabilityContractValidator({
    schemas: westernAnalysisPlanSchemaGraph,
  });
  const planBindings = database.prepare(
    `SELECT input_bindings_json
       FROM fx_plan_nodes
      WHERE input_binding_schema_ref=
        'helix://contracts/application-types/LibraWesternAnalysisPhasePlanBinding/v1'`
  ).all().map((row) => JSON.parse(row.input_bindings_json));
  for (const binding of planBindings) {
    westernPlanValidator.validate(binding.schemaRef, binding);
  }
  const bindingValue = (value) => {
    const basis = Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'bindingDigest'));
    return { ...basis, bindingDigest: canonicalDigest(basis) };
  };
  const framesBinding = planBindings.find((item) => item.phase === 'frames');
  assert.throws(() => westernPlanValidator.validate(
    framesBinding.schemaRef,
    bindingValue({
      ...framesBinding,
      capabilityInput: {
        ...framesBinding.capabilityInput,
        callerResultFixture: true,
      },
    }),
  ), (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
  const requestBinding = planBindings.find((item) =>
    item.phase === 'analysis_request');
  const reversedRequest = bindingValue({
    ...requestBinding,
    upstreamResultRefs: [...requestBinding.upstreamResultRefs].reverse(),
  });
  westernPlanValidator.validate(reversedRequest.schemaRef, reversedRequest);
  for (const mutatedRefs of [
    requestBinding.upstreamResultRefs.slice(1),
    [
      requestBinding.upstreamResultRefs[0],
      requestBinding.upstreamResultRefs[0],
      requestBinding.upstreamResultRefs[2],
    ],
    requestBinding.upstreamResultRefs.map((item, index) =>
      index === 1 ? { ...item, capabilityRef: 'shared.face.cluster.compute@1' } :
        item),
    requestBinding.upstreamResultRefs.map((item, index) =>
      index === 2 ? {
        ...item,
        resultSchemaRef:
          'helix://contracts/types/FaceEmbeddingSetHandle/v1',
      } : item),
  ]) {
    assert.throws(() => westernPlanValidator.validate(
      requestBinding.schemaRef,
      bindingValue({
        ...requestBinding,
        upstreamResultRefs: mutatedRefs,
      }),
    ), (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
  }
  const westernResultValidator = createCapabilityContractValidator({
    schemas: [
      artifactHandleSchema,
      faceClusterSetHandleSchema,
      faceEmbeddingSetHandleSchema,
      frameArtifactSetSchema,
      personMatchEvidenceSchema,
      westernAnalysisResultSchema,
    ],
  });
  const persistedWesternResults = database.prepare(
    `SELECT result_schema_ref,result_json,result_digest
       FROM fx_event_result_bindings
      WHERE result_schema_ref IN (
        'helix://contracts/types/ArtifactHandle/v1',
        'helix://contracts/types/FaceClusterSetHandle/v1',
        'helix://contracts/types/FaceEmbeddingSetHandle/v1',
        'helix://contracts/types/FrameArtifactSet/v1',
        'helix://contracts/types/PersonMatchEvidence/v1',
        'helix://contracts/types/WesternAnalysisResult/v1'
      )`
  ).all();
  assert.equal(persistedWesternResults.length >= 6, true);
  for (const row of persistedWesternResults) {
    const value = JSON.parse(row.result_json);
    assert.equal(canonicalJson(value), row.result_json);
    assert.equal(canonicalDigest(value), row.result_digest);
    westernResultValidator.validate(row.result_schema_ref, value);
  }
  const tamperedResult = {
    ...JSON.parse(persistedWesternResults[0].result_json),
    callerResultFixture: true,
  };
  assert.throws(() => westernResultValidator.validate(
    persistedWesternResults[0].result_schema_ref,
    tamperedResult,
  ), (error) => error.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
  database.close();

  const sourceAfter = await snapshotFiles(sourceLocations);
  assert.deepEqual(sourceAfter, sourceBefore);
});
