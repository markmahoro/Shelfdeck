'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

const SOURCE = 'F:\\shelfdeck_test_zone\\test_film\\香火 (2003)\\香火 (2003).mkv';
const ALLOWED_ROOT = path.resolve('F:\\shelfdeck_test_zone\\runs');
const PEOPLE = Object.freeze(Array.from({ length: 16 }, (_value, index) => Object.freeze({
  id: 80_000 + index,
  name: `Qualification Person ${String(index + 1).padStart(2, '0')}`,
  character: `Role ${index + 1}`,
  profile_path: `/qualification-person-${index + 1}.jpg`,
})));

function response(status, value, contentType = 'application/json') {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
  return new Response(bytes, { status, headers: { 'content-type': contentType, 'content-length': String(bytes.length) } });
}

function tmdbFetch(input) {
  const url = new URL(String(input));
  if (url.hostname === 'image.tmdb.org') {
    return Promise.resolve(response(200, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg'));
  }
  if (url.pathname === '/3/configuration') {
    return Promise.resolve(response(200, { images: { secure_base_url: 'https://image.tmdb.org/t/p/' } }));
  }
  if (url.pathname === '/3/movie/550/images') {
    return Promise.resolve(response(200, {
      posters: [{ file_path: '/qualification-poster.jpg' }],
      backdrops: [{ file_path: '/qualification-fanart.jpg' }],
    }));
  }
  if (url.pathname === '/3/movie/550') {
    return Promise.resolve(response(200, {
      id: 550,
      title: 'People Evidence Movie',
      original_title: 'People Evidence Movie',
      original_language: 'en',
      release_date: '1999-10-15',
      overview: 'A deterministic People registration qualification movie.',
      genres: [{ id: 18, name: 'Drama' }],
      credits: { cast: PEOPLE, crew: [{ id: 1, name: 'Qualification Director', job: 'Director' }] },
      alternative_titles: { titles: [] },
      translations: { translations: [] },
    }));
  }
  const personMatch = url.pathname.match(/^\/3\/person\/(\d+)$/);
  if (personMatch) {
    const person = PEOPLE.find((item) => String(item.id) === personMatch[1]);
    return Promise.resolve(response(person ? 200 : 404, person || { status_code: 34 }));
  }
  return Promise.resolve(response(404, { status_code: 34 }));
}

async function adminSession(host, apiKey) {
  const result = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': apiKey } });
  assert.equal(result.statusCode, 204, result.body);
  return result.headers['set-cookie'];
}

async function configureTmdb(host, cookie) {
  const tested = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: {
      kind: 'tmdb', idempotencyKey: 'people-e2e-tmdb-test', endpoint: 'https://api.themoviedb.org/3',
      credential: { kind: 'api_key', value: 'qualification-only-tmdb-key' }, settings: { language: 'zh-CN' }, timeoutMs: 5_000,
    },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  const configured = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: {
      kind: 'tmdb', idempotencyKey: 'people-e2e-tmdb-save', expectedConfigRevision: 0,
      connectionProofId: tested.json().connectionProofId,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  assert.equal(configured.json().configRevision, 1);
}

async function createInputs(host, cookie, roots) {
  const shelf = await host.inject({
    method: 'POST', url: '/v1/admin/shelves', headers: { cookie }, payload: {
      idempotencyKey: 'people-e2e-shelf-create', shelfId: 'people-e2e-shelf', name: 'People Qualification Shelf',
      targetRootLocation: roots.shelf, ruleTemplateId: 'system-beta-recommended', expectedTemplateRevision: 1,
      placementPolicy: {
        folderTemplate: '{title} ({year})', primaryTemplate: '{stem}{ext}', nfoTemplate: '{stem}.nfo',
        subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}', posterTemplate: 'poster{ext}',
        fanartTemplate: 'fanart{ext}', collisionPolicy: 'reject',
      },
    },
  });
  assert.equal(shelf.statusCode, 201, shelf.body);
  const policyValue = Object.freeze({
    includedDirectories: [], excludedDirectories: [], allowedExtensions: ['.mkv', '.nfo'],
    minimumSizeBytes: 0, excludedMaterialKeys: [],
  });
  const access = Object.freeze({
    fieldId: 'people-e2e-field', revision: 1, endpointId: 'people-e2e-endpoint', rootLocation: roots.field,
    mountScopeId: 'people-e2e-mount', mountScopeRevision: 1,
    accessSchemaRef: 'helix://e2e/people-field-access/v1',
  });
  const field = await host.inject({
    method: 'POST', url: '/v1/admin/material-fields', headers: { cookie }, payload: {
      idempotencyKey: 'people-e2e-field-create', fieldId: access.fieldId, name: 'People Qualification Field',
      contentProfileHint: 'movie',
      policy: {
        extractionPolicyId: 'people-e2e-policy', revision: 1,
        policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy: policyValue,
        policyDigest: canonicalDigest({ extractionPolicyId: 'people-e2e-policy', revision: 1, ...policyValue }),
      },
      access: { ...access, accessDigest: canonicalDigest(access) },
    },
  });
  assert.equal(field.statusCode, 201, field.body);
  const routing = await host.inject({
    method: 'PATCH', url: '/v1/admin/routing/material-fields/people-e2e-field', headers: { cookie }, payload: {
      idempotencyKey: 'people-e2e-routing', fieldId: 'people-e2e-field', expectedPolicyId: null, expectedRevision: 0,
      policy: {
        routingPolicyId: 'people-e2e-routing-policy', mode: 'sorting',
        targets: [{ shelfId: 'people-e2e-shelf', rank: 1, matchExpression: {
          nodeKind: 'predicate', factKind: 'content_profile', operator: 'eq', expectedValue: 'movie',
        } }],
      },
    },
  });
  assert.equal(routing.statusCode, 200, routing.body);
}

function snapshot(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    const arca = database.prepare(`
      SELECT COUNT(DISTINCT json_extract(value, '$.providerKey')) AS count
        FROM arca_inventory_person_relations, json_each(provider_identity_json)
       WHERE json_extract(value, '$.provider')='tmdb'
         AND json_extract(value, '$.namespace')='tmdb_person'
    `).get().count;
    const people = database.prepare(`
      SELECT COUNT(DISTINCT provider_key) AS count
        FROM people_provider_identities
       WHERE provider='tmdb' AND namespace='tmdb_person' AND active_guard=1
    `).get().count;
    const personCount = database.prepare("SELECT COUNT(*) AS count FROM people_persons WHERE status='active'").get().count;
    const candidateCount = database.prepare("SELECT COUNT(*) AS count FROM people_registration_candidates WHERE current_state='open'").get().count;
    const entries = database.prepare("SELECT COUNT(*) AS count FROM arca_shelf_entries WHERE status='active'").get().count;
    const cursor = database.prepare("SELECT revision,opaque_cursor FROM fx_reconcile_cursors WHERE owner_domain='people' AND reconciler_key='ondeck-person-evidence'").get() || null;
    return Object.freeze({ arcaDistinctTmdbPersonCount: arca, peopleDistinctTmdbPersonCount: people,
      activePersonCount: personCount, openCandidateCount: candidateCount, activeShelfEntryCount: entries, cursor });
  } finally {
    database.close();
  }
}

async function waitForPeople(databasePath) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = snapshot(databasePath);
    if (value.peopleDistinctTmdbPersonCount === PEOPLE.length) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return snapshot(databasePath);
}

