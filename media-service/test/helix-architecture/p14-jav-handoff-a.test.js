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

const secretRoot = 'p14-jav-handoff-a-secret-root-0123456789abcdef';
const schemaDdl = fs.readFileSync(path.resolve(
  __dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');

function probe(readHandle) {
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

test('JAV public HTTP preserves code evidence and accepts one exact Handoff A', async (t) => {
  const retainedSampleRoot = String(
    process.env.P14_JAV_SAMPLE_ROOT || ''
  ).trim();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-jav-handoff-a-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const sourceRoot = retainedSampleRoot || path.join(root, 'jav-source');
  fs.mkdirSync(adminDistDir, { recursive: true });
  if (!retainedSampleRoot) fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<!doctype html><div id="root"></div>',
  );
  const syntheticFiles = new Map([
    ['SDKI-001 Skin Diamond.mkv', Buffer.from('jav-primary')],
    ['SDKI-001 Skin Diamond.nfo', Buffer.from('<movie><id>SDKI-001</id></movie>')],
    ['movie.nfo', Buffer.from('<movie><title>Local JAV metadata</title></movie>')],
    ['poster.jpg', Buffer.from('jav-poster')],
    ['OTHER-999.nfo', Buffer.from('<movie><id>OTHER-999</id></movie>')],
  ]);
  const retainedNames = [
    'SDKI-001 Skin Diamond.mkv',
    'SDKI-001 Skin Diamond.nfo',
    'movie.nfo',
    'poster.jpg',
  ];
  const files = retainedSampleRoot
    ? new Map(retainedNames.map((name) => [
      name,
      fs.readFileSync(path.join(sourceRoot, name)),
    ]))
    : syntheticFiles;
  if (!retainedSampleRoot) {
    for (const [name, bytes] of files) {
      fs.writeFileSync(path.join(sourceRoot, name), bytes);
    }
  }
  const sourceBefore = new Map([...files].map(([name]) => {
    const location = path.join(sourceRoot, name);
    return [location, {
      bytes: fs.readFileSync(location),
      mtimeMs: fs.statSync(location).mtimeMs,
    }];
  }));

  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  const access = {
    fieldId: 'jav-handoff-field',
    revision: 1,
    endpointId: 'jav-handoff-endpoint',
    rootLocation: sourceRoot,
    mountScopeId: 'jav-handoff-mount',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/jav-handoff-access/v1',
  };
  const policyValue = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.jpg', '.mkv', '.nfo'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const policyBasis = {
    extractionPolicyId: 'jav-handoff-policy',
    revision: 1,
    ...policyValue,
  };
  const register = {
    idempotencyKey: 'jav-handoff-register',
    fieldId: access.fieldId,
    name: 'JAV Handoff Source',
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
    idempotencyKey: 'jav-handoff-observe',
    fieldId: access.fieldId,
    expectedAccessRevision: 1,
    expectedObservationRevision: 0,
    pageBudget: 8,
  };
  let mediaProbeCalls = 0;
  const realMediaProbe = retainedSampleRoot
    ? createCleanMediaProbe()
    : null;
  const mediaProbe = Object.freeze({
    async probe(readHandle) {
      mediaProbeCalls += 1;
      if (realMediaProbe) return realMediaProbe.probe(readHandle);
      return probe(readHandle);
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
          new Error('JAV fault after Triage Results'),
          { code: 'P14_JAV_FAULT_AFTER_TRIAGE_RESULTS' },
        );
      }
    },
  });
  try {
    const cookie = await session(host, initialized.adminApiKey);
    const registered = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: register,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    const interrupted = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: { cookie },
      payload: observe,
    });
    assert.equal(interrupted.statusCode, 400, interrupted.body);
    assert.equal(
      interrupted.json().error.details.reasonCode,
      'P14_JAV_FAULT_AFTER_TRIAGE_RESULTS',
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
      'routing_unresolved',
    );
    assert.equal(
      accepted.json().movieJourney.handoff.formation.reasonCode,
      'routing_policy_unavailable',
    );
    assert.equal(
      accepted.json().movieJourney.handoff.production,
      null,
    );
  } finally {
    await host.close();
  }
  assert.equal(mediaProbeCalls, callsBeforeAcceptance);

  database = new Database(
    path.join(dataDir, 'shelfdeck.db'),
    { readonly: true },
  );
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
    contentProfile: 'jav',
    structureKind: 'single',
    displayIdentity: 'SDKI-001',
  });
  const claim = JSON.parse(candidate.identity_claim_json);
  assert.equal(claim.claimKind, 'jav_code');
  assert.equal(claim.javCode, 'SDKI-001');
  assert.equal(claim.displayIdentity, 'SDKI-001');
  assert.deepEqual(
    claim.sourceHints.map((item) => item.hintKind),
    ['field_content_profile_hint', 'filename_title', 'jav_code'],
  );
  assert.equal(claim.sourceHints.find(
    (item) => item.hintKind === 'jav_code'
  ).hintValue, 'SDKI-001');
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
  assert.equal(related.filter((item) => item.role === 'nfo').length, 2);
  assert.equal(related.filter((item) => item.role === 'poster').length, 1);
  assert.equal(related.some((item) =>
    item.location.endsWith('OTHER-999.nfo')), false);
  const subject = database.prepare(
    `SELECT subject_id,structure_kind,content_profile,intake_revision
       FROM libra_subjects`
  ).get();
  assert.equal(subject.structure_kind, 'single');
  assert.equal(subject.content_profile, 'jav');
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
    assert.equal(snapshot.candidatePackage.contentProfile, 'jav');
    assert.equal(snapshot.primaryInputManifest.structureKind, 'single');
    assert.equal(snapshot.candidatePackage.identityClaim.javCode, 'SDKI-001');
    assert.equal(snapshot.primaryInputManifest.members.length, 1);
    assert.equal(snapshot.candidatePackage.relatedReferences.length, 3);
    assert.equal(snapshot.candidatePackage.relatedReferences.some((item) =>
      item.location.endsWith('OTHER-999.nfo')), false);
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
      headers: {
        cookie: await session(host, initialized.adminApiKey),
      },
      payload: observe,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().observation.replayed, true);
    assert.equal(replay.json().movieJourney.replayed, true);
    const conflict = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${access.fieldId}/actions/observe`,
      headers: {
        cookie: await session(host, initialized.adminApiKey),
      },
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
  database.close();

  for (const [location, expected] of sourceBefore) {
    assert.deepEqual(fs.readFileSync(location), expected.bytes);
    assert.equal(fs.statSync(location).mtimeMs, expected.mtimeMs);
  }
});
