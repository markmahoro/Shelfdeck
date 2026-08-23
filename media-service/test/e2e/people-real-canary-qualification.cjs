'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { parseRelatedNfoPeopleHints } = require('../../src/clean-product-production-port');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

const SOURCE_ROOT = path.resolve('F:\\shelfdeck_test_zone\\test_film\\放·逐 (2006)');
const ALLOWED_ROOT = path.resolve('F:\\shelfdeck_test_zone\\runs');
const PRIMARY_NAME = '放·逐 (2006) - 1080p Remux 2Audio DTS PTH.mkv';
const NFO_NAME = '放·逐 (2006) - 1080p Remux 2Audio DTS PTH.nfo';

function runRoot() {
  const resolved = path.resolve(process.env.SHELFDECK_PEOPLE_REAL_ROOT || '');
  const relative = path.relative(ALLOWED_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('SHELFDECK_PEOPLE_REAL_ROOT must be a new child of the F: qualification runs root.');
  }
  return resolved;
}

function sourceSnapshot() {
  return [PRIMARY_NAME, NFO_NAME].map((name) => {
    const value = fs.statSync(path.join(SOURCE_ROOT, name));
    return Object.freeze({ name, sizeBytes: value.size, mtimeMs: value.mtimeMs });
  });
}

function expectedPeopleFromNfo() {
  const hints = parseRelatedNfoPeopleHints(
    fs.readFileSync(path.join(SOURCE_ROOT, NFO_NAME), 'utf8'),
  );
  const people = hints.map((hint) => Object.freeze({
    displayName: hint.displayName,
    tmdbPersonId: hint.providerIdentities.find((identity) =>
      identity.provider === 'tmdb' &&
      identity.namespace === 'tmdb_person')?.providerKey || null,
  }));
  assert.equal(people.length, 23, 'The frozen source NFO actor set changed.');
  assert.equal(people.some((item) => item.tmdbPersonId === null), false,
    'The frozen source NFO must provide a stable TMDB identity for every actor.');
  assert.equal(new Set(people.map((item) => item.tmdbPersonId)).size, people.length,
    'The frozen source NFO TMDB Person identities must be unique.');
  return Object.freeze(people);
}

