'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const SECRET_ROOT = 'routing-decision-e2e-secret-root-20260811';

function mediaProbe() {
  return Object.freeze({ async probe(readHandle) {
    const result = { resultKind: 'probed', sourceHandleDigest: canonicalDigest(readHandle), durationMs: 1_000,
      videoStreams: [{ streamIndex: 0, codec: 'hevc', dispositionDefault: true, width: 1920, height: 1080 }],
      audioStreams: [], subtitleStreams: [], discTopology: null, payloadDigest: '' };
    result.payloadDigest = canonicalDigest(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'payloadDigest')));
    return Object.freeze(result);
  } });
}

function routingHandle() {
  return Object.freeze({ schemaRef: 'helix://contracts/types/IntegrationHandle/v1', schemaVersion: 1,
    handleId: 'routing-tmdb-handle', integrationId: 'routing-tmdb', integrationType: 'tmdb', configRevision: 1,
    secretRef: 'routing-tmdb-secret', allowedOperation: 'libra.routing.fact.observe@1',
    expiresAtMs: Number.MAX_SAFE_INTEGER, fenceDigest: canonicalDigest('routing-tmdb-fence') });
}

async function session(host, apiKey) {
  const response = await host.inject({ method: 'POST', url: '/v1/admin/session', headers: { 'x-api-key': apiKey } });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

function fieldCommand(fieldId, root) {
  const policyValue = { includedDirectories: [], excludedDirectories: [], allowedExtensions: ['.mkv'], minimumSizeBytes: 0, excludedMaterialKeys: [] };
  const access = { fieldId, revision: 1, endpointId: fieldId + '-endpoint', rootLocation: root,
    mountScopeId: fieldId + '-mount', mountScopeRevision: 1, accessSchemaRef: 'helix://fixtures/routing-field-access/v1' };
  return Object.freeze({ idempotencyKey: fieldId + '-register', fieldId, name: fieldId, contentProfileHint: 'movie',
    policy: { extractionPolicyId: fieldId + '-policy', revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy: policyValue,
      policyDigest: canonicalDigest({ extractionPolicyId: fieldId + '-policy', revision: 1, ...policyValue }) },
    access: { ...access, accessDigest: canonicalDigest(access) } });
}

async function createShelf(host, cookie, root, shelfId, name) {
  fs.mkdirSync(root, { recursive: true });
  const response = await host.inject({ method: 'POST', url: '/v1/admin/shelves', headers: { cookie }, payload: {
    idempotencyKey: shelfId + '-create', shelfId, name, targetRootLocation: root,
    ruleTemplateId: 'system-beta-recommended', expectedTemplateRevision: 1,
    placementPolicy: { folderTemplate: '{title} ({year})', primaryTemplate:'{stem}{ext}', nfoTemplate:'{stem}.nfo', subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}', posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy: 'reject' },
  } });
  assert.equal(response.statusCode, 201, response.body);
}

async function publishPolicy(host, cookie, fieldId, routingPolicyId, mode, targets) {
  const response = await host.inject({ method: 'PATCH', url: `/v1/admin/routing/material-fields/${fieldId}`,
    headers: { cookie }, payload: { idempotencyKey: routingPolicyId + '-publish', fieldId,
      expectedPolicyId: null, expectedRevision: 0, policy: { routingPolicyId, mode, targets } } });
  assert.equal(response.statusCode, 200, response.body);
}

async function observe(host, cookie, fieldId) {
  const response = await host.inject({ method: 'POST', url: `/v1/admin/material-fields/${fieldId}/actions/observe`,
    headers: { cookie }, payload: { idempotencyKey: fieldId + '-observe', fieldId,
      expectedAccessRevision: 1, expectedObservationRevision: 0, pageBudget: 8 } });
  assert.equal(response.statusCode, 202, response.body);
}

function sourceReality(roots) {
  const entries = [];
  function visit(root, current = root) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(root, target);
      else if (entry.isFile()) entries.push({ root: path.basename(root), relativeLocation: path.relative(root, target).replaceAll('\\', '/'),
        sizeBytes: fs.statSync(target).size, contentDigest: canonicalDigest(fs.readFileSync(target).toString('base64')) });
    }
  }
  roots.forEach((root) => visit(root));
  return canonicalDigest({ schema: 'helix.routing-e2e-source-reality@1', entries });
}