function assertRunRoot(runRoot) {
  const resolved = path.resolve(runRoot);
  const relative = path.relative(ALLOWED_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('SHELFDECK_PEOPLE_E2E_ROOT must be a new child of F:\\shelfdeck_test_zone\\runs.');
  }
  return resolved;
}

async function main() {
  const runRoot = assertRunRoot(process.env.SHELFDECK_PEOPLE_E2E_ROOT || '');
  if (fs.existsSync(path.join(runRoot, 'data'))) throw new Error('People qualification data directory already exists.');
  const roots = Object.freeze({
    data: path.join(runRoot, 'data'), field: path.join(runRoot, 'field'), shelf: path.join(runRoot, 'shelf'),
    tmp: path.join(runRoot, 'tmp'), playwright: path.join(runRoot, 'playwright'), evidence: path.join(runRoot, 'evidence'),
  });
  for (const target of Object.values(roots).filter((value) => value !== roots.data)) fs.mkdirSync(target, { recursive: true });
  const moviePath = path.join(roots.field, 'People Evidence Movie (1999).mkv');
  fs.copyFileSync(SOURCE, moviePath);
  fs.writeFileSync(path.join(roots.field, 'People Evidence Movie (1999).nfo'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<movie><title>People Evidence Movie</title><year>1999</year><tmdbid>550</tmdbid></movie>\n');
  const secretRoot = crypto.randomBytes(32).toString('base64url');
  const initialized = initializeCleanData({
    dataDir: roots.data, confirmation: 'INITIALIZE_HELIX_CLEAN_V1', secretRoot,
  });
  fs.writeFileSync(path.join(runRoot, 'private-runtime.json'), JSON.stringify({
    adminApiKey: initialized.adminApiKey, secretRoot,
  }, null, 2));
  const mediaProbe = Object.freeze({ async probe(readHandle) {
    const result = {
      resultKind: 'probed', sourceHandleDigest: canonicalDigest(readHandle), durationMs: 7_200_000,
      videoStreams: [{ streamIndex: 0, codec: 'hevc', dispositionDefault: true, width: 1920, height: 1080 }],
      audioStreams: [], subtitleStreams: [], discTopology: null, payloadDigest: '',
    };
    result.payloadDigest = canonicalDigest(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'payloadDigest')));
    return Object.freeze(result);
  } });
  const hostOptions = {
    dataDir: roots.data,
    adminDistDir: path.resolve(__dirname, '../../dist/admin'),
    secretRoot,
    mediaProbe,
    integrationFetch: tmdbFetch,
    libraWorkspaceRoot: path.join(runRoot, 'workspace'),
    integrationReservedRoots: [roots.field, roots.shelf],
  };
  let host = await createCleanServiceHost(hostOptions);
  let first;
  try {
    const cookie = await adminSession(host, initialized.adminApiKey);
    await configureTmdb(host, cookie);
    await createInputs(host, cookie, roots);
    const observed = await host.inject({
      method: 'POST', url: '/v1/admin/material-fields/people-e2e-field/actions/observe', headers: { cookie }, payload: {
        idempotencyKey: 'people-e2e-observe', fieldId: 'people-e2e-field',
        expectedAccessRevision: 1, expectedObservationRevision: 0, pageBudget: 8,
      },
    });
    assert.ok([200, 202].includes(observed.statusCode), observed.body);
    first = await waitForPeople(path.join(roots.data, 'shelfdeck.db'));
    assert.equal(first.activeShelfEntryCount, 1);
    assert.equal(first.arcaDistinctTmdbPersonCount, PEOPLE.length);
    assert.equal(first.peopleDistinctTmdbPersonCount, PEOPLE.length);
    assert.equal(first.activePersonCount, PEOPLE.length);
    assert.equal(first.openCandidateCount, 0);
  } finally {
    await host.close();
  }
  host = await createCleanServiceHost(hostOptions);
  let restarted;
  try {
    restarted = await waitForPeople(path.join(roots.data, 'shelfdeck.db'));
    assert.deepEqual({
      people: restarted.peopleDistinctTmdbPersonCount,
      active: restarted.activePersonCount,
      candidates: restarted.openCandidateCount,
    }, { people: PEOPLE.length, active: PEOPLE.length, candidates: 0 });
  } finally {
    await host.close();
  }
  const facts = Object.freeze({
    schema: 'shelfdeck.people-registration-avatar-qualification@1',
    result: 'PASS', sourceBaseline: SOURCE, copiedMovie: moviePath,
    expectedStrongProviderPeople: PEOPLE.length, first, restarted,
    sourceBytes: fs.statSync(SOURCE).size, copiedBytes: fs.statSync(moviePath).size,
  });
  fs.writeFileSync(path.join(roots.evidence, 'people-registration-facts.json'), JSON.stringify(facts, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ result: facts.result, expectedStrongProviderPeople: PEOPLE.length,
    registeredPeople: restarted.activePersonCount, restartStable: true }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
