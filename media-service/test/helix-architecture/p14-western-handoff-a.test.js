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
} = require('../../src/helix/contracts/canonical-json');
const {
  createCleanServiceHost,
} = require('../../src/clean-service-host');
const {
  createCleanMediaProbe,
} = require('../../src/clean-media-probe');
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

const secretRoot = 'p14-western-handoff-a-secret-root-0123456789abcdef';
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

test('Western stage boundary precedes every Routing Policy read', () => {
  const source = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/helix/domains/libra/application/movie-formation-coordinator.js',
  ), 'utf8');
  const boundary = source.indexOf(
    "if (subject.contentProfile === 'western_adult')",
  );
  const policyRead = source.indexOf(
    'const policy = policies.current(subject.routingProvenance.sourceFieldId);',
  );
  assert.ok(boundary > 0);
  assert.ok(policyRead > boundary);
  assert.match(
    source.slice(boundary, policyRead),
    /stage: 'formation_not_started'/,
  );
});

test('Western public HTTP freezes profile Hint and accepts one exact Handoff A', async (t) => {
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
      'formation_not_started',
    );
    assert.equal(
      accepted.json().movieJourney.handoff.formation.reasonCode,
      'western_routing_checkpoint_not_started',
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
  for (const table of [
    'libra_routing_assessments',
    'libra_routing_decisions',
    'libra_decision_basis_revisions',
    'libra_acceptance_specs',
    'libra_runs',
    'libra_workspaces',
    'libra_workspace_revisions',
    'libra_workspace_material_refs',
    'libra_product_fact_revisions',
    'libra_product_identity_revisions',
    'libra_product_packages',
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) count FROM ${table}`).get().count,
      0,
      table,
    );
  }
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
      'formation_not_started',
    );
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
  for (const table of [
    'libra_routing_assessments',
    'libra_routing_decisions',
    'libra_decision_basis_revisions',
    'libra_acceptance_specs',
    'libra_runs',
    'libra_workspaces',
    'libra_workspace_revisions',
    'libra_workspace_material_refs',
    'libra_product_fact_revisions',
    'libra_product_identity_revisions',
    'libra_product_packages',
  ]) {
    assert.equal(
      database.prepare(`SELECT count(*) count FROM ${table}`).get().count,
      0,
      table,
    );
  }
  database.close();

  const sourceAfter = await snapshotFiles(sourceLocations);
  assert.deepEqual(sourceAfter, sourceBefore);
});