async function waitForDurableAcceptance(databasePath, expectedSpecs, expectedRuns) {
  const database = new Database(databasePath, { readonly: true });
  let observed = null;
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      observed = Object.freeze({
        specs: database.prepare('SELECT count(*) count FROM libra_acceptance_specs').get().count,
        runs: database.prepare('SELECT count(*) count FROM libra_runs').get().count,
      });
      if (observed.specs === expectedSpecs && observed.runs === expectedRuns) return observed;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    database.close();
  }
  assert.fail(`Acceptance did not reach the durable expected state: ${JSON.stringify(observed)}`);
}

test('direct and sorting Routing Decisions continue through Acceptance Spec and admit resource-free Libra Runs', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-routing-decision-'));
  t.after(() => {
    if (process.env.HELIX_KEEP_TEST_DATA === '1') process.stderr.write(`preserved=${root}\n`);
    else fs.rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, 'data'), adminDistDir = path.join(root, 'admin');
  const directRoot = path.join(root, 'material-fields', 'direct'), sortingRoot = path.join(root, 'routing-material-field');
  fs.mkdirSync(adminDistDir, { recursive: true }); fs.mkdirSync(directRoot, { recursive: true }); fs.mkdirSync(sortingRoot, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  for (let index = 1; index <= 19; index += 1) fs.writeFileSync(path.join(directRoot, `Direct.Movie.${String(index).padStart(2, '0')}.mkv`), 'movie');
  for (const [title, year] of [['顽主', 1989], ['爆弹', 2025], ['0.5毫米', 2014]]) {
    const directory = path.join(sortingRoot, title); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, title + '.mkv'), 'movie');
    fs.writeFileSync(path.join(directory, title + '.nfo'), `<movie><title>${title}</title><year>${year}</year></movie>`);
  }
  for (const title of ['0.5毫米 Provider', '无NFO且无法解析的测试标题']) {
    const directory = path.join(sortingRoot, title); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, title + '.mkv'), 'movie');
  }
  const sourceBefore = sourceReality([directRoot, sortingRoot]);

  const initialized = initializeCleanData({ dataDir, confirmation: 'INITIALIZE_HELIX_CLEAN_V1', secretRoot: SECRET_ROOT });
  const providerCalls = [];
  let runtimeError = null;
  const hostOptions = { dataDir, adminDistDir, secretRoot: SECRET_ROOT, mediaProbe: mediaProbe(),
    onExecutionRuntimeError(error) { runtimeError = error; }, routingIntegrationHandleResolver: () => routingHandle(),
    routingProviderObservation: async ({ intent, integrationHandle }) => {
      assert.equal(integrationHandle.allowedOperation, 'libra.routing.fact.observe@1');
      providerCalls.push(Object.freeze({ title:intent.candidateDisplayTitle,
        requestedFactKinds:Object.freeze([...(intent.requestedFactKinds || [])]) }));
      if (intent.candidateDisplayTitle === '0.5毫米 provider') return Object.freeze([Object.freeze({
        providerKey: '100500', title: intent.candidateDisplayTitle, originalTitle: intent.candidateDisplayTitle,
        releaseYear: 2014, regionCodes: Object.freeze(['JP']), genreCodes: Object.freeze(['18']) })]);
      return Object.freeze([]);
    } };
  let host = await createCleanServiceHost(hostOptions);
  try {
    let cookie = await session(host, initialized.adminApiKey);
    for (const [fieldId, fieldRoot] of [['direct-routing-field', directRoot], ['sorting-routing-field', sortingRoot]]) {
      const created = await host.inject({ method: 'POST', url: '/v1/admin/material-fields', headers: { cookie }, payload: fieldCommand(fieldId, fieldRoot) });
      assert.equal(created.statusCode, 201, created.body);
    }
    const shelves = [['movie-test', 'movie test'], ['classics', '经典电影测试'], ['new-releases', '新片测试'], ['general', '普通电影测试']];
    for (const [shelfId, name] of shelves) await createShelf(host, cookie, path.join(root, 'routing-shelves', shelfId), shelfId, name);
    await publishPolicy(host, cookie, 'direct-routing-field', 'direct-routing-policy', 'direct', [
      { shelfId: 'movie-test', rank: 1, matchExpression: { nodeKind: 'always' } },
    ]);
    await publishPolicy(host, cookie, 'sorting-routing-field', 'sorting-routing-policy', 'sorting', [
      { shelfId: 'classics', rank: 1, matchExpression: { nodeKind: 'predicate', factKind: 'release_year', operator: 'lte', expectedValue: 1999 } },
      { shelfId: 'new-releases', rank: 2, matchExpression: { nodeKind: 'predicate', factKind: 'release_year', operator: 'gte', expectedValue: 2020 } },
      { shelfId: 'general', rank: 3, matchExpression: { nodeKind: 'always' } },
    ]);
    await observe(host, cookie, 'direct-routing-field'); await observe(host, cookie, 'sorting-routing-field');

    let formation;
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const response = await host.inject({ method: 'GET', url: '/v1/admin/formation', headers: { cookie } });
      assert.equal(response.statusCode, 200, response.body); formation = response.json();
      if (runtimeError) break;
      const resolvedCount=formation.items.filter((item)=>item.routingState==='resolved').length;
      const unresolvedCount=formation.items.filter((item)=>item.routingState==='unresolved').length;
      if (formation.summary.totalCount === 24 && resolvedCount === 23 && unresolvedCount === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ifError(runtimeError);
    assert.equal(formation.summary.pendingCount + formation.summary.inProgressCount +
      formation.summary.attentionRequiredCount + formation.summary.completedCount, 24);
    assert.equal(formation.summary.completedCount, 0);
    assert.equal(formation.items.filter((item)=>item.routingState==='resolved').length,23);
    assert.equal(formation.items.filter((item)=>item.routingState==='unresolved').length,1);
    assert.equal(formation.items.filter((item) => item.targetShelfId === 'movie-test').length, 19);
    const expected = new Map([['顽主', 'classics'], ['爆弹', 'new-releases'], ['0.5毫米', 'general'], ['0.5毫米 Provider', 'general']]);
    for (const [title, shelfId] of expected) assert.equal(formation.items.find((item) => item.displayIdentity === title)?.targetShelfId, shelfId, title);
    const unresolved = formation.items.find((item) => item.routingState === 'unresolved');
    assert.equal(unresolved.displayIdentity, '无NFO且无法解析的测试标题');
    assert.equal(unresolved.unresolvedReasonCode, 'higher_priority_rule_unknown');
    assert.deepEqual(providerCalls.filter((item)=>item.requestedFactKinds.includes('release_year'))
      .map((item)=>item.title).sort(), ['0.5毫米 provider', '无nfo且无法解析的测试标题'].sort());

    const alreadyResolved = formation.items.find((item) => item.routingState === 'resolved');
    const invalidManual = await host.inject({ method: 'POST', url: `/v1/admin/formation/subjects/${alreadyResolved.subjectId}/actions/choose-shelf`,
      headers: { cookie }, payload: { targetShelfId: 'general',
        expectedDecisionHead: { revision: alreadyResolved.routingDecisionHeadRevision, digest: alreadyResolved.routingDecisionHeadDigest },
        idempotencyKey: 'manual-resolved-state-conflict' } });
    assert.equal(invalidManual.statusCode, 409, invalidManual.body);
    assert.equal(invalidManual.json().error.code, 'ADMIN_ROUTING_MANUAL_STATE_CONFLICT');

    const manual = await host.inject({ method: 'POST', url: `/v1/admin/formation/subjects/${unresolved.subjectId}/actions/choose-shelf`,
      headers: { cookie }, payload: { targetShelfId: 'general',
        expectedDecisionHead: { revision: unresolved.routingDecisionHeadRevision, digest: unresolved.routingDecisionHeadDigest },
        idempotencyKey: 'manual-unresolved-to-general' } });
    assert.equal(manual.statusCode, 200, manual.body); assert.equal(manual.json().decision.result, 'resolved');
    const replay = await host.inject({ method: 'POST', url: `/v1/admin/formation/subjects/${unresolved.subjectId}/actions/choose-shelf`,
      headers: { cookie }, payload: { targetShelfId: 'general',
        expectedDecisionHead: { revision: unresolved.routingDecisionHeadRevision, digest: unresolved.routingDecisionHeadDigest },
        idempotencyKey: 'manual-unresolved-to-general' } });
    assert.equal(replay.statusCode, 200, replay.body); assert.equal(replay.json().replayed, true);

    await host.close();
    host = await createCleanServiceHost(hostOptions);
    cookie = await session(host, initialized.adminApiKey);
    await waitForDurableAcceptance(path.join(dataDir, 'shelfdeck.db'), 25, 24);
    const recovered = await host.inject({ method: 'GET', url: '/v1/admin/formation', headers: { cookie } });
    assert.equal(recovered.statusCode, 200, recovered.body);
    const recoveredSummary=recovered.json().summary;
    assert.equal(recoveredSummary.pendingCount + recoveredSummary.inProgressCount +
      recoveredSummary.attentionRequiredCount + recoveredSummary.completedCount, 24);
    assert.equal(recoveredSummary.completedCount, 0);
    assert.equal(recovered.json().items.filter((item)=>item.routingState==='resolved').length,24);
    assert.deepEqual(providerCalls.filter((item)=>item.requestedFactKinds.includes('release_year'))
      .map((item)=>item.title).sort(), ['0.5毫米 provider', '无nfo且无法解析的测试标题'].sort());
    assert.equal(sourceReality([directRoot, sortingRoot]), sourceBefore);

    const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly: true });
    try {
      assert.equal(database.prepare("SELECT count(*) count FROM libra_routing_decisions WHERE decision='resolved'").get().count, 24);
      assert.equal(database.prepare("SELECT count(*) count FROM libra_routing_decisions WHERE decision='unresolved'").get().count, 1);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE process_type='libra_routing' AND state='succeeded'").get().count, 29);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_workflow_events event JOIN fx_supporting_works work ON work.work_id=event.work_id WHERE work.process_type='libra_routing' AND event.capability_ref='libra.routing.fact.observe@1' AND event.state='succeeded'").get().count, 5);
      assert.equal(database.prepare("SELECT count(*) count FROM fx_workflow_events event JOIN fx_supporting_works work ON work.work_id=event.work_id WHERE work.process_type='libra_routing' AND event.capability_ref='libra.decision_basis.commit@1' AND event.state='succeeded'").get().count, 24);
      assert.equal(database.prepare('SELECT count(*) count FROM libra_acceptance_specs').get().count, 25);
      assert.equal(database.prepare("SELECT count(*) count FROM (SELECT subject_id,spec_digest FROM libra_acceptance_specs GROUP BY subject_id,spec_digest)").get().count, 24);
      assert.equal(database.prepare('SELECT count(*) count FROM libra_runs').get().count, 24);
      assert.equal(database.prepare('SELECT count(*) count FROM libra_workspaces').get().count, 0);
      assert.equal(database.prepare('SELECT count(*) count FROM libra_product_packages').get().count, 0);
      assert.equal(database.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count, 0);
    } finally { database.close(); }
  } finally { await host.close(); }
});