async function adminSession(host, apiKey) {
  const response = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': apiKey } });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

async function configureTmdb(host, cookie, credential) {
  const tested = await host.inject({
    method: 'POST', url: '/v1/admin/settings/integrations/tmdb/actions/test', headers: { cookie }, payload: {
      kind: 'tmdb', idempotencyKey: 'people-real-tmdb-test', endpoint: 'https://api.themoviedb.org/3',
      credential: { kind: 'api_key', value: credential }, settings: { language: 'zh-CN' }, timeoutMs: 10_000,
    },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  const configured = await host.inject({
    method: 'PATCH', url: '/v1/admin/settings/integrations/tmdb', headers: { cookie }, payload: {
      kind: 'tmdb', idempotencyKey: 'people-real-tmdb-save', expectedConfigRevision: 0,
      connectionProofId: tested.json().connectionProofId,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  assert.equal(configured.json().configRevision, 1);
}

async function createInputs(host, cookie, roots) {
  const shelf = await host.inject({
    method: 'POST', url: '/v1/admin/shelves', headers: { cookie }, payload: {
      idempotencyKey: 'people-real-shelf-create', shelfId: 'people-real-shelf', name: 'People Real Canary Shelf',
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
    fieldId: 'people-real-field', revision: 1, endpointId: 'people-real-endpoint', rootLocation: roots.field,
    mountScopeId: 'people-real-mount', mountScopeRevision: 1,
    accessSchemaRef: 'helix://e2e/people-real-field-access/v1',
  });
  const field = await host.inject({
    method: 'POST', url: '/v1/admin/material-fields', headers: { cookie }, payload: {
      idempotencyKey: 'people-real-field-create', fieldId: access.fieldId, name: 'People Real Canary Field',
      contentProfileHint: 'movie',
      policy: {
        extractionPolicyId: 'people-real-policy', revision: 1,
        policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy: policyValue,
        policyDigest: canonicalDigest({ extractionPolicyId: 'people-real-policy', revision: 1, ...policyValue }),
      },
      access: { ...access, accessDigest: canonicalDigest(access) },
    },
  });
  assert.equal(field.statusCode, 201, field.body);
  const routing = await host.inject({
    method: 'PATCH', url: '/v1/admin/routing/material-fields/people-real-field', headers: { cookie }, payload: {
      idempotencyKey: 'people-real-routing', fieldId: 'people-real-field', expectedPolicyId: null, expectedRevision: 0,
      policy: {
        routingPolicyId: 'people-real-routing-policy', mode: 'sorting',
        targets: [{ shelfId: 'people-real-shelf', rank: 1, matchExpression: {
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
    const arcaCount = database.prepare(`
      SELECT COUNT(DISTINCT json_extract(value, '$.providerKey')) AS count
        FROM arca_inventory_person_relations, json_each(provider_identity_json)
       WHERE json_extract(value, '$.provider')='tmdb'
         AND json_extract(value, '$.namespace')='tmdb_person'
    `).get().count;
    const people = database.prepare(`
      SELECT revisions.canonical_name AS name, identities.provider_key AS tmdbPersonId
        FROM people_persons AS people
        JOIN people_person_revisions AS revisions
          ON revisions.person_id=people.person_id AND revisions.revision=people.current_revision
        JOIN people_provider_identities AS identities
          ON identities.person_id=people.person_id AND identities.revision=people.current_revision
       WHERE people.status='active' AND identities.active_guard=1
         AND identities.provider='tmdb' AND identities.namespace='tmdb_person'
       ORDER BY CAST(identities.provider_key AS INTEGER)
    `).all();
    return Object.freeze({
      arcaDistinctTmdbPersonCount: arcaCount,
      peopleDistinctTmdbPersonCount: new Set(people.map((item) => item.tmdbPersonId)).size,
      activePersonCount: database.prepare("SELECT COUNT(*) AS count FROM people_persons WHERE status='active'").get().count,
      openCandidateCount: database.prepare("SELECT COUNT(*) AS count FROM people_registration_candidates WHERE current_state='open'").get().count,
      activeShelfEntryCount: database.prepare("SELECT COUNT(*) AS count FROM arca_shelf_entries WHERE status='active'").get().count,
      people,
    });
  } finally {
    database.close();
  }
}

async function waitForConvergence(databasePath, runtimeErrors, expectedCount) {
  const deadline = Date.now() + 180_000;
  let value = snapshot(databasePath);
  while (Date.now() < deadline) {
    value = snapshot(databasePath);
    if (value.activeShelfEntryCount === 1 && value.arcaDistinctTmdbPersonCount === expectedCount &&
        value.peopleDistinctTmdbPersonCount === value.arcaDistinctTmdbPersonCount &&
        value.activePersonCount === value.arcaDistinctTmdbPersonCount &&
        value.openCandidateCount === 0) return value;
    if (runtimeErrors.length) throw runtimeErrors.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return value;
}

async function main() {
  const root = runRoot();
  const credential = String(process.env.SHELFDECK_REAL_TMDB_API_KEY || '');
  if (!credential) throw new Error('SHELFDECK_REAL_TMDB_API_KEY is required.');
  if (fs.existsSync(path.join(root, 'data'))) throw new Error('Real People Canary data directory already exists.');
  const roots = Object.freeze({
    data: path.join(root, 'data'), field: path.join(root, 'field'), shelf: path.join(root, 'shelf'),
    tmp: path.join(root, 'tmp'), playwright: path.join(root, 'playwright'), evidence: path.join(root, 'evidence'),
    workspace: path.join(root, 'workspace'),
  });
  for (const target of Object.values(roots).filter((value) => value !== roots.data)) fs.mkdirSync(target, { recursive: true });
  const before = sourceSnapshot();
  const expectedPeople = expectedPeopleFromNfo();
  for (const item of before) fs.copyFileSync(path.join(SOURCE_ROOT, item.name), path.join(roots.field, item.name));
  const secretRoot = crypto.randomBytes(32).toString('base64url');
  const initialized = initializeCleanData({ dataDir: roots.data, confirmation: 'INITIALIZE_HELIX_CLEAN_V1', secretRoot });
  fs.writeFileSync(path.join(root, 'private-runtime.json'), JSON.stringify({
    adminApiKey: initialized.adminApiKey, secretRoot,
  }, null, 2));
  const runtimeErrors = [];
  const hostOptions = {
    dataDir: roots.data, adminDistDir: path.resolve(__dirname, '../../dist/admin'), secretRoot,
    libraWorkspaceRoot: roots.workspace, integrationReservedRoots: [roots.field, roots.shelf],
    onExecutionRuntimeError(error) { runtimeErrors.push(error); },
  };
  const databasePath = path.join(roots.data, 'shelfdeck.db');
  let host = await createCleanServiceHost(hostOptions);
  let first;
  try {
    const cookie = await adminSession(host, initialized.adminApiKey);
    await configureTmdb(host, cookie, credential);
    await createInputs(host, cookie, roots);
    const observed = await host.inject({
      method: 'POST', url: '/v1/admin/material-fields/people-real-field/actions/observe', headers: { cookie }, payload: {
        idempotencyKey: 'people-real-observe', fieldId: 'people-real-field',
        expectedAccessRevision: 1, expectedObservationRevision: 0, pageBudget: 8,
      },
    });
    assert.equal(observed.statusCode, 202, observed.body);
    first = await waitForConvergence(databasePath, runtimeErrors, expectedPeople.length);
    assert.deepEqual({
      arca:first.arcaDistinctTmdbPersonCount,
      people:first.peopleDistinctTmdbPersonCount,
      active:first.activePersonCount,
      candidates:first.openCandidateCount,
    }, { arca:23, people:23, active:23, candidates:0 });
  } finally {
    await host.close();
  }
  runtimeErrors.length = 0;
  host = await createCleanServiceHost(hostOptions);
  let restarted;
  try {
    restarted = await waitForConvergence(databasePath, runtimeErrors, expectedPeople.length);
    assert.deepEqual({
      arca: restarted.arcaDistinctTmdbPersonCount, people: restarted.peopleDistinctTmdbPersonCount,
      active: restarted.activePersonCount, candidates: restarted.openCandidateCount,
    }, {
      arca: first.arcaDistinctTmdbPersonCount, people: first.peopleDistinctTmdbPersonCount,
      active: first.activePersonCount, candidates: first.openCandidateCount,
    });
  } finally {
    await host.close();
  }
  const after = sourceSnapshot();
  assert.deepEqual(after, before);
  const facts = Object.freeze({
    schema: 'shelfdeck.people-real-canary-qualification@1', result: 'PASS', movie: '放·逐 (2006)',
    tmdbMovieId: '13807', sourceRoot: SOURCE_ROOT, expectedPeople,
    first, restarted, sourceBefore: before, sourceAfter: after,
  });
  fs.writeFileSync(path.join(roots.evidence, 'people-real-canary-facts.json'), JSON.stringify(facts, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ result: 'PASS', movie: facts.movie,
    registeredPeople: restarted.activePersonCount, restartStable: true }) + '\n');
}

main().catch((error) => {
  process.stderr.write(`${error.code || error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
